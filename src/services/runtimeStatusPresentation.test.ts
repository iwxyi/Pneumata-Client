import { describe, expect, it } from 'vitest';
import { formatFeedbackStatusLabel, formatGuidanceInputStatusLabel, resolveGuidanceExecutionStatus } from './runtimeStatusPresentation';

describe('runtimeStatusPresentation', () => {
  it('formats guidance input labels', () => {
    expect(formatGuidanceInputStatusLabel('media_request')).toBe('显式请求');
    expect(formatGuidanceInputStatusLabel('topic_shift')).toBe('调度输入');
  });

  it('formats feedback status labels', () => {
    expect(formatFeedbackStatusLabel(false)).toBe('已检索');
    expect(formatFeedbackStatusLabel(true)).toBe('已影响');
  });

  it('resolves guidance execution status semantics', () => {
    expect(resolveGuidanceExecutionStatus({ status: 'accepted_after_retry', validated: true })).toMatchObject({
      statusKind: 'applied_signal',
      statusLabel: '重试后执行',
      shouldWarn: false,
    });
    expect(resolveGuidanceExecutionStatus({ status: 'failed_after_retry', validated: false })).toMatchObject({
      statusKind: 'debug_explanation',
      statusLabel: '重试后仍偏航',
      shouldWarn: true,
    });
  });
});
