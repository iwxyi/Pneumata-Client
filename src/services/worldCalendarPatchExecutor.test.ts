import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { applyWorldCalendarPatchPlanToChats } from './worldCalendarPatchExecutor';
import type { WorldCalendarPatchApplyPlan } from './worldCalendarPatchPlanner';
import type { WorldCalendarProjectionResult } from './worldRuntimeProjection';

function chatWithEvents(id: string, runtimeEventsV2: RuntimeEventV2[] = []) {
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
    memberIds: [],
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

function projection(items: WorldCalendarProjectionResult['items']): Pick<WorldCalendarProjectionResult, 'items'> {
  return { items };
}

function plan(queue: WorldCalendarPatchApplyPlan['queue']): WorldCalendarPatchApplyPlan {
  return { queue };
}

describe('worldCalendarPatchExecutor', () => {
  it('applies patch events in queue order', () => {
    const chats = [chatWithEvents('chat-1')];
    const result = applyWorldCalendarPatchPlanToChats(
      chats,
      projection([{
        id: 'item-1',
        kind: 'activity',
        status: 'confirmed',
        title: 'A',
        participantIds: [],
        participantStates: {},
        participantNames: [],
        summary: '',
        sourceRefs: [{ conversationId: 'chat-1', eventIds: ['e1'], weight: 1, lastEvidenceAt: 100 }],
        conflict: null,
        updatedAt: 100,
      }]),
      plan([
        {
          idempotencyKey: 'k1',
          eventType: 'calendar_item_patch',
          calendarItemId: 'item-1',
          patch: { startAt: 1800000000000 },
          reason: 'first',
          priority: 1,
        },
        {
          idempotencyKey: 'k2',
          eventType: 'calendar_item_patch',
          calendarItemId: 'item-1',
          patch: { startAt: 1800003600000 },
          reason: 'second',
          priority: 2,
        },
      ]),
    );

    expect(result.appliedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.chats[0]?.runtimeEventsV2?.slice(-2).map((event) => event.summary)).toEqual(['first', 'second']);
  });

  it('skips duplicates by idempotency key on repeated apply', () => {
    const chats = [chatWithEvents('chat-1', [{
      id: 'existing',
      conversationId: 'chat-1',
      kind: 'calendar_item_patch',
      createdAt: 100,
      summary: 'existing',
      payload: { idempotencyKey: 'dup-key', calendarItemId: 'item-1' },
    }])];
    const result = applyWorldCalendarPatchPlanToChats(
      chats,
      projection([{
        id: 'item-1',
        kind: 'activity',
        status: 'confirmed',
        title: 'A',
        participantIds: [],
        participantStates: {},
        participantNames: [],
        summary: '',
        sourceRefs: [{ conversationId: 'chat-1', eventIds: ['e1'], weight: 1, lastEvidenceAt: 100 }],
        conflict: null,
        updatedAt: 100,
      }]),
      plan([{
        idempotencyKey: 'dup-key',
        eventType: 'calendar_item_patch',
        calendarItemId: 'item-1',
        patch: { startAt: 1800000000000 },
        reason: 'duplicate',
        priority: 1,
      }]),
    );
    expect(result.appliedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.chats[0]?.runtimeEventsV2).toHaveLength(1);
  });

  it('chooses highest-weight source conversation and supports fallback', () => {
    const chats = [chatWithEvents('chat-a'), chatWithEvents('chat-b')];
    const result = applyWorldCalendarPatchPlanToChats(
      chats,
      projection([
        {
          id: 'item-1',
          kind: 'activity',
          status: 'confirmed',
          title: 'A',
          participantIds: [],
          participantStates: {},
          participantNames: [],
          summary: '',
          sourceRefs: [
            { conversationId: 'chat-a', eventIds: ['e1'], weight: 0.8, lastEvidenceAt: 100 },
            { conversationId: 'chat-b', eventIds: ['e2'], weight: 1, lastEvidenceAt: 90 },
          ],
          conflict: null,
          updatedAt: 100,
        },
      ]),
      plan([
        {
          idempotencyKey: 'k1',
          eventType: 'calendar_item_patch',
          calendarItemId: 'item-1',
          patch: { startAt: 1800000000000 },
          reason: 'route to chat-b',
          priority: 1,
        },
        {
          idempotencyKey: 'k2',
          eventType: 'calendar_item_patch',
          calendarItemId: 'missing-item',
          patch: { startAt: 1800000000000 },
          reason: 'route fallback',
          priority: 2,
        },
      ]),
      { fallbackConversationId: 'chat-a' },
    );
    expect(result.appliedCount).toBe(2);
    expect(result.chats.find((chat) => chat.id === 'chat-b')?.runtimeEventsV2?.slice(-1)[0]?.summary).toBe('route to chat-b');
    expect(result.chats.find((chat) => chat.id === 'chat-a')?.runtimeEventsV2?.slice(-1)[0]?.summary).toBe('route fallback');
  });

  it('builds deterministic calendar patch event ids when now is fixed', () => {
    const chats = [chatWithEvents('chat-1')];
    const queuePlan = plan([{
      idempotencyKey: 'k-fixed',
      eventType: 'calendar_item_patch',
      calendarItemId: 'item-1',
      patch: { startAt: 1800000000000, endAt: 1800003600000 },
      reason: 'deterministic',
      priority: 1,
    }]);
    const project = projection([{
      id: 'item-1',
      kind: 'activity',
      status: 'confirmed',
      title: 'A',
      participantIds: [],
      participantStates: {},
      participantNames: [],
      summary: '',
      sourceRefs: [{ conversationId: 'chat-1', eventIds: ['e1'], weight: 1, lastEvidenceAt: 100 }],
      conflict: null,
      updatedAt: 100,
    }]);
    const first = applyWorldCalendarPatchPlanToChats(chats, project, queuePlan, { now: 1777000000000 });
    const second = applyWorldCalendarPatchPlanToChats(chats, project, queuePlan, { now: 1777000000000 });
    const firstEvent = first.chats[0]?.runtimeEventsV2?.at(-1);
    const secondEvent = second.chats[0]?.runtimeEventsV2?.at(-1);

    expect(firstEvent?.createdAt).toBe(1777000000000);
    expect(firstEvent?.id).toBe(secondEvent?.id);
  });
});
