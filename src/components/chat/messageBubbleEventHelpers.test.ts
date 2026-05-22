import { describe, expect, it } from 'vitest';
import { buildEventDisplayText, buildMemoryDistillationMeta } from './messageBubbleEventHelpers';

describe('messageBubbleEventHelpers', () => {
  it('sanitizes raw event JSON and UUIDs from event summaries', () => {
    const text = buildEventDisplayText({
      eventType: 'room_state_snapshot_v2',
      title: '房间态势更新',
      summary: '房间态势更新：{"eventType":"room_state_snapshot_v2","title":"房间态势更新"} / 3c78729f-e52d-4dde-b27f-01a949960bb8b',
    });

    expect(text).toContain('系统事件');
    expect(text).not.toContain('eventType');
    expect(text).not.toContain('3c78729f');
  });

  it('sanitizes memory distillation candidate snippets for display', () => {
    const meta = buildMemoryDistillationMeta({
      metrics: {
        ownerType: 'chat',
        candidateTexts: [
          'episodic / resentment / 3c78729f-e52d-4dde-b27f-01a949960bb8b / {"eventType":"relationship_delta"}',
        ],
        newEvidenceCount: 1,
        mergeModeLabel: '强化合并',
      },
    });

    expect(meta?.candidateTexts[0]).toContain('片段记忆');
    expect(meta?.candidateTexts[0]).not.toContain('episodic');
    expect(meta?.candidateTexts[0]).not.toContain('eventType');
    expect(meta?.candidateTexts[0]).not.toContain('3c78729f');
  });

  it('does not expose bucket wording in merge labels', () => {
    const meta = buildMemoryDistillationMeta({
      metrics: {
        ownerType: 'chat',
        candidateTexts: ['灰太狼和沸羊羊的关系有了新沉淀'],
        newEvidenceCount: 1,
        mergeModeLabel: '同 bucket 强化合并',
      },
    });

    expect(meta?.mergeModeLabel).toBe('同类证据强化合并');
    expect(meta?.mergeModeLabel).not.toContain('bucket');
  });
});
