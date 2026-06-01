import { formatGuidanceExecutionStatusLabel } from './guidancePresentation';

export type RuntimeStatusKind = 'prompt_context' | 'debug_explanation' | 'soft_signal' | 'applied_signal';

export function formatGuidanceInputStatusLabel(kind: string | undefined) {
  return kind === 'media_request' ? '显式请求' : '调度输入';
}

export function formatFeedbackStatusLabel(applied: boolean) {
  return applied ? '已影响' : '已检索';
}

export function resolveGuidanceExecutionStatus(
  execution: {
    status?: string;
    validated?: boolean;
  } | null | undefined,
): { statusKind: RuntimeStatusKind; statusLabel: string; statusHint: string; shouldWarn: boolean } {
  const statusLabel = execution?.status
    ? formatGuidanceExecutionStatusLabel(execution.status)
    : execution?.validated
      ? '已执行'
      : '需排查';
  if (execution?.validated) {
    return {
      statusKind: 'applied_signal',
      statusLabel,
      statusHint: '用户显式要求已被本轮执行；若发生重试，仍以最终通过为准。',
      shouldWarn: false,
    };
  }
  return {
    statusKind: 'debug_explanation',
    statusLabel,
    statusHint: '用户显式要求尚未通过校验，需要排查偏航、角色错位或媒体动作缺失。',
    shouldWarn: true,
  };
}
