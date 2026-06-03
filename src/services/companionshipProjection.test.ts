import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import { DEFAULT_COMPANIONSHIP_SETTINGS } from '../types/settings';
import { buildCharacterCompanionshipStates, buildCompanionshipArtifactSeeds, buildCompanionshipCarePolicyForCharacter, buildCompanionshipRuntimeTrace, buildCompanionshipStatusSignature, buildHomeCompanionshipSnapshot, buildRitualRegistry, buildSharedMemoryAnchors, buildSharedSecrets, buildUserCompanionshipProjection, shouldBlockUserProactiveContactByCompanionshipPolicy } from './companionshipProjection';
import { buildCompanionshipCareTopicEventsFromDirectUserMessage } from './directCompanionshipCare';
import { setCompanionshipRuntimeConfig } from './companionshipRuntimeConfig';

function character(overrides: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 65, neuroticism: 45, humor: 50, creativity: 50, assertiveness: 42, empathy: 72 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories: [],
    background: '穿搭博主',
    speakingStyle: '轻快',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: {
      shortTermSummary: '',
      longTerm: [],
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    speechProfile: undefined,
    personalityDrift: {},
    modelProfileId: null,
    modelProfileIds: {},
    bubbleStyleId: null,
    runtimeTimeline: [],
    deletedAt: null,
    fieldVersions: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function chat(type: 'group' | 'direct' = 'direct', relationshipLedger: RelationshipLedgerEntry[] = [], runtimeEventsV2: RuntimeEventV2[] = []) {
  return normalizeConversation({
    id: 'chat-1',
    type,
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '测试单聊',
    topic: '日常聊天',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    relationshipLedger,
    runtimeEventsV2,
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function phaseEvent(overrides: Partial<RuntimeEventV2> = {}): RuntimeEventV2 {
  return {
    id: 'evt-phase-1',
    conversationId: 'chat-1',
    kind: 'phase_transition',
    createdAt: 800,
    actorIds: ['user', 'char-a'],
    targetIds: ['char-a', 'user'],
    summary: '用户和苏苏明确确认了关系。',
    visibility: 'pair_private',
    eventClass: 'phase',
    payload: {
      eventType: 'companionship_phase_event',
      characterId: 'char-a',
      userId: 'user',
      phase: 'confirmed',
      style: 'romantic',
      reason: '双方明确说出喜欢并确认关系边界。',
      evidence: ['用户说我们就按恋人关系相处。'],
    },
    ...overrides,
  };
}

function ritualEvent(overrides: Partial<RuntimeEventV2> = {}): RuntimeEventV2 {
  return {
    id: 'evt-ritual-1',
    conversationId: 'chat-1',
    kind: 'artifact',
    createdAt: 1_000,
    actorIds: ['char-a'],
    targetIds: ['user'],
    summary: '苏苏使用了一次轻度问候仪式。',
    visibility: 'pair_private',
    eventClass: 'artifact',
    payload: {
      eventType: 'companionship_ritual',
      characterId: 'char-a',
      userId: 'user',
      ritualId: 'ritual-char-a-daily-greeting',
      kind: 'daily_greeting',
      action: 'performed',
      participantIds: ['char-a', 'user'],
      reason: '用户上线后自然接了一句问候。',
    },
    ...overrides,
  };
}

function intimateConflictEvent(overrides: Partial<RuntimeEventV2> = {}): RuntimeEventV2 {
  return {
    id: 'evt-intimate-conflict-1',
    conversationId: 'chat-1',
    kind: 'artifact',
    createdAt: 1_000,
    actorIds: ['user', 'char-a'],
    targetIds: ['char-a', 'user'],
    summary: '用户和苏苏进入一次冷战后的试探修复。',
    visibility: 'pair_private',
    eventClass: 'artifact',
    payload: {
      eventType: 'companionship_intimate_conflict',
      characterId: 'char-a',
      userId: 'user',
      action: 'repair_attempted',
      kind: 'repair_attempt',
      severity: 44,
      repairReadiness: 68,
      summary: '两个人还没有完全说开，但用户愿意给一个台阶。',
      evidence: ['用户说：我们先别冷战了，慢慢说开。'],
      participantIds: ['char-a', 'user'],
      sourceEventIds: ['evt-source-conflict'],
      confidence: 0.88,
      decisionSource: 'model',
    },
    ...overrides,
  };
}

function attachmentProfileEvent(overrides: Partial<RuntimeEventV2> = {}): RuntimeEventV2 {
  return {
    id: 'evt-attachment-1',
    conversationId: 'chat-1',
    kind: 'artifact',
    createdAt: 1_000,
    actorIds: ['user', 'char-a'],
    targetIds: ['char-a', 'user'],
    summary: '模型更新了用户依恋适配画像。',
    visibility: 'pair_private',
    eventClass: 'artifact',
    payload: {
      eventType: 'companionship_attachment_profile',
      characterId: 'char-a',
      userId: 'user',
      inferredStyle: 'avoidant',
      confidence: 0.88,
      evidence: ['用户多次表示需要空间，不希望被追问。'],
      adaptations: ['respect explicit space requests', 'keep follow-up lightweight'],
      decisionSource: 'model',
    },
    ...overrides,
  };
}

function relationship(current: RelationshipLedgerEntry['current']): RelationshipLedgerEntry {
  return {
    pairKey: 'char-a->user',
    actorId: 'char-a',
    targetId: 'user',
    current,
    derived: {
      semantic: {
        stage: '深度绑定',
        labels: ['喜欢', '深度牵挂'],
        summary: '深度绑定：喜欢、深度牵挂',
        intensity: 78,
      },
    },
    trend: 'up',
    recentEvents: [{ id: 'evt-1', kind: 'interaction', createdAt: 100, summary: '用户记得苏苏上次提过的压力。', actorIds: ['char-a'], targetIds: ['user'] }],
    lastUpdatedAt: 100,
  };
}

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || 'm-1',
    chatId: 'chat-1',
    type: overrides.type || 'user',
    senderId: overrides.senderId || 'user',
    senderName: overrides.senderName || '用户',
    content: overrides.content || '明天面试有点紧张。',
    emotion: 0,
    timestamp: overrides.timestamp || 200,
    isDeleted: false,
    ...overrides,
  };
}

describe('companionshipProjection', () => {
  beforeEach(() => {
    setCompanionshipRuntimeConfig(DEFAULT_COMPANIONSHIP_SETTINGS);
  });

  it('projects a direct user bond from relationship ledger and user memory without confirming romance', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]),
      character: character({ memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户说过明天面试会紧张。'] } }),
      messages: [message({ content: '明天面试有点紧张。', timestamp: 200 })],
      now: 200 + 6 * 60 * 60 * 1000,
    });

    expect(projection.userBond?.phase).toBe('ambiguous');
    expect(projection.userBond?.style).toBe('ambiguous');
    expect(projection.userBond?.intimacy.security).toBeGreaterThan(60);
    expect(projection.userBond?.pendingCareTopics[0]?.text).toContain('明天面试');
    expect(projection.promptLines.join('\n')).toContain('Do not claim a confirmed romantic relationship');
  });

  it('does not enter confirmed relationship phase from scores alone', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 96, trust: 92, competence: 20, threat: 0 })]),
      character: character(),
      messages: [message({ content: '今天也想和你聊一会。', timestamp: 200 })],
      now: 900,
    });

    expect(projection.userBond?.phase).not.toBe('confirmed');
    expect(projection.userBond?.phase).not.toBe('passionate');
    expect(projection.userBond?.phase).not.toBe('deep');
    expect(projection.userBond?.style).toBe('ambiguous');
  });

  it('uses explicit companionship phase events for confirmed relationship state', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 70, trust: 68, competence: 20, threat: 0 })], [phaseEvent()]),
      character: character(),
      messages: [message({ content: '今天也想和你聊一会。', timestamp: 200 })],
      now: 900,
    });

    expect(projection.userBond?.phase).toBe('confirmed');
    expect(projection.userBond?.style).toBe('romantic');
    expect(projection.userBond?.phaseEnteredAt).toBe(800);
    expect(projection.userBond?.phaseEvidence.join('\n')).toContain('明确确认了关系');
    expect(projection.userBond?.phaseEvidence.join('\n')).toContain('恋人关系');
    expect(projection.promptLines.join('\n')).toContain('confirmed relationship');
  });

  it('uses the latest valid companionship phase event and ignores unrelated actors', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 70, trust: 68, competence: 20, threat: 0 })], [
        phaseEvent({
          id: 'evt-other',
          createdAt: 1000,
          summary: '另一个角色确认关系。',
          actorIds: ['char-b', 'user'],
          targetIds: ['char-b', 'user'],
          payload: {
            eventType: 'companionship_phase_event',
            characterId: 'char-b',
            userId: 'user',
            phase: 'passionate',
          },
        }),
        phaseEvent({
          id: 'evt-repair',
          createdAt: 900,
          summary: '苏苏和用户完成了一次试探性的和好。',
          payload: {
            eventType: 'companionship_phase_event',
            characterId: 'char-a',
            userId: 'user',
            phase: 'reconciling',
            style: 'friend',
            reason: '用户递了台阶，苏苏选择先放软语气。',
          },
        }),
      ]),
      character: character(),
      messages: [message({ content: '我们慢慢说吧。', timestamp: 200 })],
      now: 1100,
    });

    expect(projection.userBond?.phase).toBe('reconciling');
    expect(projection.userBond?.style).toBe('friend');
    expect(projection.userBond?.phaseEnteredAt).toBe(900);
    expect(projection.userBond?.addressing.currentAddress).toBe('你');
    expect(projection.evidence.join('\n')).toContain('试探性的和好');
    expect(projection.evidence.join('\n')).not.toContain('另一个角色');
  });

  it('reduces security and moves to crisis when threat is high', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 10, trust: -12, competence: 0, threat: 60 })]),
      character: character(),
      messages: [message({ content: '你刚刚那句话让我很不舒服。', timestamp: 200 })],
      now: 300,
    });

    expect(projection.userBond?.phase).toBe('crisis');
    expect(projection.userBond?.intimacy.security).toBeLessThanOrEqual(22);
    expect(projection.userBond?.unresolvedTensions.length).toBeGreaterThan(0);
  });

  it('adjusts intimacy projection from shared repair anchors', () => {
    const baseChat = chat('direct', [relationship({ warmth: 38, trust: 30, competence: 10, threat: 28 })]);
    const baseProjection = buildUserCompanionshipProjection({
      chat: baseChat,
      character: character(),
      messages: [message({ content: '那天说开以后，好像没那么僵了。', timestamp: 200 })],
      now: 500,
    });
    const repairProjection = buildUserCompanionshipProjection({
      chat: baseChat,
      character: character({
        layeredMemories: [{
          id: 'repair-anchor',
          scope: 'relationship',
          layer: 'long_term',
          kind: 'bond',
          ownerId: 'char-a',
          subjectIds: ['char-a', 'user'],
          text: '第一次认真和好后，苏苏记住了用户没有离开。',
          evidenceText: '用户主动递了台阶，两个人把误会说开了。',
          salience: 0.9,
          confidence: 0.9,
          recency: 0.8,
          reinforcementCount: 2,
          sourceEventIds: ['evt-repair-anchor'],
          origin: 'distilled',
          createdAt: 100,
          updatedAt: 300,
        }],
      }),
      messages: [message({ content: '那天说开以后，好像没那么僵了。', timestamp: 200 })],
      now: 500,
    });

    expect(repairProjection.userBond?.intimacy.security || 0).toBeGreaterThan(baseProjection.userBond?.intimacy.security || 0);
    expect(repairProjection.userBond?.intimacy.intimacy || 0).toBeGreaterThan(baseProjection.userBond?.intimacy.intimacy || 0);
  });

  it('uses user boundaries to restrain romantic and exclusive intimacy projection', () => {
    const warmLedger = [relationship({ warmth: 86, trust: 82, competence: 10, threat: 4 })];
    const unrestricted = buildUserCompanionshipProjection({
      chat: chat('direct', warmLedger),
      character: character(),
      messages: [message({ content: '今天也想和你聊一会。', timestamp: 200 })],
      now: 500,
    });
    const restrained = buildUserCompanionshipProjection({
      chat: chat('direct', warmLedger, [{
        id: 'evt-profile-boundary',
        conversationId: 'chat-1',
        kind: 'artifact',
        createdAt: 250,
        actorIds: ['user'],
        targetIds: ['char-a'],
        evidenceMessageIds: ['m-1'],
        summary: '苏苏记录了用户画像线索',
        visibility: 'pair_private',
        eventClass: 'artifact',
        payload: {
          eventType: 'companionship_user_profile_memory',
          characterId: 'char-a',
          userId: 'user',
          action: 'upsert',
          decisionSource: 'model',
          items: [{
            kind: 'boundary',
            text: '用户只想当朋友，不希望恋爱暧昧或占有吃醋',
            evidence: '只想当朋友，不要暧昧',
            confidence: 0.9,
            sensitive: true,
          }],
        },
      }]),
      character: character(),
      messages: [message({ content: '今天也想和你聊一会。', timestamp: 200 })],
      now: 500,
    });

    expect(restrained.userBond?.intimacy.attraction || 0).toBeLessThan(unrestricted.userBond?.intimacy.attraction || 0);
    expect(restrained.userBond?.intimacy.exclusivity || 0).toBeLessThan(unrestricted.userBond?.intimacy.exclusivity || 0);
    expect(restrained.userBond?.carePolicy.allowMissYou).toBe(false);
  });

  it('extracts user profile boundaries and restrains romantic proactive care', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 72, trust: 66, competence: 10, threat: 2 })]),
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: [
            '用户说：叫我小夏。',
            '用户不想恋爱暧昧，只想当朋友，也不要早安晚安。',
            '用户最近喜欢低饱和穿搭，明天有面试。',
          ],
        },
      }),
      messages: [message({ content: '最近压力有点大，明天面试。', timestamp: 200 })],
      now: 300,
    });

    expect(projection.userBond?.addressing.currentAddress).toBe('小夏');
    expect(projection.userBond?.userProfile.boundaries.join('\n')).toContain('不想恋爱暧昧');
    expect(projection.promptLines.join('\n')).toContain('User boundaries');
    expect(projection.promptLines.join('\n')).toContain('user does not want romantic framing');
    expect(projection.promptLines.join('\n')).not.toContain('allowMissYou true');
  });

  it('prioritizes model-led user profile memory events in user profile projection', () => {
    const profileEvent: RuntimeEventV2 = {
      id: 'evt-profile-1',
      conversationId: 'chat-1',
      kind: 'artifact',
      createdAt: 250,
      actorIds: ['user'],
      targetIds: ['char-a'],
      evidenceMessageIds: ['m-1'],
      summary: '苏苏记录了用户画像线索',
      visibility: 'pair_private',
      eventClass: 'artifact',
      payload: {
        eventType: 'companionship_user_profile_memory',
        characterId: 'char-a',
        userId: 'user',
        action: 'upsert',
        decisionSource: 'model',
        items: [
          {
            kind: 'address_preference',
            text: '用户希望被称呼为小夏',
            evidence: '以后叫我小夏就好',
            confidence: 0.9,
          },
          {
            kind: 'boundary',
            text: '用户不希望被早安晚安打扰',
            evidence: '不要早安晚安',
            confidence: 0.86,
            sensitive: true,
          },
        ],
      },
    };

    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 72, trust: 66, competence: 10, threat: 2 })], [profileEvent]),
      character: character(),
      messages: [message({ content: '这个压力锅最近真的很好用。', timestamp: 200 })],
      now: 300,
    });

    expect(projection.userBond?.addressing.currentAddress).toBe('小夏');
    expect(projection.userBond?.userProfile.boundaries).toContain('用户不希望被早安晚安打扰');
    expect(projection.userBond?.userProfile.pressureSources).toEqual([]);
    expect(projection.userBond?.carePolicy.allowGoodMorning).toBe(false);
    expect(projection.userBond?.carePolicy.allowGoodNight).toBe(false);
    expect(projection.promptLines.join('\n')).toContain('High-confidence user profile cues');
  });

  it('projects private, public, and forbidden addresses from user memory', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 72, trust: 66, competence: 10, threat: 2 })]),
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: [
            '用户说：叫我小夏。',
            '用户说不要叫我宝宝。',
          ],
        },
      }),
      messages: [message({ content: '最近压力有点大。', timestamp: 200 })],
      now: 300,
    });

    expect(projection.userBond?.addressing.currentAddress).toBe('小夏');
    expect(projection.userBond?.addressing.privateAddress).toBe('小夏');
    expect(projection.userBond?.addressing.publicAddress).toBe('用户');
    expect(projection.userBond?.addressing.forbiddenAddresses).toContain('宝宝');
    expect(projection.userBond?.addressing.addressHistory[0]).toMatchObject({
      value: '小夏',
      adoptedAt: 300,
      initiatedBy: 'user',
    });
  });

  it('falls back to neutral addressing during crisis while preserving private preference', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 10, trust: -12, competence: 0, threat: 60 })]),
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: ['用户说：叫我小夏。'],
        },
      }),
      messages: [message({ content: '你刚刚那句话让我很不舒服。', timestamp: 200 })],
      now: 300,
    });

    expect(projection.userBond?.phase).toBe('crisis');
    expect(projection.userBond?.addressing.currentAddress).toBe('你');
    expect(projection.userBond?.addressing.privateAddress).toBe('小夏');
  });

  it('drops pending care topics after the user closes the topic', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]),
      character: character(),
      messages: [
        message({ id: 'm-1', content: '明天面试有点紧张。', timestamp: 200 }),
        message({ id: 'm-2', content: '面试结束了，已经搞定了。', timestamp: 400 }),
      ],
      now: 500,
    });

    expect(projection.userBond?.pendingCareTopics).toEqual([]);
    expect(projection.promptLines.join('\n')).not.toContain('Pending care topics');
  });

  it('blocks care topics when user rejects reminders or follow-up questions', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]),
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: ['用户说明天面试会紧张。', '用户说不要提醒也别追问这件事。'],
        },
      }),
      messages: [message({ content: '明天面试有点紧张。', timestamp: 200 })],
      now: 300,
    });

    expect(projection.userBond?.pendingCareTopics).toEqual([]);
    expect(projection.promptLines.join('\n')).not.toContain('Pending care topics');
  });

  it('reads runtime care topic events into pending care projection and removes them after closure', () => {
    const opened = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message({ id: 'msg-open', content: '明天面试有点紧张。', timestamp: 200 }),
    });
    const openProjection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })], opened),
      character: character(),
      messages: [],
      now: 300,
    });

    expect(openProjection.userBond?.pendingCareTopics[0]).toMatchObject({
      source: 'runtime_event',
      text: '明天面试有点紧张。',
      status: 'active',
    });
    expect(openProjection.promptLines.join('\n')).toContain('Pending care topics');

    const closed = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat('direct', [], opened),
      character: character(),
      message: message({ id: 'msg-close', content: '面试结束了，已经搞定了。', timestamp: 400 }),
    });
    const closedProjection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })], [...opened, ...closed]),
      character: character(),
      messages: [],
      now: 500,
    });

    expect(closedProjection.userBond?.pendingCareTopics).toEqual([]);
    expect(closedProjection.promptLines.join('\n')).not.toContain('Pending care topics');
  });

  it('blocks proactive contact when user memory rejects active disturbance', () => {
    const decision = shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: ['用户说不要主动打扰，也别提醒或私聊。'],
        },
      }),
      eventKind: 'check_in',
      reasonType: 'world_attention_private_message',
      now: 300,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('user prefers low proactive contact');
  });

  it('only blocks greeting-like check-ins when user rejects greeting rituals', () => {
    const baseCharacter = character({
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说不要早安晚安。'],
      },
    });

    expect(shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: baseCharacter,
      eventKind: 'check_in',
      reasonType: 'attention_check_in',
      now: 300,
    }).blocked).toBe(true);
    expect(shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: baseCharacter,
      eventKind: 'status_update',
      reasonType: 'world_attention_calendar_reminder',
      now: 300,
    }).blocked).toBe(false);
  });

  it('projects phase-sensitive care policy into user bond and runtime trace', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({ warmth: 70, trust: 68, competence: 10, threat: 2 })], [
        phaseEvent({
          payload: {
            eventType: 'companionship_phase_event',
            characterId: 'char-a',
            userId: 'user',
            phase: 'passionate',
            style: 'romantic',
            reason: '双方确认后进入热恋期。',
            evidence: ['用户和苏苏明确说想每天多聊一点。'],
          },
        }),
      ]),
      character: character(),
      messages: [message({ timestamp: 200 })],
      now: 1_000,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: chat('direct', [relationship({ warmth: 70, trust: 68, competence: 10, threat: 2 })], [
        phaseEvent({
          payload: {
            eventType: 'companionship_phase_event',
            characterId: 'char-a',
            userId: 'user',
            phase: 'passionate',
            style: 'romantic',
          },
        }),
      ]),
      character: character(),
      messages: [message({ timestamp: 200 })],
      now: 1_000,
    });

    expect(projection.userBond?.phase).toBe('passionate');
    expect(projection.userBond?.carePolicy.dailyInitiationBudget).toBeGreaterThanOrEqual(4);
    expect(projection.userBond?.carePolicy.triggerSensitivity).toBeGreaterThanOrEqual(76);
    expect(projection.promptLines.join('\n')).toContain('Care policy: budget');
    expect(trace?.carePolicy.dailyInitiationBudget).toBeGreaterThanOrEqual(4);
  });

  it('exposes companionship local fallback diagnostics in runtime trace', () => {
    const fallbackEvent = phaseEvent({
      id: 'evt-phase-fallback',
      payload: {
        eventType: 'companionship_phase_event',
        characterId: 'char-a',
        userId: 'user',
        phase: 'reconciling',
        style: 'friend',
        confidence: 0.62,
        decisionSource: 'local_fallback',
        reason: 'local fallback detected repair wording',
        evidence: ['我们别冷战了，慢慢说开吧。'],
      },
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: chat('direct', [relationship({ warmth: 46, trust: 38, competence: 10, threat: 20 })], [fallbackEvent]),
      character: character(),
      messages: [message({ content: '我们别冷战了，慢慢说开吧。', timestamp: 900 })],
      now: 1_000,
    });

    expect(trace?.diagnostics).toEqual(expect.arrayContaining([
      'phase_event: source=local_fallback confidence=62% event=evt-phase-fallback',
    ]));
  });

  it('projects pending promises into bond, prompt, status debug, and runtime trace', () => {
    const promiseCharacter = character({
      layeredMemories: [{
        id: 'promise-anchor',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '说好周末一起看那部电影，用户还想等苏苏一起。',
        evidenceText: '用户说：周末一起看那部电影吧。',
        salience: 0.86,
        confidence: 0.9,
        recency: 0.8,
        reinforcementCount: 1,
        sourceEventIds: ['evt-promise-anchor'],
        origin: 'distilled',
        createdAt: 700,
        updatedAt: 850,
      }],
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说下次要告诉苏苏面试结果。'],
      },
    });
    const directChat = chat('direct', [relationship({ warmth: 62, trust: 58, competence: 10, threat: 4 })]);
    const messages = [message({ content: '下次我回来告诉你结果。', timestamp: 900 })];
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: promiseCharacter,
      messages,
      now: 1_000,
    });
    const status = buildCompanionshipStatusSignature({
      chat: directChat,
      character: promiseCharacter,
      messages,
      now: 1_000,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: directChat,
      character: promiseCharacter,
      messages,
      now: 1_000,
    });

    expect(projection.userBond?.pendingPromises.map((item) => item.text).join('\n')).toContain('周末一起看');
    expect(projection.userBond?.pendingPromises.map((item) => item.text).join('\n')).toContain('告诉苏苏面试结果');
    expect(projection.promptLines.join('\n')).toContain('Pending promises/unfinished shared plans');
    expect(status?.debugLines.join('\n')).toContain('promises=');
    expect(trace?.pendingPromises.join('\n')).toContain('周末一起看');
  });

  it('projects intimate conflict state from model-led crisis phase events', () => {
    const crisis = phaseEvent({
      id: 'evt-crisis-1',
      createdAt: 900,
      summary: '用户表达被苏苏的话伤到，需要先冷静。',
      payload: {
        eventType: 'companionship_phase_event',
        characterId: 'char-a',
        userId: 'user',
        phase: 'crisis',
        style: 'friend',
        reason: '用户明确表达关系危机。',
        evidence: ['你刚刚那句话让我很受伤，我们先冷静一下。'],
      },
    });
    const directChat = chat('direct', [relationship({
      warmth: 32,
      trust: 18,
      competence: 10,
      threat: 42,
    })], [crisis]);
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: character(),
      messages: [message({ content: '你刚刚那句话让我很受伤，我们先冷静一下。', timestamp: 900 })],
      now: 1_000,
    });
    const status = buildCompanionshipStatusSignature({
      chat: directChat,
      character: character(),
      messages: [message({ content: '你刚刚那句话让我很受伤，我们先冷静一下。', timestamp: 900 })],
      now: 1_000,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: directChat,
      character: character(),
      messages: [message({ content: '你刚刚那句话让我很受伤，我们先冷静一下。', timestamp: 900 })],
      now: 1_000,
    });

    expect(projection.userBond?.intimateConflict).toMatchObject({
      kind: 'vulnerability_burst',
      participantIds: ['char-a', 'user'],
    });
    expect(projection.userBond?.intimateConflict?.severity).toBeGreaterThanOrEqual(70);
    expect(projection.promptLines.join('\n')).toContain('Current intimate conflict/repair state');
    expect(status?.debugLines.join('\n')).toContain('conflict=vulnerability_burst');
    expect(trace?.intimateConflict?.summary).toContain('受伤');
  });

  it('projects repair state from reconciling phase events and repair anchors', () => {
    const repairCharacter = character({
      layeredMemories: [{
        id: 'repair-anchor',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '那次冷战后，用户和苏苏慢慢说开并和好了。',
        evidenceText: '用户说我们别冷战了，慢慢说开吧。',
        salience: 0.88,
        confidence: 0.9,
        recency: 0.8,
        reinforcementCount: 1,
        sourceEventIds: ['evt-repair-anchor'],
        origin: 'distilled',
        createdAt: 700,
        updatedAt: 850,
      }],
    });
    const repair = phaseEvent({
      id: 'evt-repair-1',
      createdAt: 900,
      summary: '用户愿意和苏苏重新说开。',
      payload: {
        eventType: 'companionship_phase_event',
        characterId: 'char-a',
        userId: 'user',
        phase: 'reconciling',
        style: 'friend',
        reason: '用户表达修复意愿。',
        evidence: ['我们别冷战了，慢慢说开吧。'],
      },
    });
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 48,
        trust: 38,
        competence: 10,
        threat: 24,
      })], [repair]),
      character: repairCharacter,
      messages: [message({ content: '我们别冷战了，慢慢说开吧。', timestamp: 900 })],
      now: 1_000,
    });

    expect(projection.userBond?.intimateConflict).toMatchObject({
      kind: 'reconciliation',
    });
    expect(projection.userBond?.intimateConflict?.repairReadiness).toBeGreaterThan(50);
    expect(projection.evidence.join('\n')).toContain('慢慢说开');
  });

  it('prioritizes explicit intimate conflict runtime events over inferred conflict projection', () => {
    const directChat = chat('direct', [relationship({
      warmth: 40,
      trust: 34,
      competence: 10,
      threat: 52,
    })], [intimateConflictEvent()]);
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: character(),
      messages: [message({ content: '我们先别冷战了，慢慢说开。', timestamp: 990 })],
      now: 1_100,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: directChat,
      character: character(),
      messages: [message({ content: '我们先别冷战了，慢慢说开。', timestamp: 990 })],
      now: 1_100,
    });

    expect(projection.userBond?.intimateConflict).toMatchObject({
      kind: 'repair_attempt',
      severity: 44,
      repairReadiness: 68,
      summary: '两个人还没有完全说开，但用户愿意给一个台阶。',
      participantIds: ['char-a', 'user'],
    });
    expect(projection.userBond?.intimateConflict?.sourceEventIds).toEqual(expect.arrayContaining(['evt-intimate-conflict-1', 'evt-source-conflict']));
    expect(projection.promptLines.join('\n')).toContain('Current intimate conflict/repair state');
    expect(trace?.intimateConflict?.repairReadiness).toBe(68);
  });

  it('uses resolved intimate conflict events to keep recent repair from being overwritten by old ledger tension', () => {
    const directChat = chat('direct', [relationship({
      warmth: 32,
      trust: 24,
      competence: 10,
      threat: 58,
    })], [intimateConflictEvent({
      id: 'evt-intimate-resolved',
      createdAt: 1_200,
      summary: '用户和苏苏已经把误会说开。',
      payload: {
        eventType: 'companionship_intimate_conflict',
        characterId: 'char-a',
        userId: 'user',
        action: 'resolved',
        kind: 'repair_attempt',
        severity: 16,
        repairReadiness: 86,
        summary: '误会已经说开，但表达上仍要留一点余波。',
        evidence: ['用户说：这件事说开了，我们就别翻旧账了。'],
        participantIds: ['char-a', 'user'],
        confidence: 0.91,
        decisionSource: 'model',
      },
    })]);
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: character(),
      messages: [message({ content: '这件事说开了，我们就别翻旧账了。', timestamp: 1_190 })],
      now: 1_300,
    });

    expect(projection.userBond?.intimateConflict).toMatchObject({
      kind: 'reconciliation',
      severity: 16,
      repairReadiness: 86,
    });
    expect(projection.userBond?.intimateConflict?.summary).toContain('误会已经说开');
  });

  it('derives shared memory anchors from intimate conflict runtime events', () => {
    const directChat = chat('direct', [relationship({
      warmth: 34,
      trust: 28,
      competence: 10,
      threat: 48,
    })], [intimateConflictEvent({
      id: 'evt-intimate-anchor',
      createdAt: 1_200,
      summary: '用户和苏苏把一次冷战慢慢说开。',
      payload: {
        eventType: 'companionship_intimate_conflict',
        characterId: 'char-a',
        userId: 'user',
        action: 'resolved',
        kind: 'reconciliation',
        severity: 18,
        repairReadiness: 88,
        summary: '冷战后双方愿意重新接近。',
        evidence: ['用户说：这次说开以后，就别再用沉默互相试探了。'],
        participantIds: ['char-a', 'user'],
        confidence: 0.9,
        decisionSource: 'model',
      },
    })]);
    const anchors = buildSharedMemoryAnchors(character(), 1_300, directChat);
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: character(),
      messages: [message({ content: '这次说开以后，就别再用沉默互相试探了。', timestamp: 1_190 })],
      now: 1_300,
    });

    expect(anchors.find((anchor) => anchor.id === 'runtime-evt-intimate-anchor')).toMatchObject({
      kind: 'repair',
      source: 'runtime_event',
      sourceId: 'evt-intimate-anchor',
      participantIds: ['char-a', 'user'],
    });
    expect(anchors.find((anchor) => anchor.id === 'runtime-evt-intimate-anchor')?.evidence).toContain('沉默互相试探');
    expect(projection.evidence.join('\n')).toContain('冷战后双方愿意重新接近');
    expect(projection.promptLines.join('\n')).toContain('Shared memory anchors with the user');
  });

  it('allows companionship artifact seeds from runtime-event anchors even without existing character memories', () => {
    const directChat = chat('direct', [], [intimateConflictEvent({
      id: 'evt-runtime-seed-repair',
      createdAt: 1_200,
      summary: '用户和苏苏把一次误会说开。',
      payload: {
        eventType: 'companionship_intimate_conflict',
        characterId: 'char-a',
        userId: 'user',
        action: 'resolved',
        kind: 'reconciliation',
        severity: 14,
        repairReadiness: 82,
        summary: '误会说开后，两个人都记住了别用沉默互相试探。',
        evidence: ['用户说：以后不舒服就直接说。'],
        participantIds: ['char-a', 'user'],
        confidence: 0.88,
        decisionSource: 'model',
      },
    })]);
    const seeds = buildCompanionshipArtifactSeeds({
      character: character(),
      chat: directChat,
      messages: [],
      surface: 'private_diary',
      now: 1_300,
    });

    expect(seeds.join('\n')).toContain('误会说开');
    expect(seeds.join('\n')).toContain('日记');
  });

  it('exposes low-confidence or fallback intimate conflict events in companionship diagnostics', () => {
    const trace = buildCompanionshipRuntimeTrace({
      chat: chat('direct', [relationship({ warmth: 46, trust: 38, competence: 10, threat: 20 })], [
        intimateConflictEvent({
          id: 'evt-intimate-fallback',
          payload: {
            eventType: 'companionship_intimate_conflict',
            characterId: 'char-a',
            userId: 'user',
            action: 'opened',
            kind: 'cold_war',
            confidence: 0.52,
            decisionSource: 'local_fallback',
            evidence: ['先别聊了。'],
          },
        }),
      ]),
      character: character(),
      messages: [message({ content: '先别聊了。', timestamp: 900 })],
      now: 1_000,
    });

    expect(trace?.diagnostics).toEqual(expect.arrayContaining([
      'intimate_conflict: source=local_fallback confidence=52% event=evt-intimate-fallback',
    ]));
  });

  it('turns leaked user shared secrets into intimate conflict consequences', () => {
    const secretCharacter = character({
      layeredMemories: [{
        id: 'secret-leaked',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '共同秘密是用户只把暗号告诉过苏苏，但后来已经公开说漏了。',
        evidenceText: '用户发现那个暗号传开了，觉得信任受损。',
        salience: 0.92,
        confidence: 0.91,
        recency: 0.8,
        reinforcementCount: 2,
        sourceEventIds: ['evt-secret-leaked'],
        origin: 'distilled',
        createdAt: 700,
        updatedAt: 900,
      }],
    });
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 54,
        trust: 48,
        competence: 10,
        threat: 4,
      })]),
      character: secretCharacter,
      messages: [message({ content: '那个暗号怎么会被别人知道？', timestamp: 920 })],
      now: 1_000,
    });

    expect(projection.userBond?.intimateConflict).toMatchObject({
      kind: 'accusation',
      participantIds: ['char-a', 'user'],
    });
    expect(projection.userBond?.intimateConflict?.severity).toBeGreaterThan(70);
    expect(projection.userBond?.intimateConflict?.evidence.join('\n')).toContain('秘密泄露后果');
    expect(projection.promptLines.join('\n')).toContain('Current intimate conflict/repair state');
  });

  it('turns confessed user shared secrets into repair consequences', () => {
    const secretCharacter = character({
      layeredMemories: [{
        id: 'secret-confessed',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '共同秘密是苏苏后来主动坦白并承认了那个只有他们知道的暗号。',
        evidenceText: '苏苏说开了这件事，用户没有立刻原谅但愿意听。',
        salience: 0.86,
        confidence: 0.88,
        recency: 0.7,
        reinforcementCount: 1,
        sourceEventIds: ['evt-secret-confessed'],
        origin: 'distilled',
        createdAt: 700,
        updatedAt: 900,
      }],
    });
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 58,
        trust: 46,
        competence: 10,
        threat: 8,
      })]),
      character: secretCharacter,
      messages: [message({ content: '你愿意说开就好，但我还需要一点时间。', timestamp: 920 })],
      now: 1_000,
    });

    expect(projection.userBond?.intimateConflict).toMatchObject({
      kind: 'repair_attempt',
      participantIds: ['char-a', 'user'],
    });
    expect(projection.userBond?.intimateConflict?.repairReadiness).toBeGreaterThan(45);
    expect(projection.userBond?.intimateConflict?.evidence.join('\n')).toContain('秘密坦白后果');
  });

  it('adapts care policy for anxious attachment cues without exposing labels in prompt', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 62,
        trust: 58,
        competence: 10,
        threat: 4,
      })]),
      character: character(),
      messages: [
        message({ content: '你怎么不回我，是不是不想理我了？', timestamp: 800 }),
        message({ content: '我只是想确认你还在。', timestamp: 900 }),
      ],
      now: 1_000,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: chat('direct', [relationship({
        warmth: 62,
        trust: 58,
        competence: 10,
        threat: 4,
      })]),
      character: character(),
      messages: [
        message({ content: '你怎么不回我，是不是不想理我了？', timestamp: 800 }),
        message({ content: '我只是想确认你还在。', timestamp: 900 }),
      ],
      now: 1_000,
    });

    expect(projection.userBond?.attachmentProfile.inferredStyle).toBe('anxious');
    expect(projection.userBond?.carePolicy.silenceAnxietyThresholdHours).toBeLessThan(24);
    expect(projection.promptLines.join('\n')).toContain('User attachment adaptation');
    expect(projection.promptLines.join('\n')).not.toContain('anxious');
    expect(trace?.attachmentProfile?.adaptations.join('\n')).toContain('reassurance');
  });

  it('prioritizes model-led attachment profile events over local attachment inference', () => {
    const directChat = chat('direct', [relationship({
      warmth: 62,
      trust: 58,
      competence: 10,
      threat: 4,
    })], [attachmentProfileEvent()]);
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: character(),
      messages: [
        message({ content: '你怎么不回我，是不是不想理我了？', timestamp: 800 }),
        message({ content: '我只是想确认你还在。', timestamp: 900 }),
      ],
      now: 1_100,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: directChat,
      character: character(),
      messages: [
        message({ content: '你怎么不回我，是不是不想理我了？', timestamp: 800 }),
        message({ content: '我只是想确认你还在。', timestamp: 900 }),
      ],
      now: 1_100,
    });

    expect(projection.userBond?.attachmentProfile).toMatchObject({
      inferredStyle: 'avoidant',
      confidence: 88,
      adaptations: ['respect explicit space requests', 'keep follow-up lightweight'],
    });
    expect(projection.userBond?.carePolicy.allowMissYou).toBe(false);
    expect(projection.promptLines.join('\n')).toContain('User attachment adaptation');
    expect(projection.promptLines.join('\n')).not.toContain('avoidant');
    expect(trace?.attachmentProfile?.evidence.join('\n')).toContain('需要空间');
  });

  it('exposes fallback attachment profile events in companionship diagnostics', () => {
    const trace = buildCompanionshipRuntimeTrace({
      chat: chat('direct', [relationship({ warmth: 46, trust: 38, competence: 10, threat: 20 })], [
        attachmentProfileEvent({
          id: 'evt-attachment-fallback',
          payload: {
            eventType: 'companionship_attachment_profile',
            characterId: 'char-a',
            userId: 'user',
            inferredStyle: 'anxious',
            confidence: 0.54,
            evidence: ['本地兜底检测到用户反复确认对方是否还在。'],
            adaptations: ['give concise reassurance'],
            decisionSource: 'local_fallback',
          },
        }),
      ]),
      character: character(),
      messages: [message({ content: '你是不是不想理我了？', timestamp: 900 })],
      now: 1_000,
    });

    expect(trace?.diagnostics).toEqual(expect.arrayContaining([
      'attachment_profile: source=local_fallback confidence=54% event=evt-attachment-fallback',
    ]));
  });

  it('adapts proactive care policy for avoidant attachment and user space cues', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 58,
        trust: 52,
        competence: 10,
        threat: 4,
      })]),
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: ['用户说不想主动打扰，也不要追问。'],
        },
      }),
      messages: [message({ content: '我需要一点空间，先别问了。', timestamp: 900 })],
      now: 1_000,
    });
    const policy = buildCompanionshipCarePolicyForCharacter({
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: ['用户说不想主动打扰，也不要追问。'],
        },
      }),
      chat: chat('direct', [relationship({
        warmth: 58,
        trust: 52,
        competence: 10,
        threat: 4,
      })]),
      messages: [message({ content: '我需要一点空间，先别问了。', timestamp: 900 })],
      now: 1_000,
    });

    expect(projection.userBond?.attachmentProfile.inferredStyle).toBe('avoidant');
    expect(projection.userBond?.carePolicy.allowMissYou).toBe(false);
    expect(policy.dailyInitiationBudget).toBe(0);
    expect(policy.expressionIntensity).toBeLessThanOrEqual(28);
  });

  it('keeps mixed closeness and distance cues steady as disorganized attachment adaptation', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 62,
        trust: 52,
        competence: 10,
        threat: 8,
      })]),
      character: character(),
      messages: [
        message({ content: '你怎么不回我，别不理我。', timestamp: 800 }),
        message({ content: '算了，我又想要一点空间，先别追问。', timestamp: 900 }),
      ],
      now: 1_000,
    });

    expect(projection.userBond?.attachmentProfile.inferredStyle).toBe('disorganized');
    expect(projection.userBond?.carePolicy.allowMissYou).toBe(false);
    expect(projection.userBond?.attachmentProfile.adaptations.join('\n')).toContain('alternates closeness and distance');
  });

  it('does not project intimate conflict state for ordinary warm direct chats', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('direct', [relationship({
        warmth: 66,
        trust: 60,
        competence: 10,
        threat: 4,
      })]),
      character: character(),
      messages: [message({ content: '今天看到一家店，感觉你会喜欢。', timestamp: 900 })],
      now: 1_000,
    });

    expect(projection.userBond?.intimateConflict).toBeUndefined();
    expect(projection.promptLines.join('\n')).not.toContain('Current intimate conflict/repair state');
  });

  it('uses phase-sensitive proactive budget without blocking immediate user-prompted follow-up', () => {
    const crisisChat = chat('group', [relationship({ warmth: 20, trust: 12, competence: 10, threat: 50 })], [
      phaseEvent({
        payload: {
          eventType: 'companionship_phase_event',
          characterId: 'char-a',
          userId: 'user',
          phase: 'crisis',
          style: 'friend',
          reason: '用户表达受伤，需要暂停主动靠近。',
        },
      }),
    ]);
    const carePolicy = buildCompanionshipCarePolicyForCharacter({
      character: character(),
      chat: crisisChat,
      now: new Date('2026-06-01T14:00:00+08:00').getTime(),
    });

    expect(carePolicy.dailyInitiationBudget).toBe(0);
    expect(shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: character(),
      chat: crisisChat,
      eventKind: 'status_update',
      reasonType: 'world_attention_status_idle',
      attentionScore: 0.9,
      now: new Date('2026-06-01T14:00:00+08:00').getTime(),
    }).blocked).toBe(true);
    expect(shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: character(),
      chat: crisisChat,
      eventKind: 'check_in',
      reasonType: 'world_attention_private_message',
      attentionScore: 0.9,
      now: new Date('2026-06-01T14:00:00+08:00').getTime(),
    }).blocked).toBe(false);
  });

  it('applies global companionship settings to proactive care policy and traces', () => {
    setCompanionshipRuntimeConfig({
      enableProactiveCare: false,
      allowGoodMorning: false,
      allowGoodNight: false,
      allowMissYou: false,
      careIntensity: 'restrained',
    });
    const directChat = chat('direct', [relationship({ warmth: 78, trust: 72, competence: 10, threat: 2 })]);
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: character(),
      messages: [message({ content: '今天也想和你聊一会。', timestamp: 900 })],
      now: 1_000,
    });
    const decision = shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: character(),
      chat: directChat,
      eventKind: 'status_update',
      reasonType: 'world_attention_status_idle',
      attentionScore: 1,
      now: new Date('2026-06-01T14:00:00+08:00').getTime(),
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: directChat,
      character: character(),
      messages: [message({ content: '今天也想和你聊一会。', timestamp: 900 })],
      now: 1_000,
    });

    expect(projection.userBond?.carePolicy.dailyInitiationBudget).toBe(0);
    expect(projection.userBond?.carePolicy.allowGoodMorning).toBe(false);
    expect(projection.userBond?.carePolicy.allowGoodNight).toBe(false);
    expect(projection.userBond?.carePolicy.allowMissYou).toBe(false);
    expect(projection.promptLines.join('\n')).toContain('global setting disables proactive companionship');
    expect(decision).toMatchObject({
      blocked: true,
      reason: 'global setting disables proactive companionship',
    });
    expect(trace?.boundaryReasons).toEqual(expect.arrayContaining(['global setting disables proactive companionship']));
  });

  it('respects global quiet-hour overrides for companionship proactive gating', () => {
    const night = new Date('2026-06-01T01:00:00+08:00').getTime();
    const baseCharacter = character();
    const directChat = chat('direct', [relationship({ warmth: 78, trust: 72, competence: 10, threat: 2 })]);

    setCompanionshipRuntimeConfig({
      quietHours: { enabled: true, start: '23:30', end: '08:00' },
    });
    expect(shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: baseCharacter,
      chat: directChat,
      eventKind: 'status_update',
      reasonType: 'world_attention_status_idle',
      attentionScore: 1,
      now: night,
    })).toMatchObject({
      blocked: true,
      reason: 'companionship quiet hours',
    });

    setCompanionshipRuntimeConfig({
      quietHours: { enabled: false, start: '23:30', end: '08:00' },
    });
    expect(shouldBlockUserProactiveContactByCompanionshipPolicy({
      character: baseCharacter,
      chat: directChat,
      eventKind: 'status_update',
      reasonType: 'world_attention_status_idle',
      attentionScore: 1,
      now: night,
    }).blocked).toBe(false);
  });

  it('builds a low-noise companionship status signature for direct side panels', () => {
    const signature = buildCompanionshipStatusSignature({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]),
      character: character({ memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户说：叫我小夏。', '用户说明天面试会紧张。'] } }),
      messages: [message({ content: '明天面试有点紧张。', timestamp: 200 })],
      now: 300,
    });

    expect(signature?.text).toContain('小夏');
    expect(signature?.text).toContain('面试');
    expect(signature?.chips).toEqual(expect.arrayContaining(['暧昧未确认', '有关心事项']));
    expect(signature?.debugLines.join('\n')).toContain('phase=ambiguous');
    expect(signature?.debugLines.join('\n')).toContain('intimacy attraction=');
    expect(signature?.addressing?.currentAddress).toBe('小夏');
  });

  it('injects user shared anchors into projection evidence, status debug, and runtime trace', () => {
    const anchorCharacter = character({
      layeredMemories: [{
        id: 'anchor-user',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '第一次深夜聊天后，苏苏记住了用户没有离开。',
        evidenceText: '用户那晚陪苏苏聊到很晚。',
        salience: 0.9,
        confidence: 0.9,
        recency: 0.7,
        reinforcementCount: 2,
        sourceEventIds: ['evt-anchor'],
        origin: 'distilled',
        createdAt: 100,
        updatedAt: 200,
      }],
      relationships: [{
        characterId: 'char-b',
        warmth: 90,
        competence: 10,
        trust: 90,
        threat: 0,
        note: '共同秘密是只有他们知道的暗号。',
      }],
    });
    const directChat = chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]);
    const messages = [message({ content: '今天有点累。', timestamp: 200 })];
    const projection = buildUserCompanionshipProjection({
      chat: directChat,
      character: anchorCharacter,
      messages,
      now: 300,
    });
    const status = buildCompanionshipStatusSignature({
      chat: directChat,
      character: anchorCharacter,
      messages,
      now: 300,
    });
    const trace = buildCompanionshipRuntimeTrace({
      chat: directChat,
      character: anchorCharacter,
      messages,
      now: 300,
    });

    expect(projection.evidence.join('\n')).toContain('第一次深夜聊天');
    expect(projection.promptLines.join('\n')).toContain('Shared memory anchors with the user');
    expect(projection.promptLines.join('\n')).not.toContain('只有他们知道的暗号');
    expect(status?.debugLines.join('\n')).toContain('sharedAnchors=');
    expect(trace?.sharedAnchors.join('\n')).toContain('第一次深夜聊天');
  });

  it('projects offline traces and unsent drafts after the user has been silent', () => {
    const latestUserAt = 200;
    const signature = buildCompanionshipStatusSignature({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]),
      character: character({ memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户说：叫我小夏。', '用户说明天面试会紧张。'] } }),
      messages: [message({ content: '明天面试有点紧张。', timestamp: latestUserAt })],
      now: latestUserAt + 13 * 60 * 60 * 1000,
    });

    expect(signature?.offlineTrace).toContain('离线这段时间还惦记着');
    expect(signature?.unsentDraft).toContain('本来想问问小夏');
    expect(signature?.debugLines.join('\n')).toContain('offlineTrace=');
    expect(signature?.debugLines.join('\n')).toContain('unsentDraft=');
  });

  it('does not create unsent drafts when the user prefers no proactive contact', () => {
    const latestUserAt = 200;
    const signature = buildCompanionshipStatusSignature({
      chat: chat('direct', [relationship({ warmth: 68, trust: 64, competence: 10, threat: 4 })]),
      character: character({ memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户说：叫我小夏。', '用户不想主动打扰，也不要主动私聊。'] } }),
      messages: [message({ content: '明天面试有点紧张。', timestamp: latestUserAt })],
      now: latestUserAt + 13 * 60 * 60 * 1000,
    });

    expect(signature?.offlineTrace).toContain('保持安静');
    expect(signature?.unsentDraft).toBeUndefined();
  });

  it('projects online return text for home-level companionship status', () => {
    const latestUserAt = 200;
    const directChat = chat('direct', [relationship({ warmth: 72, trust: 70, competence: 10, threat: 2 })]);
    const companion = character({ memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户说：叫我小夏。'] } });
    const signature = buildCompanionshipStatusSignature({
      chat: directChat,
      character: companion,
      messages: [message({ content: '我先去忙了，晚点回来。', timestamp: latestUserAt })],
      now: latestUserAt + 30 * 60 * 60 * 1000,
    });
    const snapshot = buildHomeCompanionshipSnapshot({
      chats: [directChat],
      characters: [companion],
      messages: [message({ chatId: directChat.id, content: '我先去忙了，晚点回来。', timestamp: latestUserAt })],
      now: latestUserAt + 30 * 60 * 60 * 1000,
    });

    expect(signature?.onlineReturn).toContain('小夏');
    expect(signature?.debugLines.join('\n')).toContain('onlineReturn=');
    expect(snapshot?.text).toBe(signature?.onlineReturn);
    expect(snapshot?.characterName).toBe('苏苏');
  });

  it('does not project online return when user boundary blocks proactive contact', () => {
    const latestUserAt = 200;
    const signature = buildCompanionshipStatusSignature({
      chat: chat('direct', [relationship({ warmth: 72, trust: 70, competence: 10, threat: 2 })]),
      character: character({ memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户不想主动打扰，也不要主动私聊。'] } }),
      messages: [message({ content: '我先去忙了。', timestamp: latestUserAt })],
      now: latestUserAt + 30 * 60 * 60 * 1000,
    });

    expect(signature?.onlineReturn).toBeUndefined();
    expect(signature?.unsentDraft).toBeUndefined();
  });

  it('does not project user companionship for group chats', () => {
    const projection = buildUserCompanionshipProjection({
      chat: chat('group', [relationship({ warmth: 48, trust: 44, competence: 10, threat: 4 })]),
      character: character(),
      messages: [message({})],
      now: 300,
    });

    expect(projection.userBond).toBeNull();
    expect(projection.promptLines).toEqual([]);
  });

  it('projects lightweight character companionship from relationship presets', () => {
    const states = buildCharacterCompanionshipStates(
      character({
        relationships: [
          {
            characterId: 'char-b',
            warmth: 72,
            trust: 68,
            competence: 42,
            threat: 2,
            note: '共同秘密是只有他们知道的暗号；约定每次争执后先递台阶；担心对方最近太累。',
            updatedAt: 900,
          },
          {
            characterId: 'char-c',
            warmth: 40,
            trust: 20,
            competence: 22,
            threat: 60,
            note: '嘴上互怼但护着对方。',
          },
          {
            characterId: 'user',
            warmth: 99,
            trust: 99,
            competence: 99,
            threat: 0,
          },
          {
            characterId: 'draft-new',
            warmth: 99,
            trust: 99,
            competence: 99,
            threat: 0,
          },
        ],
      }),
      1000,
    );

    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({
      targetId: 'char-b',
      style: 'partner',
      lastCareAt: 900,
    });
    expect(states[0].sharedSecrets.join('\n')).toContain('共同秘密');
    expect(states[0].sharedRituals.join('\n')).toContain('约定');
    expect(states[0].unresolvedCareTopics.join('\n')).toContain('担心');
    expect(states[1]).toMatchObject({
      targetId: 'char-c',
      style: 'rival_with_care',
      lastCareAt: 1000,
    });
    expect(states.map((item) => item.targetId)).not.toContain('user');
    expect(states.map((item) => item.targetId)).not.toContain('draft-new');
  });

  it('projects shared memory anchors from layered memories and relationship notes', () => {
    const anchors = buildSharedMemoryAnchors(
      character({
        layeredMemories: [
          {
            id: 'anchor-1',
            scope: 'relationship',
            layer: 'long_term',
            kind: 'bond',
            ownerId: 'char-a',
            subjectIds: ['char-a', 'char-b'],
            text: '第一次深夜聊天后，char-a 和 char-b 都把那次救场当成关系里程碑。',
            evidenceText: 'char-b 在群聊冷场时替 char-a 接住了话。',
            salience: 0.9,
            confidence: 0.88,
            recency: 0.6,
            reinforcementCount: 2,
            sourceEventIds: ['evt-1'],
            origin: 'distilled',
            createdAt: 100,
            updatedAt: 200,
          },
          {
            id: 'weak-1',
            scope: 'relationship',
            layer: 'episodic',
            kind: 'bond',
            ownerId: 'char-a',
            subjectIds: ['char-a', 'char-c'],
            text: '临时闲聊。',
            salience: 0.4,
            confidence: 0.5,
            recency: 0.6,
            reinforcementCount: 1,
            sourceEventIds: [],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        relationships: [
          {
            characterId: 'char-c',
            warmth: 70,
            trust: 60,
            competence: 20,
            threat: 4,
            note: '共同秘密是只有他们知道的暗号；约定下次一起把话说完。',
            updatedAt: 300,
          },
          {
            characterId: 'user',
            warmth: 99,
            trust: 99,
            competence: 99,
            threat: 0,
            note: '共同秘密不应作为角色-角色关系 note 投影。',
            updatedAt: 300,
          },
          {
            characterId: 'draft-new',
            warmth: 99,
            trust: 99,
            competence: 99,
            threat: 0,
            note: '约定草稿也应过滤。',
            updatedAt: 300,
          },
        ],
      }),
      400,
    );

    expect(anchors.map((item) => item.kind)).toEqual(expect.arrayContaining(['first_time', 'shared_secret', 'promise']));
    expect(anchors.find((item) => item.source === 'layered_memory')).toMatchObject({
      sourceId: 'anchor-1',
      participantIds: ['char-a', 'char-b'],
    });
    expect(anchors.some((item) => item.text.includes('临时闲聊'))).toBe(false);
    expect(anchors.some((item) => item.participantIds.includes('user') && item.source === 'relationship_note')).toBe(false);
    expect(anchors.some((item) => item.participantIds.includes('draft-new'))).toBe(false);
  });

  it('projects shared secrets with public masks and leak state', () => {
    const secrets = buildSharedSecrets(
      character({
        layeredMemories: [{
          id: 'secret-user',
          scope: 'relationship',
          layer: 'long_term',
          kind: 'bond',
          ownerId: 'char-a',
          subjectIds: ['char-a', 'user'],
          text: '共同秘密是用户只把那个暗号告诉过苏苏，不能告诉别人。',
          evidenceText: '用户说这是只有我们知道的暗号。',
          salience: 0.92,
          confidence: 0.9,
          recency: 0.8,
          reinforcementCount: 2,
          sourceEventIds: ['evt-secret-user'],
          origin: 'distilled',
          createdAt: 100,
          updatedAt: 300,
        }],
        relationships: [{
          characterId: 'char-b',
          warmth: 70,
          trust: 65,
          competence: 20,
          threat: 4,
          note: '共同秘密是已经公开说漏的旧暗号。',
          updatedAt: 400,
        }],
      }),
      500,
    );

    expect(secrets[0]).toMatchObject({
      publicMask: '有一件只适合留在心里的事',
      leakState: 'sealed',
      sourceAnchorId: 'memory-secret-user',
    });
    expect(secrets[0].emotionalWeight).toBeGreaterThan(70);
    expect(secrets.some((secret) => secret.leakState === 'leaked')).toBe(true);
  });

  it('projects ritual registry from addressing, dates, and shared anchors', () => {
    const ritualCharacter = character({
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说：叫我小夏。', '用户的纪念日是六月一日。'],
      },
      layeredMemories: [{
        id: 'joke-anchor',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '共同梗是只有他们懂的“晚点回来”。',
        evidenceText: '用户和苏苏反复用这个暗号接话。',
        salience: 0.86,
        confidence: 0.88,
        recency: 0.7,
        reinforcementCount: 2,
        sourceEventIds: ['evt-joke'],
        origin: 'distilled',
        createdAt: 100,
        updatedAt: 300,
      }],
    });
    const rituals = buildRitualRegistry({
      character: ritualCharacter,
      chat: chat('direct', [relationship({ warmth: 70, trust: 68, competence: 10, threat: 2 })]),
      messages: [message({ content: '晚点回来。', timestamp: 200 })],
      now: 500,
    });

    expect(rituals.map((ritual) => ritual.kind)).toEqual(expect.arrayContaining(['daily_greeting', 'pet_name', 'anniversary', 'inside_joke']));
    expect(rituals.find((ritual) => ritual.kind === 'pet_name')?.content).toContain('小夏');
    expect(rituals.find((ritual) => ritual.kind === 'inside_joke')?.sourceAnchorId).toBe('memory-joke-anchor');

    const trace = buildCompanionshipRuntimeTrace({
      chat: chat('direct', [relationship({ warmth: 70, trust: 68, competence: 10, threat: 2 })]),
      character: ritualCharacter,
      messages: [message({ content: '晚点回来。', timestamp: 200 })],
      now: 500,
    });
    expect(trace?.rituals.join('\n')).toContain('小夏');
  });

  it('restrains greeting rituals when user rejects them', () => {
    const rituals = buildRitualRegistry({
      character: character({
        memory: {
          shortTermSummary: '',
          longTerm: [],
          secrets: [],
          obsessions: [],
          tabooTopics: [],
          userMemories: ['用户说：叫我小夏。', '用户不希望早安晚安打扰。'],
        },
      }),
      now: 500,
    });

    expect(rituals.some((ritual) => ritual.kind === 'daily_greeting')).toBe(false);
    expect(rituals.find((ritual) => ritual.kind === 'pet_name')?.boundaryReasons).toContain('user rejects greeting rituals');
  });

  it('reads ritual execution events into cooldown state and debug trace', () => {
    const ritualChat = chat('direct', [relationship({ warmth: 70, trust: 68, competence: 10, threat: 2 })], [ritualEvent()]);
    const ritualCharacter = character({
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说：叫我小夏。'],
      },
    });
    const rituals = buildRitualRegistry({
      character: ritualCharacter,
      chat: ritualChat,
      messages: [],
      now: 2_000,
    });
    const greeting = rituals.find((ritual) => ritual.id === 'ritual-char-a-daily-greeting');

    expect(greeting).toMatchObject({
      lastPerformedAt: 1_000,
      executionState: 'cooldown',
    });
    expect(greeting?.nextAvailableAt).toBe(1_000 + 12 * 60 * 60_000);
    expect(greeting?.boundaryReasons.join('\n')).toContain('ritual cooldown until');

    const trace = buildCompanionshipRuntimeTrace({
      chat: ritualChat,
      character: ritualCharacter,
      messages: [],
      now: 2_000,
    });
    expect(trace?.rituals.join('\n')).toContain('cooldown');
    expect(trace?.rituals.join('\n')).toContain('冷却至');

    const seeds = buildCompanionshipArtifactSeeds({
      character: ritualCharacter,
      chat: ritualChat,
      messages: [],
      surface: 'private_diary',
      now: 2_000,
    });
    expect(seeds.join('\n')).not.toContain('早安/晚安');
  });

  it('builds private and public artifact seeds with different user-memory boundaries', () => {
    const base = character({
      relationships: [{
        characterId: 'char-b',
        warmth: 72,
        trust: 68,
        competence: 20,
        threat: 4,
        note: '共同秘密是只有他们知道的暗号；约定下次一起把话说完。',
        updatedAt: 300,
      }],
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说下周要面试，希望别被公开点名。'],
      },
    });

    const privateSeeds = buildCompanionshipArtifactSeeds({
      character: base,
      relatedCharacters: [{ id: 'char-b', name: '小雨' }],
      surface: 'private_diary',
      includeUserMemory: true,
      now: 400,
    });
    const publicSeeds = buildCompanionshipArtifactSeeds({
      character: base,
      relatedCharacters: [{ id: 'char-b', name: '小雨' }],
      surface: 'public_moment',
      includeUserMemory: false,
      now: 400,
    });

    expect(privateSeeds.join('\n')).toContain('用户');
    expect(privateSeeds.join('\n')).toContain('小雨');
    expect(publicSeeds.join('\n')).toContain('公开动态');
    expect(publicSeeds.join('\n')).toContain('小雨');
    expect(publicSeeds.join('\n')).toContain('公开遮罩');
    expect(publicSeeds.join('\n')).toContain('一个只有熟人懂的暗号');
    expect(publicSeeds.join('\n')).not.toContain('只有他们知道的暗号');
    expect(publicSeeds.join('\n')).not.toContain('面试');
    expect(publicSeeds.join('\n')).not.toContain('希望别被公开点名');
  });
});
