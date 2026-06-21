import { describe, expect, it } from 'vitest';
import type { Message } from '../../types/message';
import { buildChatRenderItems } from './chatRenderModel';
import { getVisibleNarrativeDisplayBlocks, isNarrativeRevealAllowed } from './MessageList';

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
  it('requires an explicit live story node key for node animation', () => {
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
