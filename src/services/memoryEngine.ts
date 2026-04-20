import type { APIConfig } from '../types/settings';
import type { Message } from '../types/message';
import type { GroupChat } from '../types/chat';
import { generateResponse } from './aiClient';

export interface MemoryCandidate {
  kind: 'note' | 'artifact';
  text: string;
  reason: string;
}

export interface RefinedMemory {
  kind: 'note' | 'artifact';
  text: string;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function isLowValueUtterance(text: string) {
  const normalized = normalizeText(text);
  if (normalized.length < 20) return true;
  if (/^(我觉得|我认为|其实|嗯|啊|是的|好的|maybe|well|i think)/i.test(normalized)) return true;
  return false;
}

export function extractMemoryCandidate(text: string): MemoryCandidate | null {
  const normalized = normalizeText(text);
  if (!normalized || isLowValueUtterance(normalized)) return null;

  const artifactMatch = normalized.match(/(总结|共识|方案|清单|计划|summary|conclusion|plan|checklist)[:：]?([^。！？!?]{6,40})/i);
  if (artifactMatch) {
    return {
      kind: 'artifact',
      text: `${artifactMatch[1]}：${artifactMatch[2]}`.slice(0, 96),
      reason: 'contains explicit outcome language',
    };
  }

  const noteMatch = normalized.match(/([^。！？!?]{8,50})(应该|需要|必须|最好|不能|关键是|问题在于)([^。！？!?]{4,30})/);
  if (noteMatch) {
    return {
      kind: 'note',
      text: `${noteMatch[1]}${noteMatch[2]}${noteMatch[3]}`.slice(0, 96),
      reason: 'contains stable decision/problem framing',
    };
  }

  return null;
}

export async function refineMemoryCandidate(
  config: APIConfig,
  chat: GroupChat,
  message: Pick<Message, 'content'>,
  candidate: MemoryCandidate
): Promise<RefinedMemory | null> {
  const prompt = [
    'You are refining a long-term memory for a group conversation.',
    'Turn the candidate into one concise high-signal memory in Chinese.',
    'Do not quote raw chat phrasing unless necessary.',
    'Focus on: stable conclusion, recurring conflict, important decision, or meaningful relationship shift.',
    'Return only one line of plain text. No bullets.',
    `Conversation topic: ${chat.topic || chat.name}`,
    `Original message: ${message.content}`,
    `Candidate kind: ${candidate.kind}`,
    `Candidate draft: ${candidate.text}`,
  ].join('\n');

  try {
    const refined = await generateResponse(
      config,
      'Refine one high-value long-term memory from a chat message.',
      [{ role: 'user', content: prompt }],
    );
    const text = normalizeText(refined).slice(0, 80);
    if (!text) return null;
    return { kind: candidate.kind, text };
  } catch {
    return { kind: candidate.kind, text: candidate.text };
  }
}
