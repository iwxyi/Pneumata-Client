import { describe, expect, it } from 'vitest';
import { buildRuntimeEventMessageContent, parseRuntimeEvent } from './runtimeEventFactory';

describe('runtime event message content', () => {
  it('compacts memory distillation metrics for chat message storage', () => {
    const content = buildRuntimeEventMessageContent({
      eventType: 'memory_distillation',
      title: '记忆蒸馏',
      summary: '完成记忆合并',
      metrics: {
        ownerType: 'character',
        ownerLabel: '角色记忆',
        reasonLabel: '已完成蒸馏',
        mergeModeLabel: '强化合并',
        newEvidenceCount: 3,
        candidateTexts: Array.from({ length: 20 }, (_, index) => `very long evidence ${index}`),
      },
    });

    expect(content).not.toContain('candidateTexts');
    const parsed = parseRuntimeEvent(content);
    expect(parsed?.metrics).toMatchObject({
      ownerType: 'character',
      ownerLabel: '角色记忆',
      reasonLabel: '已完成蒸馏',
      mergeModeLabel: '强化合并',
      newEvidenceCount: 3,
    });
  });

  it('keeps conflict display metrics without retaining full metrics payloads', () => {
    const content = buildRuntimeEventMessageContent({
      eventType: 'conflict_focus_shift',
      title: '矛盾焦点变化',
      summary: '矛盾升级',
      metrics: {
        type: 'goal_conflict',
        stage: 'open',
        severity: 0.8,
        nextPressure: 'escalate',
        developmentHooks: ['force_side_taking'],
        rawCandidates: Array.from({ length: 20 }, (_, index) => ({ index, text: 'large payload' })),
      },
    });

    expect(content).not.toContain('rawCandidates');
    const parsed = parseRuntimeEvent(content);
    expect(parsed?.metrics).toMatchObject({
      type: 'goal_conflict',
      stage: 'open',
      severity: 0.8,
      nextPressure: 'escalate',
      developmentHooks: ['force_side_taking'],
    });
  });
});
