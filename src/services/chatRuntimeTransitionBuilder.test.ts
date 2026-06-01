import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import type { ConflictDevelopmentHook } from '../types/runtimeEvent';
import type { MemoryItem } from './memoryTypes';
import { buildChatPatch, buildNextWorldState, buildRelationshipTransition, buildWorldRuntimeEvents } from './chatRuntimeTransitionBuilder';
import { resolveRuntimeEvolutionConfig } from './runtimeEvolutionConfig';

function buildChat(overrides: Partial<ReturnType<typeof normalizeConversation>> = {}) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a', 'char-b', 'char-c'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  });
}

function buildCharacter(id: string, name: string, layeredMemories: MemoryItem[] = []): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories,
    background: '',
    speakingStyle: '',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: DEFAULT_CHARACTER_MEMORY,
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
  };
}

function buildRelationshipMemory(id: string, ownerId: string, subjectIds: string[], text: string, evidenceId: string, updatedAt: number): MemoryItem {
  return {
    id,
    ownerId,
    scope: 'relationship',
    layer: 'episodic',
    kind: 'resentment',
    subjectIds,
    text,
    salience: 0.8,
    confidence: 0.82,
    recency: 0.9,
    reinforcementCount: 1,
    sourceEventIds: [evidenceId],
    sourceTag: 'interaction',
    origin: 'runtime',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('buildRelationshipTransition', () => {
  it('emits localized character memory distillation events when local distillation is triggered', () => {
    const chat = buildChat();
    const speaker = buildCharacter('char-a', '甲', [
      buildRelationshipMemory('m1', 'char-a', ['char-b'], 'char-b 总爱抢话。', 'e1', 101),
      buildRelationshipMemory('m2', 'char-a', ['char-c'], 'char-c 会替 char-b 接茬。', 'e2', 102),
      buildRelationshipMemory('m3', 'char-a', ['char-b'], 'char-b 一被质疑就顶回来。', 'e3', 103),
      buildRelationshipMemory('m4', 'char-a', ['char-c'], 'char-c 常帮 char-b 圆场。', 'e4', 104),
    ]);
    const target = buildCharacter('char-b', '乙');
    const witness = buildCharacter('char-c', '丙');

    const result = buildRelationshipTransition({
      conversation: chat,
      characters: [speaker, target, witness],
      message: {
        type: 'ai',
        senderId: 'char-a',
        content: '乙你别老抢着接话。',
        interactionHint: {
          kind: 'challenge',
          actorId: 'char-a',
          targetId: 'char-b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '乙你别老抢着接话。',
          confidence: 0.94,
        },
      },
      previousAiMessage: null,
    });

    const distillationEvent = result.runtimeEvents.find((event) => event.eventType === 'memory_distillation');
    expect(distillationEvent).toBeTruthy();
    expect(distillationEvent?.title).toBe('本地蒸馏 · 甲');
    expect(distillationEvent?.summary).toContain('乙');
    expect(distillationEvent?.summary).toContain('丙');
    expect(distillationEvent?.summary).not.toContain('char-b');
    expect(distillationEvent?.summary).not.toContain('char-c');

    const payload = distillationEvent?.metrics as { ownerType?: string; source?: string; candidateTexts?: string[] };
    expect(payload.ownerType).toBe('character');
    expect(payload.source).toBe('local');
    expect(payload.candidateTexts?.[0]).toContain('乙');
  });

  it('does not emit duplicate conflict focus events when the primary conflict has not meaningfully changed', () => {
    const developmentHooks: ConflictDevelopmentHook[] = ['invite_target_response', 'force_side_taking'];
    const existingConflict = {
      id: 'conflict-1',
      scope: 'group' as const,
      type: 'authority_challenge' as const,
      severity: 0.82,
      stage: 'open' as const,
      summary: '这句话把“谁有资格管”推到了台面上。',
      participantIds: ['char-a', 'char-b'],
      targetIds: ['char-b'],
      nextPressure: 'escalate' as const,
      developmentHooks,
      sourceEventIds: [],
      updatedAt: 1,
    };
    const chat = buildChat({
      worldState: {
        phase: 'idle',
        mood: '',
        focus: '',
        recentEvent: existingConflict.summary,
        conflictAxes: [{ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'], currentTilt: -30 }],
        conflictState: {
          primaryConflict: existingConflict,
          activeConflicts: [existingConflict],
          developmentHooks,
          volatility: existingConflict.severity,
          cooling: 0,
          updatedAt: 1,
        },
      },
    });
    const speaker = buildCharacter('char-a', '甲');
    const target = buildCharacter('char-b', '乙');

    const result = buildRelationshipTransition({
      conversation: chat,
      characters: [speaker, target],
      message: {
        type: 'ai',
        senderId: 'char-a',
        content: '乙你别总一副要管全场的样子。',
        interactionHint: {
          kind: 'challenge',
          actorId: 'char-a',
          targetId: 'char-b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '乙你别总一副要管全场的样子。',
          confidence: 0.93,
        },
        conflictFocus: {
          present: true,
          type: 'authority_challenge',
          severity: 0.82,
          stage: 'open',
          summary: '这句话把“谁有资格管”推到了台面上。',
          primaryTargetIds: ['char-b'],
          participantIds: ['char-a', 'char-b'],
          nextPressure: 'escalate',
          developmentHooks: ['invite_target_response', 'force_side_taking'],
        },
      },
      previousAiMessage: null,
    });

    expect(result.runtimeEvents.some((event) => event.eventType === 'conflict_focus_shift')).toBe(false);
  });

  it('rejects high-severity conflict focus without enough evidence reason text', () => {
    const chat = buildChat();
    const speaker = buildCharacter('char-a', '甲');
    const target = buildCharacter('char-b', '乙');

    const result = buildRelationshipTransition({
      conversation: chat,
      characters: [speaker, target],
      message: {
        type: 'ai',
        senderId: 'char-a',
        content: '这句话直接把矛盾升级了。',
        interactionHint: {
          kind: 'challenge',
          actorId: 'char-a',
          targetId: 'char-b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '这句话直接把矛盾升级了。',
          confidence: 0.93,
        },
        conflictFocus: {
          present: true,
          type: 'authority_challenge',
          severity: 0.86,
          stage: 'open',
          summary: '谁有资格主导这件事，已经出现正面碰撞。',
          primaryTargetIds: ['char-b'],
          participantIds: ['char-a', 'char-b'],
          nextPressure: 'escalate',
          developmentHooks: ['invite_target_response'],
          why: '太短',
        },
      },
      previousAiMessage: null,
    });

    expect(result.runtimeEvents.some((event) => event.eventType === 'conflict_focus_shift')).toBe(false);
  });

  it('evolves core profile from runtime speech without replacing existing manual anchors', () => {
    const chat = buildChat();
    const speaker = buildCharacter('char-a', '甲');
    const target = buildCharacter('char-b', '乙');
    speaker.coreProfile = {
      coreDesire: '想被当作可靠的人。',
      coreFear: '',
      socialMask: '',
      valuePriority: [],
      biases: [],
      interactionHabits: [],
    };

    const result = buildRelationshipTransition({
      conversation: chat,
      characters: [speaker, target],
      message: {
        type: 'ai',
        senderId: 'char-a',
        content: '乙你别老抢着接话，凭什么总是一副要管全场的样子？你是不是看不起我？',
        interactionHint: {
          kind: 'challenge',
          actorId: 'char-a',
          targetId: 'char-b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '乙你别老抢着接话，凭什么总是一副要管全场的样子？你是不是看不起我？',
          confidence: 0.94,
        },
      },
      previousAiMessage: null,
    });

    const speakerPatch = result.characterPatches.find((patch) => patch.characterId === 'char-a')?.patch;
    expect(speakerPatch?.coreProfile?.coreDesire).toBe('想被当作可靠的人。');
    expect(speakerPatch?.coreProfile?.coreFear).toContain('轻视');
    expect(speakerPatch?.coreProfile?.biases?.some((item) => item.includes('打断'))).toBe(true);
    expect(speakerPatch?.coreProfile?.interactionHabits?.some((item) => item.includes('追问'))).toBe(true);
  });

  it('treats speak-as user messages as character-authored runtime speech', () => {
    const chat = buildChat();
    const speaker = buildCharacter('char-a', '甲');
    const target = buildCharacter('char-b', '乙');

    const result = buildRelationshipTransition({
      conversation: chat,
      characters: [speaker, target],
      message: {
        type: 'user',
        senderId: 'char-a',
        content: '乙你先别急着下结论，我觉得这里还有问题。',
        interactionHint: {
          kind: 'challenge',
          actorId: 'char-a',
          targetId: 'char-b',
          intensity: 3,
          tone: 'annoyed',
          evidenceText: '乙你先别急着下结论，我觉得这里还有问题。',
          confidence: 0.91,
        },
      },
      previousAiMessage: null,
    });

    const speakerPatch = result.characterPatches.find((patch) => patch.characterId === 'char-a')?.patch;
    const targetPatch = result.characterPatches.find((patch) => patch.characterId === 'char-b')?.patch;
    expect(speakerPatch?.soulState?.lastImpulse).toBeTruthy();
    expect(speakerPatch?.emotionalState).toBeTruthy();
    expect(targetPatch?.soulState?.lastImpulse).toBeTruthy();
    expect(result.runtimeEvents.some((event) => event.eventType === 'group_relationship_shift')).toBe(true);
  });

  it('does not emit relationship shift event when interaction confidence is below gate', () => {
    const chat = buildChat();
    const speaker = buildCharacter('char-a', '甲');
    const target = buildCharacter('char-b', '乙');

    const result = buildRelationshipTransition({
      conversation: chat,
      characters: [speaker, target],
      message: {
        type: 'ai',
        senderId: 'char-a',
        content: '乙你这样不太行。',
        interactionHint: {
          kind: 'challenge',
          actorId: 'char-a',
          targetId: 'char-b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '乙你这样不太行。',
          confidence: 0.6,
        },
      },
      previousAiMessage: null,
    });

    expect(result.runtimeEvents.some((event) => event.eventType === 'group_relationship_shift')).toBe(false);
  });
});

describe('buildWorldRuntimeEvents', () => {
  it('appends attention candidate runtime event when user mentions members in group chat', () => {
    const chat = buildChat({ runtimeEventsV2: [] });
    const patch = buildChatPatch(
      chat,
      { type: 'user', senderId: 'user', content: '甲先说说，乙也跟进。' },
      chat.worldState,
      [],
      resolveRuntimeEvolutionConfig('balanced'),
      [{ id: 'char-a', name: '甲' }, { id: 'char-b', name: '乙' }],
    );
    const runtimeEvents = patch.runtimeEventsV2 || [];
    const candidate = runtimeEvents.find((event) => event.kind === 'attention_candidate');
    expect(candidate).toBeTruthy();
    expect(candidate?.targetIds).toEqual(['char-a', 'char-b']);
  });

  it('uses message timestamp for deterministic attention candidate id and createdAt', () => {
    const chat = buildChat({ runtimeEventsV2: [] });
    const input = { type: 'user' as const, senderId: 'user', content: '甲先说说，乙也跟进。', timestamp: 456789 };
    const patchA = buildChatPatch(
      chat,
      input,
      chat.worldState,
      [],
      resolveRuntimeEvolutionConfig('balanced'),
      [{ id: 'char-a', name: '甲' }, { id: 'char-b', name: '乙' }],
    );
    const patchB = buildChatPatch(
      chat,
      input,
      chat.worldState,
      [],
      resolveRuntimeEvolutionConfig('balanced'),
      [{ id: 'char-a', name: '甲' }, { id: 'char-b', name: '乙' }],
    );
    const candidateA = (patchA.runtimeEventsV2 || []).find((event) => event.kind === 'attention_candidate');
    const candidateB = (patchB.runtimeEventsV2 || []).find((event) => event.kind === 'attention_candidate');
    expect(candidateA?.createdAt).toBe(456789);
    expect(candidateB?.createdAt).toBe(456789);
    expect(candidateA?.id).toBe(candidateB?.id);
  });

  it('does not emit duplicate conflict axis and world-state events when summaries stay the same', () => {
    const previousWorldState = {
      phase: 'idle' as const,
      mood: '',
      focus: '',
      recentEvent: '这句话把“谁有资格管”推到了台面上。',
      conflictAxes: [{ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'] as [string, string], currentTilt: -30 }],
    };
    const nextWorldState = {
      ...previousWorldState,
      conflictAxes: [{ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'] as [string, string], currentTilt: -48 }],
    };

    const events = buildWorldRuntimeEvents(
      { type: 'ai', content: '新的一句接话' },
      previousWorldState,
      nextWorldState,
      nextWorldState.conflictAxes || [],
      resolveRuntimeEvolutionConfig('balanced'),
    );

    expect(events).toEqual([]);
  });

  it('emits a conflict axis event when the displayed summary actually changes', () => {
    const previousWorldState = {
      phase: 'idle' as const,
      mood: '',
      focus: '',
      recentEvent: '',
      conflictAxes: [{ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'] as [string, string], currentTilt: -30 }],
    };
    const nextAxes = [{ title: '群体关系', poles: ['结盟', '拆台'] as [string, string], currentTilt: -40 }];
    const nextWorldState = {
      ...previousWorldState,
      conflictAxes: nextAxes,
      recentEvent: '新的局势变化',
    };

    const events = buildWorldRuntimeEvents(
      { type: 'ai', content: '新的一句接话' },
      previousWorldState,
      nextWorldState,
      nextAxes,
      resolveRuntimeEvolutionConfig('balanced'),
    );

    expect(events.some((event) => event.eventType === 'conflict_axis_shift')).toBe(true);
  });

  it('uses message timestamp for deterministic world runtime event createdAt', () => {
    const previousWorldState = {
      phase: 'idle' as const,
      mood: '',
      focus: '',
      recentEvent: '',
      conflictAxes: [],
    };
    const nextAxes = [{ title: '群体关系', poles: ['结盟', '拆台'] as [string, string], currentTilt: -40 }];
    const nextWorldState = {
      ...previousWorldState,
      conflictAxes: nextAxes,
      recentEvent: '新的局势变化',
    };

    const events = buildWorldRuntimeEvents(
      { type: 'ai', content: '新的一句接话', timestamp: 777 },
      previousWorldState,
      nextWorldState,
      nextAxes,
      resolveRuntimeEvolutionConfig('balanced'),
    );

    expect(events[0]?.createdAt).toBe(777);
  });

  it('decays stale conflict state when no new conflict focus appears', () => {
    const developmentHooks: ConflictDevelopmentHook[] = ['invite_target_response'];
    const chat = buildChat({
      worldState: {
        phase: 'idle',
        mood: '',
        focus: '',
        recentEvent: '旧矛盾',
        conflictAxes: [],
        conflictState: {
          primaryConflict: {
            id: 'conflict-1',
            scope: 'group',
            type: 'authority_challenge',
            severity: 0.66,
            stage: 'open',
            summary: '旧矛盾',
            participantIds: ['char-a', 'char-b'],
            targetIds: ['char-b'],
            nextPressure: 'escalate',
            developmentHooks,
            sourceEventIds: [],
            updatedAt: 1,
          },
          activeConflicts: [{
            id: 'conflict-1',
            scope: 'group',
            type: 'authority_challenge',
            severity: 0.66,
            stage: 'open',
            summary: '旧矛盾',
            participantIds: ['char-a', 'char-b'],
            targetIds: ['char-b'],
            nextPressure: 'escalate',
            developmentHooks,
            sourceEventIds: [],
            updatedAt: 1,
          }],
          developmentHooks,
          volatility: 0.66,
          cooling: 0,
          updatedAt: 1,
        },
      },
    });

    const result = buildNextWorldState(chat, {
      type: 'ai',
      senderId: 'char-c',
      content: '现在换个话题继续聊别的。',
      conflictFocus: null,
    });

    expect(result.worldState.conflictState?.primaryConflict?.severity).toBeLessThan(0.66);
    expect(result.worldState.conflictState?.primaryConflict?.stage).toBe('cooling');
  });

  it('does not adopt high-severity conflict focus into world state without evidence reason', () => {
    const chat = buildChat();
    const result = buildNextWorldState(chat, {
      type: 'ai',
      senderId: 'char-a',
      content: '这里冲突很大。',
      conflictFocus: {
        present: true,
        type: 'authority_challenge',
        severity: 0.9,
        stage: 'escalating',
        summary: '冲突升级，关系正面碰撞。',
        participantIds: ['char-a', 'char-b'],
        primaryTargetIds: ['char-b'],
        nextPressure: 'escalate',
        developmentHooks: ['raise_stakes'],
        why: '不足',
      },
    });
    expect(result.worldState.conflictState).toBeNull();
  });

  it('uses message timestamp to keep conflict state ids and updatedAt deterministic', () => {
    const chat = buildChat();
    const payload: import('../types/runtimeEvent').ConflictFocusPayload = {
      present: true as const,
      type: 'authority_challenge' as const,
      severity: 0.76,
      stage: 'open' as const,
      summary: '围绕主导权的公开冲突开始成形。',
      participantIds: ['char-a', 'char-b'],
      primaryTargetIds: ['char-b'],
      nextPressure: 'escalate' as const,
      developmentHooks: ['invite_target_response'],
      why: '一方要求主导，另一方公开反驳并质疑资格。',
    };
    const resultA = buildNextWorldState(chat, {
      type: 'ai',
      senderId: 'char-a',
      content: '冲突正在形成。',
      timestamp: 123456,
      conflictFocus: payload,
    });
    const resultB = buildNextWorldState(chat, {
      type: 'ai',
      senderId: 'char-a',
      content: '冲突正在形成。',
      timestamp: 123456,
      conflictFocus: payload,
    });

    expect(resultA.worldState.conflictState?.primaryConflict?.id).toBe(resultB.worldState.conflictState?.primaryConflict?.id);
    expect(resultA.worldState.conflictState?.updatedAt).toBe(123456);
    expect(resultB.worldState.conflictState?.updatedAt).toBe(123456);
  });
});
