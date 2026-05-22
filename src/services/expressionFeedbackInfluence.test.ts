import { describe, expect, it } from 'vitest';
import type { MemoryItem } from './memoryTypes';
import { summarizeExpressionFeedbackInfluence } from './expressionFeedbackInfluence';

function memory(id: string, text: string, patch: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    scope: 'character_self',
    layer: 'working',
    kind: 'trait_evidence',
    ownerId: 'a',
    text,
    salience: 0.7,
    confidence: 0.75,
    recency: 0.8,
    reinforcementCount: 1,
    sourceEventIds: [id],
    sourceTag: 'expression_feedback',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe('summarizeExpressionFeedbackInfluence', () => {
  it('groups expression feedback and increases strength with recurrence', () => {
    const [single] = summarizeExpressionFeedbackInfluence([
      memory('a', '用户反馈：这类回复偏长，后续应更克制'),
    ]);
    const [repeated] = summarizeExpressionFeedbackInfluence([
      memory('a', '用户反馈：这类回复偏长，后续应更克制'),
      memory('b', '用户反馈：这类回复太长，更像即时聊天', { updatedAt: 2 }),
    ]);

    expect(single).toMatchObject({ category: 'too_long', label: '控制长度', count: 1 });
    expect(repeated).toMatchObject({ category: 'too_long', label: '控制长度', count: 2 });
    expect(repeated.strength).toBeGreaterThan(single.strength);
  });

  it('ignores archived or unrelated memories', () => {
    const signals = summarizeExpressionFeedbackInfluence([
      memory('a', '普通长期记忆', { sourceTag: 'interaction' }),
      memory('b', '用户反馈：这类回复太像通用助手', { archivedAt: 3 }),
    ]);

    expect(signals).toEqual([]);
  });

  it('uses positive calibration feedback to offset negative pressure', () => {
    const [negativeOnly] = summarizeExpressionFeedbackInfluence([
      memory('a', '用户反馈：这类回复偏长，后续应更克制'),
    ]);
    const [withPositive] = summarizeExpressionFeedbackInfluence([
      memory('a', '用户反馈：这类回复偏长，后续应更克制'),
      memory('b', '用户反馈：这次长度合适，可作为聊天节奏和展开程度的正向校准', { updatedAt: 2 }),
    ]);

    expect(withPositive.category).toBe('too_long');
    expect(withPositive.negativeCount).toBe(1);
    expect(withPositive.positiveCount).toBe(1);
    expect(withPositive.strength).toBeLessThan(negativeOnly.strength);
  });
});
