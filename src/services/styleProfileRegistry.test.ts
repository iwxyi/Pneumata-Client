import { describe, expect, it } from 'vitest';
import { getStyleProfile, resolveDefaultStyleProfile } from './styleProfileRegistry';

describe('styleProfileRegistry', () => {
  it('resolves scenario default style profiles', () => {
    expect(resolveDefaultStyleProfile({ scenarioId: 'group-discussion' })).toBe('analytical_room');
    expect(resolveDefaultStyleProfile({ scenarioId: 'open-chat' })).toBe('casual_room');
    expect(resolveDefaultStyleProfile({ scenarioId: 'direct-chat' })).toBe('companion_room');
  });

  it('returns prompt context for the resolved style profile', () => {
    const profile = getStyleProfile('analytical_room');
    expect(profile?.promptContext.responseStyle).toBe('professional');
    expect(profile?.promptContext.additionalConstraints?.[0]).toContain('tradeoffs');
  });
});
