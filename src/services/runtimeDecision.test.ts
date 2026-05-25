import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { projectRuntimePressure, shouldUseFreeSpeechRuntimeDecision } from './runtimeDecision';

function buildChat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    sourceChatId: null,
    sourceMemberIds: [],
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: DEFAULT_CONVERSATION_WORLD_STATE,
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  };
}

function buildCharacter(id: string, name: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildMessage(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm1',
    chatId: 'chat-1',
    type: patch.type || 'user',
    senderId: patch.senderId || 'user',
    senderName: patch.senderName || '用户',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
  };
}

describe('runtimeDecision', () => {
  it('projects narrative pressure and a director intent for free-speaking group chats', () => {
    const chat = buildChat({
      worldState: {
        ...DEFAULT_CONVERSATION_WORLD_STATE,
        conflictState: {
          primaryConflict: {
            id: 'conflict-1',
            scope: 'group',
            type: 'value_conflict',
            severity: 0.8,
            stage: 'escalating',
            summary: '甲乙的价值冲突正在升级',
            participantIds: ['a'],
            targetIds: ['b'],
            nextPressure: 'escalate',
            developmentHooks: ['invite_target_response'],
            sourceEventIds: ['event-1'],
            updatedAt: 10,
          },
          activeConflicts: [],
          developmentHooks: [],
          volatility: 0.5,
          cooling: 0,
          updatedAt: 10,
        },
      },
    });
    const projection = projectRuntimePressure({
      chat,
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'a', senderName: '甲', content: '这不是一回事。' })],
      now: 20,
    });
    expect(projection.primaryLine?.id).toBe('conflict-1');
    expect(projection.directorIntent?.source).toBe('conflict');
    expect(projection.directorIntent?.targetActorIds).toContain('b');
  });

  it('disables free-speech runtime decisions for fixed-turn scenarios', () => {
    const chat = buildChat({ scenarioState: { currentTurnActorId: 'a', turnOrder: ['a', 'b'] } });
    expect(shouldUseFreeSpeechRuntimeDecision(chat)).toBe(false);
    const projection = projectRuntimePressure({
      chat,
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ content: '甲，你来。' })],
    });
    expect(projection).toEqual({ narrativeLines: [], primaryLine: null, directorIntent: null });
  });

  it('lets the latest director intervention override projected pressure', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      actorIds: ['user'],
      targetIds: ['a'],
      summary: '让甲先回应，不要继续升级',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['a'],
        pressure: 0.95,
        text: '让甲先回应，不要继续升级',
      },
    };
    const chat = buildChat({ runtimeEventsV2: [intervention] });
    const projection = projectRuntimePressure({
      chat,
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'b', senderName: '乙', content: '你别躲。' })],
      now: 40,
    });
    expect(projection.directorIntent).toMatchObject({
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: ['a'],
      pressure: 0.95,
    });
  });

  it('treats a targeted image request as a strong user guidance intent', () => {
    const projection = projectRuntimePressure({
      chat: buildChat(),
      characters: [buildCharacter('a', '美羊羊'), buildCharacter('b', '灰太狼')],
      messages: [buildMessage({ type: 'user', senderId: 'user', senderName: '我', content: '美羊羊发个灰太狼证件照的图片' })],
      now: 40,
    });

    expect(projection.directorIntent).toMatchObject({
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: ['a'],
      pressure: 0.98,
    });
    expect(projection.directorIntent?.userGuidance).toMatchObject({
      kind: 'media_request',
      actorIds: ['a'],
      mediaRequest: { kind: 'image', subjectActorIds: ['b'] },
    });
  });

  it('treats developer guidance messages as active user guidance', () => {
    const projection = projectRuntimePressure({
      chat: buildChat(),
      characters: [buildCharacter('a', '美羊羊'), buildCharacter('b', '灰太狼')],
      messages: [buildMessage({ type: 'god', senderId: 'user', senderName: '开发者', content: '美羊羊发个灰太狼证件照的图片' })],
      now: 40,
    });

    expect(projection.directorIntent).toMatchObject({
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: ['a'],
      pressure: 0.98,
    });
    expect(projection.directorIntent?.userGuidance).toMatchObject({
      kind: 'media_request',
      actorIds: ['a'],
      mediaRequest: { kind: 'image', subjectActorIds: ['b'] },
    });
  });

  it('lets the latest human guidance override stale pending reply pressure', () => {
    const projection = projectRuntimePressure({
      chat: buildChat(),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [
        buildMessage({ type: 'ai', senderId: 'a', senderName: '甲', content: '乙，你说呢？', timestamp: 30 }),
        buildMessage({ type: 'god', senderId: 'user', senderName: '开发者', content: '新话题：狼抓羊有过错吗？狼应该抓羊吗？', timestamp: 40 }),
      ],
      pendingReplyContext: {
        targetIds: ['b'],
        primaryTargetId: 'b',
        sourceSpeakerId: 'a',
        unmetTurns: 1,
        strength: 'strong',
      },
      now: 50,
    });

    expect(projection.directorIntent?.userGuidance).toMatchObject({
      kind: 'topic_shift',
      rawText: '新话题：狼抓羊有过错吗？狼应该抓羊吗？',
    });
    expect(projection.directorIntent?.targetActorIds).toEqual([]);
  });

  it('keeps only unanswered requested actors active for multi-actor guidance', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      summary: '让甲乙都发图',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['a', 'b'],
        pressure: 0.98,
        text: '让甲和乙都发一张图',
        maxTurns: 2,
        expiresAt: 1000,
        userGuidance: {
          kind: 'media_request',
          rawText: '让甲和乙都发一张图',
          actorIds: ['a', 'b'],
          mentionedActorIds: ['a', 'b'],
          mediaRequest: {
            kind: 'image',
            subjectActorIds: [],
            subjectText: '当前话题',
            actionText: '发一张图',
          },
          focusText: '让甲和乙都发一张图',
          beatType: 'answer',
          pressure: 0.98,
          maxTurns: 2,
          reason: '用户指定角色发送或创作图片。',
        },
      },
    };
    const afterFirst = projectRuntimePressure({
      chat: buildChat({ runtimeEventsV2: [intervention] }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'a', senderName: '甲', content: '我先发。', timestamp: 40 })],
      now: 50,
    });
    expect(afterFirst.directorIntent).toMatchObject({ source: 'user_message', targetActorIds: ['b'] });

    const afterBoth = projectRuntimePressure({
      chat: buildChat({ runtimeEventsV2: [intervention] }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [
        buildMessage({ id: 'm-a', type: 'ai', senderId: 'a', senderName: '甲', content: '我先发。', timestamp: 40 }),
        buildMessage({ id: 'm-b', type: 'ai', senderId: 'b', senderName: '乙', content: '我也发。', timestamp: 45 }),
      ],
      now: 50,
    });
    expect(afterBoth.directorIntent?.source).not.toBe('user_message');
  });

  it('does not let non-target replies consume targeted media guidance', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director-media',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      summary: '让美羊羊发灰太狼证件照',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['a'],
        pressure: 0.98,
        text: '美羊羊发个灰太狼证件照的图片',
        maxTurns: 1,
        expiresAt: 1000,
        userGuidance: {
          kind: 'media_request',
          rawText: '美羊羊发个灰太狼证件照的图片',
          actorIds: ['a'],
          mentionedActorIds: ['a', 'b'],
          mediaRequest: {
            kind: 'image',
            subjectActorIds: ['b'],
            subjectText: '灰太狼',
            actionText: '发个灰太狼证件照的图片',
          },
          focusText: '美羊羊发个灰太狼证件照的图片',
          beatType: 'answer',
          pressure: 0.98,
          maxTurns: 1,
          reason: '用户指定角色发送或创作图片。',
        },
      },
    };
    const projection = projectRuntimePressure({
      chat: buildChat({ runtimeEventsV2: [intervention] }),
      characters: [buildCharacter('a', '美羊羊'), buildCharacter('b', '灰太狼'), buildCharacter('c', '懒羊羊')],
      messages: [
        buildMessage({ type: 'ai', senderId: 'b', senderName: '灰太狼', content: '我看看你画得够不够帅。', timestamp: 40 }),
        buildMessage({ type: 'ai', senderId: 'c', senderName: '懒羊羊', content: '我也想看。', timestamp: 45 }),
      ],
      now: 50,
    });

    expect(projection.directorIntent).toMatchObject({
      source: 'user_message',
      targetActorIds: ['a'],
    });
    expect(projection.directorIntent?.userGuidance?.kind).toBe('media_request');
  });

  it('keeps a recent targeted media request active even if a non-target reply slipped in before runtime events were written', () => {
    const projection = projectRuntimePressure({
      chat: buildChat(),
      characters: [buildCharacter('a', '美羊羊'), buildCharacter('b', '灰太狼'), buildCharacter('c', '懒羊羊')],
      messages: [
        buildMessage({ id: 'guide', type: 'god', senderId: 'user', senderName: '开发者', content: '美羊羊发个灰太狼证件照的图片', timestamp: 30 }),
        buildMessage({ id: 'non-target', type: 'ai', senderId: 'b', senderName: '灰太狼', content: '我看看你画得够不够帅。', timestamp: 40 }),
      ],
      now: 50,
    });

    expect(projection.directorIntent).toMatchObject({
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: ['a'],
    });
    expect(projection.directorIntent?.userGuidance).toMatchObject({
      kind: 'media_request',
      actorIds: ['a'],
      mediaRequest: { kind: 'image', subjectActorIds: ['b'] },
    });
  });

  it('keeps explicit topic guidance active for its short focus window after one reply', () => {
    const projection = projectRuntimePressure({
      chat: buildChat(),
      characters: [buildCharacter('a', '蕉太狼'), buildCharacter('b', '慢羊羊')],
      messages: [
        buildMessage({ id: 'guide', type: 'god', senderId: 'user', senderName: '开发者', content: '新话题：狼抓羊有过错吗？狼应该抓羊吗？', timestamp: 30 }),
        buildMessage({ id: 'first', type: 'ai', senderId: 'a', senderName: '蕉太狼', content: '香蕉证件照也不是不行。', timestamp: 40 }),
      ],
      now: 50,
    });

    expect(projection.directorIntent?.userGuidance).toMatchObject({
      kind: 'topic_shift',
      rawText: '新话题：狼抓羊有过错吗？狼应该抓羊吗？',
    });
    expect(projection.directorIntent?.targetActorIds).toEqual([]);
  });

  it('expires a director intervention after one AI response by default', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      summary: '让甲先回应',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['a'],
        pressure: 0.95,
        text: '让甲先回应',
      },
    };
    const projection = projectRuntimePressure({
      chat: buildChat({ runtimeEventsV2: [intervention] }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [
        buildMessage({ type: 'ai', senderId: 'b', senderName: '乙', content: '你别躲。', timestamp: 40 }),
      ],
      now: 50,
    });
    expect(projection.directorIntent?.source).not.toBe('user_message');
  });

  it('keeps a director intervention active for configured maxTurns', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      summary: '连续两轮让甲接住',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['a'],
        pressure: 0.95,
        text: '连续两轮让甲接住',
        maxTurns: 2,
        expiresAt: 1000,
      },
    };
    const projection = projectRuntimePressure({
      chat: buildChat({ runtimeEventsV2: [intervention] }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [
        buildMessage({ type: 'ai', senderId: 'b', senderName: '乙', content: '第一轮之后。', timestamp: 40 }),
      ],
      now: 50,
    });
    expect(projection.directorIntent).toMatchObject({ source: 'user_message', targetActorIds: ['a'] });
  });

  it('ignores expired director interventions', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      summary: '已经过期',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['a'],
        pressure: 0.95,
        text: '已经过期',
        expiresAt: 35,
      },
    };
    const projection = projectRuntimePressure({
      chat: buildChat({ runtimeEventsV2: [intervention] }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'b', senderName: '乙', content: '继续。', timestamp: 32 })],
      now: 40,
    });
    expect(projection.directorIntent?.source).not.toBe('user_message');
  });
});
