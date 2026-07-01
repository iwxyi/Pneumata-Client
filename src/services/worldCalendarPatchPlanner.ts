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
  risk: 'automatic' | 'manual';
  riskReasons: string[];
  display: {
    calendarItemTitle: string;
    basedOnItemTitle: string;
    participantNames: string[];
    currentStartAt?: number | null;
    currentEndAt?: number | null;
    suggestedStartAt: number;
    suggestedEndAt?: number | null;
  };
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

function resolveEndAt(item: WorldCalendarProjectionResult['items'][number] | undefined) {
  if (!item) return null;
  if (typeof item.endAt === 'number') return item.endAt;
  if (typeof item.startAt === 'number' && typeof item.durationMinutes === 'number') return item.startAt + item.durationMinutes * 60_000;
  return null;
}

export function buildWorldCalendarPatchApplyPlan(projection: Pick<WorldCalendarProjectionResult, 'patchDraftQueue'> & Partial<Pick<WorldCalendarProjectionResult, 'items'>>): WorldCalendarPatchApplyPlan {
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

  const items = projection.items || [];
  const byItemId = new Map(items.map((item) => [item.id, item]));
  const draftCountByCalendarItem = new Map<string, number>();
  deduped.forEach((draft) => {
    draftCountByCalendarItem.set(draft.calendarItemId, (draftCountByCalendarItem.get(draft.calendarItemId) || 0) + 1);
  });

  const planItems: WorldCalendarPatchPlanItem[] = deduped.map((draft) => {
    const rootId = rootCalendarItemId(draft.calendarItemId);
    const groupKey = `${rootId}::${draft.basedOnItemId}`;
    const groupSize = draftGroups.get(groupKey) || 0;
    const item = byItemId.get(draft.calendarItemId);
    const basedOnItem = byItemId.get(draft.basedOnItemId);
    const currentStartAt = item?.startAt ?? null;
    const currentEndAt = resolveEndAt(item);
    const suggestedEndAt = draft.patch.endAt ?? (
      typeof currentStartAt === 'number' && typeof currentEndAt === 'number'
        ? draft.patch.startAt + (currentEndAt - currentStartAt)
        : null
    );
    const delayMinutes = typeof currentStartAt === 'number'
      ? Math.round((draft.patch.startAt - currentStartAt) / 60_000)
      : null;
    const conflictPartnerCount = item?.conflict?.conflictWithItemIds.length || 0;
    const riskReasons: string[] = [];
    if (!item || !basedOnItem) riskReasons.push('缺少可确认的原活动或冲突锚点');
    if (groupSize > 1) riskReasons.push('会连带调整准备、行程、休整等关联日程');
    if ((draftCountByCalendarItem.get(draft.calendarItemId) || 0) > 1) riskReasons.push('同一活动存在多个调整候选');
    if (conflictPartnerCount > 1) riskReasons.push('该活动同时涉及多个时间冲突');
    if (item?.status === 'confirmed' || item?.status === 'in_progress' || item?.status === 'completed') riskReasons.push('活动状态较确定，不适合静默改期');
    if (typeof delayMinutes === 'number' && Math.abs(delayMinutes) > 180) riskReasons.push('调整幅度超过 3 小时');
    const risk = riskReasons.length ? 'manual' : 'automatic';
    return ({
    idempotencyKey: buildIdempotencyKey(draft),
    eventType: draft.eventType,
    calendarItemId: draft.calendarItemId,
    dependsOnItemId: draft.basedOnItemId || undefined,
    chainGroupId: groupSize > 1 ? groupKey : undefined,
    patch: draft.patch,
    reason: draft.reason,
    priority: draft.patch.startAt,
    risk,
    riskReasons,
    display: {
      calendarItemTitle: item?.title || draft.calendarItemId,
      basedOnItemTitle: basedOnItem?.title || draft.basedOnItemId,
      participantNames: item?.conflict?.participantNames || [],
      currentStartAt,
      currentEndAt,
      suggestedStartAt: draft.patch.startAt,
      suggestedEndAt,
    },
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
