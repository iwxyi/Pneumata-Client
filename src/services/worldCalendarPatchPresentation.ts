import type { RuntimeEventV2 } from '../types/runtimeEvent';

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatPatchStartAt(startAt: number | null, isZh: boolean) {
  if (typeof startAt !== 'number') return '';
  const label = isZh ? '开始' : 'Start';
  return `${label} ${new Date(startAt).toLocaleString()}`;
}

export function isAutoCalendarPatchEvent(event: RuntimeEventV2) {
  if (event.kind !== 'calendar_item_patch') return false;
  const payload = event.payload as Record<string, unknown>;
  return readString(payload.source) === 'world_calendar_patch_executor';
}

export function buildCalendarPatchTimelineTitle(event: RuntimeEventV2, isZh: boolean) {
  return isAutoCalendarPatchEvent(event)
    ? (isZh ? '日历冲突自动修正' : 'Calendar auto-fix')
    : (isZh ? '日历更新' : 'Calendar patch');
}

export function buildCalendarPatchSummary(event: RuntimeEventV2, isZh: boolean) {
  const payload = event.payload as Record<string, unknown>;
  const startAt = readNumber(payload.startAt);
  const reason = readString(payload.reason) || readString(payload.summary) || readString(event.summary);
  const mode = isAutoCalendarPatchEvent(event)
    ? (isZh ? '自动冲突修正' : 'Auto conflict fix')
    : (isZh ? '日历更新' : 'Calendar update');
  const parts = [
    mode,
    formatPatchStartAt(startAt, isZh),
    reason ? (isZh ? `说明 ${reason}` : `Reason ${reason}`) : '',
  ].filter(Boolean);
  return parts.join(' · ') || mode;
}

export function buildCalendarPatchDebugChips(event: RuntimeEventV2, isZh: boolean) {
  const payload = event.payload as Record<string, unknown>;
  const hasStartPatch = typeof readNumber(payload.startAt) === 'number';
  const hasEndPatch = typeof readNumber(payload.endAt) === 'number';
  const hasParticipantPatch = Boolean(readString(payload.participantState) || readString(payload.participantId))
    || Array.isArray(payload.addParticipantIds)
    || Array.isArray(payload.removeParticipantIds);
  return [
    isAutoCalendarPatchEvent(event) ? (isZh ? '自动修正' : 'Auto') : (isZh ? '手动修正' : 'Manual'),
    hasStartPatch ? (isZh ? '开始时间' : 'Start time') : '',
    hasEndPatch ? (isZh ? '结束时间' : 'End time') : '',
    hasParticipantPatch ? (isZh ? '参与者' : 'Participants') : '',
  ].filter(Boolean);
}
