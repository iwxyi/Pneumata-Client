import { describe, expect, it } from 'vitest';
import { buildEventDisplayText, buildMemoryDistillationMeta, buildMemoryReactivationMeta } from './messageBubbleEventHelpers';

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

  it('projects member ids in event summaries to concrete names when members are available', () => {
    const text = buildEventDisplayText({
      eventType: 'memory_reactivation',
      title: '旧记忆回温',
      summary: '旧记忆回温：3c78729f-e52d-4dde-b27f-01a949960bb8b 想起了 8b3d7266-c0c7-4ceb-8dc2-45126f3f2321 的旧事',
    }, [
      { id: '3c78729f-e52d-4dde-b27f-01a949960bb8b', name: '喜羊羊' },
      { id: '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321', name: '沸羊羊' },
    ]);

    expect(text).toContain('喜羊羊');
    expect(text).toContain('沸羊羊');
    expect(text).not.toContain('3c78729f');
    expect(text).not.toContain('8b3d7266');
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

  it('projects member ids in memory distillation and reactivation meta', () => {
    const members = [
      { id: '3c78729f-e52d-4dde-b27f-01a949960bb8b', name: '喜羊羊' },
      { id: '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321', name: '沸羊羊' },
    ];
    const distillationMeta = buildMemoryDistillationMeta({
      metrics: {
        ownerType: 'character',
        ownerName: '3c78729f-e52d-4dde-b27f-01a949960bb8b',
        candidateTexts: [
          'episodic / 8b3d7266-c0c7-4ceb-8dc2-45126f3f2321 维护 3c78729f-e52d-4dde-b27f-01a949960bb8b',
        ],
        newEvidenceCount: 1,
        mergeModeLabel: '强化合并',
      },
    }, members);
    const reactivationMeta = buildMemoryReactivationMeta({
      metrics: {
        matchedTokens: ['3c78729f-e52d-4dde-b27f-01a949960bb8b'],
        recalledMemories: [
          {
            summary: '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321 记得喜羊羊上次帮忙',
            matchedTokens: ['8b3d7266-c0c7-4ceb-8dc2-45126f3f2321'],
          },
        ],
      },
    }, members);

    expect(distillationMeta?.candidateTexts[0]).toContain('沸羊羊');
    expect(distillationMeta?.candidateTexts[0]).toContain('喜羊羊');
    expect(reactivationMeta?.matchedTokens).toEqual(['喜羊羊']);
    expect(reactivationMeta?.recalledMemories[0]?.summary).toContain('沸羊羊');
    expect(reactivationMeta?.recalledMemories[0]?.matchedTokens).toEqual(['沸羊羊']);
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

  it('sanitizes memory reactivation summaries and keeps concrete matched cues', () => {
    const text = buildEventDisplayText({
      eventType: 'memory_reactivation',
      title: '旧记忆回温',
      summary: '旧记忆回温：3c78729f-e52d-4dde-b27f-01a949960bb8b 在雨夜失约',
    });
    const meta = buildMemoryReactivationMeta({
      metrics: {
        matchedTokens: ['雨夜', '失约'],
        recalledMemories: [
          {
            summary: 'episodic / 3c78729f-e52d-4dde-b27f-01a949960bb8b / 雨夜失约',
            matchedTokens: ['雨夜', '失约'],
          },
        ],
      },
    });

    expect(text).toContain('雨夜失约');
    expect(text).not.toContain('3c78729f');
    expect(meta?.matchedTokens).toEqual(['雨夜', '失约']);
    expect(meta?.recalledMemories[0]?.summary).toContain('片段记忆');
    expect(meta?.recalledMemories[0]?.summary).not.toContain('3c78729f');
  });
});
