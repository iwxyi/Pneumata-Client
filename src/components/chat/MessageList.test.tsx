import { describe, expect, it } from 'vitest';
import type { Message } from '../../types/message';
import { buildChatRenderItems } from './chatRenderModel';
import { resolveNarrativeRevealTracking, selectNewNarrativeRevealKeys } from './MessageList';

function buildMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'narrator',
    senderName: '旁白',
    content: '',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    ...overrides,
  };
}

function buildNarrativeMessage(id: string): Message {
  return buildMessage(id, {
    metadata: {
      narrativeTurn: {
        turnId: id,
        turnKind: 'narrative_beat',
        povActorId: 'narrator',
        blocks: [{
          id: `${id}-narration`,
          actorId: 'narrator',
          actorKind: 'narrator',
          kind: 'prose',
          displayMode: 'paragraph',
          text: '雨还在下，走廊尽头的灯忽明忽暗。',
        }],
      },
    },
  });
}

describe('MessageList narrative reveal eligibility', () => {
  it('treats the first non-empty render after an empty page as history baseline', () => {
    const empty = resolveNarrativeRevealTracking({
      initialized: false,
      previousKeys: new Set(),
      items: [],
    });
    const historyItems = buildChatRenderItems([
      buildNarrativeMessage('old-story-1'),
      buildNarrativeMessage('old-story-2'),
    ]);
    const baseline = resolveNarrativeRevealTracking({
      initialized: empty.initialized,
      previousKeys: empty.nextSeenKeys,
      items: historyItems,
    });

    expect(empty).toEqual(expect.objectContaining({
      initialized: false,
      newRevealKeys: [],
    }));
    expect(baseline.initialized).toBe(true);
    expect(baseline.newRevealKeys).toEqual([]);
    expect([...baseline.nextSeenKeys]).toEqual(historyItems.map((item) => item.key));
  });

  it('reveals only newly appended narrative messages after the initial history is known', () => {
    const historyItems = buildChatRenderItems([buildNarrativeMessage('old-story')]);
    const knownKeys = new Set(historyItems.map((item) => item.key));
    const nextItems = buildChatRenderItems([
      buildNarrativeMessage('old-story'),
      buildNarrativeMessage('new-story'),
      buildMessage('plain-chat', { senderId: 'a', senderName: '甲', content: '普通聊天消息' }),
    ]);

    const oldStoryKey = historyItems[0]?.key;
    const newStoryKey = nextItems.find((item) => item.message.id === 'new-story')?.key;
    expect(oldStoryKey).toBeTruthy();
    expect(newStoryKey).toBeTruthy();

    expect(selectNewNarrativeRevealKeys({
      previousKeys: new Set(),
      items: historyItems,
    })).toEqual([]);
    expect(selectNewNarrativeRevealKeys({
      previousKeys: knownKeys,
      items: nextItems,
    })).toEqual([newStoryKey]);
  });

  it('does not reveal older narrative messages inserted before the known tail', () => {
    const knownItems = buildChatRenderItems([buildNarrativeMessage('known-story')]);
    const knownKeys = new Set(knownItems.map((item) => item.key));
    const nextItems = buildChatRenderItems([
      buildNarrativeMessage('older-story'),
      buildNarrativeMessage('known-story'),
    ]);

    expect(selectNewNarrativeRevealKeys({
      previousKeys: knownKeys,
      items: nextItems,
    })).toEqual([]);
  });
});
