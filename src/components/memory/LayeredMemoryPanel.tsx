import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import DebugChip from '../common/DebugChip';
import type { MemoryItem } from '../../services/memoryTypes';
import { getExperienceLensLabel } from '../../services/experienceChangePresentation';
import { isRuntimeEvidenceMemory } from '../../services/memoryPresentation';
import { sanitizeUserFacingText, type DisplayTextMember } from '../../services/displayTextSanitizer';
import { isMemoryAnchorCandidate } from '../../services/memoryLifecycle';

function isZh(language: string) {
  return language.startsWith('zh');
}

function getMemoryLayerLabel(layer: MemoryItem['layer'], language: string) {
  const labels: Record<MemoryItem['layer'], { zh: string; en: string }> = {
    long_term: { zh: '长期记忆', en: 'Long-term' },
    episodic: { zh: '情节记忆', en: 'Episodic' },
    working: { zh: '即时记忆', en: 'Working' },
  };
  const item = labels[layer];
  return item ? (isZh(language) ? item.zh : item.en) : layer;
}

function getMemoryScopeLabel(scope: MemoryItem['scope'], language: string) {
  const labels: Record<MemoryItem['scope'], { zh: string; en: string }> = {
    character_self: { zh: '角色自我', en: 'Character self' },
    relationship: { zh: '关系', en: 'Relationship' },
    conversation: { zh: '会话', en: 'Conversation' },
    thread: { zh: '线程', en: 'Thread' },
    system_runtime: { zh: '系统运行态', en: 'Runtime' },
  };
  const item = labels[scope];
  return item ? (isZh(language) ? item.zh : item.en) : scope;
}

function getMemoryKindLabel(kind: MemoryItem['kind'], language: string) {
  const labels: Record<MemoryItem['kind'], { zh: string; en: string }> = {
    trait_evidence: { zh: '特征证据', en: 'Trait evidence' },
    obsession: { zh: '执念', en: 'Obsession' },
    taboo: { zh: '禁区', en: 'Taboo' },
    bond: { zh: '连结', en: 'Bond' },
    resentment: { zh: '芥蒂', en: 'Resentment' },
    bias: { zh: '偏向', en: 'Bias' },
    decision: { zh: '决策', en: 'Decision' },
    conflict: { zh: '冲突', en: 'Conflict' },
    status_shift: { zh: '状态变化', en: 'Status shift' },
    artifact: { zh: '产物', en: 'Artifact' },
    thread_effect: { zh: '线程影响', en: 'Thread effect' },
  };
  const item = labels[kind];
  return item ? (isZh(language) ? item.zh : item.en) : kind;
}

function buildMemoryMetaItems(item: MemoryItem, includeDebugDetails: boolean, language: string) {
  const userFacing = [
    getExperienceLensLabel(item.sourceTag, language),
    getMemoryKindLabel(item.kind, language),
  ].filter(Boolean) as string[];
  if (!includeDebugDetails) return userFacing;
  return [
    ...userFacing,
    getMemoryLayerLabel(item.layer, language),
    getMemoryScopeLabel(item.scope, language),
  ].filter(Boolean) as string[];
}

function memoryStrengthLabel(item: MemoryItem, language: string) {
  const salience = Number.isFinite(item.salience) ? item.salience : 0;
  const zh = isZh(language);
  if (item.archivedAt) return zh ? '已沉入旧档' : 'Archived';
  if (item.lastActivatedAt && Date.now() - item.lastActivatedAt < 7 * 24 * 60 * 60 * 1000) return zh ? '最近回温' : 'Recently reactivated';
  if (item.layer === 'long_term' && (item.origin === 'distilled' || item.reinforcementCount >= 3 || salience >= 0.78)) return zh ? '锚点候选' : 'Anchor candidate';
  if (salience >= 0.78) return zh ? '印象很深' : 'Strong impression';
  if (salience >= 0.5) return zh ? '印象明确' : 'Clear impression';
  return zh ? '印象较轻' : 'Light impression';
}

function memoryDisplayTime(item: MemoryItem) {
  return item.lastActivatedAt || item.updatedAt || item.distilledAt || item.archivedAt || item.createdAt || 0;
}

function newestFirst(items: MemoryItem[]) {
  return items.slice().sort((left, right) => memoryDisplayTime(right) - memoryDisplayTime(left));
}

function buildEvidenceTitle(item: MemoryItem, language: string, formatMemoryText?: (text: string, item: MemoryItem) => string, members: DisplayTextMember[] = []) {
  const evidenceSource = item.evidenceText || item.summary || item.text;
  const evidenceTitle = sanitizeUserFacingText(formatMemoryText ? formatMemoryText(evidenceSource, item) : evidenceSource, members);
  return evidenceTitle || (isZh(language) ? '暂无证据文本' : 'No evidence text yet');
}

function MemoryCard({ item, includeDebugDetails, language, formatMemoryText, members = [] }: { item: MemoryItem; includeDebugDetails: boolean; language: string; formatMemoryText?: (text: string, item: MemoryItem) => string; members?: DisplayTextMember[] }) {
  const sourceText = item.summary || item.text;
  const displayText = sanitizeUserFacingText(formatMemoryText ? formatMemoryText(sourceText, item) : sourceText, members);
  const evidenceTitle = buildEvidenceTitle(item, language, formatMemoryText, members);
  const metaItems = [memoryStrengthLabel(item, language), ...buildMemoryMetaItems(item, includeDebugDetails, language)].filter(Boolean) as string[];
  const debugText = isZh(language)
    ? `强化 ${item.reinforcementCount} · 置信 ${(item.confidence * 100).toFixed(0)}% · 显著性 ${(item.salience * 100).toFixed(0)}%`
    : `Reinforced ${item.reinforcementCount} · Confidence ${(item.confidence * 100).toFixed(0)}% · Salience ${(item.salience * 100).toFixed(0)}%`;
  return (
    <Tooltip title={evidenceTitle} arrow placement="top-start">
      <Box sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2, bgcolor: item.archivedAt ? 'transparent' : 'action.hover', border: '1px solid', borderColor: item.archivedAt ? 'divider' : 'rgba(148, 163, 184, 0.12)', opacity: item.archivedAt ? 0.72 : 1 }}>
        <Stack spacing={0.6}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{displayText}</Typography>
          <StatChipRow items={metaItems} />
          {includeDebugDetails ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', opacity: 0.85 }}>{debugText}</Typography> : null}
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

function buildMemoryFilters(groups: ReturnType<typeof buildMemoryGroups>, includeDebugDetails: boolean, language: string) {
  const zh = isZh(language);
  return ([
    { key: 'all', label: zh ? '全部' : 'All', items: groups.all, hint: zh ? '当前活跃记忆池，会进入后续检索与表达。' : 'Active memories available to later retrieval and expression.' },
    { key: 'anchors', label: zh ? '锚点' : 'Anchors', items: groups.anchors, hint: zh ? '由长期、反复强化或蒸馏记忆投影出的生命锚点候选。' : 'Long-lived or reinforced memories that may become character anchors.' },
    { key: 'longTerm', label: zh ? '长期' : 'Long-term', items: groups.longTerm, hint: zh ? '稳定判断、长期关系模式和可复用结论。' : 'Stable judgments, durable relationship patterns, and reusable conclusions.' },
    { key: 'episodic', label: zh ? '片段' : 'Episodes', items: groups.episodic, hint: zh ? '阶段性事件和仍有上下文温度的经历。' : 'Recent episodes and experiences that still carry context.' },
    includeDebugDetails ? { key: 'working', label: zh ? '即时' : 'Working', items: groups.working, hint: zh ? '当前几轮或运行态证据，通常只在调试时查看。' : 'Current-turn or runtime evidence, usually for debugging.' } : null,
    { key: 'relationship', label: zh ? '关系' : 'Relationships', items: groups.relationship, hint: zh ? '围绕具体对象形成的关系印象。' : 'Relationship impressions formed around specific people.' },
    { key: 'self', label: zh ? '自我' : 'Self', items: groups.self, hint: zh ? '角色如何理解自己、偏好、创伤或成长。' : 'How the character understands itself, preferences, wounds, or growth.' },
    { key: 'conversation', label: zh ? '会话/线程' : 'Conversation', items: groups.conversation, hint: zh ? '群聊、单聊或私聊线程里的共同记忆。' : 'Shared memory from group, direct, or private threads.' },
    includeDebugDetails ? { key: 'expressionFeedback', label: zh ? '表达反馈' : 'Feedback', items: groups.expressionFeedback, hint: zh ? '用户对表达风格的纠偏记忆。' : 'User corrections about the character expression style.' } : null,
    groups.archived.length ? { key: 'archived', label: zh ? '旧档' : 'Archive', items: groups.archived, hint: zh ? '已归档或沉下去的记忆，只有被人物、话题或旧梗唤醒时才会回到上下文。' : 'Archived memories that return only when cues reactivate them.' } : null,
  ].filter(Boolean)) as Array<{ key: MemoryFilterKey; label: string; items: MemoryItem[]; hint: string }>;
}

function localizeKnownPanelText(text: string, language: string) {
  if (isZh(language)) return text;
  const labels: Record<string, string> = {
    记忆沉淀: 'Memory sediment',
    长期记忆: 'Long-term memory',
    暂无沉淀记忆: 'No settled memory yet',
    暂无结构化记忆: 'No structured memory yet',
  };
  return labels[text] || text;
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
  const [activeFilter, setActiveFilter] = useState<MemoryFilterKey>('all');
  const language = i18n.language;
  const visibleSourceMemories = useMemo(
    () => memories.filter((item) => includeRuntimeEvidence ? true : !isRuntimeEvidenceMemory(item)),
    [includeRuntimeEvidence, memories],
  );
  const groups = useMemo(() => buildMemoryGroups(visibleSourceMemories), [visibleSourceMemories]);
  const filters = useMemo(() => buildMemoryFilters(groups, includeRuntimeEvidence, language), [groups, includeRuntimeEvidence, language]);
  const filteredMemories = useMemo(() => {
    const selected = filters.find((item) => item.key === activeFilter) || filters[0];
    return selected ? selected.items : [];
  }, [activeFilter, filters]);
  const activeMeta = filters.find((item) => item.key === activeFilter) || filters[0];
  const visibleMemories = showAll ? filteredMemories : expanded ? filteredMemories.slice(0, expandedCount) : filteredMemories.slice(0, collapsedCount);
  const displayTitle = localizeKnownPanelText(title, language);
  const displayEmptyText = localizeKnownPanelText(emptyText, language);

  return (
    <SurfaceCard>
      <SectionHeader title={displayTitle} dense action={includeRuntimeEvidence && showDebugChip ? <DebugChip /> : undefined} />
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
        {visibleMemories.length ? <Stack spacing={1}>{visibleMemories.map((item) => <MemoryCard key={item.id} item={item} includeDebugDetails={includeRuntimeEvidence} language={language} formatMemoryText={formatMemoryText} members={members} />)}</Stack> : <Typography variant="caption" color="text.secondary">{displayEmptyText}</Typography>}
        {!showAll && filteredMemories.length > collapsedCount ? <Button size="small" variant="text" onClick={() => setExpanded((prev) => !prev)}>{expanded ? (isZh(language) ? '收起' : 'Collapse') : `${isZh(language) ? '查看更多' : 'Show more'} ${filteredMemories.length}`}</Button> : null}
      </Stack>
    </SurfaceCard>
  );
}
