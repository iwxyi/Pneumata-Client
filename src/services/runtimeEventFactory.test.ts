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
        ownerLabel: '角色：小灰灰',
        ownerName: '小灰灰',
        reasonLabel: '已完成 LLM 蒸馏',
        sourceLabel: 'LLM 蒸馏',
        mergeModeLabel: '强化合并',
        newEvidenceCount: 3,
        candidateTexts: [
          '群聊稳定关系趋势：灰太狼→沸羊羊 支持：灰太狼 → 沸羊羊 · 哟，沸羊羊你今天站我这边了？ / 3c78729f-e52d-4dde-b27f-01a949960b',
          '群聊稳定关系趋势：灰太狼→沸羊羊 支持：灰太狼 → 沸羊羊 · 哟，沸羊羊你今天站我这边了？ / 3c78729f-e52d-4dde-b27f-01a949960b',
          '群聊长期拉扯主轴：喜羊羊→沸羊羊 挑战：喜羊羊 → 沸羊羊 · 怎么，你也想要一个能给你做蛋糕的老婆？ / 19b22fbd-9d0c-45f7-97b8-8224d',
        ],
      },
    });

    expect(content).not.toContain('3c78729f-e52d-4dde-b27f-01a949960b');
    const parsed = parseRuntimeEvent(content);
    expect(parsed?.metrics).toMatchObject({
      ownerType: 'character',
      ownerLabel: '角色：小灰灰',
      ownerName: '小灰灰',
      reasonLabel: '已完成 LLM 蒸馏',
      sourceLabel: 'LLM 蒸馏',
      mergeModeLabel: '强化合并',
      newEvidenceCount: 3,
      candidateTexts: [
        '群聊稳定关系趋势：支持：灰太狼 → 沸羊羊 · 哟，沸羊羊你今天站我这边了？',
        '群聊长期拉扯主轴：挑战：喜羊羊 → 沸羊羊 · 怎么，你也想要一个能给你做蛋糕的老婆？',
      ],
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
