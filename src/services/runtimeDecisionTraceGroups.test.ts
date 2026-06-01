import { describe, expect, it } from 'vitest';
import type { RuntimeDecisionTraceItem } from './runtimeDecisionTrace';
import { buildDecisionReasonGroups } from './runtimeDecisionTraceGroups';

function buildTrace(overrides: Partial<RuntimeDecisionTraceItem> = {}): RuntimeDecisionTraceItem {
  return {
    messageId: 'msg-1',
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

describe('runtimeDecisionTraceGroups', () => {
  it('maps runtime clue sections to visible groups with status semantics', () => {
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
          statusHint: '旧档进入本轮上下文',
          items: ['召回对象：灰太狼', '旧档注入：雨夜失约'],
        },
        {
          key: 'guidance_execution',
          label: '引导执行',
          promptLabel: '引导执行',
          statusKind: 'debug_explanation',
          statusLabel: '需排查',
          statusHint: '未先接住显式请求',
          items: ['状态：重试后仍偏航'],
        },
        {
          key: 'feedback',
          label: '反馈',
          promptLabel: '表达反馈',
          statusKind: 'applied_signal',
          statusLabel: '已影响',
          statusHint: '反馈已影响本轮表达',
          items: ['控制长度'],
        },
      ],
    });

    const groups = buildDecisionReasonGroups(trace);
    expect(groups.map((group) => group.key)).toEqual(['speaker', 'clue:memory', 'clue:guidance_execution', 'clue:feedback']);
    expect(groups[1]).toMatchObject({
      label: '记忆',
      statusLabel: '本轮注入',
      tone: 'rgba(255, 152, 0, 0.08)',
    });
    expect(groups[2]).toMatchObject({
      label: '引导执行',
      statusLabel: '需排查',
      tone: 'rgba(244, 67, 54, 0.08)',
    });
    expect(groups[3]).toMatchObject({
      label: '反馈',
      statusLabel: '已影响',
      tone: 'rgba(46, 125, 50, 0.08)',
    });
  });

  it('sanitizes member ids in group content and hints', () => {
    const memberId = '3c78729f-e52d-4dde-b27f-01a949960bb8';
    const trace = buildTrace({
      runtimeClueSections: [
        {
          key: 'guidance',
          label: '用户引导',
          promptLabel: '用户引导',
          statusKind: 'debug_explanation',
          statusLabel: '调度输入',
          statusHint: '用于解释用户输入影响',
          items: [`执行角色：${memberId}`, '图片对象：灰太狼'],
        },
      ],
    });
    const groups = buildDecisionReasonGroups(trace, [{ id: memberId, name: '喜羊羊' }]);
    expect(groups[0]?.items.join(' / ')).toContain('喜羊羊');
    expect(groups[0]?.items.join(' / ')).not.toContain(memberId);
    expect(groups[0]?.hint).toContain('喜羊羊');
    expect(groups[0]?.hint).not.toContain(memberId);
  });

  it('adds execution relation group when execution and speaker diverge', () => {
    const groups = buildDecisionReasonGroups(buildTrace({
      executionRelationLabel: '执行目标 甲 · 实际发言 乙',
      rawExecutionRelation: 'targets=a speaker=b matched=no',
    }));
    expect(groups.map((group) => group.key)).toContain('execution');
    const execution = groups.find((group) => group.key === 'execution');
    expect(execution?.label).toBe('执行与发言');
    expect(execution?.items[0]).toBe('执行目标 甲 · 实际发言 乙');
  });
});
