import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupChat } from '../types/chat';
import { runSessionLoop } from './sessionRunner';

const runOneRoundMock = vi.fn();
const runSessionActionExecutorMock = vi.fn();
const runSessionCommitPipelineMock = vi.fn();

vi.mock('./chatEngine', () => ({
  runOneRound: (...args: unknown[]) => runOneRoundMock(...args),
}));

vi.mock('./sessionActionExecutors/sessionActionExecutorRegistry', () => ({
  runSessionActionExecutor: (...args: unknown[]) => runSessionActionExecutorMock(...args),
}));

vi.mock('./sessionCommitPipeline', () => ({
  runSessionCommitPipeline: (...args: unknown[]) => runSessionCommitPipelineMock(...args),
}));

vi.mock('./sessionEngineKernel', () => ({
  createSessionRuntimeContext: () => ({ participants: [] }),
}));

vi.mock('./sessionActionBus', () => ({
  getAllowedSessionActions: (_engine: unknown, context: { conversation: GroupChat }) => {
    if (context.conversation.mode === 'open_chat') return [{ type: 'speak' }];
    if (context.conversation.mode === 'werewolf') return [{ type: 'wolf_vote' }];
    return [{ type: 'ask_question', payload: { prompt: '问题', targetId: 'b' }, targetIds: ['b'] }, { type: 'speak' }];
  },
}));

vi.mock('./sessionStateMachine', () => ({
  getCurrentSessionPhase: (_engine: unknown, chat: GroupChat) => ({
    allowedActions: chat.mode === 'open_chat' && chat.worldState.phase === 'aligned'
      ? ['director_intervention']
      : ['ask_question', 'speak'],
  }),
}));

vi.mock('./interviewRunnerPolicy', () => ({
  shouldInterviewAllowSpeak: (chat: GroupChat) => chat.worldState.phase !== 'aligned',
  shouldInterviewRunAction: (chat: GroupChat) => chat.worldState.phase === 'idle' || chat.worldState.phase === 'aligned',
}));

vi.mock('./engines/interviewEngine', () => ({
  INTERVIEW_ENGINE: {
    key: 'interview',
    createInitialConfig: () => ({}),
    createInitialState: () => ({}),
    buildParticipants: () => [],
    getVisiblePanels: () => [],
    getAvailableActions: () => [{ type: 'ask_question' }],
    getActionSchema: () => ({
      title: '面试动作',
      actions: [{ type: 'ask_question', payload: { prompt: '问题', targetId: 'b' }, targetIds: ['b'] }],
    }),
    resolveTurnPolicy: (context: { conversation: GroupChat }) => ({
      runChat: context.conversation.worldState.phase !== 'idle' && context.conversation.worldState.phase !== 'aligned',
      runAction: true,
      interleaveAction: false,
    }),
    buildGenerationPromptContext: () => ({ promptPrefix: 'interview' }),
    onMessageCommitted: async () => ({ chatPatch: {}, characterPatches: [], runtimeEvents: [] }),
  },
}));

vi.mock('./engines/openChatEngine', () => ({
  openChatEngine: {
    key: 'open_chat',
    createInitialConfig: () => ({}),
    createInitialState: () => ({}),
    buildParticipants: () => [],
    getVisiblePanels: () => [],
    getAvailableActions: () => [{ type: 'speak' }],
    getActionSchema: () => null,
    resolveTurnPolicy: (context: { conversation: GroupChat }) => ({
      runChat: context.conversation.worldState.phase !== 'aligned',
      runAction: false,
      interleaveAction: false,
    }),
    buildGenerationPromptContext: () => ({ promptPrefix: 'open' }),
    onMessageCommitted: async () => ({ chatPatch: {}, characterPatches: [], runtimeEvents: [] }),
  },
}));

vi.mock('./engines/werewolfEngine', () => ({
  WEREWOLF_ENGINE: {
    key: 'werewolf',
    createInitialConfig: () => ({}),
    createInitialState: () => ({}),
    buildParticipants: () => [],
    getVisiblePanels: () => [],
    getAvailableActions: () => [{ type: 'wolf_vote' }],
    getActionSchema: () => ({ title: '狼人动作', actions: [{ type: 'wolf_vote', payload: { targetId: 'b' }, targetIds: ['b'] }] }),
    resolveTurnPolicy: () => ({ runChat: false, runAction: true, interleaveAction: false }),
    onMessageCommitted: async () => ({ chatPatch: {}, characterPatches: [], runtimeEvents: [] }),
  },
}));

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realMathRandom = Math.random;

globalThis.setTimeout = ((fn: (...args: unknown[]) => void) => {
  fn();
  return 0 as unknown as ReturnType<typeof setTimeout>;
}) as unknown as typeof setTimeout;

globalThis.clearTimeout = (() => undefined) as unknown as typeof clearTimeout;
Math.random = () => 0;

afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  Math.random = realMathRandom;
});

beforeEach(() => {
  runOneRoundMock.mockReset();
  runSessionActionExecutorMock.mockReset();
  runSessionCommitPipelineMock.mockReset();
});

function buildCommitPipelineResult(args: { message: Partial<import('../types/message').Message>; chat: GroupChat; characters: unknown[] }) {
  return {
    persistedMessage: {
      id: `persisted-${Math.random()}`,
      chatId: 'chat-1',
      type: 'ai',
      senderId: args.message.senderId || 'a',
      senderName: args.message.senderName || '甲',
      content: args.message.content || '',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      ...args.message,
    },
    transition: { chatPatch: {}, characterPatches: [], runtimeEvents: [] },
    nextChat: args.chat,
    nextCharacters: args.characters,
  };
}

function buildChat(overrides: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'interview',
    modeConfig: {},
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '测试',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 999,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  } as GroupChat;
}

function buildLoopParams(chat: GroupChat) {
  let running = true;
  return {
    loopId: 'loop-1',
    chatId: chat.id,
    chat,
    characters: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] as never[],
    api: { provider: 'openai', apiKey: 'x', baseUrl: 'http://localhost', model: 'test' },
    getCurrentMessages: () => [],
    isRunning: () => running,
    isPaused: () => false,
    isActiveLoop: (loopId: string) => loopId === 'loop-1',
    onSpeakerSelected: vi.fn(),
    getStreamingMessage: undefined as (() => unknown) | undefined,
    onCommitStarted: undefined as (() => void) | undefined,
    onCommitFinished: undefined as (() => void) | undefined,
    onMessageChunk: vi.fn(),
    onClearStreamingState: vi.fn(),
    onEngineError: vi.fn(),
    onLoopError: vi.fn(() => { running = false; }),
    onCommit: vi.fn(async () => ({ chatPatch: {}, characterPatches: [], runtimeEvents: [] })),
    upsertMessage: vi.fn(),
    updateCharacter: vi.fn(async () => undefined),
    appendEventMessage: vi.fn(async () => undefined),
    updateChat: vi.fn(async () => { running = false; }),
    recordSpeak: vi.fn(),
  };
}

describe('runSessionLoop', () => {
  it('passes model stream chunks directly to the live message callback', async () => {
    runSessionCommitPipelineMock.mockImplementation(async (args) => buildCommitPipelineResult(args));
    runOneRoundMock.mockImplementation(async (_chat, _characters, _messages, _api, hooks) => {
      hooks.onSpeakerSelected('a', { id: 'a', name: '甲' });
      hooks.onMessageChunk('真');
      hooks.onMessageChunk('真正');
      hooks.onMessageChunk('真正流式');
      await hooks.onMessageComplete({ id: 'msg-stream', chatId: 'chat-1', type: 'ai', senderId: 'a', senderName: '甲', content: '真正流式', emotion: 0 });
    });
    const params = buildLoopParams(buildChat({ mode: 'open_chat', worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    params.getCurrentMessages = () => [{ id: 'm1', chatId: 'chat-1', type: 'ai', senderId: 'b', senderName: '乙', content: '上一句', emotion: 0 }] as never[];
    params.onClearStreamingState = vi.fn(() => {
      params.onLoopError();
    });
    await runSessionLoop(params as never);
    expect(params.onMessageChunk).toHaveBeenNthCalledWith(1, '真');
    expect(params.onMessageChunk).toHaveBeenNthCalledWith(2, '真正');
    expect(params.onMessageChunk).toHaveBeenNthCalledWith(3, '真正流式');
    expect(runSessionCommitPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('reports blocked interview actions when no executable schema action is available', async () => {
    const params = buildLoopParams(buildChat({ mode: 'interview', worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    await runSessionLoop(params as never);
    expect(runSessionActionExecutorMock).not.toHaveBeenCalled();
    expect(runOneRoundMock).not.toHaveBeenCalled();
    expect(params.updateChat).not.toHaveBeenCalled();
    expect(params.onLoopError).toHaveBeenCalled();
  });

  it('skips chat ticks when engine policy disallows werewolf speaking', async () => {
    const params = buildLoopParams(buildChat({ mode: 'werewolf', worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    await runSessionLoop(params as never);
    expect(runOneRoundMock).not.toHaveBeenCalled();
    expect(params.onLoopError).toHaveBeenCalled();
  });

  it('runs speaking ticks and commits the generated message', async () => {
    runSessionCommitPipelineMock.mockImplementation(async (args) => buildCommitPipelineResult(args));
    runOneRoundMock.mockImplementation(async (_chat, _characters, _messages, _api, hooks) => {
      hooks.onSpeakerSelected('a', { id: 'a', name: '甲' });
      await hooks.onMessageComplete({ id: 'msg-1', chatId: 'chat-1', type: 'ai', senderId: 'a', senderName: '甲', content: '完整回复', emotion: 0 });
    });
    const params = buildLoopParams(buildChat({ mode: 'open_chat', worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    params.getCurrentMessages = () => [{ id: 'm1', chatId: 'chat-1', type: 'ai', senderId: 'b', senderName: '乙', content: '上一句', emotion: 0 }] as never[];
    params.onClearStreamingState = vi.fn(() => {
      params.onLoopError();
    });
    await runSessionLoop(params as never);
    expect(runOneRoundMock).toHaveBeenCalledTimes(1);
    expect(params.onSpeakerSelected).toHaveBeenCalledWith('a');
    expect(runSessionCommitPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('tracks commit lifecycle and forwards the current streaming message', async () => {
    const streamingMessage = {
      id: 'stream-1',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'a',
      senderName: '甲',
      content: '正在说',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      isStreaming: true,
    };
    const commitStarted = vi.fn();
    const commitFinished = vi.fn();
    runSessionCommitPipelineMock.mockImplementation(async (args) => buildCommitPipelineResult(args));
    runOneRoundMock.mockImplementation(async (_chat, _characters, _messages, _api, hooks) => {
      hooks.onSpeakerSelected('a', { id: 'a', name: '甲' });
      await hooks.onMessageComplete({ id: 'msg-1', chatId: 'chat-1', type: 'ai', senderId: 'a', senderName: '甲', content: '完整回复', emotion: 0 });
    });
    const params = buildLoopParams(buildChat({ mode: 'open_chat', worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    params.getStreamingMessage = () => streamingMessage as never;
    params.onCommitStarted = commitStarted;
    params.onCommitFinished = commitFinished;
    params.onClearStreamingState = vi.fn(() => {
      params.onLoopError();
    });

    await runSessionLoop(params as never);

    expect(commitStarted).toHaveBeenCalledTimes(1);
    expect(commitFinished).toHaveBeenCalledTimes(1);
    expect(runSessionCommitPipelineMock).toHaveBeenCalledWith(expect.objectContaining({
      streamingMessage,
    }));
  });

  it('passes engine prompt context through to chat rounds', async () => {
    runSessionCommitPipelineMock.mockImplementation(async (args) => buildCommitPipelineResult(args));
    runOneRoundMock.mockImplementation(async (_chat, _characters, _messages, _api, hooks) => {
      hooks.onSpeakerSelected('a', { id: 'a', name: '甲' });
      await hooks.onMessageComplete({ id: 'msg-2', chatId: 'chat-1', type: 'ai', senderId: 'a', senderName: '甲', content: '另一条回复', emotion: 0 });
    });
    const params = buildLoopParams(buildChat({ mode: 'open_chat', worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    params.getCurrentMessages = () => [{ id: 'm1', chatId: 'chat-1', type: 'ai', senderId: 'b', senderName: '乙', content: '上一句', emotion: 0 }] as never[];
    params.onClearStreamingState = vi.fn(() => {
      params.onLoopError();
    });
    await runSessionLoop(params as never);
    expect(runOneRoundMock.mock.calls[0]?.[6]).toMatchObject({ buildPromptContext: expect.any(Function) });
  });

  it('reports blocked speaking phases as loop errors', async () => {
    const params = buildLoopParams(buildChat({ mode: 'open_chat', worldState: { phase: 'aligned', mood: '', focus: '', recentEvent: '', conflictAxes: [] } as never }));
    await runSessionLoop(params as never);
    expect(runOneRoundMock).not.toHaveBeenCalled();
    expect(params.onLoopError).toHaveBeenCalled();
  });
});

export {};
