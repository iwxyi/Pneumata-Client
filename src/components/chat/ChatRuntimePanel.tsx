import { useMemo, useState } from 'react';
import { Box, Chip, Dialog, DialogContent, DialogTitle, Stack, Typography, Button } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import PageSection from '../common/PageSection';
import PrivatePayloadPanel from '../session/PrivatePayloadPanel';
import { retrieveRelevantMemories } from '../../services/memoryRetrieval';
import type { MemoryItem } from '../../services/memoryTypes';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';
import { buildPresentedRelationshipLedger } from '../../services/relationshipPresentation';
import { useSettingsStore } from '../../stores/useSettingsStore';
import DialogueDebugPanel from './DialogueDebugPanel';
import { projectRuntimeTimeline, type ProjectedRuntimeTimelineItem } from '../../services/sessionProjection';
import { RelationshipRadar } from '../controls/RelationshipPanel';
import type { RelationshipLedgerEntry } from '../../types/runtimeEvent';
import { normalizeRelationshipLedgerEntry } from '../../services/relationshipLedger';

interface ChatRuntimePanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  privatePayloads?: Array<{ key: string; title: string; text: string }>;
}

type PairSummary = {
  key: string;
  source: string;
  target: string;
  score: number;
  note: string;
  relation: { warmth: number; competence: number; trust: number; threat: number };
  derived?: { stability?: number; reciprocity?: number; salience?: number };
  ledgerEntry: RelationshipLedgerEntry;
};

function cleanText(text: string) {
  return text
    .replace(/亲近/g, '亲和')
    .replace(/尊重/g, '能力')
    .replace(/态度发生变化/g, '关系发生变化')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '成员')
    .replace(/\bNaN\b/g, '0')
    .trim();
}

function clip(text: string, max = 64) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatSigned(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `${safeValue > 0 ? '+' : ''}${Math.round(safeValue)}`;
}

function formatPairLabel(source: string, target: string) {
  return `${source} ↔ ${target}`;
}

function buildPairStatus(score: number) {
  if (score >= 25) return `升温 ${Math.round(score)}`;
  if (score <= -15) return `紧张 ${Math.abs(Math.round(score))}`;
  return '有波动';
}

function pairStatusColor(score: number) {
  return score >= 0 ? 'success' as const : 'warning' as const;
}

function readSocialEventClusterMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.socialEventCluster || null;
}

function readSocialEventCandidateMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.socialEventCandidate || null;
}

function readSocialEventArtifactMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.socialEventArtifact || null;
}

function readSocialEventEffectMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.socialEventEffect || null;
}

function readRelationshipDeltaMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.relationshipDelta || null;
}

function readRoomShiftMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.roomShift || null;
}

function readMemoryCandidateMeta(item: ProjectedRuntimeTimelineItem) {
  return item.meta?.memoryCandidate || null;
}

function formatEventKind(kind: RuntimeEventV2['kind']) {
  const labels: Record<RuntimeEventV2['kind'], string> = {
    message_generated: '消息生成',
    interaction: '互动',
    relationship_delta: '关系变化',
    room_shift: '房间态势',
    memory_candidate: '记忆候选',
    artifact: '产物',
    event_candidate: '事件候选',
    phase_transition: '阶段切换',
    action_resolution: '动作结算',
    board_state: '棋盘状态',
    score_update: '分数更新',
  };
  return labels[kind] || kind;
}

function formatClusterStage(stage: 'candidate' | 'artifact' | 'effect' | 'opened' | undefined) {
  const labels: Record<string, string> = { candidate: '候选', artifact: '产物', effect: '回流', opened: '已派生' };
  return stage ? labels[stage] || stage : '事件';
}

function formatSocialEventKind(kind: string | undefined) {
  const labels: Record<string, string> = {
    pair_private_thread: '双人私聊',
    social_outing: '线下活动',
    post_moment: '朋友圈动态',
    status_update: '状态更新',
    gift_exchange: '礼物互动',
    conflict_expression: '冲突表达',
    custom: '自定义事件',
  };
  return kind ? labels[kind] || kind : '社交事件';
}

function buildTimelineTitle(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  if (cluster?.eventKind === 'pair_private_thread' && cluster.stage === 'opened') return '双人私聊';
  if (cluster) return `${formatSocialEventKind(cluster.eventKind)} · ${formatClusterStage(cluster.stage)}`;
  return item.event ? formatEventKind(item.event.kind) : item.label;
}

function buildTimelineBody(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  const artifact = readSocialEventArtifactMeta(item);
  const effect = readSocialEventEffectMeta(item);
  const relation = readRelationshipDeltaMeta(item);
  const payload = item.event?.payload as Record<string, unknown> | undefined;
  const topicSnippet = typeof payload?.topicSnippet === 'string' ? payload.topicSnippet : null;
  const participantNames = Array.isArray(payload?.participantNames) ? payload.participantNames.filter((value): value is string => typeof value === 'string') : [];
  if (relation) {
    const parts = [
      relation.delta.warmth ? `亲和${formatSigned(relation.delta.warmth)}` : '',
      relation.delta.competence ? `能力${formatSigned(relation.delta.competence)}` : '',
      relation.delta.trust ? `信任${formatSigned(relation.delta.trust)}` : '',
      relation.delta.threat ? `威胁${formatSigned(relation.delta.threat)}` : '',
    ].filter(Boolean);
    return clip(parts.join(' / '), 88);
  }
  return clip(cleanText(candidate?.title || artifact?.title || artifact?.activityType || (participantNames.length ? `${participantNames.join(' ↔ ')} · ${topicSnippet || effect?.summary || item.text}` : null) || topicSnippet || effect?.summary || item.text), 88);
}

function buildTimelineMeta(item: ProjectedRuntimeTimelineItem) {
  const relation = readRelationshipDeltaMeta(item);
  const room = readRoomShiftMeta(item);
  const memory = readMemoryCandidateMeta(item);
  const candidate = readSocialEventCandidateMeta(item);
  const effect = readSocialEventEffectMeta(item);
  const payload = item.event?.payload as Record<string, unknown> | undefined;
  const projectionKind = typeof payload?.projectionKind === 'string' ? payload.projectionKind : null;
  if (candidate) return cleanText(`候选 · ${formatSocialEventKind(candidate.eventKind)}`);
  if (effect) return cleanText(`回流 · ${projectionKind || effect.effectType}`);
  if (relation) return cleanText(item.label);
  if (room?.delta?.heat || room?.delta?.cohesion || room?.delta?.topicDrift) return `热度 ${formatSigned(room.delta?.heat)} / 凝聚 ${formatSigned(room.delta?.cohesion)}`;
  if (memory) return cleanText(`${memory.kind} · ${Math.round(memory.confidence * 100)}%`);
  return null;
}

function buildTimelineCaption(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  if (cluster?.eventKind === 'pair_private_thread' && cluster.stage === 'opened') return null;
  if (item.event?.kind === 'interaction' || item.event?.kind === 'relationship_delta') return null;
  const actors = item.actorNames?.length ? item.actorNames.join('、') : null;
  const targets = item.targetNames?.length ? item.targetNames.join('、') : null;
  if (!actors && !targets) return null;
  return clip(cleanText(actors && targets ? `${actors} → ${targets}` : actors || targets || ''), 36);
}

function looksLikePrimaryRecentEvent(value: string) {
  return /^热度\s+\d+\s*\/\s*凝聚\s+\d+/.test(value.trim());
}

function buildOverviewRows(chat: GroupChat & { primaryRecentEvent?: string }, members: AICharacter[]) {
  const room = chat.worldState.structuredRoomState;
  const recentEvent = chat.primaryRecentEvent || chat.worldState.recentEvent;
  const activeThread = room?.dominantThread?.length ? room.dominantThread.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ') : null;
  const stageLabel = chat.worldState.phase === 'idle' ? '自由聊天' : chat.worldState.phase;
  return [
    recentEvent && !looksLikePrimaryRecentEvent(recentEvent) ? { key: 'overview-recent', label: '最近', value: recentEvent } : null,
    activeThread ? { key: 'overview-thread', label: '主线', value: activeThread } : null,
    room ? { key: 'overview-room', label: '局势', value: `热度 ${Math.round(room.heat)} / 凝聚 ${Math.round(room.cohesion)}` } : null,
    { key: 'overview-stage', label: '阶段', value: stageLabel },
  ].filter(Boolean).slice(0, 3) as Array<{ key: string; label: string; value: string }>;
}

function timelineTone(item: ProjectedRuntimeTimelineItem) {
  if (readSocialEventClusterMeta(item)) return 'rgba(25, 118, 210, 0.06)';
  if (readRelationshipDeltaMeta(item)) return 'rgba(142, 36, 170, 0.05)';
  if (readRoomShiftMeta(item)) return 'rgba(67, 160, 71, 0.05)';
  return 'action.hover';
}

function buildScenarioRows(chat: GroupChat, members: AICharacter[]) {
  const scenario = chat.scenarioState;
  if (!scenario) return [];
  const roleSummary = (scenario.roleAssignments || []).slice(0, 4).map((item) => `${members.find((member) => member.id === item.actorId)?.name || item.actorId}·${item.roleId}`).join(' / ');
  const factionSummary = (scenario.factions || []).slice(0, 4).map((item) => item.label).join(' / ');
  const rows = [] as Array<{ key: string; label: string; value: string }>;
  if (roleSummary) rows.push({ key: 'roles', label: '角色位', value: roleSummary });
  if (factionSummary) rows.push({ key: 'factions', label: '阵营', value: factionSummary });
  if (scenario.currentTurnActorId) rows.push({ key: 'currentTurn', label: '当前轮次', value: members.find((item) => item.id === scenario.currentTurnActorId)?.name || scenario.currentTurnActorId });
  return rows;
}

function buildBoardRows(chat: GroupChat) {
  const board = chat.scenarioState?.board;
  if (!board) return [];
  return [
    { key: 'boardKind', label: '棋盘', value: board.schema.kind },
    { key: 'boardSize', label: '尺寸', value: `${board.schema.columns || 0} × ${board.schema.rows || 0}` },
    { key: 'pieces', label: '棋子', value: `${board.pieces?.length || 0}` },
  ];
}

function buildRoomContext(chat: GroupChat, members: AICharacter[]) {
  const room = chat.worldState.structuredRoomState;
  if (!room) return [];
  const alliances = (room.alliances || []).slice(0, 1).map((pair) => `联盟 ${pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' + ')}`);
  const conflicts = (room.conflictPairs || []).slice(0, 1).map((pair) => `对线 ${pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ')}`);
  const silenced = (room.silencedActors || []).slice(0, 1).map((id) => `被压制 ${members.find((item) => item.id === id)?.name || id}`);
  const pileOn = room.pileOnTarget ? [`围压 ${members.find((item) => item.id === room.pileOnTarget)?.name || room.pileOnTarget}`] : [];
  return [...pileOn, ...alliances, ...conflicts, ...silenced];
}

function buildTargetPressureState(chat: GroupChat, members: AICharacter[]) {
  const room = chat.worldState.structuredRoomState;
  if (!room) return { rows: [] as Array<{ key: string; label: string; value: string }>, text: null as string | null, chips: [] as string[] };
  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (room.pileOnTarget) rows.push({ key: 'pileOn', label: '围压目标', value: members.find((item) => item.id === room.pileOnTarget)?.name || room.pileOnTarget });
  if (room.dominantThread?.length) rows.push({ key: 'dominantThread', label: '主线目标', value: room.dominantThread.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ') });
  const text = rows.length ? rows.map((row) => `${row.label} ${row.value}`).join(' / ') : null;
  const chips = rows.map((row) => `${row.label} ${row.value}`);
  return { rows, text, chips };
}

function buildPairSummaries(chat: GroupChat, members: AICharacter[], isDeveloperView: boolean) {
  return buildPresentedRelationshipLedger(chat, members)
    .map((item) => ({ key: item.key, source: item.actorName, target: item.targetName, score: item.score, note: item.evidence || '暂无最新证据', relation: item.entry.current, derived: item.entry.derived, ledgerEntry: item.entry }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, isDeveloperView ? 4 : 3);
}

function buildVisibleMemories(chat: GroupChat, isDeveloperView: boolean) {
  const all = retrieveRelevantMemories((chat.layeredMemories || []) as MemoryItem[], {
    speakerId: chat.memberIds[0] || chat.id,
    targetId: chat.memberIds[1] || null,
    conversationId: chat.id,
    maxItems: isDeveloperView ? 6 : 3,
    preferredLayers: ['working', 'episodic', 'long_term'],
    preferredScopes: ['relationship', 'conversation', 'thread', 'character_self', 'system_runtime'],
    preferredSourceTags: ['group_relationship_shift', 'interaction', 'relationship_delta', 'room_shift', 'private_thread_effect', 'private_thread_summary'],
    blockedSourceTags: ['direct_user_message', 'direct_ai_follow_up', 'ai_direct_starter_message', 'ai_direct_target_message'],
    relationshipBoost: true,
    selfMemoryBoost: true,
    conversationBoost: true,
  });
  return isDeveloperView ? all : all.filter((item) => item.layer !== 'working').slice(0, 8);
}

function buildChatMemoryGroups(chat: GroupChat) {
  const items = (chat.layeredMemories || []) as MemoryItem[];
  return {
    longTerm: items.filter((item) => item.layer === 'long_term'),
    episodic: items.filter((item) => item.layer === 'episodic'),
    working: items.filter((item) => item.layer === 'working'),
    relationship: items.filter((item) => item.scope === 'relationship'),
    conversation: items.filter((item) => item.scope === 'conversation'),
    thread: items.filter((item) => item.scope === 'thread'),
    runtime: items.filter((item) => item.scope === 'system_runtime'),
  };
}

function buildMemoryLayerLabel(layer: MemoryItem['layer']) {
  const labels: Record<MemoryItem['layer'], string> = { working: '即时', episodic: '阶段', long_term: '长期' };
  return labels[layer] || layer;
}

function buildMemoryScopeLabel(scope: MemoryItem['scope']) {
  const labels: Record<MemoryItem['scope'], string> = { conversation: '会话', character_self: '角色', relationship: '关系', thread: '线程', system_runtime: '系统' };
  return labels[scope] || scope;
}

function buildMemoryKindLabel(kind: MemoryItem['kind']) {
  const labels: Record<MemoryItem['kind'], string> = { decision: '决策', conflict: '冲突', bond: '连接', resentment: '芥蒂', status_shift: '状态', trait_evidence: '特征', bias: '偏向', taboo: '禁忌', obsession: '执念', artifact: '产物', thread_effect: '线程影响' };
  return labels[kind] || kind;
}

function buildAdvancedMemoryRows(items: MemoryItem[]) {
  return items.map((item) => ({ id: item.id, title: `${buildMemoryLayerLabel(item.layer)} · ${buildMemoryKindLabel(item.kind)}`, meta: `${buildMemoryScopeLabel(item.scope)} · 强化 ${item.reinforcementCount} · 置信 ${(item.confidence * 100).toFixed(0)}%`, text: clip(cleanText(item.text), 96) }));
}

function buildMemorySummaryLine(items: MemoryItem[]) {
  return items.slice(0, 2).map((item) => clip(cleanText(item.text), 28)).join(' / ');
}

function buildMemoryPanelState(items: MemoryItem[], expanded: boolean, isDeveloperView: boolean) {
  const visible = isDeveloperView || items.length > 0;
  const rows = (expanded || isDeveloperView)
    ? buildAdvancedMemoryRows(items)
    : items.slice(0, 2).map((item) => ({ id: item.id, title: `${buildMemoryLayerLabel(item.layer)} · ${buildMemoryKindLabel(item.kind)}`, text: clip(cleanText(item.text), 72) }));
  return {
    visible,
    canExpand: items.length > 1,
    rows,
    summary: buildMemorySummaryLine(items),
    statItems: [items.length ? `${items.length} 条` : '暂无', ...items.slice(0, 3).map((item) => `${buildMemoryLayerLabel(item.layer)}·${buildMemoryKindLabel(item.kind)}`)],
    emptyText: '暂无明显沉淀',
    buttonText: expanded ? (isDeveloperView ? '收起调试细节' : '收起') : (isDeveloperView ? '展开调试细节' : '查看更多'),
    header: {
      title: isDeveloperView ? '聊天记忆' : '记忆与成长',
      subtitle: items.length ? (isDeveloperView ? `展示 ${items.length} 条结构化记忆` : items.slice(0, 2).map((item) => `${buildMemoryLayerLabel(item.layer)}·${buildMemoryKindLabel(item.kind)}`).join(' / ')) : (isDeveloperView ? '暂无结构化聊天记忆' : undefined),
    },
  };
}

function buildMemoryPanelButtonVariant() {
  return 'text' as const;
}

function buildMemoryPanelOpenState(isDeveloperView: boolean) {
  return isDeveloperView;
}

function buildMemoryPanelRowMeta(item: { meta?: string; text: string; title: string }) {
  return item.meta || null;
}

function buildMemoryPanelRowText(item: { text: string; title: string; meta?: string }) {
  return item.text;
}

function buildMemoryPanelRowTitle(item: { title: string; text: string; meta?: string }) {
  return item.title;
}

function PairDetailDialog({ open, onClose, pair }: { open: boolean; onClose: () => void; pair: PairSummary | null }) {
  if (!pair) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{formatPairLabel(pair.source, pair.target)}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Typography variant="body2">{pair.note}</Typography>
          <RelationshipRadar entry={normalizeRelationshipLedgerEntry(pair.ledgerEntry)} onOpenAxis={() => undefined} />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default function ChatRuntimePanel({ chat, members, privatePayloads = [] }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const [memoryExpanded, setMemoryExpanded] = useState(buildMemoryPanelOpenState(false));
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;
  const isAdvancedRuntimeView = developerMode && showAdvancedRuntimePanels;

  const pairSummaries = useMemo(() => buildPairSummaries(chat, members, isDeveloperView), [chat, members, isDeveloperView]);
  const roomRows = useMemo(() => buildOverviewRows(chat, members), [chat, members]);
  const roomContext = useMemo(() => buildRoomContext(chat, members), [chat, members]);
  const targetPressure = useMemo(() => buildTargetPressureState(chat, members), [chat, members]);
  const visibleMemories = useMemo(() => buildVisibleMemories(chat, isDeveloperView), [chat, isDeveloperView]);
  const chatMemoryGroups = useMemo(() => buildChatMemoryGroups(chat), [chat]);
  const projectedTimeline = useMemo(() => projectRuntimeTimeline(chat, members), [chat, members]);
  const displayTimeline = useMemo(() => projectedTimeline.filter((item) => timelineFilter === 'all' ? true : timelineFilter === 'artifact' ? item.type === 'artifact' || Boolean(readSocialEventClusterMeta(item)) : item.type === timelineFilter).slice().reverse().slice(0, isDeveloperView ? 8 : 5), [projectedTimeline, timelineFilter, isDeveloperView]);
  const activePair = pairSummaries.find((item) => item.key === activePairKey) || null;
  const memoryPanel = buildMemoryPanelState(visibleMemories, memoryExpanded, isDeveloperView);
  const memorySummary = memoryPanel.summary;
  const structureRows = [...buildScenarioRows(chat, members), ...buildBoardRows(chat)];

  return (
    <>
      <PageSection spacing={1.5}>
        <SurfaceCard>
          <SectionHeader title="运行概览" dense />
          <Stack spacing={0.8}>
            {roomRows.length ? roomRows.map((row) => (
              <Box key={row.key} sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">{row.label}</Typography>
                <Typography variant="body2" sx={{ mt: 0.2 }}>{cleanText(row.value)}</Typography>
              </Box>
            )) : <Typography variant="body2">暂无结构化房间态势</Typography>}
            {memorySummary ? <Typography variant="caption" color="text.secondary">{memorySummary}</Typography> : null}
            {[...roomContext.slice(0, 2), ...targetPressure.chips.slice(0, 2)].length ? <StatChipRow items={[...roomContext.slice(0, 2), ...targetPressure.chips.slice(0, 2)].map((chip) => cleanText(chip))} /> : null}
            {structureRows.length && isDeveloperView ? (
              <Box sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">场景结构</Typography>
                <Typography variant="body2" sx={{ mt: 0.2 }}>{structureRows.map((row) => cleanText(`${row.label} ${row.value}`)).join(' / ')}</Typography>
              </Box>
            ) : null}
          </Stack>
        </SurfaceCard>


        <SurfaceCard>
          <SectionHeader title="关系脉络" dense />
          <Stack spacing={0.9}>
            {pairSummaries.map((pair) => (
              <Box key={pair.key} sx={{ p: 1, borderRadius: 2, bgcolor: timelineTone({ type: 'relationship', text: '', label: '', event: null } as ProjectedRuntimeTimelineItem), cursor: 'pointer' }} onClick={() => setActivePairKey(pair.key)}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatPairLabel(pair.source, pair.target)}</Typography>
                  <Chip size="small" label={buildPairStatus(pair.score)} color={pairStatusColor(pair.score)} variant="outlined" />
                </Box>
                <Typography variant="caption" color="text.secondary">{pair.note}</Typography>
              </Box>
            ))}
            {!pairSummaries.length ? <Typography variant="body2">暂无明显关系变化</Typography> : null}
          </Stack>
        </SurfaceCard>

        <SurfaceCard>
          <SectionHeader title={memoryPanel.header.title} subtitle={memoryPanel.header.subtitle} dense action={isDeveloperView ? <Chip size="small" label="调试" color="warning" variant="outlined" /> : undefined} />
          <Stack spacing={0.8}>
            {memoryPanel.visible ? memoryPanel.rows.map((item) => (
              <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">{buildMemoryPanelRowTitle(item)}</Typography>
                {buildMemoryPanelRowMeta(item) ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{buildMemoryPanelRowMeta(item)}</Typography> : null}
                <Typography variant="body2">{buildMemoryPanelRowText(item)}</Typography>
              </Box>
            )) : <Typography variant="body2">{memoryPanel.emptyText}</Typography>}
            {memoryPanel.canExpand ? <Button size="small" variant={buildMemoryPanelButtonVariant()} onClick={() => setMemoryExpanded((prev) => !prev)}>{memoryPanel.buttonText}</Button> : null}
          </Stack>
        </SurfaceCard>

        {isDeveloperView ? (
          <SurfaceCard>
            <SectionHeader title="聊天记忆分层" dense action={<Chip size="small" label="调试" color="warning" variant="outlined" />} />
            <Stack spacing={0.8}>
              {([
                ['长期记忆', chatMemoryGroups.longTerm],
                ['情节记忆', chatMemoryGroups.episodic],
                ['即时记忆', chatMemoryGroups.working],
                ['关系影响', chatMemoryGroups.relationship],
                ['会话记忆', chatMemoryGroups.conversation],
                ['线程记忆', chatMemoryGroups.thread],
                ['系统运行态', chatMemoryGroups.runtime],
              ] as Array<[string, MemoryItem[]]>).map(([label, items]) => (
                <Box key={String(label)} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary">{label} · {(items as MemoryItem[]).length} 条</Typography>
                  <Typography variant="body2">{((items as MemoryItem[]).length ? (items as MemoryItem[]).slice(0, 3).map((item) => cleanText(item.text)).join(' / ') : `暂无${label}`)}</Typography>
                </Box>
              ))}
            </Stack>
          </SurfaceCard>
        ) : null}

        <SurfaceCard>
          <SectionHeader title="运行时间线" dense />
          <Stack spacing={0.8}>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(['all', 'note', 'artifact', 'relationship'] as const).map((filter) => <Chip key={filter} size="small" label={filter === 'all' ? '全部' : filter === 'note' ? '注记' : filter === 'artifact' ? '产物' : '关系'} color={timelineFilter === filter ? 'primary' : 'default'} variant={timelineFilter === filter ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(filter)} />)}
            </Box>
            {displayTimeline.length ? displayTimeline.map((item, index) => (
              <Box key={`${item.label}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: timelineTone(item) }}>
                <Typography variant="caption" color="text.secondary">{buildTimelineTitle(item)}</Typography>
                <Typography variant="body2">{buildTimelineBody(item)}</Typography>
                {buildTimelineMeta(item) ? <Typography variant="caption" color="text.secondary">{buildTimelineMeta(item)}</Typography> : null}
                {buildTimelineCaption(item) ? <Typography variant="caption" color="text.secondary">{buildTimelineCaption(item)}</Typography> : null}
              </Box>
            )) : <Typography variant="body2">暂无运行事件</Typography>}
          </Stack>
        </SurfaceCard>

        {privatePayloads.length ? <PrivatePayloadPanel payloads={privatePayloads} /> : null}
        {(isSpeechStyleView || isAdvancedRuntimeView) ? <DialogueDebugPanel chat={chat} /> : null}
      </PageSection>
      <PairDetailDialog open={Boolean(activePair)} onClose={() => setActivePairKey(null)} pair={activePair} />
    </>
  );
}
