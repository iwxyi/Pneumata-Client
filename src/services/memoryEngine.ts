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

export function extractMemoryCandidate(text: string): MemoryCandidate | null {
  void text;
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
      undefined,
      { aiUsage: { type: 'memory_refinement', label: '润色记忆', scope: 'chat' } },
    );
    const text = normalizeText(refined).slice(0, 80);
    if (!text) return null;
    return { kind: candidate.kind, text };
  } catch {
    return { kind: candidate.kind, text: candidate.text };
  }
}
