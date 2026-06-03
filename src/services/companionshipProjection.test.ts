import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import { buildCharacterCompanionshipStates, buildCompanionshipArtifactSeeds, buildCompanionshipCarePolicyForCharacter, buildCompanionshipRuntimeTrace, buildCompanionshipStatusSignature, buildHomeCompanionshipSnapshot, buildSharedMemoryAnchors, buildSharedSecrets, buildUserCompanionshipProjection, shouldBlockUserProactiveContactByCompanionshipPolicy } from './companionshipProjection';
import { buildCompanionshipCareTopicEventsFromDirectUserMessage } from './directCompanionshipCare';

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
