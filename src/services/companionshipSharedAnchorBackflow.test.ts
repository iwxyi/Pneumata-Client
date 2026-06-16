import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { buildSharedAnchorEventsFromCompanionshipEvents } from './companionshipSharedAnchorBackflow';

function character(overrides: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as unknown as AICharacter;
}

function chat(overrides: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    name: '苏苏',
    type: 'direct',
    memberIds: ['char-a'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as GroupChat;
}

function event(overrides: Partial<RuntimeEventV2>): RuntimeEventV2 {
  return {
    id: 'distilled-memory',
    conversationId: 'chat-1',
    kind: 'memory_candidate',
    createdAt: 1_000,
    actorIds: [],
    targetIds: ['char-a', 'user'],
    summary: '记忆候选',
    eventClass: 'artifact',
    visibility: 'public',
    payload: {
      kind: 'bond',
      text: '用户和苏苏说好下次一起补看那部电影，这是他们之间重要的约定。',
      origin: 'distilled',
      confidence: 0.86,
      salience: 0.82,
    },
    ...overrides,
  };
}

describe('companionshipSharedAnchorBackflow', () => {
  it('derives pair-private shared anchors from user-related distilled memories', () => {
    const events = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: chat(),
      character: character(),
      events: [event({})],
    });
    const payload = events[0]?.payload as Record<string, unknown> | undefined;

    expect(events[0]).toMatchObject({
      kind: 'artifact',
      visibility: 'pair_private',
      visibleToIds: ['char-a', 'user'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_shared_anchor',
      characterId: 'char-a',
      userId: 'user',
      action: 'upsert',
      kind: 'promise',
      participantIds: ['char-a', 'user'],
      title: '未完成约定',
    });
    expect(payload?.reason).toContain('记忆蒸馏');
  });

  it('derives role-private shared anchors from role-role group distilled memories', () => {
    const groupChat = chat({ type: 'group', memberIds: ['char-a', 'char-b'] });
    const distilled = event({
      targetIds: ['char-a', 'char-b'],
      payload: {
        kind: 'bond',
        text: '苏苏和小林经历过一次冷战，后来认真说开并完成了关系修复。',
        origin: 'distilled',
        confidence: 0.9,
        salience: 0.88,
      },
    });

    const events = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: groupChat,
      character: character(),
      events: [distilled],
    });
    const payload = events[0]?.payload as Record<string, unknown> | undefined;

    expect(events[0]).toMatchObject({
      visibility: 'role_private',
      visibleToIds: ['char-a', 'char-b'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_shared_anchor',
      characterId: 'char-a',
      kind: 'conflict',
      participantIds: ['char-a', 'char-b'],
    });
    expect(payload?.userId).toBeUndefined();
  });

  it('does not duplicate existing shared anchor events with the same stable text key', () => {
    const distilled = event({});
    const existing = event({
      id: 'existing-anchor',
      kind: 'artifact',
      payload: {
        eventType: 'companionship_shared_anchor',
        characterId: 'char-a',
        userId: 'user',
        anchorId: 'anchor-existing',
        action: 'upsert',
        kind: 'promise',
        participantIds: ['char-a', 'user'],
        text: '用户和苏苏说好下次一起补看那部电影，这是他们之间重要的约定。',
      },
    });

    const events = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: chat(),
      character: character(),
      events: [distilled, existing],
    });

    expect(events).toEqual([]);
  });
});
