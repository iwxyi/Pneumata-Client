import type { WorldCalendarPatchDraft, WorldCalendarProjectionResult } from './worldRuntimeProjection';

export interface WorldCalendarPatchPlanItem {
  idempotencyKey: string;
  eventType: 'calendar_item_patch';
  calendarItemId: string;
  dependsOnItemId?: string;
  chainGroupId?: string;
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

function rootCalendarItemId(id: string) {
  const marker = id.indexOf('::');
  return marker >= 0 ? id.slice(0, marker) : id;
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

  const draftGroups = new Map<string, number>();
  deduped.forEach((draft) => {
    const key = `${rootCalendarItemId(draft.calendarItemId)}::${draft.basedOnItemId}`;
    draftGroups.set(key, (draftGroups.get(key) || 0) + 1);
  });

  const planItems: WorldCalendarPatchPlanItem[] = deduped.map((draft) => {
    const rootId = rootCalendarItemId(draft.calendarItemId);
    const groupKey = `${rootId}::${draft.basedOnItemId}`;
    const groupSize = draftGroups.get(groupKey) || 0;
    return ({
    idempotencyKey: buildIdempotencyKey(draft),
    eventType: draft.eventType,
    calendarItemId: draft.calendarItemId,
    dependsOnItemId: draft.basedOnItemId || undefined,
    chainGroupId: groupSize > 1 ? groupKey : undefined,
    patch: draft.patch,
    reason: draft.reason,
    priority: draft.patch.startAt,
  });
  });

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
