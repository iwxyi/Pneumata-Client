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

