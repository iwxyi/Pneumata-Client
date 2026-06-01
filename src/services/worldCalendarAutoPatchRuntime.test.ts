import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation, type DriverMessageCommitTransition } from '../types/chat';
import type { AICharacter } from '../types/character';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY, DEFAULT_PERSONALITY } from '../types/character';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { applyCalendarAutoPatchForChat, buildCalendarAutoPatchRuntimeEventPayloads, shouldRunCalendarAutoPatchForTransition } from './worldCalendarAutoPatchRuntime';

function character(id: string, name: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: DEFAULT_PERSONALITY,
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildChat(runtimeEventsV2: RuntimeEventV2[]) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: 'chat-1',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
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

describe('worldCalendarAutoPatchRuntime', () => {
  it('detects calendar-relevant transition events', () => {
    const transition: DriverMessageCommitTransition = {
      chatPatch: {},
      characterPatches: [],
      runtimeEvents: [],
      chatRuntimeDelta: {
        runtimeEventsV2: {
          orderedIds: ['e1'],
          upserts: [{
            id: 'e1',
            conversationId: 'chat-1',
            kind: 'artifact',
            createdAt: 10,
            summary: '约饭',
            payload: { eventKind: 'social_outing', title: '约饭', participantIds: ['a', 'b'], dedupeKey: 'outing-1' },
          }],
        },
      },
    };
    expect(shouldRunCalendarAutoPatchForTransition(transition)).toBe(true);
  });

  it('auto-applies patch events into runtime events and persists once', async () => {
    const chat = buildChat([
      {
        id: 'evt-1',
        conversationId: 'chat-1',
        kind: 'artifact',
        createdAt: 100,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '晚饭',
        payload: {
          eventKind: 'social_outing',
          title: '晚饭',
          activityType: '聚餐',
          participantIds: ['a', 'b'],
          dedupeKey: 'outing-a-b',
          startAt: 1800000000000,
          durationMinutes: 120,
        },
      },
      {
        id: 'evt-2',
        conversationId: 'chat-1',
        kind: 'artifact',
        createdAt: 110,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '咖啡',
        payload: {
          eventKind: 'social_outing',
          title: '咖啡',
          activityType: 'coffee',
          participantIds: ['a', 'b'],
          dedupeKey: 'outing-coffee',
          startAt: 1800001800000,
          durationMinutes: 60,
        },
      },
    ]);
    const updateChat = vi.fn(async () => undefined);
    const result = await applyCalendarAutoPatchForChat({
      chat,
      characters: [character('a', 'A'), character('b', 'B')],
      updateChat,
    });
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(result.appendedRuntimeEvents.some((event) => event.kind === 'calendar_item_patch')).toBe(true);
    const patchEvent = result.appendedRuntimeEvents.find((event) => event.kind === 'calendar_item_patch');
    expect((patchEvent?.payload as Record<string, unknown>)?.source).toBe('world_calendar_auto_patch_runtime');
    expect(updateChat).toHaveBeenCalledTimes(1);
    expect(updateChat).toHaveBeenCalledWith('chat-1', expect.objectContaining({ runtimeEventsV2: expect.any(Array) }));
  });

  it('builds runtime event payloads for appended calendar patches', () => {
    const payloads = buildCalendarAutoPatchRuntimeEventPayloads([
      {
        id: 'patch-1',
        conversationId: 'chat-1',
        kind: 'calendar_item_patch',
        createdAt: 100,
        summary: '自动顺延',
        visibility: 'derived_public',
        payload: {
          calendarItemId: 'item-1',
          basedOnItemId: 'item-0',
          idempotencyKey: 'k1',
          startAt: 1800003600000,
          endAt: 1800007200000,
          durationMinutes: 60,
        },
      },
    ]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.eventType).toBe('calendar_item_patch');
    expect(payloads[0]?.metrics).toEqual(expect.objectContaining({
      calendarItemId: 'item-1',
      basedOnItemId: 'item-0',
      idempotencyKey: 'k1',
      source: 'world_calendar_auto_patch_runtime',
    }));
  });
});
