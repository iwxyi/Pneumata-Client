import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPANIONSHIP_SETTINGS } from '../types/settings';
import { isWithinCompanionshipQuietHours, shouldShowCompanionshipStatusHints } from './companionshipStatusVisibility';

function atLocalTime(hours: number, minutes = 0) {
  const date = new Date(2026, 5, 9, hours, minutes, 0, 0);
  return date.getTime();
}

describe('companionshipStatusVisibility', () => {
  it('detects overnight companionship quiet hours', () => {
    const settings = {
      ...DEFAULT_COMPANIONSHIP_SETTINGS,
      quietHours: { ...DEFAULT_COMPANIONSHIP_SETTINGS.quietHours, enabled: true, start: '23:30', end: '08:00', suppressStatusHints: true },
    };

    expect(isWithinCompanionshipQuietHours(settings, atLocalTime(23, 45))).toBe(true);
    expect(isWithinCompanionshipQuietHours(settings, atLocalTime(7, 59))).toBe(true);
    expect(isWithinCompanionshipQuietHours(settings, atLocalTime(8, 0))).toBe(false);
    expect(isWithinCompanionshipQuietHours(settings, atLocalTime(12, 0))).toBe(false);
  });

  it('detects same-day companionship quiet hours', () => {
    const settings = {
      ...DEFAULT_COMPANIONSHIP_SETTINGS,
      quietHours: { ...DEFAULT_COMPANIONSHIP_SETTINGS.quietHours, enabled: true, start: '12:00', end: '14:00', suppressStatusHints: true },
    };

    expect(isWithinCompanionshipQuietHours(settings, atLocalTime(12, 30))).toBe(true);
    expect(isWithinCompanionshipQuietHours(settings, atLocalTime(14, 0))).toBe(false);
  });

  it('hides status hints only when the quiet-hour display suppression is enabled', () => {
    const base = {
      ...DEFAULT_COMPANIONSHIP_SETTINGS,
      showStatusHints: true,
      quietHours: { ...DEFAULT_COMPANIONSHIP_SETTINGS.quietHours, enabled: true, start: '23:30', end: '08:00', suppressStatusHints: true },
    };

    expect(shouldShowCompanionshipStatusHints(base, atLocalTime(23, 45))).toBe(false);
    expect(shouldShowCompanionshipStatusHints({
      ...base,
      quietHours: { ...base.quietHours, suppressStatusHints: false },
    }, atLocalTime(23, 45))).toBe(true);
  });

  it('respects the global status hint switch outside quiet hours', () => {
    expect(shouldShowCompanionshipStatusHints({
      ...DEFAULT_COMPANIONSHIP_SETTINGS,
      showStatusHints: false,
      quietHours: { ...DEFAULT_COMPANIONSHIP_SETTINGS.quietHours, enabled: false, start: '23:30', end: '08:00', suppressStatusHints: true },
    }, atLocalTime(12, 0))).toBe(false);
  });
});
