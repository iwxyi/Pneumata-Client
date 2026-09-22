import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  type GroupChat,
} from '../types/chat';
import type { Message } from '../types/message';
import type { InnerLifeProjection } from './innerLifeEngine';
import type { ConversationMovePlan } from './conversationMovePlanner';
import type { SpeakIntent } from './intentEngine';
import type { TurnPlan } from './turnPlanner';
import { buildTurnDirective, buildTurnDirectivePrompt, shouldUseUnifiedTurnDirective } from './turnDirective';

function character(id: string, name: string, patch: Partial<AICharacter> = {}): AICharacter {
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
    ...patch,
  };
}

function chat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: false },
    modeState: { phase: 'free' },
    name: '闲聊',
    topic: '周末生日聚会怎么安排',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['rui', 'chen'],
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

function message(patch: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    chatId: 'chat-1',
    senderId: 'chen',
    type: 'ai',
    content: '这次就按贵的订吧，省得麻烦。',
    timestamp: 1,
    isDeleted: false,
    ...patch,
  };
}

const intent: SpeakIntent = {
  shouldSpeak: true,
  reason: 'wants to protect the current target without inheriting their viewpoint',
  target: 'chen',
  stance: 'back_up',
  emotionalTone: 'warm',
  delivery: 'short_reply',
  messageShape: 'single_sentence',
};

const innerLife: InnerLifeProjection = {
  actorId: 'rui',
  impulse: 'seek_attention',
  tone: 'vulnerable',
  reason: '最近发言没有被接住，想确认自己仍被看见。',
  pressure: 0.72,
  evidence: ['最近 3 轮未被明显接住'],
  state: {
    mood: { pleasure: 0, arousal: 20, dominance: 45 },
    energy: 44,
    attention: 58,
    loneliness: 70,
    repression: 20,
    shame: 10,
    envy: 0,
    trustInRoom: 48,
    ignoredStreak: 3,
    updatedAt: 1,
  },
  expressionPlan: { tone: 'vulnerable', length: 'short', messageCount: 1, typoLevel: 0, delayMs: 500, allowWithdraw: false },
};

const movePlan: ConversationMovePlan = {
  speakerId: 'rui',
  targetActorId: 'chen',
  targetClaimText: '这次就按贵的订吧，省得麻烦。',
  moveType: 'add_boundary_condition',
  socialPosture: { warmth: 'warm', directness: 'soft' },
  reason: 'default_room_move',
  confidence: 0.7,
};

const turnPlan: TurnPlan = {
  rhythm: 'short_reply',
  targetBubbleCount: 1,
  lengthBand: 'short',
  allowExtraMessages: false,
  waitSensitive: false,
  reasons: ['test'],
};

describe('turnDirective', () => {
  it('only applies to ordinary group conversation rooms', () => {
    expect(shouldUseUnifiedTurnDirective(chat())).toBe(true);
    expect(shouldUseUnifiedTurnDirective(chat({ type: 'direct' }))).toBe(false);
    expect(shouldUseUnifiedTurnDirective(chat({
      mode: 'werewolf',
      sessionKind: { topology: 'group', family: 'deduction', scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid' },
    }))).toBe(false);
    expect(shouldUseUnifiedTurnDirective(chat({
      mode: 'group_discussion',
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
    }))).toBe(false);
  });

  it('turns backing into independent support instead of forced agreement', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message()],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
    });

    expect(directive?.targetName).toBe('陈越');
    expect(directive?.socialJob).toContain('condition');
    expect(directive?.relationshipEffect).toContain('do not automatically repeat their claim');
    expect(directive?.relationshipEffect).toContain('joke');
    expect(directive?.situationalConstraints).toEqual([]);
    const prompt = buildTurnDirectivePrompt(directive);
    expect(prompt).toContain('Character drive is the primary behavior decision');
    expect(prompt).toContain('Attention target for interpretation only: 陈越');
    expect(prompt).toContain('not an instruction to visibly address them by name');
    expect(prompt).not.toContain('Active target: 陈越');
  });

  it('keeps user guidance above AI-to-AI room momentum', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message({ type: 'user', senderId: 'user', content: '预算别超过 200。' })],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
      userGuidance: {
        kind: 'topic_shift',
        rawText: '预算别超过 200。',
        actorIds: ['rui'],
        mentionedActorIds: ['rui'],
        focusText: '预算别超过 200。',
        beatType: 'invite',
        pressure: 0.9,
        maxTurns: 4,
        reason: '用户给出预算约束。',
        hasHardConstraints: true,
      },
    });

    expect(directive?.userConstraint).toContain('user steered the topic');
    expect(buildTurnDirectivePrompt(directive)).toContain('User constraint');
  });

  it('projects core profile and relationship stakes ahead of the generic social job', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞', { coreProfile: {
        coreDesire: '不让朋友在众人面前被当成可牺牲的那一个',
        interactionHabits: ['先看谁在替别人吞下代价'],
      }, relationships: [{ characterId: 'chen', warmth: 30, trust: 24, competence: 10, threat: 4 }] }),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')], messages: [message()], styleProfile: 'casual_room', intent, innerLife, conversationMovePlan: movePlan, turnPlan,
    });
    const prompt = buildTurnDirectivePrompt(directive);

    expect(prompt).toContain('不让朋友在众人面前被当成可牺牲的那一个');
    expect(prompt).toContain('先看谁在替别人吞下代价');
    expect(prompt).toContain('Relationship action: protect');
    expect(prompt).toContain('Character drive is the primary behavior decision');
  });

  it('keeps user decision pressure ahead of AI-to-AI logistics', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [
        message({
          type: 'user',
          senderId: 'user',
          senderName: '用户',
          content: '周五想找个像精酿吧一样热闹、有木桌和音乐的地方，你们帮我选。',
        }),
        message({ id: 'm2', senderId: 'chen', senderName: '陈越', content: '北门那家要先问低消。', timestamp: 2 }),
      ],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
      userGuidance: {
        kind: 'topic_shift',
        rawText: '周五想找个像精酿吧一样热闹、有木桌和音乐的地方，你们帮我选。',
        actorIds: [],
        mentionedActorIds: [],
        focusText: '帮我选热闹的地方',
        beatType: 'invite',
        pressure: 0.78,
        maxTurns: 4,
        reason: '用户要求群聊给出选择。',
      },
    });

    const prompt = buildTurnDirectivePrompt(directive);
    expect(prompt).toContain('state one concrete preference or shortlist first');
    expect(prompt).toContain('do not pass the choice back to the room');
  });

  it('does not repeat broad clarification after a user asked the room to choose', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [
        message({
          type: 'user',
          senderId: 'user',
          senderName: '用户',
          content: '周五想找个像精酿吧一样热闹、有木桌和音乐的地方，你们帮我选。',
        }),
        message({ id: 'm2', senderId: 'chen', senderName: '陈越', content: '你先说你要的是哪种闹？', timestamp: 2 }),
      ],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
    });

    const prompt = buildTurnDirectivePrompt(directive);
    expect(prompt).toContain('previous AI already pushed a broad clarification');
    expect(prompt).toContain('add a concrete option');
  });

  it('folds situational floor and handoff pressure into the directive', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [
        message({ type: 'ai', senderId: 'rui', senderName: '瑞瑞', content: '那先别定。' }),
        message({ id: 'm2', type: 'user', senderId: 'user', senderName: '用户', content: '陈越，你怎么看？我想听你的意见。', timestamp: 2 }),
      ],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
    });

    expect(directive?.situationalConstraints.join('\n')).toContain('name someone else');
    expect(directive?.situationalConstraints.join('\n')).toContain('short clean handoff');
    expect(directive?.situationalConstraints.join('\n')).toContain('recent own visible line');
    expect(buildTurnDirectivePrompt(directive)).toContain('Situational constraints');
  });

  it('does not expose raw runtime field names in the visible prompt block', () => {
    const prompt = buildTurnDirectivePrompt(buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message()],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
      runtimeBundle: { trace: { hotspotState: 'hot' } } as never,
    }));

    expect(prompt).not.toContain('impulse:');
    expect(prompt).not.toContain('pressure:');
    expect(prompt).not.toContain('policyHits');
    expect(prompt).toContain('do not sprawl');
    expect(prompt).toContain('clean correct statement');
    expect(prompt).toContain('performance of depth');
  });

  it('folds long-run and name-addressing drift into situational constraints', () => {
    const longLine = '这件事如果认真讲，'.repeat(24);
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [
        message({ id: 'm1', type: 'ai', senderId: 'rui', senderName: '瑞瑞', content: `陈越，${longLine}`, timestamp: 1 }),
        message({ id: 'm2', type: 'ai', senderId: 'chen', senderName: '陈越', content: `瑞瑞，${longLine}`, timestamp: 2 }),
        message({ id: 'm3', type: 'ai', senderId: 'rui', senderName: '瑞瑞', content: `陈越，${longLine}`, timestamp: 3 }),
      ],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
    });
    const constraints = directive?.situationalConstraints.join('\n') || '';

    expect(constraints).toContain('recent room replies are getting long');
    expect(constraints).toContain('overusing visible name-addressing');
    expect(buildTurnDirectivePrompt(directive)).toContain('Situational constraints');
  });
});
