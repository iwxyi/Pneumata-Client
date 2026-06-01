import { describe, expect, it } from 'vitest';
import type { WorldCalendarItem } from './worldRuntimeProjection';
import {
  buildMonthDayChips,
  filterAndSortCalendarItems,
  getMonthStart,
  groupCalendarItemsByDay,
  startOfDay,
} from './worldCalendarViewModel';

function makeItem(input: Partial<WorldCalendarItem> & Pick<WorldCalendarItem, 'id' | 'title' | 'summary'>): WorldCalendarItem {
  return {
    id: input.id,
    kind: input.kind || 'activity',
    status: input.status || 'planned',
    title: input.title,
    summary: input.summary,
    participantIds: input.participantIds || [],
    participantStates: input.participantStates || {},
    participantNames: input.participantNames || [],
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    durationMinutes: input.durationMinutes ?? null,
    timeHint: input.timeHint ?? null,
    locationHint: input.locationHint ?? null,
    sourceRefs: input.sourceRefs || [],
    conflict: input.conflict ?? null,
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

describe('worldCalendarViewModel', () => {
  it('filters by status and actor then sorts by startAt', () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    const items = [
      makeItem({
        id: 'b',
        title: 'B',
        summary: 'B',
        startAt: now + 2 * 3600_000,
        status: 'planned',
        participantIds: ['char-1'],
      }),
      makeItem({
        id: 'a',
        title: 'A',
        summary: 'A',
        startAt: now + 1 * 3600_000,
        status: 'planned',
        participantIds: ['char-1'],
      }),
      makeItem({
        id: 'c',
        title: 'C',
        summary: 'C',
        startAt: now - 1 * 3600_000,
        endAt: now - 30 * 60_000,
        status: 'completed',
        participantIds: ['char-2'],
      }),
    ];

    const result = filterAndSortCalendarItems({
      items,
      actorId: 'char-1',
      kindFilter: 'all',
      statusFilter: 'upcoming',
      selectedDayStart: null,
      now,
    });

    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('groups items by day', () => {
    const day1 = Date.UTC(2026, 5, 1, 9, 0, 0);
    const day2 = Date.UTC(2026, 5, 2, 9, 0, 0);
    const items = [
      makeItem({ id: 'a', title: 'A', summary: 'A', startAt: day1 }),
      makeItem({ id: 'b', title: 'B', summary: 'B', startAt: day2 }),
      makeItem({ id: 'c', title: 'C', summary: 'C', startAt: day1 + 3600_000 }),
    ];
    const grouped = groupCalendarItemsByDay(items);
    expect(grouped.length).toBe(2);
    expect(grouped[0].dayStart).toBe(startOfDay(day1));
    expect(grouped[0].items.map((item) => item.id)).toEqual(['a', 'c']);
    expect(grouped[1].dayStart).toBe(startOfDay(day2));
  });

  it('builds month day chips with per-day event counts', () => {
    const monthStart = getMonthStart(Date.UTC(2026, 5, 15));
    const items = [
      makeItem({ id: 'a', title: 'A', summary: 'A', startAt: Date.UTC(2026, 5, 3, 10, 0, 0) }),
      makeItem({ id: 'b', title: 'B', summary: 'B', startAt: Date.UTC(2026, 5, 3, 15, 0, 0) }),
      makeItem({ id: 'c', title: 'C', summary: 'C', startAt: Date.UTC(2026, 5, 20, 9, 0, 0) }),
      makeItem({ id: 'x', title: 'X', summary: 'X', startAt: Date.UTC(2026, 6, 1, 9, 0, 0) }),
    ];

    const chips = buildMonthDayChips({ items, visibleMonthStart: monthStart });
    expect(chips.length).toBe(30);
    expect(chips[2].day).toBe(3);
    expect(chips[2].count).toBe(2);
    expect(chips[19].day).toBe(20);
    expect(chips[19].count).toBe(1);
  });
});
