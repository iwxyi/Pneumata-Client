import type { AICharacter } from '../types/character';

export function accumulateCharacterRuntime(
  character: AICharacter,
  event: { type: 'relationship' | 'drift' | 'memory'; text: string; createdAt?: number },
  options?: { now?: number },
) {
  const nextTimeline = [...(character.runtimeTimeline || [])];
  const createdAt = typeof event.createdAt === 'number' && Number.isFinite(event.createdAt)
    ? Math.round(event.createdAt)
    : (typeof options?.now === 'number' && Number.isFinite(options.now) ? Math.round(options.now) : Date.now());
  nextTimeline.push({
    type: event.type,
    text: event.text,
    createdAt,
  });
  return nextTimeline.slice(-20);
}
