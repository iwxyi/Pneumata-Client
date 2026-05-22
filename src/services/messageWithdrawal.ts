import type { Message, MessageMetadata } from '../types/message';

export function buildWithdrawnNotice(senderName: string, language = 'zh') {
  return language.startsWith('en')
    ? `${senderName} withdrew a message`
    : `${senderName}撤回了一条消息`;
}

export function shouldAutoWithdrawMessage(params: {
  metadata?: MessageMetadata;
  random?: () => number;
}) {
  const innerLife = params.metadata?.runtimeDecision?.innerLife;
  if (!innerLife?.expressionPlan?.allowWithdraw) return false;
  const state = innerLife.state || {};
  const impulse = innerLife.impulse;
  const pressure = innerLife.pressure || 0;
  const shame = state.shame || 0;
  const repression = state.repression || 0;
  const riskyImpulse = impulse === 'repair' || impulse === 'defend_face' || impulse === 'mock' || impulse === 'avoid';
  if (!riskyImpulse && shame < 62 && repression < 64) return false;

  const chance = Math.min(0.36, 0.08 + pressure * 0.16 + Math.max(0, shame - 55) / 260 + Math.max(0, repression - 55) / 300);
  return (params.random || Math.random)() < chance;
}

export function withWithdrawnMessage<T extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'>>(message: T, options?: {
  reason?: string;
  withdrawnAt?: number;
  language?: string;
}): T {
  const originalContent = message.metadata?.withdrawal?.originalContent || message.content;
  return {
    ...message,
    content: buildWithdrawnNotice(message.senderName, options?.language),
    metadata: {
      ...(message.metadata || {}),
      withdrawal: {
        withdrawn: true,
        originalContent,
        reason: options?.reason,
        withdrawnAt: options?.withdrawnAt || Date.now(),
      },
    },
  };
}

export function maybeAutoWithdrawMessage<T extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'>>(message: T, options?: {
  random?: () => number;
  now?: number;
  language?: string;
}): T {
  if (!shouldAutoWithdrawMessage({ metadata: message.metadata, random: options?.random })) return message;
  return withWithdrawnMessage(message, {
    reason: message.metadata?.runtimeDecision?.innerLife?.reason,
    withdrawnAt: options?.now,
    language: options?.language,
  });
}
