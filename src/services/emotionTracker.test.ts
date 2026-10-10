import { describe, expect, it } from 'vitest';
import { collectModelEmotionDeltas, updateEmotionFromModelDelta } from './emotionTracker';

describe('updateEmotionFromModelDelta', () => {
  it('does not infer or decay emotion when the model supplied no affect delta', () => {
    expect(updateEmotionFromModelDelta(0.6)).toBe(0.6);
    expect(updateEmotionFromModelDelta(-0.2, {})).toBe(-0.2);
  });

  it('maps model-authored positive and negative affect axes to the scalar direction', () => {
    expect(updateEmotionFromModelDelta(0, { affection: 40 })).toBeCloseTo(0.3);
    expect(updateEmotionFromModelDelta(0, { irritation: 40 })).toBeCloseTo(-0.3);
    expect(updateEmotionFromModelDelta(0, { embarrassment: -20 })).toBeCloseTo(0.15);
  });

  it('combines conflicting axes without treating message wording as evidence', () => {
    expect(updateEmotionFromModelDelta(0, { excitement: 20, insecurity: 20 })).toBe(0);
  });

  it('retains prior mood as momentum while applying a smaller model signal', () => {
    expect(updateEmotionFromModelDelta(0.5, { irritation: 8 })).toBeCloseTo(0.29);
  });

  it('keeps speaker and directed target affect isolated from uninvolved members', () => {
    const updates = collectModelEmotionDeltas('speaker', [
      {
        actorId: 'speaker', targetId: 'target', kind: 'challenge', tone: 'annoyed',
        intensity: 3, confidence: 0.9, evidenceText: 'line',
        immediateImpact: { speakerEmotionDelta: { irritation: 10 }, targetEmotionDelta: { embarrassment: 18 } },
      },
    ], { affection: 6 });

    expect(updates.get('speaker')).toEqual({ irritation: 10, affection: 6 });
    expect(updates.get('target')).toEqual({ embarrassment: 18 });
    expect(updates.has('uninvolved')).toBe(false);
  });
});
