import type { MessageMetadata } from '../types/message';
import type { GeneratedRoundMessage } from './chatEngine';

const MAX_SEGMENT_COUNT = 3;
const DEFAULT_MIN_LENGTH_TO_SPLIT = 54;

function clampSegmentCount(count: unknown) {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(MAX_SEGMENT_COUNT, Math.round(count)));
}

function normalizeChatText(content: string) {
  return content.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function splitParagraphs(content: string) {
  return content
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitSentences(content: string) {
  const pieces: string[] = [];
  let cursor = 0;
  const boundary = /[。！？!?…]+["'”’）)]?\s*/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(content))) {
    const end = match.index + match[0].length;
    const piece = content.slice(cursor, end).trim();
    if (piece) pieces.push(piece);
    cursor = end;
  }
  const tail = content.slice(cursor).trim();
  if (tail) pieces.push(tail);
  return pieces.length > 1 ? pieces : [content.trim()].filter(Boolean);
}

function splitSoftClauses(content: string) {
  const clauses: string[] = [];
  let cursor = 0;
  const boundary = /[，,；;、]\s*/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(content))) {
    const end = match.index + match[0].length;
    const piece = content.slice(cursor, end).trim();
    if (piece) clauses.push(piece);
    cursor = end;
  }
  const tail = content.slice(cursor).trim();
  if (tail) clauses.push(tail);
  return clauses.length > 1 ? clauses : [content.trim()].filter(Boolean);
}

function collectNaturalPieces(content: string) {
  const paragraphs = splitParagraphs(content);
  if (paragraphs.length > 1) return paragraphs.flatMap((paragraph) => splitSentences(paragraph));
  const sentences = splitSentences(content);
  if (sentences.length > 1) return sentences;
  return splitSoftClauses(content);
}

function packPieces(pieces: string[], targetCount: number, targetLength: number) {
  const segments: string[] = [];
  let current = '';
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    const next = current ? `${current}${needsSpace(current, piece) ? ' ' : ''}${piece}` : piece;
    const remainingPieces = pieces.length - index - 1;
    const remainingSlots = targetCount - segments.length - 1;
    if (current && next.length >= targetLength && remainingPieces >= remainingSlots) {
      segments.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) segments.push(current);

  while (segments.length > targetCount) {
    const tail = segments.pop();
    if (!tail) break;
    segments[segments.length - 1] = `${segments[segments.length - 1]}${needsSpace(segments[segments.length - 1], tail) ? ' ' : ''}${tail}`;
  }
  return mergeTinySegments(segments);
}

function needsSpace(left: string, right: string) {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function mergeTinySegments(segments: string[]) {
  const merged: string[] = [];
  for (const segment of segments) {
    if (segment.length < 8 && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${needsSpace(merged[merged.length - 1], segment) ? ' ' : ''}${segment}`;
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function hasMediaMetadata(metadata?: MessageMetadata) {
  return Boolean(metadata?.attachments?.length || metadata?.generationDecision);
}

function stripTurnLevelMetadata(metadata?: MessageMetadata): MessageMetadata | undefined {
  if (!metadata) return undefined;
  const next: MessageMetadata = {};
  if (metadata.format) next.format = metadata.format;
  if (metadata.visibility) next.visibility = metadata.visibility;
  return Object.keys(next).length ? next : undefined;
}

function cloneSegmentMessage(message: GeneratedRoundMessage, content: string, index: number): GeneratedRoundMessage {
  if (index === 0) {
    return {
      ...message,
      content,
    };
  }
  return {
    ...message,
    content,
    metadata: stripTurnLevelMetadata(message.metadata),
    interactionHint: null,
    interactionHints: null,
    addressedTargetIds: null,
    primaryAddressedTargetId: null,
    socialEventHints: null,
    conflictFocus: null,
  };
}

export function splitGeneratedMessageText(content: string, requestedCount = 1) {
  const normalized = normalizeChatText(content);
  if (!normalized) return [];
  const desiredCount = clampSegmentCount(requestedCount);
  const inferredCount = normalized.length >= 170 ? 3 : normalized.length >= DEFAULT_MIN_LENGTH_TO_SPLIT ? 2 : 1;
  const targetCount = Math.max(desiredCount, inferredCount);
  if (targetCount <= 1) return [normalized];

  const pieces = collectNaturalPieces(normalized);
  const minLengthToSplit = desiredCount > 1 ? 28 : DEFAULT_MIN_LENGTH_TO_SPLIT;
  if (pieces.length <= 1 || normalized.length < minLengthToSplit) return [normalized];
  const targetLength = Math.max(24, Math.ceil(normalized.length / targetCount));
  const segments = packPieces(pieces, targetCount, targetLength)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 1 ? segments.slice(0, MAX_SEGMENT_COUNT) : [normalized];
}

export function splitGeneratedRoundMessage(message: GeneratedRoundMessage) {
  if (message.metadata?.withdrawal?.withdrawn || message.metadata?.format === 'markdown' || hasMediaMetadata(message.metadata)) return [message];
  const requestedCount = message.metadata?.runtimeDecision?.innerLife?.expressionPlan?.messageCount || 1;
  const segments = splitGeneratedMessageText(message.content, requestedCount);
  if (segments.length <= 1) return [message];
  return segments.map((segment, index) => cloneSegmentMessage(message, segment, index));
}
