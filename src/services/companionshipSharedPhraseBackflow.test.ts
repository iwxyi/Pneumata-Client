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
        confidence: 0.9,
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
      expect.objectContaining({ text: '我们就在一起吧。', kind: 'confession_line' }),
      expect.objectContaining({ text: '慢慢来，我们说开。', kind: 'comfort_line' }),
    ]));
  });

  it('does not derive duplicate shared phrase events when one already exists', () => {
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

    expect(buildSharedPhraseEventsFromCompanionshipEvents({ chat: chat(), character: character(), events: [promise, existing] })).toEqual([]);
    expect(buildSharedPhraseEventsFromCompanionshipEvent({ chat: chat(), character: character(), event: existing })).toEqual([]);
  });
});
