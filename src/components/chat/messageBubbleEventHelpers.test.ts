import { describe, expect, it } from 'vitest';
import {
  buildConflictEventMeta,
  buildEventDisplayText,
  buildMemoryDistillationMeta,
  buildMemoryReactivationMeta,
  shouldHideEmptyConflictEvent,
} from './messageBubbleEventHelpers';

describe('messageBubbleEventHelpers', () => {
  it('builds localized memory distillation display text', () => {
    const text = buildEventDisplayText({
      eventType: 'memory_distillation',
      summary: 'ignored',
      metrics: {
        ownerType: 'character',
        ownerLabel: '角色：喜羊羊',
        ownerName: '喜羊羊',
        candidateTexts: ['test'],
        sourceLabel: 'LLM蒸馏',
      },
    });
    expect(text).toBe('LLM角色蒸馏 · 喜羊羊');
  });

  it('builds memory distillation meta from metrics', () => {
    const meta = buildMemoryDistillationMeta({
      metrics: {
        ownerType: 'character',
        candidateTexts: ['A', 'B'],
        mergeMode: 'append_new',
        newEvidenceCount: 3,
      },
    });
    expect(meta).toEqual({
      mergeModeLabel: '新增记忆',
      evidenceCount: 3,
      candidateTexts: ['A'],
    });
  });

  it('redacts high-risk private memory distillation candidates', () => {
    const meta = buildMemoryDistillationMeta({
      metrics: {
        ownerType: 'character',
        candidateTexts: ['秘密暗号是雨夜便利店，不能公开说'],
        mergeMode: 'append_new',
        newEvidenceCount: 1,
      },
    });
    expect(meta?.candidateTexts).toEqual(['有一条私域蒸馏候选已隐藏原文']);
  });

  it('builds memory reactivation meta and sanitizes fields', () => {
    const meta = buildMemoryReactivationMeta({
      metrics: {
        matchedTokens: ['喜羊羊', '灰太狼'],
        recalledMemories: [
          { summary: '喜羊羊 记得灰太狼说过的话', matchedTokens: ['灰太狼'] },
        ],
      },
    });
    expect(meta?.matchedTokens).toEqual(['喜羊羊', '灰太狼']);
    expect(meta?.recalledMemories[0]?.summary).toContain('喜羊羊');
  });

  it('redacts high-risk private event and memory reactivation text', () => {
    expect(buildEventDisplayText({
      eventType: 'memory_reactivation',
      summary: '秘密暗号是雨夜便利店，不能公开说',
    })).toBe('有一条私域记忆回温已隐藏原文');

    const meta = buildMemoryReactivationMeta({
      metrics: {
        matchedTokens: ['雨夜便利店暗号'],
        recalledMemories: [
          { summary: '手机号 13800000000 不要公开', matchedTokens: ['13800000000'] },
        ],
      },
    });
    expect(meta?.matchedTokens).toEqual(['有一条私域命中词已隐藏原文']);
    expect(meta?.recalledMemories[0]?.summary).toBe('有一条私域回温记忆已隐藏原文');
    expect(meta?.recalledMemories[0]?.matchedTokens).toEqual(['有一条私域命中词已隐藏原文']);
  });

  it('hides empty conflict events only when both summary and metrics are empty', () => {
    expect(shouldHideEmptyConflictEvent({
      eventType: 'conflict_focus_shift',
      summary: '',
      metrics: {},
    })).toBe(true);
    expect(shouldHideEmptyConflictEvent({
      eventType: 'conflict_focus_shift',
      summary: '有冲突摘要',
      metrics: {},
    })).toBe(false);
    expect(shouldHideEmptyConflictEvent({
      eventType: 'conflict_focus_shift',
      summary: '',
      metrics: { type: 'resource' },
    })).toBe(false);
  });

  it('delegates conflict metrics formatting', () => {
    const meta = buildConflictEventMeta({
      metrics: {
        type: 'status',
        stage: 'escalating',
        severity: 0.6,
      },
    });
    expect(meta).toBeTruthy();
  });
});
