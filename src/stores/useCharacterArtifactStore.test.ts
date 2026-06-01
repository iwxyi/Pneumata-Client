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

vi.mock('../services/characterExperienceArtifacts', async () => {
  const actual = await vi.importActual<typeof import('../services/characterExperienceArtifacts')>('../services/characterExperienceArtifacts');
  return {
    ...actual,
    generateCharacterDailyDiaryArtifact: vi.fn(async () => '苏苏的日记：今天拍照后意识到自己也在影响别人。'),
    generateCharacterExperienceArtifact: vi.fn(async ({ kind }: { kind: string }) => (
      kind === 'birth_letter'
        ? '第一次醒来，我知道自己叫苏苏。'
        : '没说完的话留给小雨。'
    )),
  };
});

let artifactStore: Awaited<typeof import('./useCharacterArtifactStore')>['useCharacterArtifactStore'];
let settingsStore: Awaited<typeof import('./useSettingsStore')>['useSettingsStore'];
let generateDailyDiaryMock: ReturnType<typeof vi.mocked<Awaited<typeof import('../services/characterExperienceArtifacts')>['generateCharacterDailyDiaryArtifact']>>;

function dateKeyDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function timestampDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getTime();
}

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
  const settingsMod = await import('./useSettingsStore');
  const artifactMod = await import('../services/characterExperienceArtifacts');
  artifactStore = mod.useCharacterArtifactStore;
  settingsStore = settingsMod.useSettingsStore;
  generateDailyDiaryMock = vi.mocked(artifactMod.generateCharacterDailyDiaryArtifact);
});

describe('useCharacterArtifactStore', () => {
  beforeEach(() => {
    localStore.clear();
    generateDailyDiaryMock.mockClear();
    artifactStore.setState({ items: [], jobs: [], isProcessing: false, unreadLetterCount: 0 });
    settingsStore.setState({
      aiProfiles: [{
        id: 'default',
        name: 'Default',
        type: 'text',
        isDefault: true,
        provider: 'openai',
        apiKey: 'key',
        baseUrl: 'https://example.test',
        model: 'model',
      }],
      aiGeneration: {
        enableMoments: true,
        enableDiaries: true,
      },
    });
    settingsStore.getState().setAIGeneration({ enableMoments: true, enableDiaries: true });
  });

  it('creates diary entries, birth letters, and final letters', async () => {
    const character = buildCharacter();
    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const diaries = artifactStore.getState().getDiaryEntries(character.id);
    expect(diaries.length).toBeGreaterThan(0);
    expect(diaries[0]?.kind).toBe('diary');
    expect(diaries[0]?.generationSnapshot?.character.name).toBe('苏苏');
    expect(diaries[0]?.generationSnapshot?.character.visualIdentity?.referenceImages?.[0]?.url).toBeUndefined();

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
    const finalLetter = letters.find((item) => item.kind === 'final_letter');
    expect(finalLetter).toBeTruthy();
    expect(finalLetter?.text).toContain('没说完的话留给小雨');
    expect(artifactStore.getState().unreadLetterCount).toBe(2);
  });

  it('does not enqueue diary jobs when global diary generation is disabled', async () => {
    const character = buildCharacter();
    settingsStore.getState().setAIGeneration({ enableDiaries: false });
    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(artifactStore.getState().jobs.some((job) => job.kind === 'diary')).toBe(false);
    expect(artifactStore.getState().getDiaryEntries(character.id)).toHaveLength(0);
  });

  it('enqueues diary jobs when global diary generation is disabled but character override is on', async () => {
    const character = normalizeCharacter({
      ...buildCharacter(),
      generationPreferences: {
        moments: 'follow_global',
        diaries: 'on',
      },
    } as AICharacter);
    settingsStore.getState().setAIGeneration({ enableDiaries: false });
    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(artifactStore.getState().getDiaryEntries(character.id).length).toBeGreaterThan(0);
  });

  it('does not enqueue diary jobs when global diary generation is enabled but character override is off', async () => {
    const character = normalizeCharacter({
      ...buildCharacter(),
      generationPreferences: {
        moments: 'follow_global',
        diaries: 'off',
      },
    } as AICharacter);
    settingsStore.getState().setAIGeneration({ enableDiaries: true });
    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(artifactStore.getState().jobs.some((job) => job.kind === 'diary')).toBe(false);
    expect(artifactStore.getState().getDiaryEntries(character.id)).toHaveLength(0);
  });

  it('regenerates an artifact from its saved generation snapshot', async () => {
    const character = buildCharacter();
    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const diary = artifactStore.getState().getDiaryEntries(character.id)[0];
    expect(diary?.generationSnapshot).toBeTruthy();

    generateDailyDiaryMock.mockResolvedValueOnce('苏苏的日记：这是新版提示词重新生成的内容。');
    const regenerated = await artifactStore.getState().regenerateArtifact({ itemId: diary!.id });

    expect(regenerated.id).toBe(diary!.id);
    expect(regenerated.text).toContain('新版提示词');
    expect(regenerated.updatedAt).toBeGreaterThan(diary!.updatedAt);
    expect(regenerated.generationSnapshot?.promptVersion).toBe('character-experience-artifacts-v2');
    expect(artifactStore.getState().getDiaryEntries(character.id)[0]?.text).toContain('新版提示词');
  });

  it('skips letter generation when the default text model is not configured', async () => {
    settingsStore.setState({
      aiProfiles: [{
        id: 'default',
        name: 'Default',
        type: 'text',
        isDefault: true,
        provider: 'openai',
        apiKey: '',
        baseUrl: '',
        model: '',
      }],
    });
    const character = buildCharacter();

    artifactStore.getState().enqueueBirthLetter(character, [{ id: 'c2', name: '小雨' }]);
    artifactStore.getState().enqueueFinalLetter(character, [{ id: 'c2', name: '小雨' }]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(artifactStore.getState().getLetterEntries()).toHaveLength(0);
    expect(artifactStore.getState().jobs).toHaveLength(0);
  });

  it('regenerates diary entries that accidentally stored raw context', async () => {
    const character = buildCharacter();
    artifactStore.setState({
      items: [{
        id: 'raw-diary',
        kind: 'diary',
        characterId: character.id,
        characterName: character.name,
        dateKey: '1970-01-01',
        sourceKey: null,
        title: '苏苏 · 1970-01-01',
        text: JSON.stringify({ profile: { name: '苏苏' }, memories: [], relationships: [], innerResidues: [] }),
        source: 'ai',
        unread: false,
        createdAt: 1,
        updatedAt: 1,
      }],
      jobs: [],
      isProcessing: false,
      unreadLetterCount: 0,
    });

    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const diaries = artifactStore.getState().getDiaryEntries(character.id);
    expect(diaries).toHaveLength(1);
    expect(diaries[0]?.id).not.toBe('raw-diary');
    expect(diaries[0]?.text).toContain('苏苏的日记');
  });

  it('limits diary backfill to the recent window plus the previous available day', async () => {
    const character = {
      ...buildCharacter(),
      layeredMemories: [20, 10, 3].map((days) => ({
        id: `m-${days}`,
        scope: 'character_self' as const,
        layer: 'long_term' as const,
        kind: 'trait_evidence' as const,
        ownerId: 'c1',
        text: `第 ${days} 天前的记忆`,
        salience: 0.9,
        confidence: 0.8,
        recency: 0.8,
        reinforcementCount: 1,
        sourceEventIds: [`e-${days}`],
        createdAt: timestampDaysAgo(days),
        updatedAt: timestampDaysAgo(days),
      })),
      relationships: [],
      runtimeTimeline: [],
    };

    artifactStore.getState().syncCharacters([character]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const generatedDateKeys = generateDailyDiaryMock.mock.calls.map(([params]) => params.dateKey);
    expect(generatedDateKeys).toEqual([dateKeyDaysAgo(3)]);
  });

  it('keeps an old previous available diary day and queues diary generation by date before character order', async () => {
    const olderCharacter = {
      ...buildCharacter(),
      id: 'c-old',
      name: '旧日角色',
      layeredMemories: [{
        id: 'm-old',
        scope: 'character_self' as const,
        layer: 'long_term' as const,
        kind: 'trait_evidence' as const,
        ownerId: 'c-old',
        text: '很久以前的记忆',
        salience: 0.9,
        confidence: 0.8,
        recency: 0.8,
        reinforcementCount: 1,
        sourceEventIds: ['e-old'],
        createdAt: timestampDaysAgo(20),
        updatedAt: timestampDaysAgo(20),
      }],
      relationships: [],
      runtimeTimeline: [],
    };
    const recentCharacter = {
      ...buildCharacter(),
      id: 'c-recent',
      name: '近事角色',
      layeredMemories: [{
        id: 'm-recent',
        scope: 'character_self' as const,
        layer: 'long_term' as const,
        kind: 'trait_evidence' as const,
        ownerId: 'c-recent',
        text: '最近的记忆',
        salience: 0.9,
        confidence: 0.8,
        recency: 0.8,
        reinforcementCount: 1,
        sourceEventIds: ['e-recent'],
        createdAt: timestampDaysAgo(2),
        updatedAt: timestampDaysAgo(2),
      }],
      relationships: [],
      runtimeTimeline: [],
    };

    artifactStore.getState().syncCharacters([recentCharacter, olderCharacter]);
    await artifactStore.getState().resumeProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const generatedDateKeys = generateDailyDiaryMock.mock.calls.map(([params]) => params.dateKey);
    expect(generatedDateKeys).toEqual([dateKeyDaysAgo(20), dateKeyDaysAgo(2)]);
    expect(artifactStore.getState().getDiaryEntries('c-old')[0]?.dateKey).toBe(dateKeyDaysAgo(20));
  });
});
