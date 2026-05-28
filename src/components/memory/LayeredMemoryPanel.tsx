import { useMemo, useState } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
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

function MemoryCard({
  item,
  includeDebugDetails,
  language,
  formatMemoryText,
  members = [],
  hideEvidenceTooltip = false,
}: {
  item: MemoryItem;
  includeDebugDetails: boolean;
  language: string;
  formatMemoryText?: (text: string, item: MemoryItem) => string;
  members?: DisplayTextMember[];
  hideEvidenceTooltip?: boolean;
}) {
  const presented = projectLayeredMemoryItem({ item, includeDebugDetails, language, formatMemoryText, members });
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const previewEvidenceItems = presented.evidenceItems.filter((entry) => entry.weight >= 0.55).slice(0, 3);
  const tooltipEvidenceItems = previewEvidenceItems.length ? previewEvidenceItems : presented.evidenceItems.slice(0, 2);
  const showEvidenceIcon = !hideEvidenceTooltip && presented.evidenceItems.length > 0;
  const evidenceTooltip = tooltipEvidenceItems.length ? (
    <Stack component="span" spacing={0.75} sx={{ maxWidth: 360 }}>
      {tooltipEvidenceItems.map((entry, index) => (
        <Box
          component="span"
          key={`${entry.text}-${index}`}
          sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0.75, whiteSpace: 'pre-wrap' }}
        >
          <Box component="span" sx={{ opacity: 0.68, fontVariantNumeric: 'tabular-nums' }}>{index + 1}.</Box>
          <Box component="span">{entry.text}</Box>
        </Box>
      ))}
      {presented.evidenceItems.length > tooltipEvidenceItems.length ? (
        <Box component="span" sx={{ display: 'block', color: 'rgba(255,255,255,0.72)' }}>
          {language.startsWith('zh') ? `还有 ${presented.evidenceItems.length - tooltipEvidenceItems.length} 条，点击图标查看全部` : `${presented.evidenceItems.length - tooltipEvidenceItems.length} more, click the icon to view all`}
        </Box>
      ) : null}
    </Stack>
  ) : '';
  return (
    <>
      <Box sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2, bgcolor: item.archivedAt ? 'transparent' : 'action.hover', border: '1px solid', borderColor: item.archivedAt ? 'divider' : 'rgba(148, 163, 184, 0.12)', opacity: item.archivedAt ? 0.72 : 1 }}>
        <Stack spacing={0.6}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 700, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{presented.displayText}</Typography>
            {showEvidenceIcon ? (
              <Tooltip title={evidenceTooltip} arrow placement="top-start">
                <IconButton
                  size="small"
                  aria-label={language.startsWith('zh') ? '查看证据' : 'View evidence'}
                  onClick={() => setEvidenceOpen(true)}
                  sx={{
                    mt: -0.25,
                    mr: -0.35,
                    width: 24,
                    height: 24,
                    color: 'text.secondary',
                    opacity: 0.72,
                    '&:hover': { opacity: 1, color: 'primary.main', bgcolor: 'action.hover' },
                  }}
                >
                  <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
          <StatChipRow items={presented.metaItems} />
          {includeDebugDetails ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', opacity: 0.85 }}>{presented.debugText}</Typography> : null}
        </Stack>
      </Box>
      <Dialog
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid',
              borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.10)' : 'rgba(226, 232, 240, 0.12)',
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(18,20,28,0.84)',
              backdropFilter: 'blur(24px) saturate(1.12)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.12)',
              boxShadow: (theme) => theme.palette.mode === 'light'
                ? '0 24px 80px rgba(15, 23, 42, 0.16)'
                : '0 24px 80px rgba(0,0,0,0.42)',
            },
          },
          backdrop: {
            sx: {
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.16)' : 'rgba(0,0,0,0.34)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            pr: 6,
            pb: 1,
            borderBottom: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.08)' : 'rgba(226, 232, 240, 0.10)',
          }}
        >
          <Stack spacing={0.25}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{language.startsWith('zh') ? '记忆证据' : 'Memory Evidence'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {language.startsWith('zh') ? `${presented.evidenceItems.length} 条来源线索` : `${presented.evidenceItems.length} evidence sources`}
            </Typography>
          </Stack>
          <IconButton
            aria-label={language.startsWith('zh') ? '关闭' : 'Close'}
            onClick={() => setEvidenceOpen(false)}
            sx={{
              position: 'absolute',
              right: 12,
              top: 12,
              width: 32,
              height: 32,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
            }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 2.5 }, py: { xs: 1.25, sm: 1.5 } }}>
          <Stack
            spacing={0}
            sx={{
              border: '1px solid',
              borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.08)' : 'rgba(226, 232, 240, 0.10)',
              borderRadius: 1.5,
              overflow: 'hidden',
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.035)',
            }}
          >
            {presented.evidenceItems.map((entry, index) => (
              <Box
                key={`${entry.text}-${index}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '28px minmax(0, 1fr)',
                  gap: 1.25,
                  alignItems: 'flex-start',
                  px: { xs: 1.15, sm: 1.35 },
                  py: { xs: 1.15, sm: 1.25 },
                  borderBottom: index === presented.evidenceItems.length - 1 ? 0 : '1px solid',
                  borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.07)' : 'rgba(226, 232, 240, 0.08)',
                }}
              >
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mt: 0.1,
                    fontSize: 12,
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'primary.main',
                    border: '1px solid',
                    borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(43, 92, 255, 0.22)' : 'rgba(125, 166, 255, 0.28)',
                    bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(43, 92, 255, 0.06)' : 'rgba(125, 166, 255, 0.10)',
                  }}
                >
                  {index + 1}
                </Box>
                <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {entry.text}
                </Typography>
              </Box>
            ))}
          </Stack>
        </DialogContent>
      </Dialog>
    </>
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
  hideEvidenceTooltip?: boolean;
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
  hideEvidenceTooltip = false,
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
        {visibleMemories.length ? (
          <Stack spacing={1}>
            {visibleMemories.map((item) => (
              <MemoryCard
                key={item.id}
                item={item}
                includeDebugDetails={includeRuntimeEvidence}
                language={language}
                formatMemoryText={formatMemoryText}
                members={members}
                hideEvidenceTooltip={hideEvidenceTooltip}
              />
            ))}
          </Stack>
        ) : <Typography variant="caption" color="text.secondary">{displayEmptyText}</Typography>}
        {!showAll && filteredMemories.length > collapsedCount ? <Button size="small" variant="text" onClick={() => setExpanded((prev) => !prev)}>{expanded ? (language.startsWith('zh') ? '收起' : 'Collapse') : `${language.startsWith('zh') ? '查看更多' : 'Show more'} ${filteredMemories.length}`}</Button> : null}
      </Stack>
    </SurfaceCard>
  );
}
