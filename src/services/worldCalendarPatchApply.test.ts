import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY, DEFAULT_PERSONALITY } from '../types/character';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { applyWorldCalendarPatchDraftQueue, reorderPlanQueueWithModel } from './worldCalendarPatchApply';
import * as aiClient from './aiClient';

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

function buildChat(id: string, runtimeEventsV2: RuntimeEventV2[]) {
  return normalizeConversation({
    id,
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: id,
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

describe('worldCalendarPatchApply', () => {
  it('applies projected queue and persists only changed chats', async () => {
    const chats = [
      buildChat('chat-1', [
        {
          id: 'evt-1',
          conversationId: 'chat-1',
          kind: 'artifact',
          createdAt: 100,
          actorIds: ['a'],
          targetIds: ['b'],
          summary: 'A和B约饭',
          visibility: 'derived_public',
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
          summary: 'A和B又约了重叠活动',
          visibility: 'derived_public',
          payload: {
            eventKind: 'social_outing',
            title: '喝咖啡',
            activityType: 'coffee',
            participantIds: ['a', 'b'],
            dedupeKey: 'outing-coffee',
            startAt: 1800001800000,
            durationMinutes: 60,
          },
        },
      ]),
      buildChat('chat-2', []),
    ];
    const updateChat = vi.fn(async () => undefined);
    const result = await applyWorldCalendarPatchDraftQueue({
      chats,
      characters: [character('a', 'A'), character('b', 'B')],
      updateChat,
      conversationId: 'chat-1',
    });
    expect(result.queueCount).toBeGreaterThan(0);
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(result.persistedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.failures).toEqual([]);
    expect(updateChat).toHaveBeenCalledTimes(1);
    expect(updateChat).toHaveBeenCalledWith('chat-1', expect.objectContaining({ runtimeEventsV2: expect.any(Array) }));
  });

  it('continues patch persistence when continueOnPersistError=true', async () => {
    const chats = [
      buildChat('chat-1', [
        {
          id: 'evt-1',
          conversationId: 'chat-1',
          kind: 'artifact',
          createdAt: 100,
          actorIds: ['a'],
          targetIds: ['b'],
          summary: 'A和B约饭',
          visibility: 'derived_public',
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
      ]),
      buildChat('chat-2', [
        {
          id: 'evt-1b',
          conversationId: 'chat-1',
          kind: 'artifact',
          createdAt: 105,
          actorIds: ['a'],
          targetIds: ['b'],
          summary: 'A和B重叠咖啡',
          visibility: 'derived_public',
          payload: {
            eventKind: 'social_outing',
            title: '二次咖啡',
            activityType: 'coffee',
            participantIds: ['a', 'b'],
            dedupeKey: 'outing-a-b-2',
            startAt: 1800000900000,
            durationMinutes: 90,
          },
        },
        {
          id: 'evt-2',
          conversationId: 'chat-2',
          kind: 'artifact',
          createdAt: 110,
          actorIds: ['a'],
          targetIds: ['b'],
          summary: 'A和B约咖啡',
          visibility: 'derived_public',
          payload: {
            eventKind: 'social_outing',
            title: '喝咖啡',
            activityType: 'coffee',
            participantIds: ['a', 'b'],
            dedupeKey: 'outing-coffee',
            startAt: 1800001800000,
            durationMinutes: 60,
          },
        },
      ]),
    ];
    const updateChat = vi.fn(async () => {
      throw new Error('persist failed');
    });
    const result = await applyWorldCalendarPatchDraftQueue({
      chats,
      characters: [character('a', 'A'), character('b', 'B')],
      updateChat,
      continueOnPersistError: true,
    });
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(result.failedCount).toBeGreaterThan(0);
    expect(result.persistedCount).toBeGreaterThanOrEqual(0);
    expect(result.failures[0]).toEqual(expect.objectContaining({ chatId: expect.any(String) }));
  });

  it('marks patch runtime event source by trigger', async () => {
    const chats = [
      buildChat('chat-1', [
        {
          id: 'evt-1',
          conversationId: 'chat-1',
          kind: 'artifact',
          createdAt: 100,
          actorIds: ['a'],
          targetIds: ['b'],
          summary: 'A和B约饭',
          visibility: 'derived_public',
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
          summary: 'A和B又约了重叠活动',
          visibility: 'derived_public',
          payload: {
            eventKind: 'social_outing',
            title: '喝咖啡',
            activityType: 'coffee',
            participantIds: ['a', 'b'],
            dedupeKey: 'outing-coffee',
            startAt: 1800001800000,
            durationMinutes: 60,
          },
        },
      ]),
    ];

    const updates: Array<{ id: string; runtimeEventsV2: RuntimeEventV2[] }> = [];
    const updateChat = vi.fn(async (id: string, patch: Partial<{ runtimeEventsV2: RuntimeEventV2[] }>) => {
      if (patch.runtimeEventsV2) updates.push({ id, runtimeEventsV2: patch.runtimeEventsV2 });
    });

    await applyWorldCalendarPatchDraftQueue({
      chats,
      characters: [character('a', 'A'), character('b', 'B')],
      updateChat: updateChat as never,
      conversationId: 'chat-1',
      trigger: 'action_panel',
    });

    const latestPatched = updates[updates.length - 1]?.runtimeEventsV2 || [];
    const patchEvent = [...latestPatched].reverse().find((event) => event.kind === 'calendar_item_patch');
    expect((patchEvent?.payload as Record<string, unknown>)?.source).toBe('world_calendar_action_panel');
  });

  it('uses text model arbitration to reorder independent patch drafts when config is provided', async () => {
    const jsonSpy = vi.spyOn(aiClient, 'generateJsonResponse').mockResolvedValueOnce(JSON.stringify({ orderedIndices: [1, 0] }));
    const queue = [{
      idempotencyKey: 'k1',
      eventType: 'calendar_item_patch' as const,
      calendarItemId: 'item-1',
      patch: { startAt: 10 },
      reason: 'first',
      priority: 10,
    }, {
      idempotencyKey: 'k2',
      eventType: 'calendar_item_patch' as const,
      calendarItemId: 'item-2',
      patch: { startAt: 12 },
      reason: 'second',
      priority: 12,
    }];
    const reordered = await reorderPlanQueueWithModel(
      queue,
      { provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini' },
    );
    expect(jsonSpy).toHaveBeenCalled();
    expect(reordered.queue[0]?.calendarItemId).toBe('item-2');
    expect(reordered.queue[1]?.calendarItemId).toBe('item-1');
    expect(reordered.meta.applied).toBe(true);
    jsonSpy.mockRestore();
  });
});
