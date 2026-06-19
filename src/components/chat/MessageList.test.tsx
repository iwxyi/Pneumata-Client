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

function buildNarrativeMessage(id: string, overrides: Partial<Message> = {}): Message {
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
    ...overrides,
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
    const historyItems = buildChatRenderItems([buildNarrativeMessage('old-story', { timestamp: 1 })]);
    const knownKeys = new Set(historyItems.map((item) => item.key));
    const nextItems = buildChatRenderItems([
      buildNarrativeMessage('old-story', { timestamp: 1 }),
      buildNarrativeMessage('new-story', { timestamp: 2 }),
      buildMessage('plain-chat', { senderId: 'a', senderName: '甲', content: '普通聊天消息', timestamp: 3 }),
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
    const knownItems = buildChatRenderItems([buildNarrativeMessage('known-story', { timestamp: 2 })]);
    const knownKeys = new Set(knownItems.map((item) => item.key));
    const nextItems = buildChatRenderItems([
      buildNarrativeMessage('older-story', { timestamp: 1 }),
      buildNarrativeMessage('known-story', { timestamp: 2 }),
    ]);

    expect(selectNewNarrativeRevealKeys({
      previousKeys: knownKeys,
      items: nextItems,
    })).toEqual([]);
  });

  it('treats batched appended narrative messages as restored history instead of replaying every paragraph', () => {
    const knownItems = buildChatRenderItems([buildNarrativeMessage('known-tail', { timestamp: 1 })]);
    const knownKeys = new Set(knownItems.map((item) => item.key));
    const nextItems = buildChatRenderItems([
      buildNarrativeMessage('known-tail', { timestamp: 1 }),
      buildNarrativeMessage('restored-story-1', { timestamp: 2 }),
      buildNarrativeMessage('restored-story-2', { timestamp: 3 }),
      buildNarrativeMessage('restored-story-3', { timestamp: 4 }),
    ]);

    expect(selectNewNarrativeRevealKeys({
      previousKeys: knownKeys,
      items: nextItems,
    })).toEqual([]);
  });

  it('does not replay a history message when hydration swaps it to a later render key at the same timestamp', () => {
    const knownItems = buildChatRenderItems([
      buildNarrativeMessage('story-before', { timestamp: 1 }),
      buildNarrativeMessage('local-story-tail', { clientKey: 'local-story-tail', timestamp: 2 }),
    ]);
    const knownKeys = new Set(knownItems.map((item) => item.key));
    const nextItems = buildChatRenderItems([
      buildNarrativeMessage('story-before', { timestamp: 1 }),
      buildNarrativeMessage('server-story-tail', { timestamp: 2 }),
    ]);

    expect(selectNewNarrativeRevealKeys({
      previousKeys: knownKeys,
      previousMaxTimestamp: 2,
      items: nextItems,
    })).toEqual([]);
  });
});
