import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeCharacter } from '../types/character';
import type { AICharacter } from '../types/character';

const localStore = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => { localStore.set(key, value); },
  removeItem: (key: string) => { localStore.delete(key); },
  clear: () => { localStore.clear(); },
  key: (index: number) => Array.from(localStore.keys())[index] ?? null,
  get length() { return localStore.size; },
});

let artifactStore: Awaited<typeof import('./useCharacterArtifactStore')>['useCharacterArtifactStore'];

function buildCharacter(): AICharacter {
  return normalizeCharacter({
    id: 'c1',
    name: '苏苏',
    avatar: '👗',
    personality: { openness: 80, extroversion: 70, agreeableness: 75, neuroticism: 30, humor: 50, creativity: 80, assertiveness: 65, empathy: 70 },
    behavior: { proactivity: 60, aggressiveness: 20, humorIntensity: 55, empathyLevel: 70, summarizing: 30, offTopic: 10 },
    expertise: ['穿搭'],
    speakingStyle: '活泼',
    background: '穿搭博主。',
    relationships: [{ characterId: 'c2', warmth: 22, competence: 10, trust: 20, threat: 5, updatedAt: 100 }],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    layeredMemories: [{
      id: 'm1',
      scope: 'character_self',
      layer: 'long_term',
      kind: 'trait_evidence',
      ownerId: 'c1',
      text: '今天拍照后意识到自己也在影响别人。',
      salience: 0.9,
      confidence: 0.8,
      recency: 0.8,
      reinforcementCount: 1,
      sourceEventIds: ['e1'],
      createdAt: 100,
      updatedAt: 100,
    }],
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    runtimeTimeline: [{ type: 'memory', text: '一条记录', createdAt: 100 }],
    modelProfileIds: { text: null, image: null, audio: null, document: null },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  } as AICharacter);
}

beforeAll(async () => {
  const mod = await import('./useCharacterArtifactStore');
  artifactStore = mod.useCharacterArtifactStore;
});

describe('useCharacterArtifactStore', () => {
  beforeEach(() => {
    localStore.clear();
    artifactStore.setState({ items: [], jobs: [], isProcessing: false, unreadLetterCount: 0 });
  });

  it('creates diary entries, birth letters, and final letters', async () => {
    const character = buildCharacter();
    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const diaries = artifactStore.getState().getDiaryEntries(character.id);
    expect(diaries.length).toBeGreaterThan(0);
    expect(diaries[0]?.kind).toBe('diary');

    artifactStore.getState().enqueueBirthLetter(character, [{ id: 'c2', name: '小雨' }]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const birthLetter = artifactStore.getState().getLetterEntries().find((item) => item.kind === 'birth_letter');
    expect(birthLetter?.title).toContain('诞生信');
    expect(birthLetter?.unread).toBe(true);

    artifactStore.getState().enqueueFinalLetter(character, [{ id: 'c2', name: '小雨' }]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const letters = artifactStore.getState().getLetterEntries();
    expect(letters.some((item) => item.kind === 'final_letter')).toBe(true);
    expect(artifactStore.getState().unreadLetterCount).toBe(2);
  });
});
