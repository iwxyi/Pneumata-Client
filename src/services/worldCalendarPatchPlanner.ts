import type { WorldCalendarPatchDraft, WorldCalendarProjectionResult } from './worldRuntimeProjection';

export interface WorldCalendarPatchPlanItem {
  idempotencyKey: string;
  eventType: 'calendar_item_patch';
  calendarItemId: string;
  dependsOnItemId?: string;
  patch: WorldCalendarPatchDraft['patch'];
  reason: string;
  priority: number;
}

export interface WorldCalendarPatchApplyPlan {
  queue: WorldCalendarPatchPlanItem[];
}

function buildIdempotencyKey(draft: WorldCalendarPatchDraft) {
  const endAt = draft.patch.endAt ?? '';
  const duration = draft.patch.durationMinutes ?? '';
  return `calendar-patch:${draft.calendarItemId}:${draft.basedOnItemId}:${draft.patch.startAt}:${endAt}:${duration}`;
}

export function buildWorldCalendarPatchApplyPlan(projection: Pick<WorldCalendarProjectionResult, 'patchDraftQueue'>): WorldCalendarPatchApplyPlan {
  const deduped = projection.patchDraftQueue.filter((draft, index, array) => (
    array.findIndex((item) => (
      item.calendarItemId === draft.calendarItemId
      && item.basedOnItemId === draft.basedOnItemId
      && item.patch.startAt === draft.patch.startAt
      && (item.patch.endAt ?? null) === (draft.patch.endAt ?? null)
      && (item.patch.durationMinutes ?? null) === (draft.patch.durationMinutes ?? null)
    )) === index
  ));

  const planItems: WorldCalendarPatchPlanItem[] = deduped.map((draft) => ({
    idempotencyKey: buildIdempotencyKey(draft),
    eventType: draft.eventType,
    calendarItemId: draft.calendarItemId,
    dependsOnItemId: draft.basedOnItemId || undefined,
    patch: draft.patch,
    reason: draft.reason,
    priority: draft.patch.startAt,
  }));

  const byCalendarItem = new Map(planItems.map((item) => [item.calendarItemId, item]));
  return {
    queue: [...planItems].sort((left, right) => {
      const leftDepends = left.dependsOnItemId ? byCalendarItem.get(left.dependsOnItemId) : null;
      const rightDepends = right.dependsOnItemId ? byCalendarItem.get(right.dependsOnItemId) : null;
      if (leftDepends?.calendarItemId === right.calendarItemId) return 1;
      if (rightDepends?.calendarItemId === left.calendarItemId) return -1;
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.calendarItemId.localeCompare(right.calendarItemId);
    }),
  };
}
