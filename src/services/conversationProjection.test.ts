import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import { projectConversationForModel } from './conversationProjection';

function message(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'msg-1',
    chatId: 'chat-1',
    type: patch.type || 'ai',
    senderId: patch.senderId || 'char-a',
    senderName: patch.senderName || '甲',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
    ...patch,
  };
}

describe('projectConversationForModel', () => {
  it('uses assistant only for the current speaker own prior turns', () => {
    const projected = projectConversationForModel({
      messages: [
        message({ type: 'user', senderId: 'user', senderName: '开发者', content: '你们怎么看？', timestamp: 1 }),
        message({ type: 'ai', senderId: 'char-a', senderName: '甲', content: '我觉得可以。', timestamp: 2 }),
        message({ type: 'ai', senderId: 'char-b', senderName: '乙', content: '我不同意。', timestamp: 3 }),
      ],
      characters: new Map<string, AICharacter>(),
      options: { currentSpeakerId: 'char-a', chatType: 'group' },
    });

    expect(projected).toEqual([
      { role: 'user', content: 'Conversation transcript for context only:\nThe complete recent transcript is provided separately as chat messages and is not repeated here.\nRecent transcript is room state and thread evidence, not a style sample to imitate.' },
      { role: 'user', content: '用户: 你们怎么看？' },
      { role: 'assistant', content: '我觉得可以。' },
      { role: 'user', content: '乙: 我不同意。' },
    ]);
  });

  it('keeps AI private counterpart turns as named user-side context', () => {
    const projected = projectConversationForModel({
      messages: [
        message({ senderId: 'char-b', senderName: '阿远', content: '你刚才在群里有点冲。', timestamp: 1 }),
        message({ senderId: 'char-a', senderName: '苏苏', content: '我知道，我有点后悔。', timestamp: 2 }),
      ],
      characters: new Map<string, AICharacter>(),
      options: { currentSpeakerId: 'char-a', chatType: 'ai_direct' },
    });

    expect(projected).toEqual([
      { role: 'user', content: 'Conversation transcript for context only:\nThe complete recent transcript is provided separately as chat messages and is not repeated here.\nRecent transcript is pair-private relationship context, not a generic room script.' },
      { role: 'user', content: '阿远: 你刚才在群里有点冲。' },
      { role: 'assistant', content: '我知道，我有点后悔。' },
    ]);
  });

  it('filters non-dialogue events from the model transcript', () => {
    const projected = projectConversationForModel({
      messages: [
        message({ id: 'sys', type: 'system', senderId: 'system', senderName: 'System', content: 'hidden', timestamp: 1 }),
        message({ id: 'evt', type: 'event', senderId: 'system', senderName: 'System', content: 'event', timestamp: 2 }),
        message({ id: 'user', type: 'user', senderId: 'user', senderName: '我', content: '继续说', timestamp: 3 }),
      ],
      characters: new Map<string, AICharacter>(),
      options: { currentSpeakerId: 'char-a', chatType: 'direct' },
    });

    expect(projected).toEqual([
      { role: 'user', content: 'Conversation transcript for context only:\nThe complete recent transcript is provided separately as chat messages and is not repeated here.\nRecent transcript is private context and direct input, not a public-room writing sample.' },
      { role: 'user', content: '用户: 继续说' },
    ]);
  });
});
