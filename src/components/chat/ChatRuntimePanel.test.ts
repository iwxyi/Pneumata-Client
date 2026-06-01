import { describe, expect, it } from 'vitest';
import type { RuntimeDecisionTraceItem } from '../../services/runtimeDecisionTrace';
import { buildDecisionReasonGroups } from '../../services/runtimeDecisionTraceGroups';

function buildTrace(overrides: Partial<RuntimeDecisionTraceItem> = {}): RuntimeDecisionTraceItem {
  return {
    messageId: 'm-1',
    timestamp: 1,
    senderId: 'a',
    senderName: '甲',
    director: 'none',
    directorLabel: '无调度意图',
    rawDirector: 'none',
    primaryLine: null,
    primaryLineLabel: null,
    rawPrimaryLine: null,
    score: null,
    reasons: [],
    reasonLabels: [],
    rawReasons: [],
    innerLifeLabel: null,
    innerLifeReason: null,
    innerLifeEvidence: [],
    innerLifeState: null,
    expressionLabel: null,
    expressionReasons: [],
    expressionFeedbackRetrievedLabels: [],
    expressionFeedbackAppliedLabels: [],
    expressionFeedbackRetrievedReasons: [],
    expressionFeedbackAppliedReasons: [],
    rawExpression: null,
    surfaceLabel: null,
    surfaceBasis: [],
    rawSurface: null,
    executionRelationLabel: null,
    rawExecutionRelation: null,
    debugDetailLabel: null,
    rawDebugHint: null,
    runtimeClueSections: [],
    ...overrides,
  };
}

describe('ChatRuntimePanel decision reason groups', () => {
  it('builds groups directly from runtime clue sections with status labels', () => {
    const trace = buildTrace({
      reasonLabels: ['卷入当前矛盾'],
      rawReasons: ['conflict'],
      runtimeClueSections: [
        {
          key: 'memory',
          label: '记忆',
          promptLabel: '记忆线索',
          statusKind: 'prompt_context',
          statusLabel: '本轮注入',
          statusHint: '旧档进入 prompt',
          items: ['召回对象：灰太狼', '旧档注入：雨夜失约'],
        },
        {
          key: 'guidance_execution',
          label: '引导执行',
          promptLabel: '引导执行',
          statusKind: 'debug_explanation',
          statusLabel: '需排查',
          statusHint: '没有先接住请求',
          items: ['状态：重试后仍偏航'],
        },
        {
          key: 'feedback',
          label: '反馈',
          promptLabel: '表达反馈',
          statusKind: 'applied_signal',
          statusLabel: '已影响',
          statusHint: '反馈实际影响了本轮',
          items: ['控制长度'],
        },
      ],
    });

    const groups = buildDecisionReasonGroups(trace);
    expect(groups.map((group) => group.key)).toEqual(['speaker', 'clue:memory', 'clue:guidance_execution', 'clue:feedback']);
    expect(groups.find((group) => group.key === 'clue:memory')).toMatchObject({
      label: '记忆',
      statusLabel: '本轮注入',
    });
    expect(groups.find((group) => group.key === 'clue:guidance_execution')).toMatchObject({
      statusLabel: '需排查',
      tone: 'rgba(244, 67, 54, 0.08)',
    });
    expect(groups.find((group) => group.key === 'clue:feedback')).toMatchObject({
      statusLabel: '已影响',
      tone: 'rgba(46, 125, 50, 0.08)',
    });
  });
});
