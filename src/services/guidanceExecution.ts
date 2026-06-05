import type { AICharacter } from '../types/character';
import type { Message, MessageMetadata } from '../types/message';
import type { UserGuidanceIntent } from './userGuidanceIntent';

export type GuidanceExecutionReason = NonNullable<NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['guidanceExecution']>['finalReason']>;
export type GuidanceRejectionReason = NonNullable<NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['guidanceExecution']>['rejectedReasons']>[number];

export interface GuidanceExecutionEvaluation {
  matched: boolean;
  reason: GuidanceExecutionReason;
}

export interface GuidanceExecutionOptions {
  mediaCapabilities?: {
    image?: boolean;
    audio?: boolean;
  };
}

export interface GuidanceProgressSnapshot {
  matchedMessages: Message[];
  completedActorIds: Set<string>;
  consumedTurns: number;
}

function normalizeForComparison(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?:：；;"“”'‘’（）()[\]{}<>《》]/g, '').toLowerCase();
}

export function normalizeGuidanceMatchText(text: string) {
  return normalizeForComparison(text);
}

export function extractGuidanceMatchTokens(text: string) {
  const normalized = normalizeGuidanceMatchText(text);
  const tokens: string[] = [];
  const chunks = normalized.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{3,}/gi) || [];
  for (const chunk of chunks) {
    if (/^[a-z0-9_]+$/i.test(chunk)) {
      tokens.push(chunk.toLowerCase());
      continue;
    }
    if (chunk.length <= 4) {
      tokens.push(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length - 1; index += 1) {
      tokens.push(chunk.slice(index, index + 2));
    }
  }
  return tokens
    .map((token) => token.trim())
    .filter((token, index, array) => token.length >= 2 && array.indexOf(token) === index);
}

function characterNamesByIds(ids: string[] | undefined, characters: AICharacter[] | undefined) {
  if (!characters?.length || !ids?.length) return [];
  return ids
    .map((id) => characters.find((character) => character.id === id)?.name)
    .filter(Boolean) as string[];
}

function isGenericImageSubject(text: string) {
  const normalized = normalizeGuidanceMatchText(text);
  if (!normalized) return true;
  return /^(当前话题|这张图|一张图|图片|照片|相片|图|发图|发一张图|发个图|发图片)$/.test(normalized);
}

function buildImageSubjectTerms(guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  const request = guidance.mediaRequest;
  if (!request) return [];
  const subjectNames = characterNamesByIds(request.subjectActorIds, characters);
  const subjectText = subjectNames.length ? subjectNames.join('、') : request.subjectText;
  if (!subjectText || isGenericImageSubject(subjectText)) return [];
  return extractGuidanceMatchTokens(subjectText);
}

function imageSubjectMatchesText(text: string, guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  const terms = buildImageSubjectTerms(guidance, characters);
  if (!terms.length) return true;
  const normalized = normalizeGuidanceMatchText(text);
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function hasImageUnableText(content: string) {
  if (/(发不了|发不出|没法发|无法发|不能发|生成不了|画不了|拍不了|没法生成|无法生成|图片模型|没有图片能力)/i.test(content)) {
    return true;
  }
  return false;
}

function hasImageCompletionText(content: string) {
  if (/(来啦|来了|发来|发给|给你看|你看|看这|这张|出图|生成好|生成了|画好|画好了|画完|拍好|拍好了|做好了|弄好了)/i.test(content)) {
    return true;
  }
  return /我把.{0,24}(图|图片|照片|相片|证件照|海报|插画|头像|表情包).{0,24}(画|拍|做|生成|发)/i.test(content)
    || /我把.{0,24}(画|拍|做|生成).{0,24}(好|完|出来|发)/i.test(content);
}

function hasConcreteImageAction(content: string) {
  return hasImageUnableText(content) || hasImageCompletionText(content);
}

function hasImageAttachment(message: Pick<Message, 'metadata'>) {
  return Boolean(
    message.metadata?.generationDecision?.image?.shouldGenerate
    || message.metadata?.attachments?.some((attachment) => attachment.kind === 'image' && attachment.status !== 'deleted' && attachment.status !== 'failed'),
  );
}

function getMessageRuntimeGuidance(message: Pick<Message, 'metadata'>): UserGuidanceIntent | null {
  const guidance = message.metadata?.runtimeDecision?.directorIntent?.userGuidance;
  if (!guidance || typeof guidance.kind !== 'string') return null;
  return guidance as UserGuidanceIntent;
}

function getMessageGuidanceExecutionStatus(message: Pick<Message, 'metadata'>) {
  return message.metadata?.runtimeDecision?.guidanceExecution || null;
}

function isSameGuidance(left: UserGuidanceIntent | null | undefined, right: UserGuidanceIntent | null | undefined) {
  if (!left || !right) return false;
  return left.kind === right.kind && left.rawText === right.rawText;
}

export function isGuidanceSatisfiedByMessage(message: Message, guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  if (message.type !== 'ai' || message.isDeleted) return false;
  const execution = getMessageGuidanceExecutionStatus(message);
  if (execution?.status === 'accepted' && execution.validated && isSameGuidance(getMessageRuntimeGuidance(message), guidance)) {
    return true;
  }
  return evaluateGuidanceMessage(message, guidance, characters).matched;
}

export function collectGuidanceProgressAfterTimestamp(
  messages: Message[],
  timestamp: number,
  guidance: UserGuidanceIntent,
  characters?: AICharacter[],
): GuidanceProgressSnapshot {
  const matchedMessages = messages
    .filter((message) => message.timestamp > timestamp && isGuidanceSatisfiedByMessage(message, guidance, characters))
    .sort((left, right) => left.timestamp - right.timestamp);
  return {
    matchedMessages,
    completedActorIds: new Set(matchedMessages.map((message) => message.senderId)),
    consumedTurns: matchedMessages.length,
  };
}

function imageAttachmentMatchesGuidance(message: Pick<Message, 'metadata'>, guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  if (!hasImageAttachment(message)) return false;
  if (isSameGuidance(getMessageRuntimeGuidance(message), guidance)) return true;
  const attachments = message.metadata?.attachments || [];
  if (!attachments.length) return !buildImageSubjectTerms(guidance, characters).length;
  return attachments.some((attachment) => {
    const text = `${attachment.altText || ''} ${attachment.promptText || ''}`;
    return imageSubjectMatchesText(text, guidance, characters);
  });
}

function evaluateMediaGuidanceContent(content: string, guidance: UserGuidanceIntent, characters?: AICharacter[], options?: GuidanceExecutionOptions): GuidanceExecutionReason {
  const request = guidance.mediaRequest;
  if (!request) return 'matched';
  if (hasImageUnableText(content)) return 'matched';
  if (request.kind === 'image' && options?.mediaCapabilities?.image === false) return 'missing_requested_image';
  if (!hasConcreteImageAction(content)) return 'missing_requested_image';
  if (!imageSubjectMatchesText(content, guidance, characters)) return 'missing_requested_subject';
  return 'matched';
}

export function evaluateGuidanceGeneratedContent(
  content: string,
  guidance: UserGuidanceIntent | null | undefined,
  speaker: Pick<AICharacter, 'id'> | string | null | undefined,
  characters?: AICharacter[],
  options?: GuidanceExecutionOptions,
): GuidanceExecutionEvaluation {
  if (!guidance) return { matched: true, reason: 'matched' };
  if (!normalizeGuidanceMatchText(content)) return { matched: false, reason: 'empty_content' };
  const speakerId = typeof speaker === 'string' ? speaker : speaker?.id;
  if (guidance.actorIds.length && (!speakerId || !guidance.actorIds.includes(speakerId))) return { matched: false, reason: 'wrong_speaker' };
  if (guidance.kind === 'media_request') {
    const reason = evaluateMediaGuidanceContent(content, guidance, characters, options);
    return { matched: reason === 'matched', reason };
  }
  return { matched: true, reason: 'matched' };
}

export function evaluateGuidanceMessage(message: Message, guidance: UserGuidanceIntent, characters?: AICharacter[]): GuidanceExecutionEvaluation {
  if (message.type !== 'ai' || message.isDeleted) return { matched: false, reason: 'empty_content' };
  if (guidance.actorIds.length && !guidance.actorIds.includes(message.senderId)) return { matched: false, reason: 'wrong_speaker' };
  if (guidance.kind === 'media_request' && imageAttachmentMatchesGuidance(message, guidance, characters)) {
    return { matched: true, reason: 'matched' };
  }
  if (guidance.kind === 'media_request' && hasImageCompletionText(message.content || '') && !hasImageUnableText(message.content || '')) {
    return { matched: false, reason: 'missing_requested_image' };
  }
  return evaluateGuidanceGeneratedContent(message.content || '', guidance, message.senderId, characters);
}
