import { describe, expect, it } from 'vitest';
import type { InteractionEventPayload } from '../types/runtimeEvent';
import { calculateRoomShift } from './roomStateSynthesizer';

function buildInteraction(overrides: Partial<InteractionEventPayload> = {}): InteractionEventPayload {
  return {
    kind: 'challenge',
    actorId: 'a',
    targetId: 'b',
    intensity: 4,
    tone: 'annoyed',
    evidenceText: '你刚才那个判断前后矛盾。',
    confidence: 0.9,
    ...overrides,
  };
}

describe('roomStateSynthesizer', () => {
  it('tracks dominant thread and silenced actors for conflict', () => {
    const { nextState } = calculateRoomShift(null, buildInteraction());
    expect(nextState.dominantThread).toEqual(['a', 'b']);
    expect(nextState.silencedActors).toContain('b');
    expect(nextState.conflictPairs).toContainEqual(['a', 'b']);
  });

  it('tracks alliances for supportive interactions', () => {
    const { nextState } = calculateRoomShift(null, buildInteraction({ kind: 'support', tone: 'warm' }));
    expect(nextState.alliances).toContainEqual(['a', 'b']);
    expect(nextState.cohesion).toBeGreaterThan(50);
  });

  it('keeps pile-on target when conflicts continue', () => {
    const first = calculateRoomShift(null, buildInteraction({ kind: 'pile_on' })).nextState;
    const second = calculateRoomShift(first, buildInteraction({ actorId: 'c', kind: 'challenge' })).nextState;
    expect(second.pileOnTarget).toBe('b');
  });
});
