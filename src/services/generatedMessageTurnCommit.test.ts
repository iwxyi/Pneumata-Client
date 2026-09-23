import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';
import { commitGeneratedMessageTurn } from './generatedMessageTurnCommit';

const runSessionCommitPipelineMock = vi.fn();

vi.mock('./sessionCommitPipeline', () => ({
  runSessionCommitPipeline: (...args: unknown[]) => runSessionCommitPipelineMock(...args),
}));

beforeEach(() => {
  runSessionCommitPipelineMock.mockReset();
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
  it('commits each explicit message part through the normal session pipeline', async () => {
    runSessionCommitPipelineMock.mockImplementation(async (args: { message: Message }) => ({
      persistedMessage: buildPersistedMessage(args.message.content, runSessionCommitPipelineMock.mock.calls.length),
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

    expect(runSessionCommitPipelineMock).toHaveBeenCalledTimes(2);
    expect(runSessionCommitPipelineMock.mock.calls.map((call) => call[0].message.content)).toEqual(['等下', '你刚说谁来着？']);
    expect(runSessionCommitPipelineMock.mock.calls[1]?.[0]).toMatchObject({
      streamingMessage: null,
      localRevealStartDelayMs: expect.any(Number),
    });
  });

  it('passes each segment metadata independently to the normal commit pipeline', async () => {
    runSessionCommitPipelineMock.mockImplementation(async (args: { message: Message }) => ({
      persistedMessage: buildPersistedMessage(args.message.content, runSessionCommitPipelineMock.mock.calls.length),
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
        content: '第一条',
        metadata: { generatedAt: 777000 },
        messageParts: [
          { content: '第一条', metadata: { generatedAt: 777000 } },
          {
            content: '第二条图片',
            metadata: {
              attachments: [{ id: 'image-1', kind: 'image', status: 'queued', altText: '小花', promptText: '一朵小花', createdAt: 1, updatedAt: 1 }],
            },
          },
          {
            content: '第三条语音',
            metadata: {
              attachments: [{ id: 'audio-1', kind: 'audio', status: 'queued', altText: '语音：你好', promptText: '你好', createdAt: 1, updatedAt: 1 }],
            },
          },
        ],
        emotion: 0,
      },
    } as never);

    expect(runSessionCommitPipelineMock).toHaveBeenCalledTimes(3);
    expect(runSessionCommitPipelineMock.mock.calls[1]?.[0]?.message).toMatchObject({
      content: '第二条图片',
      metadata: { attachments: [{ id: 'image-1', kind: 'image', status: 'queued' }] },
    });
    expect(runSessionCommitPipelineMock.mock.calls[2]?.[0]?.message).toMatchObject({
      content: '第三条语音',
      metadata: { attachments: [{ id: 'audio-1', kind: 'audio', status: 'queued' }] },
    });
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
  });
});
