import type { AICharacter } from '../types/character';
import type { DriverEventPayload, DriverMessageCommitTransition, GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { APIConfig } from '../types/settings';
import { applyWorldCalendarPatchDraftQueue } from './worldCalendarPatchApply';

function isCalendarRelevantRuntimeEvent(event: RuntimeEventV2) {
  if (event.kind === 'calendar_item_patch') return true;
  if (event.kind !== 'event_candidate' && event.kind !== 'artifact') return false;
  const payload = event.payload as Record<string, unknown>;
  return payload.eventKind === 'social_outing' || payload.eventKind === 'travel_plan' || payload.eventKind === 'calendar_reminder';
}

export function shouldRunCalendarAutoPatchForTransition(transition: DriverMessageCommitTransition) {
  return (transition.chatRuntimeDelta?.runtimeEventsV2?.upserts || []).some(isCalendarRelevantRuntimeEvent);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildCalendarAutoPatchRuntimeEventPayloads(events: RuntimeEventV2[]): DriverEventPayload[] {
  return events
    .filter((event) => event.kind === 'calendar_item_patch')
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return {
        eventType: 'calendar_item_patch',
        title: '日历冲突自动修正',
        summary: event.summary || getString(payload.reason) || '自动应用日历修正草案',
        metrics: {
          calendarItemId: getString(payload.calendarItemId),
          basedOnItemId: getString(payload.basedOnItemId),
          idempotencyKey: getString(payload.idempotencyKey),
          startAt: getNumber(payload.startAt),
          endAt: getNumber(payload.endAt),
          durationMinutes: getNumber(payload.durationMinutes),
          source: 'world_calendar_auto_patch_runtime',
        },
        createdAt: event.createdAt,
        visibilityScope: event.visibility || 'derived_public',
        eventClass: event.eventClass || 'artifact',
        channelId: event.channelId,
        causedByIntentId: event.causedByIntentId,
        threadRef: event.threadRef,
      };
    });
}

export async function applyCalendarAutoPatchForChat(params: {
  chat: GroupChat;
  characters: AICharacter[];
  textApiConfig?: APIConfig | null;
  updateChat: (id: string, updates: Partial<GroupChat>) => Promise<void>;
}): Promise<{ nextChat: GroupChat; appliedCount: number; skippedCount: number; appendedRuntimeEvents: RuntimeEventV2[] }> {
  let persistedEvents = params.chat.runtimeEventsV2 || [];
  const execution = await applyWorldCalendarPatchDraftQueue({
    chats: [params.chat],
    characters: params.characters,
    textApiConfig: params.textApiConfig || null,
    conversationId: params.chat.id,
    trigger: 'auto_runtime',
    riskMode: 'automatic',
    updateChat: async (id, updates) => {
      if (id === params.chat.id && updates.runtimeEventsV2) {
        persistedEvents = updates.runtimeEventsV2;
      }
      await params.updateChat(id, updates);
    },
  });
  const nextChat = {
    ...params.chat,
    runtimeEventsV2: persistedEvents,
  };
  const previousEventIds = new Set((params.chat.runtimeEventsV2 || []).map((event) => event.id));
  const appendedRuntimeEvents = persistedEvents.filter((event) => !previousEventIds.has(event.id));
  return {
    nextChat,
    appliedCount: execution.appliedCount,
    skippedCount: execution.skippedCount,
    appendedRuntimeEvents,
  };
}
