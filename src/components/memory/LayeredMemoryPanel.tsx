import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import DebugChip from '../common/DebugChip';
import type { MemoryItem } from '../../services/memoryTypes';
import type { DisplayTextMember } from '../../services/displayTextSanitizer';
import {
  buildLayeredMemoryFilters,
  buildLayeredMemoryGroups,
  filterVisibleLayeredMemories,
  localizeLayeredMemoryPanelText,
  projectLayeredMemoryItem,
  type LayeredMemoryFilterKey,
} from '../../services/layeredMemoryPresentation';

function MemoryCard({ item, includeDebugDetails, language, formatMemoryText, members = [] }: { item: MemoryItem; includeDebugDetails: boolean; language: string; formatMemoryText?: (text: string, item: MemoryItem) => string; members?: DisplayTextMember[] }) {
  const presented = projectLayeredMemoryItem({ item, includeDebugDetails, language, formatMemoryText, members });
  return (
    <Tooltip title={presented.evidenceTitle} arrow placement="top-start">
      <Box sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2, bgcolor: item.archivedAt ? 'transparent' : 'action.hover', border: '1px solid', borderColor: item.archivedAt ? 'divider' : 'rgba(148, 163, 184, 0.12)', opacity: item.archivedAt ? 0.72 : 1 }}>
        <Stack spacing={0.6}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{presented.displayText}</Typography>
          <StatChipRow items={presented.metaItems} />
          {includeDebugDetails ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', opacity: 0.85 }}>{presented.debugText}</Typography> : null}
        </Stack>
      </Box>
    </Tooltip>
  );
}

interface LayeredMemoryPanelProps {
  memories: MemoryItem[];
  title?: string;
  emptyText?: string;
  collapsedCount?: number;
  expandedCount?: number;
  showAll?: boolean;
  includeRuntimeEvidence?: boolean;
  showDebugChip?: boolean;
  formatMemoryText?: (text: string, item: MemoryItem) => string;
  members?: DisplayTextMember[];
}

export default function LayeredMemoryPanel({
  memories,
  title = '长期记忆',
  emptyText = '暂无结构化记忆',
  collapsedCount = 4,
  expandedCount = 12,
  showAll = false,
  includeRuntimeEvidence = false,
  showDebugChip = true,
  formatMemoryText,
  members = [],
}: LayeredMemoryPanelProps) {
  const { i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<LayeredMemoryFilterKey>('all');
  const language = i18n.language;
  const visibleSourceMemories = useMemo(
    () => filterVisibleLayeredMemories(memories, includeRuntimeEvidence),
    [includeRuntimeEvidence, memories],
  );
  const groups = useMemo(() => buildLayeredMemoryGroups(visibleSourceMemories), [visibleSourceMemories]);
  const filters = useMemo(() => buildLayeredMemoryFilters(groups, includeRuntimeEvidence, language), [groups, includeRuntimeEvidence, language]);
  const filteredMemories = useMemo(() => {
    const selected = filters.find((item) => item.key === activeFilter) || filters[0];
    return selected ? selected.items : [];
  }, [activeFilter, filters]);
  const activeMeta = filters.find((item) => item.key === activeFilter) || filters[0];
  const visibleMemories = showAll ? filteredMemories : expanded ? filteredMemories.slice(0, expandedCount) : filteredMemories.slice(0, collapsedCount);
  const displayTitle = localizeLayeredMemoryPanelText(title, language);
  const displayEmptyText = localizeLayeredMemoryPanelText(emptyText, language);

  return (
    <SurfaceCard>
      <SectionHeader title={displayTitle} dense action={includeRuntimeEvidence && showDebugChip ? <DebugChip /> : undefined} />
      <Stack spacing={1.15}>
        {visibleSourceMemories.length ? (
          <Tabs
            value={activeFilter}
            onChange={(_, value) => { setActiveFilter(value); setExpanded(false); }}
            variant="scrollable"
            scrollButtons={false}
            sx={{ minHeight: 34, borderBottom: '1px solid', borderColor: 'divider', '& .MuiTab-root': { minWidth: 0, minHeight: 34, px: { xs: 0.75, sm: 1.25 }, py: 0.5, fontSize: { xs: 12, sm: 13 }, whiteSpace: 'nowrap' } }}
          >
            {filters.map((filter) => (
              <Tab key={filter.key} value={filter.key} label={`${filter.label} ${filter.items.length}`} />
            ))}
          </Tabs>
        ) : null}
        {activeMeta ? <Typography variant="caption" color="text.secondary">{activeMeta.hint}</Typography> : null}
        {visibleMemories.length ? <Stack spacing={1}>{visibleMemories.map((item) => <MemoryCard key={item.id} item={item} includeDebugDetails={includeRuntimeEvidence} language={language} formatMemoryText={formatMemoryText} members={members} />)}</Stack> : <Typography variant="caption" color="text.secondary">{displayEmptyText}</Typography>}
        {!showAll && filteredMemories.length > collapsedCount ? <Button size="small" variant="text" onClick={() => setExpanded((prev) => !prev)}>{expanded ? (language.startsWith('zh') ? '收起' : 'Collapse') : `${language.startsWith('zh') ? '查看更多' : 'Show more'} ${filteredMemories.length}`}</Button> : null}
      </Stack>
    </SurfaceCard>
  );
}
