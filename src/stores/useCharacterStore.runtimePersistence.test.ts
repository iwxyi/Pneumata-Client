import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import type { MemoryItem } from '../services/memoryTypes';
import { storageKey } from '../constants/brand';

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function memory(index: number): MemoryItem {
  return {
    id: `memory-${index}`,
    scope: 'character_self',
    layer: 'episodic',
    kind: 'trait_evidence',
    ownerId: 'character-1',
    text: `角色记忆 ${index}`,
    salience: 50,
    confidence: 0.8,
    recency: 50,
    reinforcementCount: 1,
    sourceEventIds: [`event-${index}`],
    createdAt: index,
    updatedAt: index,
  };
}

function character(overrides: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'character-1',
    name: '小甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    personalityDrift: { empathy: 4 },
    emotionalState: { irritation: 0, affection: 5, insecurity: 6, excitement: 2, embarrassment: 4 },
    soulState: {
      mood: { pleasure: -8, arousal: 20, dominance: -2 },
      energy: 62,
      attention: 70,
      loneliness: 36,
      repression: 42,
      shame: 18,
      envy: 4,
      trustInRoom: 58,
      ignoredStreak: 1,
      lastImpulse: 'repair',
      lastImpulseReason: '刚才的话有一点刺，正在找补。',
      updatedAt: 10,
    },
    coreProfile: { coreDesire: '被认真听见', coreFear: '被当成工具' },
    behavior: { proactivity: 50, aggressiveness: 20, humorIntensity: 40, empathyLevel: 60, summarizing: 30, offTopic: 20 },
    expertise: ['测试'],
    speakingStyle: '短句',
    background: '测试角色',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    layeredMemories: [],
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    runtimeTimeline: [],
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('character runtime persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    localStorage.setItem(storageKey('token'), 'test-token');
  });

  it('keeps bounded runtime fields and soul state in cloud patches', async () => {
    const { __characterRuntimePersistenceForTests } = await import('./useCharacterStore');
    const { compactCharacterPatchForCloud, limits } = __characterRuntimePersistenceForTests;
    const patch = compactCharacterPatchForCloud({
      emotionalState: character().emotionalState,
      personalityDrift: character().personalityDrift,
      soulState: character().soulState,
      layeredMemories: Array.from({ length: limits.layeredMemories + 5 }, (_, index) => memory(index)),
      runtimeTimeline: Array.from({ length: limits.runtimeTimeline + 5 }, (_, index) => ({ type: 'memory', text: `timeline-${index}`, createdAt: index })),
      updatedAt: 999,
    });

    expect(patch.emotionalState).toMatchObject({ insecurity: 6, excitement: 2 });
    expect(patch.personalityDrift).toMatchObject({ empathy: 4 });
    expect(patch.soulState).toMatchObject({ lastImpulse: 'repair', trustInRoom: 58 });
    expect(patch.layeredMemories).toHaveLength(limits.layeredMemories);
    expect(patch.runtimeTimeline).toHaveLength(limits.runtimeTimeline);
    expect(patch.updatedAt).toBeUndefined();
  });

  it('keeps bounded full character state in local persistence', async () => {
    const { __characterRuntimePersistenceForTests } = await import('./useCharacterStore');
    const { buildPersistedCharacterState, limits } = __characterRuntimePersistenceForTests;
    const persisted = buildPersistedCharacterState({
      characters: [character({
        layeredMemories: Array.from({ length: limits.layeredMemories + 2 }, (_, index) => memory(index)),
        runtimeTimeline: Array.from({ length: limits.runtimeTimeline + 2 }, (_, index) => ({ type: 'memory', text: `timeline-${index}`, createdAt: index })),
      })],
      lastSyncedAt: 1,
      pendingOperations: [],
    });

    expect(persisted.characters[0].emotionalState).toMatchObject({ insecurity: 6, affection: 5 });
    expect(persisted.characters[0].personalityDrift).toMatchObject({ empathy: 4 });
    expect(persisted.characters[0].soulState).toMatchObject({ lastImpulseReason: '刚才的话有一点刺，正在找补。' });
    expect(persisted.characters[0].coreProfile).toMatchObject({ coreDesire: '被认真听见' });
    expect(persisted.characters[0].layeredMemories).toHaveLength(limits.layeredMemories);
    expect(persisted.characters[0].runtimeTimeline).toHaveLength(limits.runtimeTimeline);
    expect(persisted.characters[0].characterDetailLoaded).toBe(true);
  });

  it('projects visual asset changes locally without creating a character sync patch', async () => {
    const { useCharacterStore } = await import('./useCharacterStore');
    const original = character({
      visualIdentity: {
        description: '旧视觉描述',
        referenceImages: [
          { id: 'asset-1', assetId: 'asset-1', url: 'https://example.test/one.png', createdAt: 1, isPrimary: true },
          { id: 'asset-2', assetId: 'asset-2', url: 'https://example.test/two.png', createdAt: 2 },
        ],
        primaryReferenceImageId: 'asset-1',
      },
    });
    useCharacterStore.setState({ characters: [original], pendingOperations: [] });
    useCharacterStore.getState().applyLocalCharacterVisualAssets('character-1', [
      { id: 'asset-2', assetId: 'asset-2', url: 'https://example.test/two.png', createdAt: 2 },
    ], 'asset-2');
    const projected = useCharacterStore.getState().getCharacter('character-1')!;

    expect(projected.visualIdentity).toMatchObject({
      description: '旧视觉描述',
      primaryReferenceImageId: 'asset-2',
      referenceImages: [{ id: 'asset-2', isPrimary: true }],
    });
    expect(projected.visualReferenceImages).toEqual([{ id: 'asset-2', assetId: 'asset-2', url: 'https://example.test/two.png', createdAt: 2, isPrimary: true }]);
    expect(projected.updatedAt).toBe(original.updatedAt);
    expect(useCharacterStore.getState().pendingOperations).toEqual([]);
  });
});
