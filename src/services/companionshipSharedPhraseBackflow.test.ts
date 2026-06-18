import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { buildSharedPhraseEventsFromCompanionshipEvent, buildSharedPhraseEventsFromCompanionshipEvents } from './companionshipSharedPhraseBackflow';

function character(): AICharacter {
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
  } as unknown as AICharacter;
}

function chat(): GroupChat {
  return {
    id: 'chat-1',
    name: '苏苏',
    type: 'direct',
    memberIds: ['char-a'],
    createdAt: 1,
    updatedAt: 1,
  } as GroupChat;
}

function event(overrides: Partial<RuntimeEventV2>): RuntimeEventV2 {
  return {
    id: 'evt-companionship',
    conversationId: 'chat-1',
    kind: 'artifact',
    createdAt: 1_000,
    actorIds: ['user', 'char-a'],
    targetIds: ['char-a', 'user'],
    summary: '陪伴事件',
    eventClass: 'artifact',
    visibility: 'pair_private',
    evidenceMessageIds: ['msg-source'],
    payload: {},
    ...overrides,
  };
}

describe('companionshipSharedPhraseBackflow', () => {
  it('derives pet name and promise shared phrase events from companionship events', () => {
    const addressing = event({
      id: 'evt-addressing',
      payload: {
        eventType: 'companionship_addressing',
        characterId: 'char-a',
        userId: 'user',
        action: 'set_private',
        privateAddress: '小夏',
        initiatedBy: 'user',
        confidence: 0.9,
      },
    });
    const promise = event({
      id: 'evt-promise',
      payload: {
        eventType: 'companionship_promise',
        characterId: 'char-a',
        userId: 'user',
        promiseId: 'promise-1',
        promiseText: '说好下次一起补看那部电影',
        action: 'opened',
        confidence: 0.9,
      },
    });

    const events = buildSharedPhraseEventsFromCompanionshipEvents({ chat: chat(), character: character(), events: [addressing, promise] });
    const payloads = events.map((item) => item.payload as Record<string, unknown>);

    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'companionship_shared_phrase', text: '小夏', kind: 'pet_name' }),
      expect.objectContaining({ eventType: 'companionship_shared_phrase', text: '说好下次一起补看那部电影', kind: 'promise_line' }),
    ]));
  });

  it('derives confession and repair shared phrases from phase and conflict events', () => {
    const phase = event({
      id: 'evt-phase',
      payload: {
        eventType: 'companionship_phase_event',
        characterId: 'char-a',
        userId: 'user',
        phase: 'confirmed',
        style: 'romantic',
        evidence: ['用户说：“我们就在一起吧。”'],
        sourceMessageIds: ['msg-phase-source'],
        confidence: 0.9,
        decisionSource: 'model',
      },
    });
    const repair = event({
      id: 'evt-repair',
      payload: {
        eventType: 'companionship_intimate_conflict',
        characterId: 'char-a',
        userId: 'user',
        action: 'resolved',
        kind: 'reconciliation',
        evidence: ['用户说：“慢慢来，我们说开。”'],
        participantIds: ['char-a', 'user'],
        confidence: 0.9,
      },
    });

    const events = buildSharedPhraseEventsFromCompanionshipEvents({ chat: chat(), character: character(), events: [phase, repair] });
    const payloads = events.map((item) => item.payload as Record<string, unknown>);

    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '我们就在一起吧。', kind: 'confession_line', sourceMessageIds: ['msg-phase-source', 'msg-source'], decisionSource: 'model' }),
      expect.objectContaining({ text: '慢慢来，我们说开。', kind: 'comfort_line' }),
    ]));
  });

  it('records reused shared phrase events when a phrase already exists', () => {
    const promise = event({
      id: 'evt-promise',
      payload: {
        eventType: 'companionship_promise',
        characterId: 'char-a',
        userId: 'user',
        promiseId: 'promise-1',
        promiseText: '说好下次一起补看那部电影',
        action: 'opened',
      },
    });
    const existing = event({
      id: 'evt-existing-phrase',
      payload: {
        eventType: 'companionship_shared_phrase',
        characterId: 'char-a',
        userId: 'user',
        phraseId: 'phrase-existing',
        action: 'upsert',
        text: '说好下次一起补看那部电影',
        kind: 'promise_line',
        participantIds: ['char-a', 'user'],
      },
    });

    const events = buildSharedPhraseEventsFromCompanionshipEvents({ chat: chat(), character: character(), events: [promise, existing] });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      eventType: 'companionship_shared_phrase',
      phraseId: 'phrase-existing',
      action: 'reused',
      text: '说好下次一起补看那部电影',
      reuseCount: 2,
    });
    expect(buildSharedPhraseEventsFromCompanionshipEvent({ chat: chat(), character: character(), event: existing })).toEqual([]);
  });

  it('derives shared phrases from distilled memory candidates with clear companionship wording', () => {
    const distilled = event({
      id: 'distilled-memory-secret-code',
      kind: 'memory_candidate',
      targetIds: ['char-a', 'user'],
      summary: '用户和苏苏把“月亮今天也站岗”当作只属于两个人的秘密暗号。',
      visibility: 'public',
      payload: {
        kind: 'bond',
        text: '用户和苏苏把“月亮今天也站岗”当作只属于两个人的秘密暗号。',
        origin: 'distilled',
        confidence: 0.86,
        salience: 0.82,
      },
    });

    const events = buildSharedPhraseEventsFromCompanionshipEvents({ chat: chat(), character: character(), events: [distilled] });
    const payload = events[0]?.payload as Record<string, unknown> | undefined;

    expect(payload).toMatchObject({
      eventType: 'companionship_shared_phrase',
      text: '月亮今天也站岗',
      kind: 'secret_code',
      visibility: 'private',
      participantIds: ['char-a', 'user'],
      sourceMessageIds: ['msg-source'],
      decisionSource: 'local_fallback',
    });
    expect(payload?.reason).toContain('记忆蒸馏');
  });

  it('derives role-role shared phrases from group distilled memories without marking them as user-private', () => {
    const groupChat = { ...chat(), type: 'group', memberIds: ['char-a', 'char-b'] } as GroupChat;
    const distilled = event({
      id: 'distilled-memory-role-joke',
      kind: 'memory_candidate',
      targetIds: ['char-a', 'char-b'],
      summary: '苏苏和小林把“雨天加班券”当作共同梗。',
      visibility: 'public',
      payload: {
        kind: 'bond',
        text: '苏苏和小林把“雨天加班券”当作共同梗。',
        origin: 'distilled',
        confidence: 0.8,
        salience: 0.76,
      },
    });

    const events = buildSharedPhraseEventsFromCompanionshipEvents({ chat: groupChat, character: character(), events: [distilled] });
    const payload = events[0]?.payload as Record<string, unknown> | undefined;

    expect(events[0]).toMatchObject({
      visibility: 'role_private',
      visibleToIds: ['char-a', 'char-b'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_shared_phrase',
      text: '雨天加班券',
      kind: 'inside_joke',
      visibility: 'public_hint',
      participantIds: ['char-a', 'char-b'],
    });
    expect(payload?.userId).toBeUndefined();
  });

  it('does not derive shared phrases from low-confidence distilled memories', () => {
    const distilled = event({
      id: 'distilled-memory-low-confidence',
      kind: 'memory_candidate',
      targetIds: ['char-a', 'user'],
      summary: '用户和苏苏把“月亮今天也站岗”当作只属于两个人的秘密暗号。',
      visibility: 'public',
      payload: {
        kind: 'bond',
        text: '用户和苏苏把“月亮今天也站岗”当作只属于两个人的秘密暗号。',
        origin: 'distilled',
        confidence: 0.5,
        salience: 0.82,
      },
    });

    const events = buildSharedPhraseEventsFromCompanionshipEvents({ chat: chat(), character: character(), events: [distilled] });

    expect(events).toEqual([]);
  });
});
