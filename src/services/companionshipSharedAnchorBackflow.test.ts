import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { buildRitualEventsFromRelationshipRuntimeEvents, buildRitualEventsFromSharedAnchorEvents, buildSharedAnchorEventsFromCompanionshipEvents } from './companionshipSharedAnchorBackflow';

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
    evidenceMessageIds: ['msg-distilled'],
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
      sourceMessageIds: ['msg-distilled'],
      decisionSource: 'local_fallback',
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

  it('does not derive shared anchors from low-confidence distilled memories', () => {
    const lowConfidence = event({
      payload: {
        kind: 'bond',
        text: '用户和苏苏说好下次一起补看那部电影，这是他们之间重要的约定。',
        origin: 'distilled',
        confidence: 0.48,
        salience: 0.82,
      },
    });

    const events = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: chat(),
      character: character(),
      events: [lowConfidence],
    });

    expect(events).toEqual([]);
  });

  it('derives ritual evolution events from upserted shared anchors', () => {
    const anchorEvents = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: chat(),
      character: character(),
      events: [event({})],
    });

    const ritualEvents = buildRitualEventsFromSharedAnchorEvents({
      chat: chat(),
      character: character(),
      events: anchorEvents,
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(ritualEvents[0]).toMatchObject({
      visibility: 'pair_private',
      visibleToIds: ['char-a', 'user'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      characterId: 'char-a',
      userId: 'user',
      action: 'updated',
      kind: 'anniversary',
      participantIds: ['char-a', 'user'],
      sourceMessageIds: ['msg-distilled'],
      decisionSource: 'local_fallback',
    });
    expect(String(payload?.ritualId)).toContain('anchor-backflow');
  });

  it('keeps role-role ritual evolution role-private', () => {
    const groupChat = chat({ type: 'group', memberIds: ['char-a', 'char-b'] });
    const distilled = event({
      targetIds: ['char-a', 'char-b'],
      payload: {
        kind: 'bond',
        text: '苏苏和小林把“雨天加班券”当作共同梗。',
        origin: 'distilled',
        confidence: 0.9,
        salience: 0.88,
      },
    });
    const anchorEvents = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: groupChat,
      character: character(),
      events: [distilled],
    });

    const ritualEvents = buildRitualEventsFromSharedAnchorEvents({
      chat: groupChat,
      character: character(),
      events: anchorEvents,
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(ritualEvents[0]).toMatchObject({
      visibility: 'role_private',
      visibleToIds: ['char-a', 'char-b'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      characterId: 'char-a',
      action: 'updated',
      kind: 'inside_joke',
      participantIds: ['char-a', 'char-b'],
    });
    expect(payload?.userId).toBeUndefined();
  });

  it('does not duplicate ritual evolution events with the same ritual content key', () => {
    const anchorEvents = buildSharedAnchorEventsFromCompanionshipEvents({
      chat: chat(),
      character: character(),
      events: [event({})],
    });
    const first = buildRitualEventsFromSharedAnchorEvents({
      chat: chat(),
      character: character(),
      events: anchorEvents,
    });

    const second = buildRitualEventsFromSharedAnchorEvents({
      chat: chat(),
      character: character(),
      events: [...anchorEvents, ...first],
    });

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('derives milestone ritual evolution from high-confidence phase events', () => {
    const phase = event({
      id: 'phase-confirmed',
      kind: 'phase_transition',
      summary: '用户确认了和苏苏的关系。',
      payload: {
        eventType: 'companionship_phase_event',
        characterId: 'char-a',
        userId: 'user',
        action: 'set',
        phase: 'confirmed',
        style: 'romantic',
        evidence: ['我们就按恋人关系相处吧'],
        confidence: 0.9,
        decisionSource: 'model',
      },
    });

    const ritualEvents = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [phase],
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(ritualEvents[0]).toMatchObject({
      visibility: 'pair_private',
      visibleToIds: ['char-a', 'user'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'updated',
      kind: 'milestone',
      ritualId: 'ritual-runtime-phase-char-a-confirmed',
      decisionSource: 'model',
    });
    expect(String(payload?.evidence)).toContain('恋人关系');
  });

  it('derives reconciliation ritual evolution from resolved intimate conflict events and dedupes it', () => {
    const resolved = event({
      id: 'conflict-resolved',
      kind: 'artifact',
      summary: '用户和苏苏把误会说开。',
      payload: {
        eventType: 'companionship_intimate_conflict',
        characterId: 'char-a',
        userId: 'user',
        action: 'resolved',
        kind: 'reconciliation',
        summary: '误会说开后，两个人都记住了别用沉默互相试探。',
        evidence: ['以后不舒服就直接说'],
        confidence: 0.86,
        decisionSource: 'model',
      },
    });

    const first = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [resolved],
    });
    const second = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [resolved, ...first],
    });
    const payload = first[0]?.payload as Record<string, unknown> | undefined;

    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'updated',
      kind: 'reconciliation',
      ritualId: 'ritual-runtime-conflict-char-a-resolved',
      decisionSource: 'model',
    });
    expect(String(payload?.content)).toContain('不靠沉默试探');
    expect(second).toEqual([]);
  });

  it('derives pet-name ritual evolution from addressing events', () => {
    const addressing = event({
      id: 'addressing-private',
      kind: 'artifact',
      summary: '用户认可了私下称呼。',
      evidenceMessageIds: ['msg-addressing'],
      payload: {
        eventType: 'companionship_addressing',
        characterId: 'char-a',
        userId: 'user',
        action: 'set_private',
        privateAddress: '小月亮',
        initiatedBy: 'user',
        evidence: '以后私下可以叫我小月亮',
        confidence: 0.92,
        decisionSource: 'model',
      },
    });

    const ritualEvents = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [addressing],
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(ritualEvents[0]).toMatchObject({
      visibility: 'pair_private',
      visibleToIds: ['char-a', 'user'],
      evidenceMessageIds: ['msg-addressing'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'updated',
      kind: 'pet_name',
      participantIds: ['char-a', 'user'],
      sourceMessageIds: ['msg-addressing'],
      decisionSource: 'model',
    });
    expect(String(payload?.content)).toContain('小月亮');
  });

  it('derives role-private inside-joke rituals from shared phrase events', () => {
    const groupChat = chat({ type: 'group', memberIds: ['char-a', 'char-b'] });
    const phrase = event({
      id: 'role-shared-phrase',
      kind: 'artifact',
      targetIds: ['char-a', 'char-b'],
      summary: '苏苏和小林复用了共同梗。',
      evidenceMessageIds: ['msg-phrase'],
      payload: {
        eventType: 'companionship_shared_phrase',
        characterId: 'char-a',
        phraseId: 'phrase-rain-ticket',
        action: 'reused',
        text: '雨天加班券',
        kind: 'inside_joke',
        participantIds: ['char-a', 'char-b'],
        visibility: 'public_hint',
        evidence: '他们又提到雨天加班券',
        confidence: 0.88,
        decisionSource: 'model',
      },
    });

    const ritualEvents = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: groupChat,
      character: character(),
      events: [phrase],
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(ritualEvents[0]).toMatchObject({
      visibility: 'role_private',
      visibleToIds: ['char-a', 'char-b'],
    });
    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'updated',
      kind: 'inside_joke',
      participantIds: ['char-a', 'char-b'],
      sourceMessageIds: ['msg-phrase'],
      decisionSource: 'model',
    });
    expect(payload?.userId).toBeUndefined();
    expect(String(payload?.content)).toContain('雨天加班券');
  });

  it('derives anniversary rituals from important user profile dates', () => {
    const profile = event({
      id: 'profile-important-date',
      kind: 'artifact',
      summary: '苏苏记录了用户的重要日期。',
      evidenceMessageIds: ['msg-date'],
      payload: {
        eventType: 'companionship_user_profile_memory',
        characterId: 'char-a',
        userId: 'user',
        action: 'upsert',
        items: [{
          kind: 'important_date',
          text: '用户下周五有一场很重要的面试',
          evidence: '下周五我要去面试，有点紧张',
          confidence: 0.91,
          sensitive: true,
        }],
        reason: 'model extracted important date',
        evidence: '下周五我要去面试，有点紧张',
        sourceMessageIds: ['msg-date'],
        confidence: 0.91,
        decisionSource: 'model',
      },
    });

    const ritualEvents = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [profile],
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'updated',
      kind: 'anniversary',
      participantIds: ['char-a', 'user'],
      sourceMessageIds: ['msg-date'],
      decisionSource: 'model',
    });
    expect(String(payload?.content)).toContain('重要的面试');
  });

  it('derives daily greeting rhythm from user profile schedule hints', () => {
    const profile = event({
      id: 'profile-schedule',
      kind: 'artifact',
      summary: '苏苏记录了用户作息。',
      evidenceMessageIds: ['msg-schedule'],
      payload: {
        eventType: 'companionship_user_profile_memory',
        characterId: 'char-a',
        userId: 'user',
        action: 'upsert',
        items: [{
          kind: 'schedule_hint',
          text: '用户通常凌晨一点后才睡，早上不适合太早打扰',
          evidence: '我一般一点以后才睡，早上别太早找我',
          confidence: 0.88,
        }],
        reason: 'model extracted schedule',
        sourceMessageIds: ['msg-schedule'],
        confidence: 0.88,
        decisionSource: 'model',
      },
    });

    const ritualEvents = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [profile],
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'updated',
      kind: 'daily_greeting',
      ritualId: 'ritual-runtime-profile-greeting-char-a',
      sourceMessageIds: ['msg-schedule'],
    });
    expect(String(payload?.content)).toContain('不机械打卡');
  });

  it('suppresses greeting rituals from explicit user profile boundaries', () => {
    const profile = event({
      id: 'profile-greeting-boundary',
      kind: 'artifact',
      summary: '苏苏记录了用户问候边界。',
      evidenceMessageIds: ['msg-boundary'],
      payload: {
        eventType: 'companionship_user_profile_memory',
        characterId: 'char-a',
        userId: 'user',
        action: 'upsert',
        items: [{
          kind: 'boundary',
          text: '用户不想要每天早安晚安式的关系仪式',
          evidence: '不要每天早安晚安，太像打卡了',
          confidence: 0.9,
          sensitive: true,
        }],
        reason: 'model extracted boundary',
        sourceMessageIds: ['msg-boundary'],
        confidence: 0.9,
        decisionSource: 'model',
      },
    });

    const ritualEvents = buildRitualEventsFromRelationshipRuntimeEvents({
      chat: chat(),
      character: character(),
      events: [profile],
    });
    const payload = ritualEvents[0]?.payload as Record<string, unknown> | undefined;

    expect(payload).toMatchObject({
      eventType: 'companionship_ritual',
      action: 'suppressed',
      kind: 'daily_greeting',
      ritualId: 'ritual-runtime-profile-greeting-char-a',
      sourceMessageIds: ['msg-boundary'],
      decisionSource: 'model',
    });
    expect(String(payload?.reason)).toContain('边界');
  });
});
