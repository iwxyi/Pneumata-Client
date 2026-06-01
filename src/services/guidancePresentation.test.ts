import { describe, expect, it } from 'vitest';
import { formatGuidanceExecutionReasonLabel, formatGuidanceExecutionStatusLabel, formatGuidanceKindLabel } from './guidancePresentation';

describe('guidancePresentation', () => {
  it('formats guidance kind/status/reason labels with centralized mapping', () => {
    expect(formatGuidanceKindLabel('topic_shift')).toBe('话题引导');
    expect(formatGuidanceKindLabel('direct_reply')).toBe('点名回应');
    expect(formatGuidanceExecutionStatusLabel('accepted_after_retry')).toBe('重试后执行');
    expect(formatGuidanceExecutionReasonLabel('missing_question_answer')).toBe('没有先回答新问题');
  });

  it('falls back to original token for unknown enums', () => {
    expect(formatGuidanceKindLabel('custom_kind')).toBe('custom_kind');
    expect(formatGuidanceExecutionStatusLabel('pending')).toBe('pending');
    expect(formatGuidanceExecutionReasonLabel('unknown_reason')).toBe('unknown_reason');
  });
});
