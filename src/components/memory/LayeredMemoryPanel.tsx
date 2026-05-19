import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import type { MemoryItem } from '../../services/memoryTypes';

function getMemoryLayerLabel(layer: MemoryItem['layer']) {
  const labels: Record<MemoryItem['layer'], string> = {
    long_term: '长期记忆',
    episodic: '情节记忆',
    working: '即时记忆',
  };
  return labels[layer] || layer;
}

function getMemoryScopeLabel(scope: MemoryItem['scope']) {
  const labels: Record<MemoryItem['scope'], string> = {
    character_self: '角色自我',
    relationship: '关系',
    conversation: '会话',
    thread: '线程',
    system_runtime: '系统运行态',
  };
  return labels[scope] || scope;
}

function getMemoryKindLabel(kind: MemoryItem['kind']) {
  const labels: Record<MemoryItem['kind'], string> = {
    trait_evidence: '特征证据',
    obsession: '执念',
    taboo: '禁区',
    bond: '连结',
    resentment: '芥蒂',
    bias: '偏向',
    decision: '决策',
    conflict: '冲突',
    status_shift: '状态变化',
    artifact: '产物',
    thread_effect: '线程影响',
  };
  return labels[kind] || kind;
}

function MemoryCard({ item, formatMemoryText }: { item: MemoryItem; formatMemoryText?: (text: string, item: MemoryItem) => string }) {
  const displayText = formatMemoryText ? formatMemoryText(item.text, item) : item.text;
  const evidenceSource = item.evidenceText || item.summary || item.text;
  const evidenceTitle = formatMemoryText ? formatMemoryText(evidenceSource, item) : evidenceSource;
  return (
    <Box sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
      <Stack spacing={0.6}>
        <Typography variant="body2" sx={{ fontWeight: 700 }} title={evidenceTitle}>{displayText}</Typography>
        <StatChipRow items={[getMemoryLayerLabel(item.layer), getMemoryScopeLabel(item.scope), getMemoryKindLabel(item.kind)]} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', opacity: 0.85 }}>{`强化 ${item.reinforcementCount} · 置信 ${(item.confidence * 100).toFixed(0)}%`}</Typography>
      </Stack>
    </Box>
  );
}

function buildMemoryGroups(items: MemoryItem[]) {
  return {
    longTerm: items.filter((item) => item.layer === 'long_term'),
    episodic: items.filter((item) => item.layer === 'episodic'),
    working: items.filter((item) => item.layer === 'working'),
    relationship: items.filter((item) => item.scope === 'relationship'),
    self: items.filter((item) => item.scope === 'character_self'),
    conversation: items.filter((item) => item.scope === 'conversation' || item.scope === 'thread'),
  };
}

interface LayeredMemoryPanelProps {
  memories: MemoryItem[];
  title?: string;
  emptyText?: string;
  collapsedCount?: number;
  expandedCount?: number;
  formatMemoryText?: (text: string, item: MemoryItem) => string;
}

export default function LayeredMemoryPanel({
  memories,
  title = '自动记忆沉淀',
  emptyText = '暂无结构化记忆',
  collapsedCount = 4,
  expandedCount = 12,
  formatMemoryText,
}: LayeredMemoryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const groups = useMemo(() => buildMemoryGroups(memories), [memories]);
  const filters = useMemo(() => ([
    { key: 'longTerm', label: '长期', items: groups.longTerm },
    { key: 'episodic', label: '情节', items: groups.episodic },
    { key: 'working', label: '即时', items: groups.working },
    { key: 'relationship', label: '关系', items: groups.relationship },
    { key: 'self', label: '角色自我', items: groups.self },
    { key: 'conversation', label: '会话/线程', items: groups.conversation },
  ]), [groups]);
  const filteredMemories = useMemo(() => {
    const selected = filters.find((item) => item.key === activeFilter);
    return selected ? selected.items : memories;
  }, [activeFilter, filters, memories]);
  const visibleMemories = expanded ? filteredMemories.slice(0, expandedCount) : filteredMemories.slice(0, collapsedCount);

  return (
    <SurfaceCard>
      <SectionHeader title={title} dense />
      <Stack spacing={1}>
        {memories.length ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            <Chip
              size="small"
              label={`全部 ${memories.length}`}
              color={activeFilter === null ? 'primary' : 'default'}
              variant={activeFilter === null ? 'filled' : 'outlined'}
              onClick={() => setActiveFilter(null)}
            />
            {filters.filter((item) => item.items.length).map((filter) => (
              <Chip
                key={filter.key}
                size="small"
                label={`${filter.label} ${filter.items.length}`}
                color={activeFilter === filter.key ? 'primary' : 'default'}
                variant={activeFilter === filter.key ? 'filled' : 'outlined'}
                onClick={() => setActiveFilter((prev) => (prev === filter.key ? null : filter.key))}
              />
            ))}
          </Box>
        ) : null}
        {visibleMemories.length ? <Stack spacing={1}>{visibleMemories.map((item) => <MemoryCard key={item.id} item={item} formatMemoryText={formatMemoryText} />)}</Stack> : <Typography variant="caption" color="text.secondary">{emptyText}</Typography>}
        {filteredMemories.length > collapsedCount ? <Button size="small" variant="text" onClick={() => setExpanded((prev) => !prev)}>{expanded ? '收起' : '查看更多'}</Button> : null}
      </Stack>
    </SurfaceCard>
  );
}
