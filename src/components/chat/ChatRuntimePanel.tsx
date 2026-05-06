import { useMemo, useState } from 'react';
import { Box, Chip, Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
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

function safeNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatSigned(value: number | undefined) {
  const safeValue = safeNumber(value);
  return `${safeValue > 0 ? '+' : ''}${Math.round(safeValue)}`;
}

function formatPairLabel(source: string, target: string) {
  return `${source} ↔ ${target}`;
}

function buildPairScore(relation: PairSummary['relation']) {
  return safeNumber(relation.warmth) + safeNumber(relation.competence) + safeNumber(relation.trust) - safeNumber(relation.threat);
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
  };
  return labels[kind] || kind;
}

function formatClusterStage(stage: 'candidate' | 'artifact' | 'effect' | 'opened' | undefined) {
  const labels: Record<string, string> = {
    candidate: '候选',
    artifact: '产物',
    effect: '回流',
    opened: '已派生',
  };
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
  if (cluster) return `${formatSocialEventKind(cluster.eventKind)} · ${formatClusterStage(cluster.stage)}`;
  return item.event ? formatEventKind(item.event.kind) : item.label;
}

function buildTimelineBody(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  const artifact = readSocialEventArtifactMeta(item);
  const effect = readSocialEventEffectMeta(item);
  return clip(cleanText(candidate?.title || artifact?.title || artifact?.activityType || effect?.summary || item.text), 88);
}

function buildTimelineMeta(item: ProjectedRuntimeTimelineItem) {
  const relation = readRelationshipDeltaMeta(item);
  const room = readRoomShiftMeta(item);
  const memory = readMemoryCandidateMeta(item);
  const candidate = readSocialEventCandidateMeta(item);
  const effect = readSocialEventEffectMeta(item);

  if (candidate) return cleanText(`候选 · ${formatSocialEventKind(candidate.eventKind)}`);
  if (effect) return cleanText(`回流 · ${effect.effectType}`);
  if (relation) return cleanText(`关系 · ${relation.reason}`);
  if (room?.delta?.heat || room?.delta?.cohesion || room?.delta?.topicDrift) {
    return `热度 ${formatSigned(room.delta?.heat)} / 凝聚 ${formatSigned(room.delta?.cohesion)}`;
  }
  if (memory) return cleanText(`${memory.kind} · ${Math.round(memory.confidence * 100)}%`);
  return null;
}

function buildTimelineCaption(item: ProjectedRuntimeTimelineItem) {
  const actors = item.actorNames?.length ? item.actorNames.join('、') : null;
  const targets = item.targetNames?.length ? item.targetNames.join('、') : null;
  if (!actors && !targets) return null;
  return clip(cleanText(actors && targets ? `${actors} → ${targets}` : actors || targets || ''), 36);
}

function timelineTone(item: ProjectedRuntimeTimelineItem) {
  if (readSocialEventClusterMeta(item)) return 'rgba(25, 118, 210, 0.06)';
  if (readRelationshipDeltaMeta(item)) return 'rgba(142, 36, 170, 0.05)';
  if (readRoomShiftMeta(item)) return 'rgba(67, 160, 71, 0.05)';
  return 'action.hover';
}

function buildPairSummaries(chat: GroupChat, members: AICharacter[], isDeveloperView: boolean) {
  return buildPresentedRelationshipLedger(chat, members)
    .map((item) => ({
      key: item.key,
      source: item.actorName,
      target: item.targetName,
      score: item.score,
      note: item.evidence || '暂无最新证据',
      relation: item.entry.current,
      derived: item.entry.derived,
      ledgerEntry: item.entry,
    }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, isDeveloperView ? 4 : 3);
}

function buildRoomRows(chat: GroupChat, members: AICharacter[]) {
  const room = chat.worldState.structuredRoomState;
  if (!room) return [];
  return [
    { key: 'heat', label: '热度', value: `${Math.round(room.heat)}` },
    { key: 'cohesion', label: '凝聚', value: `${Math.round(room.cohesion)}` },
    { key: 'topicDrift', label: '跑题', value: `${Math.round(room.topicDrift)}` },
    { key: 'thread', label: '主线程', value: room.dominantThread ? room.dominantThread.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ') : '暂无' },
  ];
}

function buildRoomContext(chat: GroupChat, members: AICharacter[]) {
  const room = chat.worldState.structuredRoomState;
  if (!room) return [];
  const alliances = (room.alliances || []).slice(0, 1).map((pair) => `联盟 ${pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' + ')}`);
  const conflicts = (room.conflictPairs || []).slice(0, 1).map((pair) => `对线 ${pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ')}`);
  const silenced = (room.silencedActors || []).slice(0, 1).map((id) => `被压制 ${members.find((item) => item.id === id)?.name || id}`);
  return [...alliances, ...conflicts, ...silenced];
}

function buildVisibleMemories(chat: GroupChat, isDeveloperView: boolean) {
  const all = retrieveRelevantMemories((chat.layeredMemories || []) as MemoryItem[], {
    speakerId: chat.memberIds[0] || chat.id,
    targetId: chat.memberIds[1] || null,
    conversationId: chat.id,
    maxItems: isDeveloperView ? 4 : 2,
  });
  return isDeveloperView ? all : all.filter((item) => item.layer !== 'working').slice(0, 2);
}

function PairDetailDialog({ open, onClose, pair }: { open: boolean; onClose: () => void; pair: PairSummary | null }) {
  const [activeAxis, setActiveAxis] = useState<string | null>(null);
  if (!pair) return null;
  const normalizedEntry = normalizeRelationshipLedgerEntry(pair.ledgerEntry);
  const hasNonZeroRadar = ['warmth', 'competence', 'trust', 'threat'].some((axis) => Math.abs(normalizedEntry.current[axis as keyof typeof normalizedEntry.current]) > 0);
  const detailChips = [
    `亲和 ${formatSigned(pair.relation.warmth)}`,
    `能力 ${formatSigned(pair.relation.competence)}`,
    `信任 ${formatSigned(pair.relation.trust)}`,
    `威胁 ${formatSigned(pair.relation.threat)}`,
  ];
  const derivedChips = [
    typeof pair.derived?.stability === 'number' ? `稳定 ${Math.round(pair.derived.stability)}` : null,
    typeof pair.derived?.salience === 'number' ? `显著 ${Math.round(pair.derived.salience)}` : null,
    typeof pair.derived?.reciprocity === 'number' ? `对称 ${Math.round(pair.derived.reciprocity)}` : null,
  ].filter(Boolean) as string[];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{formatPairLabel(pair.source, pair.target)}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Typography variant="body2">{pair.note}</Typography>
          {hasNonZeroRadar ? <RelationshipRadar entry={normalizedEntry} onOpenAxis={(axis) => setActiveAxis(axis)} /> : <Typography variant="caption" color="text.secondary">该关系目前还没有形成明显的结构化四轴偏移。</Typography>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {detailChips.map((chip) => <Chip key={chip} size="small" label={chip} variant="outlined" />)}
          </Box>
          {derivedChips.length ? <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{derivedChips.map((chip) => <Chip key={chip} size="small" label={chip} variant="outlined" />)}</Box> : null}
          {activeAxis ? <Typography variant="caption" color="text.secondary">轴详情请在成员页关系卡中查看完整原因链。</Typography> : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default function ChatRuntimePanel({ chat, members, privatePayloads = [] }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;

  const pairSummaries = useMemo(() => buildPairSummaries(chat, members, isDeveloperView), [chat, members, isDeveloperView]);
  const roomRows = useMemo(() => buildRoomRows(chat, members), [chat, members]);
  const roomContext = useMemo(() => buildRoomContext(chat, members), [chat, members]);
  const visibleMemories = useMemo(() => buildVisibleMemories(chat, isDeveloperView), [chat, isDeveloperView]);
  const projectedTimeline = useMemo(() => projectRuntimeTimeline(chat, members), [chat, members]);
  const displayTimeline = useMemo(() => projectedTimeline.filter((item) => timelineFilter === 'all' ? true : timelineFilter === 'artifact' ? item.type === 'artifact' || Boolean(readSocialEventClusterMeta(item)) : item.type === timelineFilter).slice().reverse().slice(0, isDeveloperView ? 8 : 5), [projectedTimeline, timelineFilter, isDeveloperView]);
  const activePair = pairSummaries.find((item) => item.key === activePairKey) || null;
  const roomSummary = roomRows.slice(0, 3).map((row) => `${row.label} ${cleanText(row.value)}`).join(' / ');
  const memorySummary = visibleMemories.map((item) => clip(cleanText(item.text), 28)).join(' / ');

  return (
    <>
      <PageSection spacing={1.5}>
        <SurfaceCard>
          <SectionHeader title="运行概览" dense />
          <Typography variant="body2">{roomSummary || '暂无结构化房间态势'}</Typography>
          {memorySummary ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{memorySummary}</Typography> : null}
          {roomContext.length ? <Box sx={{ mt: 0.75 }}><StatChipRow items={roomContext.slice(0, 1).map((chip) => cleanText(chip))} /></Box> : null}
        </SurfaceCard>

        <Divider flexItem />

        <SurfaceCard>
          <SectionHeader title="关键关系动态" subtitle={pairSummaries.length ? `当前优先展示 ${pairSummaries.slice(0, 2).length} 条最显著关系` : undefined} dense />
          {pairSummaries.length ? (
            <Stack spacing={0.75}>
              {pairSummaries.slice(0, 2).map((pair) => (
                <Box key={pair.key} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatPairLabel(pair.source, pair.target)}</Typography>
                    <Chip size="small" label={buildPairStatus(pair.score)} color={pairStatusColor(pair.score)} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{clip(pair.note, 48)}</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <StatChipRow items={[`信任 ${formatSigned(pair.relation.trust)}`, `威胁 ${formatSigned(pair.relation.threat)}`]} />
                  </Box>
                  <Box sx={{ mt: 0.5 }}>
                    <Chip size="small" label="详情" variant="outlined" onClick={() => setActivePairKey(pair.key)} sx={{ cursor: 'pointer' }} />
                  </Box>
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="body2" color="text.secondary">暂无突出关系变化</Typography>}
        </SurfaceCard>

        <SurfaceCard>
          <SectionHeader title={`事件时间线${displayTimeline.length ? ` · ${displayTimeline.length}` : ''}`} dense />
          <Box sx={{ mb: 1 }}>
            <StatChipRow items={[
              timelineFilter === 'all' ? '全部' : timelineFilter === 'relationship' ? '关系' : timelineFilter === 'artifact' ? '社交' : (isDeveloperView ? '记忆' : '沉淀'),
            ]} />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mb: 1 }}>
            {[
              ['all', '全部'],
              ['relationship', '关系'],
              ['artifact', '社交'],
              ['note', isDeveloperView ? '记忆' : '沉淀'],
            ].map(([value, label]) => (
              <Chip key={value} size="small" label={label} color={timelineFilter === value ? 'primary' : 'default'} variant={timelineFilter === value ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(value as 'all' | 'note' | 'artifact' | 'relationship')} />
            ))}
          </Box>
          {displayTimeline.length ? (
            <Stack spacing={0.85}>
              {displayTimeline.map((item, index) => {
                const meta = buildTimelineMeta(item);
                const caption = buildTimelineCaption(item);
                return (
                  <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: timelineTone(item) }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="text.secondary">{buildTimelineTitle(item)}</Typography>
                      {meta ? <Typography variant="caption" color="text.secondary">{meta}</Typography> : null}
                    </Box>
                    <Typography variant="body2" sx={{ mt: 0.25 }}>{buildTimelineBody(item)}</Typography>
                    {caption ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{caption}</Typography> : null}
                  </Box>
                );
              })}
            </Stack>
          ) : <Typography variant="body2" color="text.secondary">暂无关键事件</Typography>}
        </SurfaceCard>

        {(isDeveloperView || visibleMemories.length > 0) ? (
          <SurfaceCard>
            <SectionHeader title={isDeveloperView ? '记忆调试' : '关键记忆'} dense />
            {visibleMemories.length ? (
              <Stack spacing={0.85}>
                {visibleMemories.map((item) => (
                  <Box key={item.id} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="body2">{clip(cleanText(item.text), 72)}</Typography>
                    {isDeveloperView ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{`强化 ${item.reinforcementCount} · 置信 ${(item.confidence * 100).toFixed(0)}%`}</Typography> : null}
                  </Box>
                ))}
              </Stack>
            ) : <Typography variant="body2" color="text.secondary">暂无明显沉淀</Typography>}
          </SurfaceCard>
        ) : null}

        {privatePayloads.length ? <PrivatePayloadPanel payloads={privatePayloads} /> : null}
        {isSpeechStyleView ? <DialogueDebugPanel chat={chat} /> : null}
      </PageSection>
      <PairDetailDialog open={Boolean(activePair)} onClose={() => setActivePairKey(null)} pair={activePair} />
    </>
  );
}
