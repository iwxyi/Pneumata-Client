import type { CompanionshipSettings } from '../types/settings';

function parseClockMinutes(value: string | undefined | null) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isWithinCompanionshipQuietHours(settings: CompanionshipSettings, now = Date.now()) {
  if (!settings.quietHours.enabled) return false;
  const start = parseClockMinutes(settings.quietHours.start);
  const end = parseClockMinutes(settings.quietHours.end);
  if (start == null || end == null || start === end) return false;
  const date = new Date(now);
  const current = date.getHours() * 60 + date.getMinutes();
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function shouldShowCompanionshipStatusHints(settings: CompanionshipSettings, now = Date.now()) {
  if (!settings.showStatusHints) return false;
  if (settings.quietHours.suppressStatusHints && isWithinCompanionshipQuietHours(settings, now)) return false;
  return true;
}
