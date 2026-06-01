import { describe, expect, it } from 'vitest';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { buildCalendarPatchDebugChips, buildCalendarPatchSummary, buildCalendarPatchTimelineTitle, isAutoCalendarPatchEvent } from './worldCalendarPatchPresentation';

function calendarPatchEvent(payload: Record<string, unknown>): RuntimeEventV2 {
  return {
    id: 'patch-1',
    conversationId: 'chat-1',
    kind: 'calendar_item_patch',
    createdAt: 1800000000000,
    summary: '自动顺延',
    visibility: 'derived_public',
    payload,
  };
}

describe('worldCalendarPatchPresentation', () => {
  it('identifies auto calendar patch events by source', () => {
    const autoEvent = calendarPatchEvent({ source: 'world_calendar_patch_executor' });
    const manualEvent = calendarPatchEvent({ source: 'manual' });
    expect(isAutoCalendarPatchEvent(autoEvent)).toBe(true);
    expect(isAutoCalendarPatchEvent(manualEvent)).toBe(false);
  });

  it('builds zh timeline title/summary/chips', () => {
    const event = calendarPatchEvent({
      source: 'world_calendar_patch_executor',
      calendarItemId: 'item-20260101-abcdef',
      basedOnItemId: 'item-anchor-001',
      idempotencyKey: 'calendar-patch:key:abcdef',
      startAt: 1800003600000,
    });
    expect(buildCalendarPatchTimelineTitle(event, true)).toBe('日历冲突自动修正');
    const summary = buildCalendarPatchSummary(event, true);
    expect(summary).toContain('自动冲突修正');
    expect(summary).toContain('开始');
    expect(summary).not.toContain('item-20260101-abcdef');
    expect(summary).not.toContain('item-anchor-001');
    const chips = buildCalendarPatchDebugChips(event, true);
    expect(chips[0]).toBe('自动修正');
    expect(chips.join(' · ')).not.toContain('目标');
    expect(chips.join(' · ')).not.toContain('item-anchor-001');
  });

  it('sanitizes patch reason text in summary', () => {
    const uuid = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
    const event = calendarPatchEvent({
      source: 'world_calendar_patch_executor',
      startAt: 1800003600000,
      reason: `${uuid} {"eventType":"room_state_snapshot_v2"} relationship ledger has become salient`,
    });
    const summary = buildCalendarPatchSummary(event, true);
    expect(summary).not.toContain(uuid);
    expect(summary).not.toContain('eventType');
    expect(summary).toContain('系统事件');
    expect(summary).toContain('关系账本中的变化已经足够显著');
  });
});
