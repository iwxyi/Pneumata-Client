import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeConversation, type DriverMessageCommitTransition } from '../types/chat';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { DEFAULT_API_CONFIG } from '../types/settings';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { __resetDeferredLlmDistillationStateForTests, runSessionCommitPipeline } from './sessionCommitPipeline';

const runChatCommitPipelineMock = vi.fn();
const shouldRunLlmChatDistillationMock = vi.fn();
const shouldRunLlmCharacterDistillationMock = vi.fn();
const distillChatMemoriesWithLlmMock = vi.fn();
const distillCharacterMemoriesWithLlmMock = vi.fn();
const debugLlmChatDistillationMock = vi.fn();
const debugLlmCharacterDistillationMock = vi.fn();
const buildLlmDistillationSourceMock = vi.fn();

vi.mock('./chatCommitPipeline', () => ({
  runChatCommitPipeline: (...args: unknown[]) => runChatCommitPipelineMock(...args),
}));

vi.mock('./llmMemoryDistillation', () => ({
  buildLlmDistillationSource: (...args: unknown[]) => buildLlmDistillationSourceMock(...args),
  debugLlmCharacterDistillation: (...args: unknown[]) => debugLlmCharacterDistillationMock(...args),
  debugLlmChatDistillation: (...args: unknown[]) => debugLlmChatDistillationMock(...args),
  distillChatMemoriesWithLlm: (...args: unknown[]) => distillChatMemoriesWithLlmMock(...args),
  distillCharacterMemoriesWithLlm: (...args: unknown[]) => distillCharacterMemoriesWithLlmMock(...args),
  shouldRunLlmCharacterDistillation: (...args: unknown[]) => shouldRunLlmCharacterDistillationMock(...args),
  shouldRunLlmChatDistillation: (...args: unknown[]) => shouldRunLlmChatDistillationMock(...args),
}));

beforeEach(() => {
  __resetDeferredLlmDistillationStateForTests();
  runChatCommitPipelineMock.mockReset();
  shouldRunLlmChatDistillationMock.mockReset();
  shouldRunLlmCharacterDistillationMock.mockReset();
  distillChatMemoriesWithLlmMock.mockReset();
  distillCharacterMemoriesWithLlmMock.mockReset();
  debugLlmChatDistillationMock.mockReset();
  debugLlmCharacterDistillationMock.mockReset();
  buildLlmDistillationSourceMock.mockReset();
});

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a', 'char-b'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildCharacter(id: string, name: string, layeredMemories: MemoryItem[] = []): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories,
    background: '',
    speakingStyle: '',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    speechProfile: undefined,
    personalityDrift: {},
    modelProfileId: null,
    modelProfileIds: {},
    bubbleStyleId: null,
    runtimeTimeline: [],
    deletedAt: null,
    fieldVersions: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildMemoryItem(id: string, ownerId: string, subjectIds: string[], text: string, eventId: string): MemoryItem {
  return {
    id,
    ownerId,
    scope: 'relationship',
    layer: 'working',
    kind: 'resentment',
    subjectIds,
    text,
    salience: 0.8,
    confidence: 0.85,
    recency: 0.9,
    reinforcementCount: 1,
    sourceEventIds: [eventId],
    sourceTag: 'interaction',
    origin: 'runtime',
    createdAt: 100,
    updatedAt: 100,
  };
}

function buildDistilledCandidate(ownerId: string, text: string): MemoryCandidate {
  return {
    scope: 'relationship',
    layerHint: 'long_term',
    kind: 'resentment',
    ownerId,
    subjectIds: ['char-b'],
    text,
    sourceEventIds: ['e1', 'e2'],
    sourceTag: 'llm_memory_distillation',
    origin: 'distilled',
    distilledFromIds: ['src-1'],
    distilledAt: 300,
    distillationVersion: 'llm-v2',
    scoreBreakdown: {
      stability: 0.9,
      recurrence: 0.8,
      impact: 0.8,
      specificity: 0.8,
      durability: 0.9,
    },
  };
}

describe('runSessionCommitPipeline', () => {
  it('runs LLM distillation against the post-commit layered memories and emits debug events', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('char-a', '甲'), buildCharacter('char-b', '乙')];
    const freshChatMemory = buildMemoryItem('chat-fresh', 'chat-1', ['char-a', 'char-b'], 'fresh-chat-evidence', 'evt-chat');
    const freshCharacterMemory = buildMemoryItem('char-fresh', 'char-a', ['char-b'], 'fresh-char-evidence', 'evt-char');
    const transition: DriverMessageCommitTransition = {
      chatPatch: { layeredMemories: [freshChatMemory] },
      characterPatches: [{ characterId: 'char-a', patch: { layeredMemories: [freshCharacterMemory] } }],
      runtimeEvents: [],
    };
    const updateChat = vi.fn(async () => undefined);
    const updateCharacter = vi.fn(async () => undefined);
    const appendEventMessage = vi.fn(async () => undefined);

    runChatCommitPipelineMock.mockResolvedValue({
      persistedMessage: { id: 'msg-1' },
      transition,
    });
    shouldRunLlmChatDistillationMock.mockImplementation((nextChat: { layeredMemories?: MemoryItem[] }) =>
      Boolean(nextChat.layeredMemories?.some((item) => item.text === 'fresh-chat-evidence')),
    );
    shouldRunLlmCharacterDistillationMock.mockImplementation((nextCharacter: AICharacter) =>
      Boolean(nextCharacter.layeredMemories?.some((item) => item.text === 'fresh-char-evidence')),
    );
    distillChatMemoriesWithLlmMock.mockImplementation(async (_api: unknown, nextChat: { layeredMemories?: MemoryItem[] }) =>
      nextChat.layeredMemories?.some((item) => item.text === 'fresh-chat-evidence')
        ? [buildDistilledCandidate('chat-1', 'char-b 被持续针对')]
        : [],
    );
    distillCharacterMemoriesWithLlmMock.mockImplementation(async (_api: unknown, nextCharacter: AICharacter) =>
      nextCharacter.layeredMemories?.some((item) => item.text === 'fresh-char-evidence')
        ? [buildDistilledCandidate(nextCharacter.id, 'char-b 被持续针对')]
        : [],
    );
    debugLlmChatDistillationMock.mockReturnValue({ eligibleCount: 1, evidenceCount: 1 });
    debugLlmCharacterDistillationMock.mockReturnValue({ eligibleCount: 1, evidenceCount: 1 });
    buildLlmDistillationSourceMock.mockImplementation(({ layeredMemories }: { layeredMemories?: MemoryItem[] }) => layeredMemories || []);

    await runSessionCommitPipeline({
      api: DEFAULT_API_CONFIG,
      chatId: chat.id,
      chat,
      characters,
      message: {
        chatId: chat.id,
        type: 'ai',
        senderId: 'char-a',
        senderName: '甲',
        content: '测试消息',
        emotion: 0,
      },
      currentMessages: [],
      onCommit: vi.fn(async () => transition),
      upsertMessage: vi.fn(),
      updateCharacter,
      appendEventMessage,
      updateChat,
      recordSpeak: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(updateChat).toHaveBeenCalled();
      expect(updateCharacter).toHaveBeenCalled();
    });

    expect(distillChatMemoriesWithLlmMock).toHaveBeenCalledWith(DEFAULT_API_CONFIG, expect.objectContaining({
      layeredMemories: expect.arrayContaining([expect.objectContaining({ text: 'fresh-chat-evidence' })]),
    }));
    expect(distillCharacterMemoriesWithLlmMock).toHaveBeenCalledWith(DEFAULT_API_CONFIG, expect.objectContaining({
      id: 'char-a',
      layeredMemories: expect.arrayContaining([expect.objectContaining({ text: 'fresh-char-evidence' })]),
    }));
    expect(updateChat).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      layeredMemories: expect.arrayContaining([expect.objectContaining({ text: 'char-b 被持续针对' })]),
    }));
    expect(updateCharacter).toHaveBeenCalledWith('char-a', expect.objectContaining({
      layeredMemories: expect.arrayContaining([expect.objectContaining({ text: 'char-b 被持续针对' })]),
    }));
    expect(appendEventMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        eventType: 'memory_distillation',
        title: 'LLM 蒸馏 · 群聊',
        summary: expect.stringContaining('乙'),
      }),
      'msg-1',
    );
  });

  it('coalesces overlapping deferred chat distillation runs for the same chat', async () => {
    const baseChat = buildChat();
    const characters = [buildCharacter('char-a', '甲'), buildCharacter('char-b', '乙')];
    const freshChatMemory = buildMemoryItem('chat-fresh', 'chat-1', ['char-a', 'char-b'], 'fresh-chat-evidence', 'evt-chat');
    const transition: DriverMessageCommitTransition = {
      chatPatch: { layeredMemories: [freshChatMemory] },
      characterPatches: [],
      runtimeEvents: [],
    };

    runChatCommitPipelineMock
      .mockResolvedValueOnce({
        persistedMessage: { id: 'msg-1' },
        transition,
      })
      .mockResolvedValueOnce({
        persistedMessage: { id: 'msg-2' },
        transition: { chatPatch: {}, characterPatches: [], runtimeEvents: [] },
      });
    shouldRunLlmChatDistillationMock.mockReturnValue(true);
    shouldRunLlmCharacterDistillationMock.mockReturnValue(false);
    buildLlmDistillationSourceMock.mockImplementation(({ layeredMemories }: { layeredMemories?: MemoryItem[] }) => layeredMemories || []);
    debugLlmChatDistillationMock.mockReturnValue({ eligibleCount: 1, evidenceCount: 1 });

    let releaseDistillation: (() => void) | undefined;
    let invocation = 0;
    distillChatMemoriesWithLlmMock.mockImplementation(async () => {
      invocation += 1;
      if (invocation === 1) {
        await new Promise<void>((resolve) => {
          releaseDistillation = resolve;
        });
      }
      return [buildDistilledCandidate('chat-1', 'char-b 被持续针对')];
    });

    let currentChat = normalizeConversation({
      ...baseChat,
      layeredMemories: [freshChatMemory],
    });

    await runSessionCommitPipeline({
      api: DEFAULT_API_CONFIG,
      chatId: currentChat.id,
      chat: currentChat,
      characters,
      message: {
        chatId: currentChat.id,
        type: 'ai',
        senderId: 'char-a',
        senderName: '甲',
        content: '第一轮',
        emotion: 0,
      },
      currentMessages: [],
      onCommit: vi.fn(async () => transition),
      upsertMessage: vi.fn(),
      updateCharacter: vi.fn(async () => undefined),
      appendEventMessage: vi.fn(async () => undefined),
      updateChat: vi.fn(async () => undefined),
      recordSpeak: vi.fn(),
      getCurrentChat: () => currentChat,
      getCurrentCharacters: () => characters,
    });

    currentChat = normalizeConversation({
      ...currentChat,
      layeredMemories: [
        freshChatMemory,
        buildMemoryItem('chat-fresh-2', 'chat-1', ['char-a', 'char-b'], 'fresh-chat-evidence-2', 'evt-chat-2'),
      ],
      updatedAt: 2,
      lastMessageAt: 2,
    });

    await runSessionCommitPipeline({
      api: DEFAULT_API_CONFIG,
      chatId: currentChat.id,
      chat: currentChat,
      characters,
      message: {
        chatId: currentChat.id,
        type: 'ai',
        senderId: 'char-a',
        senderName: '甲',
        content: '第二轮',
        emotion: 0,
      },
      currentMessages: [],
      onCommit: vi.fn(async () => ({ chatPatch: {}, characterPatches: [], runtimeEvents: [] })),
      upsertMessage: vi.fn(),
      updateCharacter: vi.fn(async () => undefined),
      appendEventMessage: vi.fn(async () => undefined),
      updateChat: vi.fn(async () => undefined),
      recordSpeak: vi.fn(),
      getCurrentChat: () => currentChat,
      getCurrentCharacters: () => characters,
    });

    expect(distillChatMemoriesWithLlmMock).toHaveBeenCalledTimes(1);

    releaseDistillation?.();

    await vi.waitFor(() => {
      expect(distillChatMemoriesWithLlmMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not add unchanged framework fields to every runtime chat patch', async () => {
    const chat = normalizeConversation({
      ...buildChat(),
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
      scenarioPackage: { scenarioId: 'open-chat', label: 'Open Chat' },
      channels: [{ channelId: 'public', visibility: 'public', label: 'Public' }],
      judgeAgent: { enabled: false, style: 'assistive' },
    });
    const transition: DriverMessageCommitTransition = {
      chatPatch: { runtimeTimeline: [{ type: 'note', text: '测试', createdAt: 2 }] },
      characterPatches: [],
      runtimeEvents: [],
    };
    runChatCommitPipelineMock.mockImplementation(async (params: {
      onCommit: (args: { conversation: typeof chat; characters: AICharacter[]; message: { content: string; type: 'ai'; senderId: string }; previousAiMessage: null }) => Promise<DriverMessageCommitTransition>;
    }) => ({
      persistedMessage: { id: 'msg-1' },
      transition: await params.onCommit({
        conversation: chat,
        characters: [],
        message: { content: '测试消息', type: 'ai', senderId: 'char-a' },
        previousAiMessage: null,
      }),
    }));
    shouldRunLlmChatDistillationMock.mockReturnValue(false);
    shouldRunLlmCharacterDistillationMock.mockReturnValue(false);

    await runSessionCommitPipeline({
      api: DEFAULT_API_CONFIG,
      chatId: chat.id,
      chat,
      characters: [],
      message: {
        chatId: chat.id,
        type: 'ai',
        senderId: 'char-a',
        senderName: '甲',
        content: '测试消息',
        emotion: 0,
      },
      currentMessages: [],
      onCommit: vi.fn(async () => transition),
      upsertMessage: vi.fn(),
      updateCharacter: vi.fn(async () => undefined),
      appendEventMessage: vi.fn(async () => undefined),
      updateChat: vi.fn(async () => undefined),
      recordSpeak: vi.fn(),
    });

    const wrappedOnCommit = runChatCommitPipelineMock.mock.calls[0]?.[0]?.onCommit as (args: {
      conversation: typeof chat;
      characters: AICharacter[];
      message: { content: string; type: 'ai'; senderId: string };
      previousAiMessage: null;
    }) => Promise<DriverMessageCommitTransition>;
    const wrappedTransition = await wrappedOnCommit({
      conversation: chat,
      characters: [],
      message: { content: '测试消息', type: 'ai', senderId: 'char-a' },
      previousAiMessage: null,
    });

    expect(Object.keys(wrappedTransition.chatPatch)).toEqual(['runtimeTimeline']);
  });

});
