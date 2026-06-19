import { describe, expect, it } from 'vitest';
import type { Message } from '../../types/message';
import { buildChatRenderItems } from './chatRenderModel';
import { getVisibleNarrativeDisplayBlocks, isNarrativeRevealAllowed, resolveNarrativeRevealTracking, selectNewNarrativeRevealKeys } from './MessageList';

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

  it('keeps the seen timestamp baseline across return-page hydration so restored history cannot restart reveal', () => {
    const firstPaintItems = buildChatRenderItems([
      buildNarrativeMessage('story-before', { timestamp: 1 }),
      buildNarrativeMessage('local-story-tail', { clientKey: 'local-story-tail', timestamp: 2 }),
    ]);
    const baseline = resolveNarrativeRevealTracking({
      initialized: false,
      previousKeys: new Set(),
      items: firstPaintItems,
    });
    const hydratedItems = buildChatRenderItems([
      buildNarrativeMessage('story-before', { timestamp: 1 }),
      buildNarrativeMessage('server-story-tail', { timestamp: 2 }),
      buildNarrativeMessage('restored-story-a', { timestamp: 3 }),
      buildNarrativeMessage('restored-story-b', { timestamp: 4 }),
    ]);
    const hydrated = resolveNarrativeRevealTracking({
      initialized: baseline.initialized,
      previousKeys: baseline.nextSeenKeys,
      previousMaxTimestamp: baseline.nextMaxTimestamp,
      items: hydratedItems,
    });
    const nextLiveItems = buildChatRenderItems([
      ...hydratedItems.map((item) => item.message),
      buildNarrativeMessage('live-story', { timestamp: 5 }),
    ]);
    const live = resolveNarrativeRevealTracking({
      initialized: hydrated.initialized,
      previousKeys: hydrated.nextSeenKeys,
      previousMaxTimestamp: hydrated.nextMaxTimestamp,
      items: nextLiveItems,
    });

    expect(baseline.newRevealKeys).toEqual([]);
    expect(baseline.nextMaxTimestamp).toBe(2);
    expect(hydrated.newRevealKeys).toEqual([]);
    expect(hydrated.nextMaxTimestamp).toBe(4);
    expect(live.newRevealKeys).toEqual([expect.stringContaining('live-story')]);
  });

  it('requires an explicit live message key when a reveal gate is provided', () => {
    const [item] = buildChatRenderItems([
      buildNarrativeMessage('story-live', { clientKey: 'client-story-live', serverId: 'server-story-live', timestamp: 2 }),
    ]);

    expect(item).toBeTruthy();
    expect(isNarrativeRevealAllowed({ item, revealMessageKeys: new Set() })).toBe(false);
    expect(isNarrativeRevealAllowed({ item, revealMessageKeys: new Set(['other-message']) })).toBe(false);
    expect(isNarrativeRevealAllowed({ item, revealMessageKeys: new Set(['client-story-live']) })).toBe(true);
    expect(isNarrativeRevealAllowed({ item, revealMessageKeys: new Set(['server-story-live']) })).toBe(true);
  });

  it('hides developer-only story panels from the normal narrative stream', () => {
    const systemPanelOnly = buildMessage('choice-diagnostic', {
      metadata: {
        narrativeTurn: {
          turnId: 'choice-diagnostic',
          turnKind: 'choice_prompt',
          povActorId: 'narrator',
          blocks: [{
            id: 'choice-diagnostic-panel',
            actorId: 'narrator',
            actorKind: 'system',
            kind: 'system_note',
            displayMode: 'system_panel',
            text: '新的抉择点\n前情：走廊尽头还有脚步声。',
          }],
        },
        storyChoices: [
          { label: '让林医生推门查看脚步声来源', prompt: '林医生推门查看脚步声来源' },
          { label: '让护士守在楼梯口观察退路', prompt: '护士守住楼梯口' },
        ],
      },
    });

    expect(getVisibleNarrativeDisplayBlocks(systemPanelOnly, false)).toEqual([]);
    expect(getVisibleNarrativeDisplayBlocks(systemPanelOnly, true)).toEqual([
      expect.objectContaining({ displayMode: 'system_panel', text: expect.stringContaining('新的抉择点') }),
    ]);
  });
});
