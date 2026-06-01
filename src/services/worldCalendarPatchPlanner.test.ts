import { describe, expect, it } from 'vitest';
import { buildWorldCalendarPatchApplyPlan } from './worldCalendarPatchPlanner';
import type { WorldCalendarProjectionResult } from './worldRuntimeProjection';

function projectionWithDrafts(drafts: WorldCalendarProjectionResult['patchDraftQueue']): WorldCalendarProjectionResult {
  return {
    items: [],
    patchDraftQueue: drafts,
  };
}

describe('worldCalendarPatchPlanner', () => {
  it('builds deduped apply queue with deterministic order', () => {
    const projection = projectionWithDrafts([
      {
        eventType: 'calendar_item_patch',
        calendarItemId: 'event-b',
        basedOnItemId: 'event-a',
        patch: { startAt: 1800004500000, endAt: 1800008100000, durationMinutes: 60 },
        reason: 'A与B冲突，B顺延',
      },
      {
        eventType: 'calendar_item_patch',
        calendarItemId: 'event-c',
        basedOnItemId: 'event-b',
        patch: { startAt: 1800009000000, endAt: 1800012600000, durationMinutes: 60 },
        reason: 'B与C冲突，C顺延',
      },
      {
        eventType: 'calendar_item_patch',
        calendarItemId: 'event-b',
        basedOnItemId: 'event-a',
        patch: { startAt: 1800004500000, endAt: 1800008100000, durationMinutes: 60 },
        reason: '重复草案应去重',
      },
    ]);

    const plan = buildWorldCalendarPatchApplyPlan(projection);
    expect(plan.queue).toHaveLength(2);
    expect(plan.queue[0]?.calendarItemId).toBe('event-b');
    expect(plan.queue[1]?.calendarItemId).toBe('event-c');
    expect(plan.queue[0]?.idempotencyKey).toContain('event-b:event-a');
    expect(plan.queue[1]?.dependsOnItemId).toBe('event-b');
  });
});
