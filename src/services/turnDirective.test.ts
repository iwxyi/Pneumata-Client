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
    senderName: '陈越',
    type: 'ai',
    emotion: 0,
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
  maxBubbleCount: 1,
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
    expect(directive?.relationshipEffect).toContain('weak surface fallback');
    expect(directive?.relationshipEffect).toContain('relational consequence');
    expect(directive?.situationalConstraints).toEqual([]);
    const prompt = buildTurnDirectivePrompt(directive);
    expect(prompt).toContain('Read the exchange from inside this person');
    expect(prompt).toContain('live attention is on 陈越');
    expect(prompt).toContain('only if saying it performs a real social action');
    expect(prompt).not.toContain('Active target: 陈越');
  });

  it('keeps planning labels out of the visible dialogue contract', () => {
    const prompt = buildTurnDirectivePrompt({
      roomStyle: 'casual',
      characterDrive: {
        stake: '不想让对方一个人扛着',
        feltReaction: '有点心软又嘴硬',
        immediateWant: '让对方知道自己在听',
        immediateRisk: '显得过分认真',
        attentionLens: '对方话里的犹豫',
        relationalAction: 'situated',
        observableMove: '问一句具体的近况',
        speakingNecessity: 'optional',
        evidence: ['对方话里的犹豫'],
      },
      socialJob: 'show social support while keeping independent judgment',
      emotionalUndercurrent: 'subtle: protective warmth',
      relationshipEffect: 'treat the relationship as evidence',
      requiredChange: 'a specific reaction is enough',
      expressionShape: 'ordinary wording',
      situationalConstraints: [],
      forbiddenDrift: [],
    });

    expect(prompt).toContain('private planning language, not dialogue');
    expect(prompt).toContain('先接住/我来回应/这句我认');
    expect(prompt).toContain('calm does not mean generic or emotionless');
  });

  it('treats scalar social posture as subordinate to concrete relationship evidence', () => {
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

    const prompt = buildTurnDirectivePrompt(directive);
    expect(prompt).toContain('close, unequal, competitive, indebted, wounded, desired, feared, or professional relationship');
    expect(prompt).toContain('friendly teamwork');
  });

  it('keeps a visible emotional spike in the opening beat even without a directed runtime event', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message()],
      styleProfile: 'casual_room',
      intent,
      innerLife: { ...innerLife, impulse: 'defend_face', tone: 'defensive', pressure: 0.86 },
      conversationMovePlan: movePlan,
      turnPlan,
    });

    expect(buildTurnDirectivePrompt(directive)).toContain('opening beat visibly carry this pressure');
  });

  it('does not treat an unrecorded emotion as proof that the live exchange is neutral', () => {
    const calmInnerLife: InnerLifeProjection = {
      ...innerLife,
      impulse: 'stay_silent',
      tone: 'casual',
      reason: '没有强触发。',
      pressure: 0.24,
      evidence: [],
      activeAffect: null,
      dominantEmotion: null,
    };
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞'),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message({ content: '你刚才当着所有人的面说我只会添乱。' })],
      styleProfile: 'casual_room',
      intent,
      innerLife: calmInnerLife,
      conversationMovePlan: movePlan,
      turnPlan,
    });
    const prompt = buildTurnDirectivePrompt(directive);

    expect(directive?.emotionalUndercurrent).toContain('no strong carried feeling is currently recorded');
    expect(directive?.emotionalUndercurrent).not.toContain('low internal pressure');
    expect(prompt).toContain('not a verdict that the live exchange is emotionally neutral');
    expect(prompt).toContain('Read the live exchange for a real emotional or relational beat');
    expect(prompt).toContain('choose only what the situation supports');
  });

  it('keeps calm turns emotionally legible through personality and relationship', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞', {
        speakingStyle: '真正担心时会先挖苦一句。',
        coreProfile: { coreDesire: '不让朋友独自承担代价' },
      }),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message({ content: '那就按贵的订吧，省得麻烦。' })],
      styleProfile: 'casual_room',
      intent: { ...intent, emotionalTone: 'warm' },
      innerLife: { ...innerLife, pressure: 0.24, impulse: 'stay_silent', tone: 'casual', activeAffect: null, dominantEmotion: null },
      conversationMovePlan: { ...movePlan, socialPosture: { warmth: 'warm', directness: 'soft' } },
      turnPlan,
    });
    const prompt = buildTurnDirectivePrompt(directive);

    expect(directive?.requiredChange).toContain('human point of view');
    expect(directive?.expressionShape).toContain('calm line still needs a human angle');
    expect(prompt).toContain('“No notable feeling” does not mean neutral assistant prose');
    expect(prompt).toContain('personality and relationship should still leave a visible bias');
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
    expect(prompt).toContain('Relationship pull: protect');
    expect(prompt).toContain('Personal meaning:');
  });

  it('turns shared history into subjective meaning instead of a required-move checklist', () => {
    const directive = buildTurnDirective({
      chat: chat(),
      speaker: character('rui', '瑞瑞', {
        speakingStyle: '真正担心时会先挖苦一句。',
        coreProfile: { coreDesire: '确认朋友没在硬撑', coreFear: '把关心说得太肉麻' },
        relationships: [{
          characterId: 'chen',
          warmth: 72,
          competence: 40,
          trust: 68,
          threat: 0,
          attachment: 55,
          note: '记得陈越上次嘴上说没事，后来一个人在楼下坐到天亮。',
        }],
      }),
      members: [character('rui', '瑞瑞'), character('chen', '陈越')],
      messages: [message({ content: '没事，你们先睡吧。' })],
      styleProfile: 'casual_room',
      intent,
      innerLife,
      conversationMovePlan: movePlan,
      turnPlan,
    });
    const prompt = buildTurnDirectivePrompt(directive);

    expect(prompt).toContain('一个人在楼下坐到天亮');
    expect(prompt).toContain('what this moment means to this person');
    expect(prompt).toContain('what they would rather not say');
    expect(prompt).toContain('one available move, not an obligation');
    expect(prompt).not.toContain('make it visible as');
    expect(prompt).not.toContain('Required state change:');
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
    expect(prompt).toContain('Keep only essential constraints');
    expect(prompt).toContain('expose internal fields');
    expect(prompt).toContain('not automatically the only target');
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
