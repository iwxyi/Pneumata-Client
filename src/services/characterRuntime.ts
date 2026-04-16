import type { AICharacter } from '../types/character';

export function accumulateCharacterRuntime(
  character: AICharacter,
  event: { type: 'relationship' | 'drift' | 'memory'; text: string; createdAt?: number }
) {
  const nextTimeline = [...(character.runtimeTimeline || [])];
  nextTimeline.push({
    type: event.type,
    text: event.text,
    createdAt: event.createdAt || Date.now(),
  });
  return nextTimeline.slice(-20);
}
