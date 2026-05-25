import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openChatEngine } from './openChatEngine';
import { normalizeConversation } from '../../types/chat';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_MEMORY, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_EMOTIONAL_STATE, type AICharacter } from '../../types/character';
import { DEFAULT_API_CONFIG } from '../../types/settings';
import type { DriverMessageCommitResult } from '../../types/chat';

const generateResponseMock = vi.fn();

vi.mock('../aiClient', () => ({
  generateResponse: (...args: unknown[]) => generateResponseMock(...args),
}));

beforeEach(() => {
  generateResponseMock.mockReset();
});

function buildApiConfig() {
  return {
    ...DEFAULT_API_CONFIG,
    apiKey: 'test-key',
  };
}

function jsonResponse(payload: unknown) {
  return JSON.stringify(payload);
}

function buildChat() {
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
    memberIds: ['a', 'b'],
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
  });
}

function buildCharacter(id: string, name: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories: [],
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

function readRuntimeEvents(result: DriverMessageCommitResult) {
  return result.chatPatch.runtimeEventsV2 || result.chatRuntimeDelta?.runtimeEventsV2?.upserts || [];
}

function applyResultToChat(chat: ReturnType<typeof buildChat>, result: DriverMessageCommitResult) {
  const eventById = new Map((chat.runtimeEventsV2 || []).map((event) => [event.id, event] as const));
  result.chatRuntimeDelta?.runtimeEventsV2?.upserts.forEach((event) => eventById.set(event.id, event));
  const ledgerByKey = new Map((chat.relationshipLedger || []).map((entry) => [entry.pairKey, entry] as const));
  result.chatRuntimeDelta?.relationshipLedger?.upserts.forEach((entry) => ledgerByKey.set(entry.pairKey, entry));
  const isPresent = <T,>(value: T | undefined): value is T => Boolean(value);
  return normalizeConversation({
    ...chat,
    ...result.chatPatch,
    runtimeEventsV2: result.chatRuntimeDelta?.runtimeEventsV2
      ? result.chatRuntimeDelta.runtimeEventsV2.orderedIds.map((id) => eventById.get(id)).filter(isPresent)
      : (result.chatPatch.runtimeEventsV2 || chat.runtimeEventsV2),
    relationshipLedger: result.chatRuntimeDelta?.relationshipLedger
      ? result.chatRuntimeDelta.relationshipLedger.orderedPairKeys.map((key) => ledgerByKey.get(key)).filter(isPresent)
      : (result.chatPatch.relationshipLedger || chat.relationshipLedger),
    updatedAt: chat.updatedAt + 1,
    lastMessageAt: chat.lastMessageAt + 1,
  });
}

function readAppliedRuntimeEvents(chat: ReturnType<typeof buildChat>, result: DriverMessageCommitResult) {
  return applyResultToChat(chat, result).runtimeEventsV2 || [];
}

describe('openChatEngine.onMessageCommitted', () => {
  it('produces structured runtime events for message, interaction, room shift, and memory', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const message = {
      type: 'ai' as const,
      senderId: 'a',
      content: '乙，你刚才那个说法不对，我不同意。',
      interactionHint: {
        kind: 'challenge' as const,
        actorId: 'a',
        targetId: 'b',
        intensity: 4,
        tone: 'annoyed' as const,
        evidenceText: '乙，你刚才那个说法不对，我不同意。',
        confidence: 0.92,
      },
      socialEventHints: [{
        eventKind: 'pair_private_thread' as const,
        participantIds: ['a', 'b'],
        targetIds: ['b'],
        reasonType: 'unresolved_question',
        confidence: 0.9,
        urgency: 'immediate' as const,
        seedIntent: '想私下继续和乙把刚才的争议说清楚。',
        visibilityPlan: 'conversation_private' as const,
        expectedArtifacts: ['private_thread_summary'],
        dedupeKey: 'pair-a-b-thread-1',
      }],
    };
    const result: DriverMessageCommitResult = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: message as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });

    expect(result.chatPatch.runtimeEventsV2).toBeUndefined();
    expect(result.chatPatch.relationshipLedger).toBeUndefined();
    expect(result.chatRuntimeDelta?.runtimeEventsV2?.upserts.length).toBeGreaterThan(0);
    expect(result.chatRuntimeDelta?.relationshipLedger?.upserts.length).toBeGreaterThan(0);
    const kinds = (readRuntimeEvents(result)).map((event) => event.kind);
    expect(kinds).toContain('message_generated');
    expect(kinds).toContain('interaction');
    expect(kinds).toContain('relationship_delta');
    expect(kinds).toContain('room_shift');
    expect(kinds).toContain('memory_candidate');
    expect(kinds).toContain('event_candidate');
  });

  it('records plain user guidance as conversation focus and a topic memory cue', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result: DriverMessageCommitResult = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'user',
        senderId: 'user',
        content: '聊聊今晚要不要一起去看烟花。',
      },
      previousAiMessage: null,
      recentMessages: [],
    });

    const applied = applyResultToChat(chat, result);
    expect(applied.worldState.focus).toBe('聊聊今晚要不要一起去看烟花。');
    expect(applied.worldState.recentEvent).toBe('用户引导：聊聊今晚要不要一起去看烟花。');
    expect(applied.runtimeEventsV2?.some((event) => event.kind === 'memory_candidate' && event.summary.includes('用户引导'))).toBe(true);
    expect(result.characterPatches).toHaveLength(0);
  });

  it('records withdrawal residue without preserving the withdrawn text as public runtime', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result: DriverMessageCommitResult = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '甲撤回了一条消息',
        metadata: {
          withdrawal: {
            withdrawn: true,
            originalContent: '乙，你这说法真的太离谱了。',
            reason: '前面的刺留下了关系修复压力。',
            withdrawnAt: 123,
          },
        },
        interactionHint: {
          kind: 'challenge',
          actorId: 'a',
          targetId: 'b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '乙，你这说法真的太离谱了。',
          confidence: 0.95,
        },
      },
      previousAiMessage: null,
      recentMessages: [],
    });

    const applied = applyResultToChat(chat, result);
    const events = applied.runtimeEventsV2 || [];
    expect(events.some((event) => event.kind === 'message_generated' && event.summary.includes('撤回了一条消息'))).toBe(true);
    expect(events.some((event) => event.summary.includes('太离谱'))).toBe(false);
    expect(events.some((event) => event.payload && JSON.stringify(event.payload).includes('太离谱'))).toBe(false);
    expect(events.some((event) => event.kind === 'memory_candidate' && event.summary.includes('撤回本身'))).toBe(true);
    expect(applied.relationshipLedger?.length || 0).toBe(0);
  });

  it('keeps relationship ledger recent events lightweight across structured commits', async () => {
    let chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];

    for (let index = 0; index < 4; index += 1) {
      const result = await openChatEngine.onMessageCommitted({
        conversation: chat,
        characters,
        message: {
          type: 'ai',
          senderId: 'a',
          content: `乙，你第 ${index + 1} 次这个说法我还是不同意。`,
          interactionHint: {
            kind: 'challenge',
            actorId: 'a',
            targetId: 'b',
            intensity: 4,
            tone: 'annoyed',
            evidenceText: `乙，你第 ${index + 1} 次这个说法我还是不同意。`,
            confidence: 0.92,
          },
        },
        previousAiMessage: null,
        recentMessages: [],
      });

      chat = applyResultToChat(chat, result);
    }

    const ledger = chat.relationshipLedger || [];
    expect(ledger.length).toBeGreaterThan(0);
    const recentEvent = ledger[0]?.recentEvents.at(-1);
    expect(recentEvent && 'summary' in recentEvent).toBe(true);
    expect(recentEvent && Object.prototype.hasOwnProperty.call(recentEvent, 'payload')).toBe(false);
    expect(JSON.stringify(ledger).length).toBeLessThan(6000);
  });

  it('adds post moment candidate/events for celebratory room messages', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const message = {
      type: 'ai' as const,
      senderId: 'a',
      content: '今天这波聊得可以，晚上去吃火锅顺便拍个合照吧。',
      interactionHint: {
        kind: 'support' as const,
        actorId: 'a',
        targetId: 'b',
        intensity: 3,
        tone: 'warm' as const,
        evidenceText: '今天这波聊得可以，晚上去吃火锅顺便拍个合照吧。',
        confidence: 0.9,
      },
      socialEventHints: [{
        eventKind: 'post_moment' as const,
        targetIds: ['b'],
        reasonType: 'celebration',
        confidence: 0.88,
        urgency: 'soon' as const,
        seedIntent: '想发一条和刚才活动气氛有关的动态。',
        visibilityPlan: 'public' as const,
        expectedArtifacts: ['moment_text', 'moment_food_photo', 'moment_group_photo'],
        title: '朋友圈动态',
        activityType: '记录聚会',
        dedupeKey: 'moment-a-celebration-1',
      }],
    };
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: message as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });

    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'post_moment')).toBe(true);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'moment_text')).toBe(true);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { sourceText?: string }).sourceText?.includes('吃火锅'))).toBe(true);
  });

  it('adds social outing candidate/events for outing-style room messages', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const message = {
      type: 'ai' as const,
      senderId: 'a',
      content: '那就今晚一起去吃火锅庆祝一下，顺便拍张合照。',
      interactionHint: {
        kind: 'support' as const,
        actorId: 'a',
        targetId: 'b',
        intensity: 3,
        tone: 'warm' as const,
        evidenceText: '那就今晚一起去吃火锅庆祝一下，顺便拍张合照。',
        confidence: 0.9,
      },
      socialEventHints: [{
        eventKind: 'social_outing' as const,
        participantIds: ['a', 'b'],
        reasonType: 'celebration',
        confidence: 0.9,
        urgency: 'soon' as const,
        seedIntent: '想把刚才群里的热络气氛延续成一次线下活动。',
        visibilityPlan: 'public' as const,
        expectedArtifacts: ['outing_summary', 'group_photo', 'food_photo'],
        title: '线下活动',
        activityType: '吃饭',
        timeHint: '今晚',
        locationHint: '未定',
        dedupeKey: 'outing-tonight-a-b',
      }],
    };
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: message as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });

    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'social_outing')).toBe(true);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'outing_summary')).toBe(true);
  });

  it('falls back to AI post moment analysis when no hint is provided', async () => {
    generateResponseMock
      .mockResolvedValueOnce(jsonResponse({ shouldCreate: true, title: '朋友圈动态', activityType: '记录聚会', targetIds: ['b'], confidence: 0.91, reasonType: 'celebration', dedupeKey: 'moment-fallback-1', seedIntent: '想把刚才的开心时刻发成动态。' }));

    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '今天太开心了，刚才那一幕我都想发出来。',
        interactionHint: {
          kind: 'support',
          actorId: 'a',
          targetId: 'b',
          intensity: 3,
          tone: 'warm',
          evidenceText: '今天太开心了，刚才那一幕我都想发出来。',
          confidence: 0.9,
        },
      },
      previousAiMessage: null,
      recentMessages: [],
      apiConfig: buildApiConfig(),
    });

    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'post_moment')).toBe(true);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'moment_text')).toBe(true);
    expect(generateResponseMock.mock.calls.length).toBe(1);
    expect(generateResponseMock.mock.calls.some(([, prompt]) => typeof prompt === 'string' && prompt.includes('朋友圈/动态'))).toBe(true);
  });

  it('ignores malformed AI post moment analysis and keeps runtime stable', async () => {
    generateResponseMock
      .mockResolvedValueOnce('not-json');

    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '刚才这段我真想发出来记录一下。',
        interactionHint: {
          kind: 'support',
          actorId: 'a',
          targetId: 'b',
          intensity: 3,
          tone: 'warm',
          evidenceText: '刚才这段我真想发出来记录一下。',
          confidence: 0.9,
        },
      },
      previousAiMessage: null,
      recentMessages: [],
      apiConfig: buildApiConfig(),
    });

    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'post_moment')).toBe(false);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'moment_text')).toBe(false);
    expect(events.some((event) => event.kind === 'message_generated')).toBe(true);
    expect(generateResponseMock).toHaveBeenCalledTimes(1);
  });

  it('does not run social event LLM analysis for ordinary messages without explicit hints', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '这事先这样吧，我听明白你的意思了。',
        interactionHint: {
          kind: 'support',
          actorId: 'a',
          targetId: 'b',
          intensity: 3,
          tone: 'warm',
          evidenceText: '这事先这样吧，我听明白你的意思了。',
          confidence: 0.9,
        },
      },
      previousAiMessage: null,
      recentMessages: [],
      apiConfig: buildApiConfig(),
    });

    expect(generateResponseMock).not.toHaveBeenCalled();
    expect((readRuntimeEvents(result)).some((event) => event.kind === 'event_candidate')).toBe(false);
  });

  it('gates pair private thread candidates on actual interaction state', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '我们之后再说吧。',
        interactionHint: {
          kind: 'support',
          actorId: 'a',
          targetId: 'b',
          intensity: 1,
          tone: 'warm',
          evidenceText: '我们之后再说吧。',
          confidence: 0.9,
        },
        socialEventHints: [{
          eventKind: 'pair_private_thread',
          participantIds: ['a', 'b'],
          targetIds: ['b'],
          reasonType: 'unresolved_question',
          confidence: 0.9,
          urgency: 'immediate',
          seedIntent: '想私下继续聊。',
          visibilityPlan: 'conversation_private',
          expectedArtifacts: ['private_thread_summary'],
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    expect((readRuntimeEvents(result)).some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'pair_private_thread')).toBe(false);
  });

  it('uses warm room state to admit post moment candidates', async () => {
    const chat = normalizeConversation({
      ...buildChat(),
      worldState: { ...buildChat().worldState, structuredRoomState: { heat: 26, cohesion: 14, topicDrift: 4, dominantThread: ['a', 'b'], alliances: [['a', 'b']], conflictPairs: [], pileOnTarget: null, silencedActors: [] } },
    });
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '这段我真想发出来纪念一下。',
        interactionHint: null,
        socialEventHints: [{
          eventKind: 'post_moment',
          confidence: 0.88,
          urgency: 'soon',
          seedIntent: '想发动态。',
          visibilityPlan: 'public',
          expectedArtifacts: ['moment_text'],
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    expect((readRuntimeEvents(result)).some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'post_moment')).toBe(true);
  });

  it('uses relationship and room state to admit outing candidates', async () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 8, competence: 5, trust: 4, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 1,
      }],
      worldState: { ...buildChat().worldState, structuredRoomState: { heat: 14, cohesion: 8, topicDrift: 3, dominantThread: ['a', 'b'], alliances: [['a', 'b']], conflictPairs: [], pileOnTarget: null, silencedActors: [] } },
    });
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '那今晚一起去吃火锅吧。',
        interactionHint: {
          kind: 'support',
          actorId: 'a',
          targetId: 'b',
          intensity: 3,
          tone: 'warm',
          evidenceText: '那今晚一起去吃火锅吧。',
          confidence: 0.92,
        },
        socialEventHints: [{
          eventKind: 'social_outing',
          participantIds: ['a', 'b'],
          confidence: 0.88,
          urgency: 'soon',
          seedIntent: '线下活动。',
          visibilityPlan: 'public',
          expectedArtifacts: ['outing_summary'],
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    expect((readRuntimeEvents(result)).some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'social_outing')).toBe(true);
  });

  it('merges semantically similar outing candidates across nearby messages', async () => {
    const baseChat = normalizeConversation({
      ...buildChat(),
      runtimeEventsV2: [{
        id: 'evt-existing-outing',
        conversationId: 'chat-1',
        kind: 'event_candidate',
        createdAt: 1,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: 'a 提议触发线下活动',
        visibility: 'derived_public',
        payload: {
          eventKind: 'social_outing',
          initiatorId: 'a',
          participantIds: ['a', 'b'],
          targetIds: ['b'],
          reasonType: 'celebration',
          confidence: 0.82,
          urgency: 'soon',
          seedIntent: '先约一波火锅。',
          visibilityPlan: 'public',
          expectedArtifacts: ['outing_summary'],
          title: '线下活动',
          activityType: '吃火锅',
          timeHint: '今晚',
          locationHint: null,
          dedupeKey: null,
        },
      }],
    });
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: baseChat,
      characters,
      message: {
        type: 'ai',
        senderId: 'b',
        content: '行，那今晚就一起去吃火锅吧。',
        interactionHint: {
          kind: 'support',
          actorId: 'b',
          targetId: 'a',
          intensity: 4,
          tone: 'warm',
          evidenceText: '行，那今晚就一起去吃火锅吧。',
          confidence: 0.92,
        },
        socialEventHints: [{
          eventKind: 'social_outing',
          participantIds: ['a', 'b'],
          targetIds: ['a'],
          reasonType: 'celebration',
          confidence: 0.9,
          urgency: 'soon',
          seedIntent: '今晚去吃火锅。',
          visibilityPlan: 'public',
          expectedArtifacts: ['outing_summary', 'group_photo'],
          title: '线下活动',
          activityType: '吃火锅',
          timeHint: '今晚',
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    const events = readAppliedRuntimeEvents(baseChat, result);
    const outingCandidates = events.filter((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'social_outing');
    expect(outingCandidates).toHaveLength(1);
    const latest = outingCandidates.at(-1);
    expect(latest?.id).toBe('evt-existing-outing');
    expect((latest?.payload as { participantIds?: string[] }).participantIds).toEqual(['a', 'b']);
    expect((latest?.payload as { expectedArtifacts?: string[] }).expectedArtifacts).toContain('group_photo');
    expect((latest?.payload as { targetIds?: string[] }).targetIds).toContain('a');
    expect((latest?.payload as { targetIds?: string[] }).targetIds).toContain('b');
  });

  it('merges semantically similar post moment candidates by initiator and topic', async () => {
    const baseChat = normalizeConversation({
      ...buildChat(),
      runtimeEventsV2: [{
        id: 'evt-existing-moment',
        conversationId: 'chat-1',
        kind: 'event_candidate',
        createdAt: 1,
        actorIds: ['a'],
        summary: 'a 提议发布一条 post_moment 动态',
        visibility: 'derived_public',
        payload: {
          eventKind: 'post_moment',
          initiatorId: 'a',
          participantIds: ['a'],
          targetIds: ['b'],
          reasonType: 'celebration',
          confidence: 0.84,
          urgency: 'soon',
          seedIntent: '记录火锅局。',
          visibilityPlan: 'public',
          expectedArtifacts: ['moment_text'],
          title: '朋友圈动态',
          activityType: '记录火锅',
          dedupeKey: null,
        },
      }],
    });
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: baseChat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '这波火锅我真得发个动态纪念一下。',
        interactionHint: null,
        socialEventHints: [{
          eventKind: 'post_moment',
          confidence: 0.91,
          urgency: 'soon',
          seedIntent: '发动态记录火锅。',
          visibilityPlan: 'public',
          expectedArtifacts: ['moment_text', 'moment_food_photo'],
          title: '朋友圈动态',
          activityType: '记录火锅',
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    const events = readAppliedRuntimeEvents(baseChat, result);
    const moments = events.filter((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'post_moment');
    expect(moments).toHaveLength(1);
    const latest = moments.at(-1);
    expect(latest?.id).toBe('evt-existing-moment');
    expect((latest?.payload as { activityType?: string }).activityType).toBe('记录火锅');
    expect((latest?.payload as { seedIntent?: string }).seedIntent).toContain('火锅');
    expect((latest?.payload as { initiatorId?: string }).initiatorId).toBe('a');
    expect((latest?.payload as { title?: string }).title).toBe('朋友圈动态');
    expect((latest?.payload as { visibilityPlan?: string }).visibilityPlan).toBe('public');
  });

  it('adds status update candidate/events for self-update messages', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '最近我在忙新项目，这两天可能回复慢一点。',
        interactionHint: null,
        socialEventHints: [{
          eventKind: 'status_update',
          confidence: 0.88,
          urgency: 'soon',
          seedIntent: '想同步一下最近状态。',
          visibilityPlan: 'public',
          expectedArtifacts: ['status_note'],
          title: '状态更新',
          activityType: '项目近况',
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'status_update')).toBe(true);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'status_note')).toBe(true);
  });

  it('adds conflict expression candidate/events for confrontational messages', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '你刚才那个说法我真的接受不了。',
        interactionHint: {
          kind: 'challenge',
          actorId: 'a',
          targetId: 'b',
          intensity: 4,
          tone: 'annoyed',
          evidenceText: '你刚才那个说法我真的接受不了。',
          confidence: 0.93,
        },
        socialEventHints: [{
          eventKind: 'conflict_expression',
          targetIds: ['b'],
          participantIds: ['a'],
          confidence: 0.9,
          urgency: 'soon',
          seedIntent: '想把刚才的不满直接说开。',
          visibilityPlan: 'public',
          expectedArtifacts: ['conflict_note'],
          title: '冲突表达',
          activityType: '正面摊牌',
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'conflict_expression')).toBe(true);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'conflict_note')).toBe(true);
  });

  it('adds gift exchange candidate/events for caring gift messages', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '我给你带了杯咖啡，别太辛苦。',
        interactionHint: {
          kind: 'support',
          actorId: 'a',
          targetId: 'b',
          intensity: 3,
          tone: 'warm',
          evidenceText: '我给你带了杯咖啡，别太辛苦。',
          confidence: 0.92,
        },
        socialEventHints: [{
          eventKind: 'gift_exchange',
          targetIds: ['b'],
          participantIds: ['a'],
          confidence: 0.9,
          urgency: 'soon',
          seedIntent: '想送个小礼物表达心意。',
          visibilityPlan: 'public',
          expectedArtifacts: ['gift_note'],
          title: '礼物互动',
          activityType: '送咖啡',
        }],
      } as Parameters<typeof openChatEngine.onMessageCommitted>[0]['message'],
      previousAiMessage: null,
      recentMessages: [],
    });
    const events = readRuntimeEvents(result);
    expect(events.some((event) => event.kind === 'event_candidate' && (event.payload as { eventKind?: string }).eventKind === 'gift_exchange')).toBe(true);
    expect(events.some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'gift_note')).toBe(true);
  });

  it('adds artifact events for summary-like messages', async () => {
    const chat = buildChat();
    const characters = [buildCharacter('a', '甲'), buildCharacter('b', '乙')];
    const result = await openChatEngine.onMessageCommitted({
      conversation: chat,
      characters,
      message: {
        type: 'ai',
        senderId: 'a',
        content: '总结一下，今天的方案就是先拆模块再合并。',
        interactionHint: null,
      },
      previousAiMessage: null,
      recentMessages: [],
    });

    expect((readRuntimeEvents(result)).some((event) => event.kind === 'artifact')).toBe(true);
  });
});
