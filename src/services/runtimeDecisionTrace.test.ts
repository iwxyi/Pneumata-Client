import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { formatSpeakerScoreReason, projectRuntimeDecisionTrace, summarizeLatestRuntimeDecision } from './runtimeDecisionTrace';

function buildMessage(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm1',
    chatId: 'chat-1',
    type: patch.type || 'ai',
    senderId: patch.senderId || 'a',
    senderName: patch.senderName || '甲',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
    metadata: patch.metadata,
  };
}

describe('runtimeDecisionTrace', () => {
  it('projects compact decision traces from message metadata', () => {
    const traces = projectRuntimeDecisionTrace([
      buildMessage({ id: 'm1', timestamp: 1, metadata: undefined }),
      buildMessage({
        id: 'm2',
        senderName: '乙',
        timestamp: 2,
        metadata: {
          runtimeDecision: {
            directorIntent: { source: 'conflict', beatType: 'challenge', pressure: 0.82, reason: '矛盾升温' },
            narrativeLines: [{ id: 'conflict-1', type: 'conflict', title: '当前矛盾', salience: 0.91, tension: 0.8, status: 'escalating' }],
            speakerScore: { actorId: 'b', finalScore: 1.234, reasons: ['conflict', 'director:challenge:target'] },
          },
        },
      }),
    ]);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      messageId: 'm2',
      senderName: '乙',
      directorLabel: '矛盾 · 挑战 · 压力 0.82',
      rawDirector: 'conflict/challenge · 0.82 · 矛盾升温',
      primaryLine: 'conflict:当前矛盾 · 显著 0.91',
      primaryLineLabel: '矛盾线 · 当前矛盾 · 显著 0.91',
      rawPrimaryLine: 'conflict:当前矛盾 · 显著 0.91',
      score: '得分 1.23',
      reasons: ['conflict', 'director:challenge:target'],
      reasonLabels: ['卷入当前矛盾', '适合挑战当前目标'],
      rawReasons: ['conflict', 'director:challenge:target'],
    });
  });

  it('summarizes the latest runtime decision', () => {
    const summary = summarizeLatestRuntimeDecision([
      buildMessage({
        id: 'm2',
        timestamp: 2,
        senderName: '乙',
        metadata: {
          runtimeDecision: {
            directorIntent: { source: 'topic', beatType: 'invite', pressure: 0.34, reason: '继续话题' },
            speakerScore: { actorId: 'b', finalScore: 0.8, reasons: [] },
          },
        },
      }),
    ]);
    expect(summary).toContain('乙');
    expect(summary).toContain('话题 · 邀请');
  });

  it('formats known speaker score reasons into readable labels', () => {
    expect(formatSpeakerScoreReason('pending_reply')).toBe('有待回应对象');
    expect(formatSpeakerScoreReason('director:answer:target')).toBe('被点名回应');
    expect(formatSpeakerScoreReason('director:escalate:opposition')).toBe('与目标存在对立，适合升级');
    expect(formatSpeakerScoreReason('unknown_code')).toBe('unknown_code');
  });

  it('keeps readable reason labels available for advanced runtime panels', () => {
    const [trace] = projectRuntimeDecisionTrace([
      buildMessage({
        id: 'm3',
        timestamp: 3,
        senderName: '丙',
        metadata: {
          runtimeDecision: {
            speakerScore: {
              actorId: 'c',
              finalScore: 0.9,
              reasons: ['relationship', 'director:defend:relationship', 'director:cool_down:empathy'],
            },
          },
        },
      }),
    ]);

    expect(trace.rawReasons).toEqual(['relationship', 'director:defend:relationship', 'director:cool_down:empathy']);
    expect(trace.reasonLabels).toEqual(['关系压力较高', '适合维护相关对象', '共情较高，适合降温']);
  });
});
