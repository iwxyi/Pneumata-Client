import { describe, expect, it } from 'vitest';
import { isRuntimeEvidenceMemory, isUserFacingMemoryItem } from './memoryPresentation';
import type { MemoryItem } from './memoryTypes';

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem-1',
    scope: 'conversation',
    layer: 'episodic',
    kind: 'conflict',
    ownerId: 'chat-1',
    text: '喜羊羊和沸羊羊的争执开始稳定影响群聊气氛。',
    salience: 0.8,
    confidence: 0.9,
    recency: 1,
    reinforcementCount: 1,
    sourceEventIds: ['evt-1'],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('memoryPresentation', () => {
  it('hides raw runtime evidence from user-facing memory lists', () => {
    const roomShift = memory({ scope: 'system_runtime', sourceTag: 'room_shift', layer: 'working' });
    const relationshipDelta = memory({ sourceTag: 'relationship_delta' });

    expect(isRuntimeEvidenceMemory(roomShift)).toBe(true);
    expect(isUserFacingMemoryItem(roomShift)).toBe(false);
    expect(isUserFacingMemoryItem(relationshipDelta)).toBe(false);
  });

  it('keeps distilled relationship memories visible', () => {
    const distilled = memory({
      sourceTag: 'relationship_delta',
      origin: 'distilled',
      layer: 'long_term',
    });

    expect(isRuntimeEvidenceMemory(distilled)).toBe(false);
    expect(isUserFacingMemoryItem(distilled)).toBe(true);
  });

  it('treats raw emotional and personality state entries as runtime evidence', () => {
    const emotion = memory({ sourceTag: 'emotional_state', scope: 'character_self', layer: 'working' });
    const drift = memory({ sourceTag: 'personality_drift', scope: 'character_self', layer: 'episodic' });

    expect(isRuntimeEvidenceMemory(emotion)).toBe(true);
    expect(isRuntimeEvidenceMemory(drift)).toBe(true);
    expect(isUserFacingMemoryItem(emotion)).toBe(false);
    expect(isUserFacingMemoryItem(drift)).toBe(false);
  });

  it('hides archived memories', () => {
    expect(isUserFacingMemoryItem(memory({ archivedAt: 200 }))).toBe(false);
  });
});
