import type { WorldCalendarItem } from './worldRuntimeProjection';

export type CalendarKindFilter = 'all' | 'activity' | 'travel' | 'reminder';
export type CalendarStatusFilter = 'all' | 'upcoming' | 'in_progress' | 'completed' | 'cancelled';

export function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getMonthStart(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function filterAndSortCalendarItems(input: {
  items: WorldCalendarItem[];
  actorId?: string | null;
  kindFilter: CalendarKindFilter;
  statusFilter: CalendarStatusFilter;
  selectedDayStart?: number | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const withKind = input.kindFilter === 'all'
    ? input.items
    : input.items.filter((item) => item.kind === input.kindFilter);
  const withActor = withKind.filter((item) => !input.actorId || item.participantIds.includes(input.actorId));
  const withStatus = withActor.filter((item) => {
    if (input.statusFilter === 'all') return true;
    if (input.statusFilter === 'completed') return item.status === 'completed';
    if (input.statusFilter === 'cancelled') return item.status === 'cancelled';
    if (input.statusFilter === 'in_progress') return item.status === 'in_progress';
    if (input.statusFilter === 'upcoming') {
      if (item.status === 'completed' || item.status === 'cancelled') return false;
      if (typeof item.endAt === 'number') return item.endAt >= now;
      if (typeof item.startAt === 'number') return item.startAt >= now;
      return true;
    }
    return true;
  });
  const withDay = withStatus.filter((item) => {
    if (input.selectedDayStart == null) return true;
    return startOfDay(item.startAt ?? item.updatedAt) === input.selectedDayStart;
  });
  return [...withDay].sort((a, b) => (a.startAt ?? a.updatedAt) - (b.startAt ?? b.updatedAt));
}

export function groupCalendarItemsByDay(items: WorldCalendarItem[]) {
  const groups = new Map<number, WorldCalendarItem[]>();
  items.forEach((item) => {
    const key = startOfDay(item.startAt ?? item.updatedAt);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  });
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayStart, grouped]) => ({ dayStart, items: grouped }));
}

export function buildMonthDayChips(input: {
  items: WorldCalendarItem[];
  visibleMonthStart: number;
}) {
  const monthDate = new Date(input.visibleMonthStart);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const counts = new Map<number, number>();
  input.items.forEach((item) => {
    const dayStart = startOfDay(item.startAt ?? item.updatedAt);
    const dayDate = new Date(dayStart);
    if (dayDate.getFullYear() !== year || dayDate.getMonth() !== month) return;
    counts.set(dayStart, (counts.get(dayStart) || 0) + 1);
  });
  return Array.from({ length: daysInMonth }, (_, index) => {
    const dayStart = startOfDay(new Date(year, month, index + 1).getTime());
    return {
      dayStart,
      day: index + 1,
      week: new Date(dayStart).getDay(),
      count: counts.get(dayStart) || 0,
    };
  });
}
