import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { resolveDirectorIntent } from './directorIntent';

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
    metadata: patch.metadata,
  };
}

describe('resolveDirectorIntent', () => {
  it('prioritizes an unresolved pending reply', () => {
    const intent = resolveDirectorIntent({
      chat: buildChat(),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'a', senderName: '甲', content: '乙你怎么看？' })],
      pendingReplyContext: {
        targetIds: ['b'],
        primaryTargetId: 'b',
        sourceSpeakerId: 'a',
        unmetTurns: 2,
        strength: 'strong',
      },
    });
    expect(intent.source).toBe('user_message');
    expect(intent.beatType).toBe('answer');
    expect(intent.targetActorIds).toEqual(['b']);
    expect(intent.pressure).toBeGreaterThan(0.8);
  });

  it('turns an active conflict into a conflict pressure', () => {
    const intent = resolveDirectorIntent({
      chat: buildChat({
        worldState: {
          ...DEFAULT_CONVERSATION_WORLD_STATE,
          conflictState: {
            primaryConflict: {
              id: 'conflict-1',
              scope: 'group',
              type: 'value_conflict',
              severity: 0.8,
              stage: 'escalating',
              summary: '甲乙正在争夺解释权',
              participantIds: ['a'],
              targetIds: ['b'],
              nextPressure: 'spread',
              developmentHooks: ['force_side_taking'],
              sourceEventIds: [],
              updatedAt: 1,
            },
            activeConflicts: [],
            developmentHooks: [],
            volatility: 0.5,
            cooling: 0,
            updatedAt: 1,
          },
        },
      }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'a', senderName: '甲', content: '这事不是这么算的。' })],
    });
    expect(intent.source).toBe('conflict');
    expect(intent.beatType).toBe('invite');
    expect(intent.targetActorIds).toEqual(['b', 'a']);
    expect(intent.targetLineId).toBe('conflict-1');
  });

  it('uses the primary narrative line before legacy room fallbacks', () => {
    const intent = resolveDirectorIntent({
      chat: buildChat(),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [buildMessage({ type: 'ai', senderId: 'a', senderName: '甲', content: '刚才那件事还没完。' })],
      narrativeLines: [{
        id: 'relationship:a->b',
        conversationId: 'chat-1',
        type: 'relationship',
        title: '紧张对峙',
        summary: '甲对乙的信任正在下降',
        participantIds: ['a', 'b'],
        visibility: 'public',
        status: 'active',
        tension: 0.7,
        momentum: 0.7,
        salience: 0.82,
        sourceEventIds: ['event-1'],
        lastTouchedAt: 1,
        openQuestions: ['这段关系会继续恶化吗？'],
        possibleNextBeats: [{
          beatType: 'challenge',
          targetActorIds: ['a', 'b'],
          pressure: 0.76,
          reason: '关系线已经成为当前焦点',
        }],
      }],
    });
    expect(intent.source).toBe('relationship');
    expect(intent.targetLineId).toBe('relationship:a->b');
    expect(intent.beatType).toBe('challenge');
  });

  it('normalizes room state metrics before converting them into pressure', () => {
    const intent = resolveDirectorIntent({
      chat: buildChat({
        worldState: {
          ...DEFAULT_CONVERSATION_WORLD_STATE,
          structuredRoomState: {
            heat: 80,
            cohesion: -8,
            topicDrift: 0,
            dominantThread: ['a', 'b'],
            alliances: [],
            conflictPairs: [['a', 'b']],
            pileOnTarget: 'b',
            silencedActors: [],
          },
        },
      }),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [],
    });

    expect(intent.source).toBe('room_state');
    expect(intent.beatType).toBe('cool_down');
    expect(intent.pressure).toBeGreaterThan(0.7);
    expect(intent.pressure).toBeLessThan(0.9);
  });

  it('does not treat manual speak-as user messages as topic guidance', () => {
    const intent = resolveDirectorIntent({
      chat: buildChat(),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [
        buildMessage({
          type: 'user',
          senderId: 'a',
          senderName: '甲',
          content: '新话题：今晚聊身份冲突',
          metadata: { manualSpeaker: { actorId: 'a', actorName: '甲' } },
        }),
      ],
    });

    expect(intent.source).not.toBe('user_message');
    expect(intent.userGuidance).toBeFalsy();
  });

  it('treats god messages as topic guidance', () => {
    const intent = resolveDirectorIntent({
      chat: buildChat(),
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [
        buildMessage({
          type: 'god',
          senderId: 'user',
          senderName: '主持',
          content: '新话题：你们对规则公平性的看法',
        }),
      ],
    });

    expect(intent.source).toBe('user_message');
    expect(intent.userGuidance?.kind).toBe('topic_shift');
  });
});
