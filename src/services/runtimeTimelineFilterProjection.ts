import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import { readSocialEventClusterMeta } from './sessionProjection';

export type RuntimeTimelineFilter = 'all' | 'note' | 'artifact' | 'relationship';

export function projectFilteredRuntimeTimeline(
  items: ProjectedRuntimeTimelineItem[],
  filter: RuntimeTimelineFilter,
  expanded: boolean,
  collapsedLimit = 6,
  expandedLimit = 16,
) {
  const filtered = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'artifact') return item.type === 'artifact' || Boolean(readSocialEventClusterMeta(item));
    return item.type === filter;
  });
  const limit = expanded ? expandedLimit : collapsedLimit;
  return filtered.slice().reverse().slice(0, limit);
}

export function projectRuntimeTimelineFilterLabel(filter: RuntimeTimelineFilter) {
  if (filter === 'all') return '全部';
  if (filter === 'relationship') return '关系';
  if (filter === 'artifact') return '产物/事件';
  return '记录';
}
