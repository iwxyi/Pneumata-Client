import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { NarrativeLineProjection } from './narrativeProjection';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { buildNarrativeLineTooltip, formatNarrativeLineText } from './narrativeLinePresentation';

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

function buildLine(patch: Partial<NarrativeLineProjection>): NarrativeLineProjection {
  return {
    id: 'line-1',
    conversationId: 'chat-1',
    type: 'topic',
    title: '线',
    summary: '摘要',
    participantIds: [],
    visibility: 'public',
    status: 'active',
    tension: 0.1,
    momentum: 0.1,
    salience: 0.5,
    sourceEventIds: [],
    lastTouchedAt: 1,
    openQuestions: [],
    possibleNextBeats: [],
    ...patch,
  };
}

function buildMessage(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm1',
    chatId: 'chat-1',
    type: patch.type || 'ai',
    senderId: patch.senderId || 'a',
    senderName: patch.senderName || '甲',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
  };
}

describe('narrativeLinePresentation', () => {
  const members = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];

  it('formats user-facing line text without member ids', () => {
    expect(formatNarrativeLineText('a 对 b 的关系正在变化。', members)).toBe('甲 对 乙 的关系正在变化。');
  });

  it('masks unknown UUIDs and raw system payloads in line text', () => {
    const text = formatNarrativeLineText('e055aa1d-88d4-4e96-abd2-1b35a3d56f67 对 {"eventType":"room_state_snapshot_v2"}', members);
    expect(text).toContain('成员');
    expect(text).toContain('系统事件');
    expect(text).not.toContain('e055aa1d');
    expect(text).not.toContain('eventType');
  });

  it('uses relationship ledger recent evidence in tooltips', () => {
    const tooltip = buildNarrativeLineTooltip({
      line: buildLine({ id: 'relationship:a->b', type: 'relationship', participantIds: ['a', 'b'] }),
      chat: buildChat({
        relationshipLedger: [{
          pairKey: 'a->b',
          actorId: 'a',
          targetId: 'b',
          current: { warmth: 0, competence: 0, trust: -10, threat: 20 },
          axisReasons: {},
          trend: 'volatile',
          recentEvents: [{ id: 'evt-rel', kind: 'relationship_delta', createdAt: 2, summary: 'a 质疑 b 的判断' }],
          lastUpdatedAt: 2,
        }],
      }),
      members,
      messages: [],
    });

    expect(tooltip).toContain('形成原因');
    expect(tooltip).toContain('甲 质疑 乙');
  });

  it('uses latest conversational message for topic evidence', () => {
    const tooltip = buildNarrativeLineTooltip({
      line: buildLine({ id: 'topic:latest', type: 'topic' }),
      chat: buildChat(),
      members,
      messages: [
        buildMessage({ id: 'm1', type: 'ai', content: '最近有什么好玩的事？', timestamp: 1 }),
        buildMessage({ id: 'm2', type: 'event', senderName: '事件', content: '{"eventType":"room_state_snapshot_v2"}', timestamp: 2 }),
      ],
    });

    expect(tooltip).toContain('最近有什么好玩的事？');
    expect(tooltip).not.toContain('eventType');
  });

  it('sanitizes runtime event evidence in tooltips', () => {
    const unknownActorId = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
    const unknownTargetId = '3c78729f-e52d-4dde-b27f-01a949960bb8';
    const tooltip = buildNarrativeLineTooltip({
      line: buildLine({
        id: 'conflict-1',
        type: 'conflict',
        participantIds: [unknownActorId, unknownTargetId],
        sourceEventIds: ['evt-leaky'],
        possibleNextBeats: [{ beatType: 'challenge', targetActorIds: [], pressure: 0.64, reason: 'Relationship ledger has become salient' }],
      }),
      chat: buildChat({
        worldState: {
          ...DEFAULT_CONVERSATION_WORLD_STATE,
          conflictState: {
            primaryConflict: null,
            activeConflicts: [],
            developmentHooks: [],
            volatility: 0.1,
            cooling: 0,
            updatedAt: 1,
          },
        },
        runtimeEventsV2: [{
          id: 'evt-leaky',
          conversationId: 'chat-1',
          kind: 'relationship_delta',
          createdAt: 2,
          summary: `${unknownActorId} relationship_delta → ${unknownTargetId} {"eventType":"room_state_snapshot_v2","summary":"heat"}`,
          visibility: 'public',
          actorIds: [unknownActorId],
          targetIds: [unknownTargetId],
          payload: { eventType: 'room_state_snapshot_v2' },
        }],
      }),
      members,
      messages: [],
    });

    expect(tooltip).toContain('关系变化');
    expect(tooltip).toContain('成员');
    expect(tooltip).toContain('系统事件');
    expect(tooltip).toContain('关系账本中的变化已经足够显著');
    expect(tooltip).not.toContain(unknownActorId);
    expect(tooltip).not.toContain(unknownTargetId);
    expect(tooltip).not.toContain('relationship_delta');
    expect(tooltip).not.toContain('eventType');
    expect(tooltip).not.toContain('Relationship ledger');
  });

  it('does not leak private mystery event summaries', () => {
    const tooltip = buildNarrativeLineTooltip({
      line: buildLine({ id: 'mystery:hidden-pressure', type: 'mystery', sourceEventIds: ['secret-event'], hiddenParticipantIds: ['a', 'b'] }),
      chat: buildChat({
        runtimeEventsV2: [{
          id: 'secret-event',
          conversationId: 'chat-1',
          kind: 'artifact',
          createdAt: 2,
          summary: '狼人私聊：甲和乙决定今晚攻击丙',
          visibility: 'role_private',
          actorIds: ['a'],
          targetIds: ['b'],
          payload: { artifactType: 'private_thread_summary' },
        }],
      }),
      members,
      messages: [],
    });

    expect(tooltip).toContain('形成原因');
    expect(tooltip).toContain('未公开的产物');
    expect(tooltip).not.toContain('攻击丙');
    expect(tooltip).not.toContain('狼人私聊');
  });
});
