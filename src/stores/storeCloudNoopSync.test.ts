import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey } from '../constants/brand';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  DEFAULT_OPEN_CHAT_MODE_CONFIG,
  DEFAULT_OPEN_CHAT_MODE_STATE,
  type GroupChat,
} from '../types/chat';
import type { AICharacter } from '../types/character';
import type { CharacterArtifactEntry } from './useCharacterArtifactStore';

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
}

const apiMocks = vi.hoisted(() => ({
  getSyncChanges: vi.fn(),
  getChats: vi.fn(),
  getDeletedChats: vi.fn(),
  getCharacters: vi.fn(),
  getDeletedCharacters: vi.fn(),
  getCharacterArtifactSummaries: vi.fn(),
  getCharacterArtifactItem: vi.fn(),
}));

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      getSyncChanges: apiMocks.getSyncChanges,
      getChats: apiMocks.getChats,
      getDeletedChats: apiMocks.getDeletedChats,
      getCharacters: apiMocks.getCharacters,
      getDeletedCharacters: apiMocks.getDeletedCharacters,
      getCharacterArtifactSummaries: apiMocks.getCharacterArtifactSummaries,
      getCharacterArtifactItem: apiMocks.getCharacterArtifactItem,
    },
  };
});

function seedCloudAuth() {
  localStorage.setItem(storageKey('token'), 'token');
  localStorage.setItem(storageKey('auth-mode'), 'cloud');
}

function chat(overrides: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    name: '测试群聊',
    topic: '测试主题',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['character-1'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    layeredMemories: [],
    runtimeSeed: { notes: [], artifacts: [] },
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: DEFAULT_CONVERSATION_WORLD_STATE,
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  };
}

function character(overrides: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'character-1',
    name: '小甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
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

function artifact(overrides: Partial<CharacterArtifactEntry> = {}): CharacterArtifactEntry {
  return {
    id: 'artifact-1',
    kind: 'diary',
    characterId: 'character-1',
    characterName: '小甲',
    dateKey: '2026-06-05',
    sourceKey: 'source-1',
    title: '测试日记',
    text: '本地日记内容',
    source: 'local',
    unread: false,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

describe('cloud no-op sync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
    seedCloudAuth();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getSyncChanges.mockResolvedValue({
      status: 'not_modified',
      cursor: 'rev-1',
      revision: 'rev-1',
      changes: [],
    });
  });

  it('does not rewrite chats or fetch chat summaries when the remote scope is not modified', async () => {
    const { useChatStore } = await import('./useChatStore');
    await useChatStore.persist.rehydrate();
    useChatStore.setState({
      chats: [chat()],
      currentChatId: null,
      lastSyncedAt: 1,
      pendingOperations: [],
      pendingEditSyncCount: 0,
      pendingEditSyncError: null,
      remoteDeletedChatIds: [],
      remoteDeletedChats: [],
      isLoading: false,
    });
    let writes = 0;
    const unsubscribe = useChatStore.subscribe(() => {
      writes += 1;
    });

    await useChatStore.getState().loadChats();

    unsubscribe();
    expect(writes).toBe(0);
    expect(apiMocks.getSyncChanges).toHaveBeenCalledWith({ scope: 'chats.summary', since: null });
    expect(apiMocks.getChats).not.toHaveBeenCalled();
    expect(apiMocks.getDeletedChats).not.toHaveBeenCalled();
  });

  it('does not rewrite chats when marking an already projected chat list warm', async () => {
    const { useChatStore } = await import('./useChatStore');
    await useChatStore.persist.rehydrate();
    useChatStore.setState({
      chats: [chat()],
      currentChatId: null,
      lastSyncedAt: 1,
      pendingOperations: [],
      pendingEditSyncCount: 0,
      pendingEditSyncError: null,
      remoteDeletedChatIds: [],
      remoteDeletedChats: [],
      isLoading: false,
    });
    let writes = 0;
    const unsubscribe = useChatStore.subscribe(() => {
      writes += 1;
    });

    useChatStore.getState().markChatsWarm();

    unsubscribe();
    expect(writes).toBe(0);
  });

  it('does not rewrite characters or fetch character summaries when the remote scope is not modified', async () => {
    const { useCharacterStore } = await import('./useCharacterStore');
    await useCharacterStore.persist.rehydrate();
    useCharacterStore.setState({
      characters: [character()],
      lastSyncedAt: 1,
      pendingOperations: [],
      pendingEditSyncCount: 0,
      pendingEditSyncError: null,
      remoteDeletedCharacterIds: [],
      isLoading: false,
    });
    let writes = 0;
    const unsubscribe = useCharacterStore.subscribe(() => {
      writes += 1;
    });

    await useCharacterStore.getState().loadCharacters();

    unsubscribe();
    expect(writes).toBe(0);
    expect(apiMocks.getSyncChanges).toHaveBeenCalledWith({ scope: 'characters.summary', since: null });
    expect(apiMocks.getCharacters).not.toHaveBeenCalled();
    expect(apiMocks.getDeletedCharacters).not.toHaveBeenCalled();
  });

  it('does not rewrite characters when marking an already projected character list warm', async () => {
    const { useCharacterStore } = await import('./useCharacterStore');
    await useCharacterStore.persist.rehydrate();
    useCharacterStore.setState({
      characters: [character()],
      lastSyncedAt: 1,
      pendingOperations: [],
      pendingEditSyncCount: 0,
      pendingEditSyncError: null,
      remoteDeletedCharacterIds: [],
      isLoading: false,
    });
    let writes = 0;
    const unsubscribe = useCharacterStore.subscribe(() => {
      writes += 1;
    });

    useCharacterStore.getState().markCharactersWarm();

    unsubscribe();
    expect(writes).toBe(0);
  });

  it('does not rewrite artifacts or fetch artifact summaries when the remote scope is not modified', async () => {
    const { useCharacterArtifactStore } = await import('./useCharacterArtifactStore');
    useCharacterArtifactStore.setState({
      items: [artifact()],
      jobs: [],
      isProcessing: false,
      unreadLetterCount: 0,
    });
    let writes = 0;
    const unsubscribe = useCharacterArtifactStore.subscribe(() => {
      writes += 1;
    });

    await useCharacterArtifactStore.getState().syncCloud();

    unsubscribe();
    expect(writes).toBe(0);
    expect(apiMocks.getSyncChanges).toHaveBeenCalledWith({ scope: 'artifacts.summary', since: null });
    expect(apiMocks.getCharacterArtifactSummaries).not.toHaveBeenCalled();
    expect(apiMocks.getCharacterArtifactItem).not.toHaveBeenCalled();
  });
});
