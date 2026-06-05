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

  it('merges chat summary changes without clearing loaded chat runtime details', async () => {
    apiMocks.getSyncChanges.mockResolvedValueOnce({
      status: 'modified',
      cursor: 'chats.summary:rev-2',
      revision: 'chats.summary:rev-2',
      changes: [{
        op: 'upsert',
        entity: 'chat_summary',
        id: 'chat-1',
        revision: 2,
        patch: {
          id: 'chat-1',
          type: 'group',
          mode: 'open_chat',
          name: '测试群聊新版',
          topic: '测试主题',
          style: 'free',
          runtimeEvolutionIntensity: 'balanced',
          memberIds: ['character-1'],
          sourceChatId: null,
          sourceMemberIds: [],
          speed: 1,
          isActive: true,
          allowIntervention: true,
          showRoleActions: true,
          topicSeed: '',
          deletedAt: null,
          fieldVersions: {},
          createdAt: 1,
          updatedAt: 2,
          lastMessageAt: 2,
          worldState: DEFAULT_CONVERSATION_WORLD_STATE,
          runtimeDetailLoaded: false,
          latestMessage: {
            id: 'message-2',
            chatId: 'chat-1',
            type: 'ai',
            senderId: 'character-1',
            senderName: '小甲',
            content: '最新摘要消息',
            emotion: 60,
            timestamp: 2,
            isDeleted: false,
          },
        },
      }],
    });
    const { useChatStore } = await import('./useChatStore');
    await useChatStore.persist.rehydrate();
    useChatStore.setState({
      chats: [chat({
        name: '测试群聊',
        runtimeDetailLoaded: true,
        runtimeSeed: { notes: ['完整前情'], artifacts: ['完整产物'] },
        layeredMemories: [{ id: 'memory-1', scope: 'conversation', layer: 'long_term', kind: 'artifact', ownerId: 'chat-1', text: '完整会话记忆', salience: 0.7, confidence: 0.7, recency: 0.7, reinforcementCount: 1, sourceEventIds: [], createdAt: 1, updatedAt: 1 }],
        runtimeTimeline: [{ type: 'note', text: '完整时间线', createdAt: 1 }],
        updatedAt: 1,
        lastMessageAt: 1,
      })],
      currentChatId: null,
      lastSyncedAt: 1,
      pendingOperations: [],
      pendingEditSyncCount: 0,
      pendingEditSyncError: null,
      remoteDeletedChatIds: [],
      remoteDeletedChats: [],
      isLoading: false,
    });

    await useChatStore.getState().loadChats();

    const merged = useChatStore.getState().chats[0];
    expect(merged.name).toBe('测试群聊新版');
    expect(merged.updatedAt).toBe(2);
    expect(merged.lastMessageAt).toBe(2);
    expect(merged.latestMessage?.content).toBe('最新摘要消息');
    expect(merged.runtimeDetailLoaded).toBe(true);
    expect(merged.runtimeSeed?.notes).toEqual(['完整前情']);
    expect(merged.layeredMemories?.[0]?.text).toBe('完整会话记忆');
    expect(merged.runtimeTimeline?.[0]?.text).toBe('完整时间线');
    expect(apiMocks.getChats).not.toHaveBeenCalled();
  });

  it('keeps pending chat fields projected over newer remote field versions', async () => {
    apiMocks.getSyncChanges.mockResolvedValueOnce({
      status: 'modified',
      cursor: 'chats.summary:rev-2',
      revision: 'chats.summary:rev-2',
      changes: [{
        op: 'upsert',
        entity: 'chat_summary',
        id: 'chat-1',
        revision: 2,
        patch: chat({
          id: 'chat-1',
          name: '云端群聊名',
          fieldVersions: { name: 200 },
          updatedAt: 200,
          lastMessageAt: 200,
          runtimeDetailLoaded: false,
        }),
      }],
    });
    const { useChatStore } = await import('./useChatStore');
    await useChatStore.persist.rehydrate();
    useChatStore.setState({
      chats: [chat({
        id: 'chat-1',
        name: '本地群聊名',
        fieldVersions: { name: 1 },
        updatedAt: 1,
        lastMessageAt: 1,
      })],
      currentChatId: null,
      lastSyncedAt: 1,
      pendingOperations: [{
        id: 'op-chat-name',
        entityId: 'chat-1',
        kind: 'patch',
        targetIds: ['chat-1'],
        clientTimestamp: 100,
        patch: { name: '本地待同步群聊名' },
        status: 'pending',
        attemptCount: 0,
      }],
      pendingEditSyncCount: 1,
      pendingEditSyncError: null,
      remoteDeletedChatIds: [],
      remoteDeletedChats: [],
      isLoading: false,
    });

    await useChatStore.getState().loadChats();

    const merged = useChatStore.getState().chats[0];
    expect(merged.name).toBe('本地待同步群聊名');
    expect(merged.updatedAt).toBe(200);
    expect(merged.fieldVersions?.name).toBe(200);
    expect(useChatStore.getState().pendingOperations).toHaveLength(1);
    expect(apiMocks.getChats).not.toHaveBeenCalled();
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

  it('merges character summary changes without clearing loaded character details', async () => {
    apiMocks.getSyncChanges.mockResolvedValueOnce({
      status: 'modified',
      cursor: 'characters.summary:rev-2',
      revision: 'characters.summary:rev-2',
      changes: [{
        op: 'upsert',
        entity: 'character_summary',
        id: 'character-1',
        revision: 2,
        patch: {
          id: 'character-1',
          name: '小甲新版',
          avatar: '',
          personality: { openness: 70, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
          expertise: ['测试'],
          group: null,
          bubbleStyleId: null,
          bubbleStyle: null,
          isPreset: false,
          deletedAt: null,
          fieldVersions: {},
          createdAt: 1,
          updatedAt: 2,
          characterDetailLoaded: false,
        },
      }],
    });
    const { useCharacterStore } = await import('./useCharacterStore');
    await useCharacterStore.persist.rehydrate();
    useCharacterStore.setState({
      characters: [character({
        name: '小甲',
        background: '完整背景不能被摘要覆盖',
        speakingStyle: '完整说话方式',
        layeredMemories: [{ id: 'memory-1', scope: 'character_self', layer: 'long_term', kind: 'trait_evidence', ownerId: 'character-1', text: '完整记忆', salience: 0.7, confidence: 0.7, recency: 0.7, reinforcementCount: 1, sourceEventIds: [], createdAt: 1, updatedAt: 1 }],
        characterDetailLoaded: true,
        updatedAt: 1,
      })],
      lastSyncedAt: 1,
      pendingOperations: [],
      pendingEditSyncCount: 0,
      pendingEditSyncError: null,
      remoteDeletedCharacterIds: [],
      isLoading: false,
    });

    await useCharacterStore.getState().loadCharacters();

    const merged = useCharacterStore.getState().characters[0];
    expect(merged.name).toBe('小甲新版');
    expect(merged.updatedAt).toBe(2);
    expect(merged.characterDetailLoaded).toBe(true);
    expect(merged.background).toBe('完整背景不能被摘要覆盖');
    expect(merged.speakingStyle).toBe('完整说话方式');
    expect(merged.layeredMemories?.[0]?.text).toBe('完整记忆');
    expect(apiMocks.getCharacters).not.toHaveBeenCalled();
  });

  it('keeps pending character fields projected over newer remote field versions', async () => {
    apiMocks.getSyncChanges.mockResolvedValueOnce({
      status: 'modified',
      cursor: 'characters.summary:rev-2',
      revision: 'characters.summary:rev-2',
      changes: [{
        op: 'upsert',
        entity: 'character_summary',
        id: 'character-1',
        revision: 2,
        patch: {
          ...character({
            id: 'character-1',
            name: '云端角色名',
            fieldVersions: { name: 200 },
            updatedAt: 200,
            characterDetailLoaded: false,
          }),
          bubbleStyleId: null,
          bubbleStyle: null,
        },
      }],
    });
    const { useCharacterStore } = await import('./useCharacterStore');
    await useCharacterStore.persist.rehydrate();
    useCharacterStore.setState({
      characters: [character({
        id: 'character-1',
        name: '本地角色名',
        fieldVersions: { name: 1 },
        updatedAt: 1,
      })],
      lastSyncedAt: 1,
      pendingOperations: [{
        id: 'op-character-name',
        entityId: 'character-1',
        kind: 'patch',
        targetIds: ['character-1'],
        clientTimestamp: 100,
        patch: { name: '本地待同步角色名' },
        status: 'pending',
        attemptCount: 0,
      }],
      pendingEditSyncCount: 1,
      pendingEditSyncError: null,
      remoteDeletedCharacterIds: [],
      isLoading: false,
    });

    await useCharacterStore.getState().loadCharacters();

    const merged = useCharacterStore.getState().characters[0];
    expect(merged.name).toBe('本地待同步角色名');
    expect(merged.updatedAt).toBe(200);
    expect(merged.fieldVersions?.name).toBe(200);
    expect(useCharacterStore.getState().pendingOperations).toHaveLength(1);
    expect(apiMocks.getCharacters).not.toHaveBeenCalled();
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
