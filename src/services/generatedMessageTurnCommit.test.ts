import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';
import { commitGeneratedMessageTurn } from './generatedMessageTurnCommit';

const persistStreamingMessageMock = vi.fn();
const runSessionCommitPipelineMock = vi.fn();
const runPersistedSessionCommitRuntimeMock = vi.fn();

vi.mock('./chatCommitMessage', () => ({
  persistStreamingMessage: (...args: unknown[]) => persistStreamingMessageMock(...args),
}));

vi.mock('./sessionCommitPipeline', () => ({
  runSessionCommitPipeline: (...args: unknown[]) => runSessionCommitPipelineMock(...args),
  runPersistedSessionCommitRuntime: (...args: unknown[]) => runPersistedSessionCommitRuntimeMock(...args),
}));

beforeEach(() => {
  persistStreamingMessageMock.mockReset();
  runSessionCommitPipelineMock.mockReset();
  runPersistedSessionCommitRuntimeMock.mockReset();
});

function buildPersistedMessage(content: string, index: number): Message {
  return {
    id: `local-${index}`,
    clientKey: `local-${index}`,
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-1',
    senderName: '甲',
    content,
    emotion: 0,
    timestamp: 100 + index,
    isDeleted: false,
  };
}

function baseParams() {
  return {
    api: { provider: 'openai', apiKey: 'x', baseUrl: 'http://localhost', model: 'test' },
    chatId: 'chat-1',
    chat: { id: 'chat-1' },
    characters: [],
    streamingMessage: null,
    currentMessages: [],
    onCommit: vi.fn(),
    upsertMessage: vi.fn(),
    updateCharacter: vi.fn(),
    updateCharacters: vi.fn(),
    appendEventMessage: vi.fn(),
    appendEventMessages: vi.fn(),
    updateChat: vi.fn(),
    applyChatRuntimeDelta: vi.fn(),
    recordSpeak: vi.fn(),
  };
}

describe('commitGeneratedMessageTurn', () => {
  it('persists model-provided extra messages but runs runtime commit once with the full turn', async () => {
    let persistIndex = 0;
    persistStreamingMessageMock.mockImplementation(async (args: { message: { content: string } }) => {
      const message = buildPersistedMessage(args.message.content, persistIndex);
      persistIndex += 1;
      return message;
    });
    runPersistedSessionCommitRuntimeMock.mockImplementation(async (args: { message: Message }) => ({
      persistedMessage: args.message,
      transition: { chatPatch: {}, characterPatches: [], runtimeEvents: [] },
      nextChat: { id: 'chat-1' },
      nextCharacters: [],
    }));

    await commitGeneratedMessageTurn({
      ...baseParams(),
      message: {
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'char-1',
        senderName: '甲',
        content: '等下',
        extraMessages: ['你刚说谁来着？'],
        emotion: 0,
      },
    } as never);

    expect(persistStreamingMessageMock).toHaveBeenCalledTimes(2);
    expect(persistStreamingMessageMock.mock.calls.map((call) => call[0].message.content)).toEqual(['等下', '你刚说谁来着？']);
    expect(runSessionCommitPipelineMock).not.toHaveBeenCalled();
    expect(runPersistedSessionCommitRuntimeMock).toHaveBeenCalledTimes(1);
    expect(runPersistedSessionCommitRuntimeMock.mock.calls[0]?.[0].message.content).toBe('等下\n你刚说谁来着？');
  });

  it('uses message.metadata.generatedAt as deterministic segment timestamp base', async () => {
    let persistIndex = 0;
    persistStreamingMessageMock.mockImplementation(async (args: { message: { content: string } }) => {
      const message = buildPersistedMessage(args.message.content, persistIndex);
      persistIndex += 1;
      return message;
    });
    runPersistedSessionCommitRuntimeMock.mockResolvedValue({
      persistedMessage: buildPersistedMessage('等下\n你刚说谁来着？', 0),
      transition: { chatPatch: {}, characterPatches: [], runtimeEvents: [] },
      nextChat: { id: 'chat-1' },
      nextCharacters: [],
    });

    await commitGeneratedMessageTurn({
      ...baseParams(),
      message: {
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'char-1',
        senderName: '甲',
        content: '等下',
        extraMessages: ['你刚说谁来着？'],
        metadata: { generatedAt: 777000 },
        emotion: 0,
      },
    } as never);

    expect(persistStreamingMessageMock).toHaveBeenCalledTimes(2);
    expect(persistStreamingMessageMock.mock.calls[0]?.[0]?.timestamp).toBeUndefined();
    expect(persistStreamingMessageMock.mock.calls[1]?.[0]?.timestamp).toBe(777001);
  });

  it('keeps the existing single-message commit path when no explicit parts are provided', async () => {
    runSessionCommitPipelineMock.mockResolvedValue({
      persistedMessage: buildPersistedMessage('完整回复', 0),
      transition: { chatPatch: {}, characterPatches: [], runtimeEvents: [] },
      nextChat: { id: 'chat-1' },
      nextCharacters: [],
    });

    await commitGeneratedMessageTurn({
      ...baseParams(),
      message: {
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'char-1',
        senderName: '甲',
        content: '完整回复',
        emotion: 0,
      },
    } as never);

    expect(runSessionCommitPipelineMock).toHaveBeenCalledTimes(1);
    expect(persistStreamingMessageMock).not.toHaveBeenCalled();
    expect(runPersistedSessionCommitRuntimeMock).not.toHaveBeenCalled();
  });
});
