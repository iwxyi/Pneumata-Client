import { describe, expect, it } from 'vitest';
import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import { projectFilteredRuntimeTimeline, projectRuntimeTimelineFilterLabel } from './runtimeTimelineFilterProjection';

function item(partial: Partial<ProjectedRuntimeTimelineItem>): ProjectedRuntimeTimelineItem {
  return {
    type: 'note',
    text: 'x',
    createdAt: 1,
    label: 'x',
    ...partial,
  };
}

describe('runtimeTimelineFilterProjection', () => {
  it('filters artifact tab with social-event cluster items and applies collapsed limit', () => {
    const source = [
      item({ type: 'note', createdAt: 1, text: 'note-1' }),
      item({ type: 'artifact', createdAt: 2, text: 'artifact-2' }),
      item({ type: 'note', createdAt: 3, text: 'cluster-note-3', meta: { socialEventCluster: { stage: 'candidate', eventKind: 'check_in', dedupeKey: null } } }),
      item({ type: 'relationship', createdAt: 4, text: 'rel-4' }),
    ];
    const projected = projectFilteredRuntimeTimeline(source, 'artifact', false, 2, 10);
    expect(projected.map((entry) => entry.text)).toEqual(['cluster-note-3', 'artifact-2']);
  });

  it('returns expanded list with reverse order for all filter', () => {
    const source = [
      item({ text: '1', createdAt: 1 }),
      item({ text: '2', createdAt: 2 }),
      item({ text: '3', createdAt: 3 }),
    ];
    const projected = projectFilteredRuntimeTimeline(source, 'all', true, 1, 10);
    expect(projected.map((entry) => entry.text)).toEqual(['3', '2', '1']);
  });

  it('maps filter labels', () => {
    expect(projectRuntimeTimelineFilterLabel('all')).toBe('全部');
    expect(projectRuntimeTimelineFilterLabel('relationship')).toBe('关系');
    expect(projectRuntimeTimelineFilterLabel('artifact')).toBe('产物/事件');
    expect(projectRuntimeTimelineFilterLabel('note')).toBe('记录');
  });
});
