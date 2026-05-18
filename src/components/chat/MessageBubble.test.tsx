import { describe, expect, it } from 'vitest';
import { getAttachmentErrorText } from './messageAttachmentDisplay';
import { buildEventDisplayText, buildMemoryDistillationMeta, shouldHideEmptyConflictEvent } from './messageBubbleEventHelpers';

describe('MessageBubble event rendering', () => {
  it('formats memory distillation titles with readable source and owner labels', () => {
    const text = buildEventDisplayText({
      eventType: 'memory_distillation',
      title: '',
      summary: '',
      metrics: {
        sourceLabel: 'LLM 蒸馏',
        ownerLabel: '角色：甲',
        reasonLabel: '已完成 LLM 蒸馏',
      },
    });

    expect(text).toBe('LLM角色蒸馏');
  });

  it('formats local memory distillation titles distinctly from LLM distillation', () => {
    const text = buildEventDisplayText({
      eventType: 'memory_distillation',
      title: '',
      summary: '',
      metrics: {
        ownerType: 'chat',
        sourceLabel: '本地蒸馏',
        ownerLabel: '群聊：羊村大家庭闲聊',
        reasonLabel: '已完成本地蒸馏',
      },
    });

    expect(text).toBe('本地群聊蒸馏');
  });

  it('cleans distillation candidate texts before rendering them', () => {
    const meta = buildMemoryDistillationMeta({
      metrics: {
        ownerType: 'chat',
        ownerLabel: '群聊：羊村大家庭闲聊',
        sourceLabel: '本地蒸馏',
        reasonLabel: '已完成本地蒸馏',
        mergeModeLabel: '同 bucket 强化合并',
        newEvidenceCount: 11,
        candidateTexts: [
          '群聊稳定关系趋势：灰太狼→沸羊羊 支持：灰太狼 → 沸羊羊 · 哟，沸羊羊你今天站我这边了？ / 3c78729f-e52d-4dde-b27f-01a949960b',
          '群聊稳定关系趋势：灰太狼→沸羊羊 支持：灰太狼 → 沸羊羊 · 哟，沸羊羊你今天站我这边了？ / 3c78729f-e52d-4dde-b27f-01a949960b',
        ],
      },
    });

    expect(meta?.candidateTexts).toEqual([
      '群聊稳定关系趋势：灰太狼→沸羊羊 支持：灰太狼 → 沸羊羊 · 哟，沸羊羊你今天站我这边了？',
    ]);
  });

  it('keeps empty conflict events out of display when nothing meaningful exists', () => {
    const shouldHide = shouldHideEmptyConflictEvent({
      eventType: 'conflict_focus_shift',
      summary: '',
      metrics: {},
    });

    expect(shouldHide).toBe(true);
  });

  it('uses the concrete attachment error for failed media placeholders', () => {
    expect(getAttachmentErrorText({ error: '图片模型未配置' })).toBe('图片模型未配置');
  });

  it('falls back to a useful failed media message when no concrete error exists', () => {
    expect(getAttachmentErrorText({ error: '   ' })).toBe('生成任务失败，请检查模型配置或稍后重试。');
  });
});
