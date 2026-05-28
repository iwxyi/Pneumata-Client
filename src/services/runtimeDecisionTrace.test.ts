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
            innerLife: {
              impulse: 'show_off',
              tone: 'casual',
              reason: '想证明自己',
              pressure: 0.64,
              expressionPlan: {
                length: 'normal',
                messageCount: 2,
                typoLevel: 1,
                delayMs: 1600,
                allowWithdraw: false,
              },
            },
            responseSurface: {
              kind: 'professional',
              allowMarkdown: true,
              preserveParagraphs: true,
              roleFit: 'capable',
              basis: ['mode:interview', 'topic:professional-task', 'role:capable'],
            },
            memoryContext: {
              recalledArchives: [{
                id: 'archive-1',
                scope: 'relationship',
                kind: 'resentment',
                layer: 'long_term',
                summary: '雨夜失约',
                recallReason: '当前对话提到旧承诺',
              }],
            },
            expressionFeedback: [{
              id: 'fb-1',
              label: '减少助手腔',
              text: '用户反馈：这类回复太像通用助手',
              evidence: '作为一个AI助手，我建议你',
              kind: 'taboo',
              layer: 'episodic',
              confidence: 0.8,
              applied: true,
              effects: ['提示词加强反助手腔约束'],
            }],
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
      innerLifeLabel: '内在冲动：证明自己 · 随意 · 压力 0.64',
      expressionLabel: '表达 常规 · 2 拍表达倾向 · 富文本',
      expressionReasons: expect.arrayContaining(['内在冲动：证明自己', '语气：随意', '延迟：1600ms', '内心表达计划倾向分成几拍；若模型追加连续气泡，运行态仍按完整回合处理', '输出形态允许 Markdown / 段落保留']),
      expressionFeedbackRetrievedLabels: ['减少助手腔'],
      expressionFeedbackAppliedLabels: ['减少助手腔'],
      expressionFeedbackRetrievedReasons: ['已检索 · 减少助手腔 · 强度 80% · 用户反馈：这类回复太像通用助手 · 证据：作为一个AI助手，我建议你'],
      expressionFeedbackAppliedReasons: ['已影响 · 减少助手腔 · 影响：提示词加强反助手腔约束 · 用户反馈：这类回复太像通用助手'],
      rawExpression: 'normal/count:2/delay:1600/typo:1/withdraw:false',
      surfaceLabel: '专业表达 · 角色能力支持 · Markdown',
      surfaceBasis: ['面试模式', '主题请求专业表达', '角色能力支持长文'],
      rawSurface: 'professional/capable/markdown',
      debugDetailLabel: '调度：矛盾 · 挑战 · 压力 0.82 · 矛盾升温 / 线索：矛盾线 · 当前矛盾 · 显著 0.91 / 表达：专业表达 · 角色能力支持 · Markdown / 节奏：表达 常规 · 2 拍表达倾向 · 富文本',
      rawDebugHint: 'director=conflict/challenge · 0.82 · 矛盾升温 / line=conflict:当前矛盾 · 显著 0.91 / surface=professional/capable/markdown / expression=normal/count:2/delay:1600/typo:1/withdraw:false',
      runtimeClueSections: expect.arrayContaining([
        expect.objectContaining({
          key: 'memory',
          statusLabel: '本轮注入',
          items: expect.arrayContaining(['旧档注入：雨夜失约', '原因：当前对话提到旧承诺']),
        }),
        expect.objectContaining({
          key: 'feedback',
          statusLabel: '已影响',
        }),
      ]),
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
    expect(formatSpeakerScoreReason('emotion:tension')).toBe('情绪后效：想反驳或防备');
    expect(formatSpeakerScoreReason('emotion:warmth')).toBe('情绪后效：想接话或靠近');
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

  it('projects member ids in decision trace labels and runtime clues', () => {
    const memberId = '3c78729f-e52d-4dde-b27f-01a949960bb8b';
    const [trace] = projectRuntimeDecisionTrace([
      buildMessage({
        id: 'm4',
        timestamp: 4,
        senderId: memberId,
        senderName: '喜羊羊',
        metadata: {
          runtimeDecision: {
            directorIntent: { source: 'relationship', beatType: 'defend', pressure: 0.7, reason: `${memberId} 被点名` },
            narrativeLines: [{ id: 'line-1', type: 'relationship', title: `${memberId} 的关系线`, salience: 0.8, tension: 0.3, status: 'active' }],
            speakerScore: { actorId: memberId, finalScore: 0.8, reasons: ['relationship'] },
            memoryContext: {
              recalledArchives: [{
                id: 'archive-1',
                scope: 'relationship',
                kind: 'bond',
                layer: 'long_term',
                summary: `${memberId} 记得旧约定`,
                recallReason: `${memberId} 再次提到旧事`,
              }],
            },
          },
        },
      }),
    ], 1, [{ id: memberId, name: '喜羊羊' }]);

    expect(trace.primaryLineLabel).toContain('喜羊羊 的关系线');
    expect(trace.rawDirector).toContain('喜羊羊 被点名');
    expect(trace.runtimeClueSections.flatMap((section) => section.items).join(' / ')).toContain('喜羊羊 记得旧约定');
    expect(trace.runtimeClueSections.flatMap((section) => section.items).join(' / ')).not.toContain(memberId);
  });
});
