import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import DebugChip from '../common/DebugChip';
import type { MemoryItem } from '../../services/memoryTypes';
import { getExperienceLensLabel } from '../../services/experienceChangePresentation';
import { isRuntimeEvidenceMemory } from '../../services/memoryPresentation';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import { isMemoryAnchorCandidate } from '../../services/memoryLifecycle';

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

function buildMemoryMetaItems(item: MemoryItem, includeDebugDetails: boolean) {
  const userFacing = [
    getExperienceLensLabel(item.sourceTag),
    getMemoryKindLabel(item.kind),
  ].filter(Boolean) as string[];
  if (!includeDebugDetails) return userFacing;
  return [
    ...userFacing,
    getMemoryLayerLabel(item.layer),
    getMemoryScopeLabel(item.scope),
  ].filter(Boolean) as string[];
}

function memoryStrengthLabel(item: MemoryItem) {
  const salience = Number.isFinite(item.salience) ? item.salience : 0;
  if (item.archivedAt) return '已沉入旧档';
  if (item.lastActivatedAt && Date.now() - item.lastActivatedAt < 7 * 24 * 60 * 60 * 1000) return '最近回温';
  if (item.layer === 'long_term' && (item.origin === 'distilled' || item.reinforcementCount >= 3 || salience >= 0.78)) return '锚点候选';
  if (salience >= 0.78) return '印象很深';
  if (salience >= 0.5) return '印象明确';
  return '印象较轻';
}

function memoryDisplayTime(item: MemoryItem) {
  return item.lastActivatedAt || item.updatedAt || item.distilledAt || item.archivedAt || item.createdAt || 0;
}

function newestFirst(items: MemoryItem[]) {
  return items.slice().sort((left, right) => memoryDisplayTime(right) - memoryDisplayTime(left));
}

function buildEvidenceTitle(item: MemoryItem, formatMemoryText?: (text: string, item: MemoryItem) => string) {
  const evidenceSource = item.evidenceText || item.summary || item.text;
  const evidenceTitle = sanitizeUserFacingText(formatMemoryText ? formatMemoryText(evidenceSource, item) : evidenceSource);
  return evidenceTitle || '暂无证据文本';
}

function MemoryCard({ item, includeDebugDetails, formatMemoryText }: { item: MemoryItem; includeDebugDetails: boolean; formatMemoryText?: (text: string, item: MemoryItem) => string }) {
  const sourceText = item.summary || item.text;
  const displayText = sanitizeUserFacingText(formatMemoryText ? formatMemoryText(sourceText, item) : sourceText);
  const evidenceTitle = buildEvidenceTitle(item, formatMemoryText);
  const metaItems = [memoryStrengthLabel(item), ...buildMemoryMetaItems(item, includeDebugDetails)].filter(Boolean) as string[];
  return (
    <Tooltip title={evidenceTitle} arrow placement="top-start">
      <Box sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2, bgcolor: item.archivedAt ? 'transparent' : 'action.hover', border: '1px solid', borderColor: item.archivedAt ? 'divider' : 'rgba(148, 163, 184, 0.12)', opacity: item.archivedAt ? 0.72 : 1 }}>
        <Stack spacing={0.6}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{displayText}</Typography>
          <StatChipRow items={metaItems} />
          {includeDebugDetails ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', opacity: 0.85 }}>{`强化 ${item.reinforcementCount} · 置信 ${(item.confidence * 100).toFixed(0)}% · 显著性 ${(item.salience * 100).toFixed(0)}%`}</Typography> : null}
        </Stack>
      </Box>
    </Tooltip>
  );
}

type MemoryFilterKey = 'all' | 'anchors' | 'longTerm' | 'episodic' | 'working' | 'relationship' | 'self' | 'conversation' | 'expressionFeedback' | 'archived';

function buildMemoryGroups(items: MemoryItem[]) {
  const activeItems = newestFirst(items.filter((item) => !item.archivedAt));
  const expressionFeedback = activeItems.filter((item) => item.sourceTag === 'expression_feedback');
  return {
    all: activeItems,
    anchors: activeItems.filter(isMemoryAnchorCandidate),
    longTerm: activeItems.filter((item) => item.layer === 'long_term'),
    episodic: activeItems.filter((item) => item.layer === 'episodic'),
    working: activeItems.filter((item) => item.layer === 'working'),
    relationship: activeItems.filter((item) => item.scope === 'relationship'),
    self: activeItems.filter((item) => item.scope === 'character_self'),
    conversation: activeItems.filter((item) => item.scope === 'conversation' || item.scope === 'thread'),
    expressionFeedback,
    archived: newestFirst(items.filter((item) => item.archivedAt)),
  };
}

function buildMemoryFilters(groups: ReturnType<typeof buildMemoryGroups>, includeDebugDetails: boolean) {
  return ([
    { key: 'all', label: '全部', items: groups.all, hint: '当前活跃记忆池，会进入后续检索与表达。' },
    { key: 'anchors', label: '锚点', items: groups.anchors, hint: '由长期、反复强化或蒸馏记忆投影出的生命锚点候选。' },
    { key: 'longTerm', label: '长期', items: groups.longTerm, hint: '稳定判断、长期关系模式和可复用结论。' },
    { key: 'episodic', label: '片段', items: groups.episodic, hint: '阶段性事件和仍有上下文温度的经历。' },
    includeDebugDetails ? { key: 'working', label: '即时', items: groups.working, hint: '当前几轮或运行态证据，通常只在调试时查看。' } : null,
    { key: 'relationship', label: '关系', items: groups.relationship, hint: '围绕具体对象形成的关系印象。' },
    { key: 'self', label: '自我', items: groups.self, hint: '角色如何理解自己、偏好、创伤或成长。' },
    { key: 'conversation', label: '会话/线程', items: groups.conversation, hint: '群聊、单聊或私聊线程里的共同记忆。' },
    includeDebugDetails ? { key: 'expressionFeedback', label: '表达反馈', items: groups.expressionFeedback, hint: '用户对表达风格的纠偏记忆。' } : null,
    groups.archived.length ? { key: 'archived', label: '旧档', items: groups.archived, hint: '已归档或沉下去的记忆，只有被人物、话题或旧梗唤醒时才会回到上下文。' } : null,
  ].filter(Boolean)) as Array<{ key: MemoryFilterKey; label: string; items: MemoryItem[]; hint: string }>;
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
}: LayeredMemoryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<MemoryFilterKey>('all');
  const visibleSourceMemories = useMemo(
    () => memories.filter((item) => includeRuntimeEvidence ? true : !isRuntimeEvidenceMemory(item)),
    [includeRuntimeEvidence, memories],
  );
  const groups = useMemo(() => buildMemoryGroups(visibleSourceMemories), [visibleSourceMemories]);
  const filters = useMemo(() => buildMemoryFilters(groups, includeRuntimeEvidence), [groups, includeRuntimeEvidence]);
  const filteredMemories = useMemo(() => {
    const selected = filters.find((item) => item.key === activeFilter) || filters[0];
    return selected ? selected.items : [];
  }, [activeFilter, filters]);
  const activeMeta = filters.find((item) => item.key === activeFilter) || filters[0];
  const visibleMemories = showAll ? filteredMemories : expanded ? filteredMemories.slice(0, expandedCount) : filteredMemories.slice(0, collapsedCount);

  return (
    <SurfaceCard>
      <SectionHeader title={title} dense action={includeRuntimeEvidence && showDebugChip ? <DebugChip /> : undefined} />
      <Stack spacing={1.15}>
        {visibleSourceMemories.length ? (
          <Tabs
            value={activeFilter}
            onChange={(_, value) => { setActiveFilter(value); setExpanded(false); }}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ minHeight: 34, borderBottom: '1px solid', borderColor: 'divider', '& .MuiTab-root': { minHeight: 34, px: 1.25, py: 0.5, fontSize: 13 } }}
          >
            {filters.map((filter) => (
              <Tab key={filter.key} value={filter.key} label={`${filter.label} ${filter.items.length}`} />
            ))}
          </Tabs>
        ) : null}
        {activeMeta ? <Typography variant="caption" color="text.secondary">{activeMeta.hint}</Typography> : null}
        {visibleMemories.length ? <Stack spacing={1}>{visibleMemories.map((item) => <MemoryCard key={item.id} item={item} includeDebugDetails={includeRuntimeEvidence} formatMemoryText={formatMemoryText} />)}</Stack> : <Typography variant="caption" color="text.secondary">{emptyText}</Typography>}
        {!showAll && filteredMemories.length > collapsedCount ? <Button size="small" variant="text" onClick={() => setExpanded((prev) => !prev)}>{expanded ? '收起' : `查看更多 ${filteredMemories.length}`}</Button> : null}
      </Stack>
    </SurfaceCard>
  );
}
