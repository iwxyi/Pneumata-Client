import type { MemoryItem } from './memoryTypes';

export interface InfluenceState {
  topicBias: string[];
  relationshipBias: string[];
  careBias: string[];
  noveltyBias: 'expand' | 'stabilize' | 'resolve' | 'neutral';
  avoidanceBias: string[];
}

function compact(text: string | undefined | null, max = 48) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

export function buildInfluenceState(params: {
  conversationMemories: MemoryItem[];
  characterMemories: MemoryItem[];
  targetedCharacterMemories: MemoryItem[];
}): InfluenceState {
  const topicBias = params.conversationMemories.map((item) => compact(item.summary || item.text, 40)).filter(Boolean).slice(0, 3);
  const relationshipBias = params.targetedCharacterMemories.map((item) => compact(item.summary || item.text, 44)).filter(Boolean).slice(0, 3);
  const careBias = params.characterMemories
    .filter((item) => item.kind === 'bond' || item.kind === 'status_shift')
    .map((item) => compact(item.summary || item.text, 44))
    .filter(Boolean)
    .slice(0, 2);
  const avoidanceBias = params.characterMemories
    .filter((item) => item.kind === 'resentment' || item.kind === 'taboo')
    .map((item) => compact(item.summary || item.text, 44))
    .filter(Boolean)
    .slice(0, 2);
  const noveltyBias = topicBias.length >= 2 ? 'resolve' : relationshipBias.length ? 'stabilize' : params.characterMemories.length ? 'expand' : 'neutral';
  return {
    topicBias,
    relationshipBias,
    careBias,
    noveltyBias,
    avoidanceBias,
  };
}
