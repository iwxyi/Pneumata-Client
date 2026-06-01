import { describe, expect, it } from 'vitest';
import { formatRuntimeEventKindLabel, formatSocialEventKindLabel } from './runtimeEventPresentation';

describe('runtimeEventPresentation', () => {
  it('formats runtime event kind labels in zh/en', () => {
    expect(formatRuntimeEventKindLabel('event_candidate', 'zh')).toBe('事件候选');
    expect(formatRuntimeEventKindLabel('event_candidate', 'en')).toBe('Event candidate');
  });

  it('formats social event labels and supports new kinds', () => {
    expect(formatSocialEventKindLabel('check_in', 'zh')).toBe('问候跟进');
    expect(formatSocialEventKindLabel('react_to_moment', 'zh')).toBe('动态回应');
    expect(formatSocialEventKindLabel('check_in', 'en')).toBe('Check-in');
  });

  it('falls back to original token for unknown kinds', () => {
    expect(formatRuntimeEventKindLabel('unknown_kind', 'zh')).toBe('unknown_kind');
    expect(formatSocialEventKindLabel('unknown_kind', 'zh')).toBe('unknown_kind');
  });
});
