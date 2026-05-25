import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { buildChatCommitContext, getPreviousAiMessage } from './chatCommitContext';

function message(id: string, type: Message['type'], senderId: string, timestamp: number, isDeleted = false): Message {
  return {
    id,
    chatId: 'chat-1',
    type,
    senderId,
    senderName: senderId,
    content: id,
    emotion: 0,
    timestamp,
    isDeleted,
  };
}

describe('chatCommitContext', () => {
  it('uses the latest existing AI message as previous speaker context', () => {
    const messages = [
      message('ai-1', 'ai', 'char-a', 1),
      message('user-1', 'user', 'user', 2),
      message('ai-2', 'ai', 'char-b', 3),
    ];

    expect(getPreviousAiMessage(messages)?.senderId).toBe('char-b');
    expect(buildChatCommitContext(messages).previousAiMessage?.senderId).toBe('char-b');
  });

  it('ignores deleted AI messages and user messages', () => {
    const messages = [
      message('ai-1', 'ai', 'char-a', 1),
      message('ai-2', 'ai', 'char-b', 2, true),
      message('user-1', 'user', 'user', 3),
    ];

    expect(getPreviousAiMessage(messages)?.senderId).toBe('char-a');
  });
});
