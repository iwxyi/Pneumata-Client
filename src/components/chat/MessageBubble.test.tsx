import { describe, expect, it } from 'vitest';
import { buildEventDisplayText, shouldHideEmptyConflictEvent } from './messageBubbleEventHelpers';

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

    expect(text).toBe('LLM 蒸馏 · 角色：甲 · 已完成 LLM 蒸馏');
  });

  it('keeps empty conflict events out of display when nothing meaningful exists', () => {
    const shouldHide = shouldHideEmptyConflictEvent({
      eventType: 'conflict_focus_shift',
      summary: '',
      metrics: {},
    });

    expect(shouldHide).toBe(true);
  });
});
