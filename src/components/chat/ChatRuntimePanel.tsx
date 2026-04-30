import { useMemo, useState } from 'react';
import { Box, Card, CardContent, Chip, Dialog, DialogContent, DialogTitle, LinearProgress, Stack, Typography } from '@mui/material';
import PrivatePayloadPanel from '../session/PrivatePayloadPanel';
import { retrieveRelevantMemories } from '../../services/memoryRetrieval';
import type { MemoryItem } from '../../services/memoryTypes';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { MemoryCandidatePayload, RuntimeEventV2, SocialEventCandidatePayload, SocialEventEffectPayload, SocialEventKind } from '../../types/runtimeEvent';
import { useSettingsStore } from '../../stores/useSettingsStore';
import SimpleBarChart from '../common/SimpleBarChart';
import DialogueDebugPanel from './DialogueDebugPanel';
import { projectLatestRuntimeEvent, projectRuntimeTimeline, type ProjectedRuntimeTimelineItem } from '../../services/sessionProjection';

function readSocialEventArtifactMeta(item: { meta?: { socialEventArtifact?: { eventKind?: string; artifactType?: string; title?: string; activityType?: string; dedupeKey?: string | null; participantIds?: string[]; targetIds?: string[]; expectedArtifacts?: string[]; timeHint?: string | null; locationHint?: string | null; candidateId?: string; reasonType?: string } } }) {
  return item.meta?.socialEventArtifact || null;
}

function readSocialEventEffectMeta(item: { meta?: { socialEventEffect?: SocialEventEffectPayload } }) {
  return item.meta?.socialEventEffect || null;
}

function readSocialEventClusterMeta(item: { meta?: { socialEventCluster?: { eventKind?: string; dedupeKey?: string | null; stage: 'candidate' | 'artifact' | 'effect' | 'opened' } } }) {
  return item.meta?.socialEventCluster || null;
}

function readMemoryCandidateMeta(item: { meta?: { memoryCandidate?: MemoryCandidatePayload } }) {
  return item.meta?.memoryCandidate || null;
}

function readRelationshipDeltaMeta(item: { meta?: { relationshipDelta?: { reason: string; delta: { warmth?: number; competence?: number; trust?: number; threat?: number }; axisReasons?: Partial<Record<'warmth' | 'competence' | 'trust' | 'threat', Array<{ axis: 'warmth' | 'competence' | 'trust' | 'threat'; value: number; reason: string; evidence: string; createdAt?: number }>>>; spikeType?: 'normal' | 'turning_point' | 'rupture' | 'bonding' } } }) {
  return item.meta?.relationshipDelta || null;
}

function buildRelationshipAxisMeta(item: NonNullable<ReturnType<typeof readRelationshipDeltaMeta>>) {
  return [
    { key: 'warmth' as const, label: '亲和', value: item.delta.warmth, reasons: item.axisReasons?.warmth || [] },
    { key: 'competence' as const, label: '能力', value: item.delta.competence, reasons: item.axisReasons?.competence || [] },
    { key: 'trust' as const, label: '信任', value: item.delta.trust, reasons: item.axisReasons?.trust || [] },
    { key: 'threat' as const, label: '威胁', value: item.delta.threat, reasons: item.axisReasons?.threat || [] },
  ].filter((axis) => typeof axis.value === 'number');
}

function RelationshipReasonDialog({ open, onClose, axisLabel, reasons }: { open: boolean; onClose: () => void; axisLabel: string; reasons: Array<{ axis: 'warmth' | 'competence' | 'trust' | 'threat'; value: number; reason: string; evidence: string; createdAt?: number }> }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{axisLabel} 变化原因</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {reasons.length ? reasons.map((reason, index) => (
            <Box key={`${reason.axis}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">{reason.reason} · {formatSignedNumber(reason.value)}</Typography>
              <Typography variant="body2">{reason.evidence}</Typography>
            </Box>
          )) : <Typography variant="body2" color="text.secondary">暂无单独原因记录</Typography>}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function RelationshipAxisChips({ item, onOpen }: { item: NonNullable<ReturnType<typeof readRelationshipDeltaMeta>>; onOpen: (axisLabel: string, reasons: Array<{ axis: 'warmth' | 'competence' | 'trust' | 'threat'; value: number; reason: string; evidence: string; createdAt?: number }>) => void }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
      {buildRelationshipAxisMeta(item).map((axis) => (
        <Chip key={axis.key} size="small" label={buildSignedMetricLabel(axis.label, axis.value)} variant="outlined" onClick={() => onOpen(axis.label, axis.reasons)} sx={{ cursor: 'pointer' }} />
      ))}
    </Box>
  );
}

function formatSpikeType(spikeType: 'normal' | 'turning_point' | 'rupture' | 'bonding' | undefined) {
  const labels: Record<string, string> = {
    normal: '常规',
    turning_point: '转折点',
    rupture: '破裂',
    bonding: '强化绑定',
  };
  return spikeType ? (labels[spikeType] || spikeType) : null;
}

function RelationshipDeltaBlock({ item, onOpen }: { item: NonNullable<ReturnType<typeof readRelationshipDeltaMeta>>; onOpen: (axisLabel: string, reasons: Array<{ axis: 'warmth' | 'competence' | 'trust' | 'threat'; value: number; reason: string; evidence: string; createdAt?: number }>) => void }) {
  return (
    <>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
        <Chip size="small" label={`关系 ${item.reason}`} variant="outlined" />
        {formatSpikeType(item.spikeType) ? <Chip size="small" label={formatSpikeType(item.spikeType) || ''} color="secondary" variant="outlined" /> : null}
      </Box>
      <RelationshipAxisChips item={item} onOpen={onOpen} />
    </>
  );
}

function RelationshipGraphLegend({ label, value }: { label: string; value: number }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="caption" color="text.secondary">{value}</Typography>
      </Box>
      <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, 50 + value / 2))} sx={{ height: 5, borderRadius: 999 }} />
    </Box>
  );
}

function RelationshipGraphDetails({ relation, derived }: { relation: { warmth: number; competence: number; trust: number; threat: number }; derived?: { stability?: number; reciprocity?: number; salience?: number } }) {
  return (
    <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
      <RelationshipGraphLegend label="亲和" value={relation.warmth} />
      <RelationshipGraphLegend label="能力" value={relation.competence} />
      <RelationshipGraphLegend label="信任" value={relation.trust} />
      <RelationshipGraphLegend label="威胁" value={relation.threat} />
      {derived ? (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
          {typeof derived.stability === 'number' ? <Chip size="small" variant="outlined" label={`稳定 ${Math.round(derived.stability)}`} /> : null}
          {typeof derived.salience === 'number' ? <Chip size="small" variant="outlined" label={`显著 ${Math.round(derived.salience)}`} /> : null}
          {typeof derived.reciprocity === 'number' ? <Chip size="small" variant="outlined" label={`对称 ${Math.round(derived.reciprocity)}`} /> : null}
        </Box>
      ) : null}
    </Box>
  );
}

function safeNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function relationshipHeatLabel(score: number) {
  const safeScore = safeNumber(score);
  return safeScore >= 0 ? `升温 ${Math.round(safeScore)}` : `紧张 ${Math.abs(Math.round(safeScore))}`;
}

function relationshipHeatColor(score: number) {
  return safeNumber(score) >= 0 ? 'success' as const : 'warning' as const;
}

function relationshipFallbackText(score: number) {
  return safeNumber(score) >= 0 ? '关系升温中' : '关系紧张中';
}

function relationshipScore(relation: { warmth: number; competence: number; trust: number; threat: number }) {
  return safeNumber(relation.warmth) + safeNumber(relation.competence) + safeNumber(relation.trust) - safeNumber(relation.threat);
}

function normalizeLegacyRelationshipTerms(text: string) {
  return text
    .replace(/亲近/g, '亲和')
    .replace(/尊重/g, '能力')
    .replace(/态度发生变化/g, '关系发生变化');
}

function cleanTimelineText(text: string) {
  return normalizeLegacyRelationshipTerms(text)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '成员')
    .replace(/\bNaN\b/g, '0')
    .trim();
}

function cleanMemorySummary(text: string) {
  return clipLabel(cleanTimelineText(text), 80);
}

function buildRelationshipHeadline(source: string, target: string, score: number) {
  const safeScore = safeNumber(score);
  return `${source}→${target} ${safeScore >= 0 ? `升温 ${Math.round(safeScore)}` : `紧张 ${Math.abs(Math.round(safeScore))}`}`;
}

function buildPrimaryRecentEventLabel(structuredRoomState: GroupChat['worldState']['structuredRoomState'], fallback: string) {
  if (structuredRoomState) return `热度 ${formatMetricValue(structuredRoomState.heat)} / 凝聚 ${formatMetricValue(structuredRoomState.cohesion)}`;
  return cleanTimelineText(fallback);
}

function buildObservationChips(firstRelationshipLabel: string | null, topInteractionChip: string | null, roomShiftDeltaLabel: string | null, primaryRecentEvent: string) {
  return [firstRelationshipLabel, topInteractionChip, roomShiftDeltaLabel, primaryRecentEvent ? clipLabel(primaryRecentEvent, 22) : null].filter(Boolean) as string[];
}

function buildSocialClusterDescription(entry: { participants: Set<string>; targets: Set<string>; title?: string | null; reason?: string | null }) {
  return [
    entry.participants.size ? Array.from(entry.participants).join('、') : null,
    entry.targets.size ? `→ ${Array.from(entry.targets).join('、')}` : null,
    entry.title,
    entry.reason,
  ].filter(Boolean).join(' · ') || null;
}

function describeSocialClusterTitle(entry: { eventKind?: string; stages: Set<'candidate' | 'artifact' | 'effect' | 'opened'>; count: number }) {
  return `${formatSocialEventKind(entry.eventKind)} ${Array.from(entry.stages).map((stage) => formatSocialEventStage(stage)).join('→')} ×${entry.count}`;
}

function buildTimelineHeadingText(item: ProjectedRuntimeTimelineItem, fallback: string) {
  return cleanTimelineText(fallback || item.text);
}

function buildTimelineBodyText(item: ProjectedRuntimeTimelineItem, fallback: string) {
  const text = cleanTimelineText(fallback || item.text);
  const participantCaption = describeTimelineParticipants(item);
  return participantCaption && text.startsWith(participantCaption) ? text.slice(participantCaption.length).replace(/^[：:\s·-]+/, '') || text : text;
}

function buildMemoryCardText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeRuntimeCardText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeDialogReasonText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeDialogEvidenceText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeSummaryLine(text: string) {
  return cleanTimelineText(text);
}

function sanitizeMemoryText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeMetricLabel(text: string) {
  return cleanTimelineText(text);
}

function sanitizeChipText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeClusterDescription(text: string) {
  return cleanTimelineText(text);
}

function sanitizeTimelineText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeMemoryDebugText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeRelationshipReasonEvidence(text: string) {
  return cleanTimelineText(text);
}

function sanitizeRelationshipReasonReason(text: string) {
  return cleanTimelineText(text);
}

function sanitizeCardText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeLabelText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeCaption(text: string) {
  return cleanTimelineText(text);
}

function sanitizeDescription(text: string) {
  return cleanTimelineText(text);
}

function sanitizeTitle(text: string) {
  return cleanTimelineText(text);
}

function sanitizeText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeLine(text: string) {
  return cleanTimelineText(text);
}

function sanitizeParagraph(text: string) {
  return cleanTimelineText(text);
}

function sanitizeSummary(text: string) {
  return cleanTimelineText(text);
}

function sanitizeGenericText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnySummary(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyLabel(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyCaption(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDescription(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyBody(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyNote(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyTitle(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMeta(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyValue(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyHeading(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyCard(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyPanel(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRuntime(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyCluster(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMemory(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyObservation(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRelationship(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRoom(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyState(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDialog(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyUi(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDisplay(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyOutput(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyGeneral(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyString(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyLine(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyParagraph(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyTextValue(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyCopy(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRender(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyReadable(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyHuman(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyResolved(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyFriendly(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyVisible(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyFinal(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyNormalized(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyLegacy(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyStructured(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyContent(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMessage(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyEvent(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyGraph(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyView(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnySection(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDetail(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnySupport(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyReason(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyEvidence(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMetric(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyNarrative(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyTrend(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyInsight(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyPrimary(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyCompact(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMerged(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDebug(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyTag(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyHeadingText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyBodyText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyCaptionText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyLabelText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnySummaryText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDescriptionText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyNoteText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyTitleText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMetaText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyValueText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRuntimeText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyClusterText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyMemoryText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyObservationText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRelationshipText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyRoomText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyStateText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDialogText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyUiText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyDisplayText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyOutputText(text: string) {
  return cleanTimelineText(text);
}

function sanitizeAnyGeneralText(text: string) {
  return cleanTimelineText(text);
}

function buildRelationshipEventNote(note: string) {
  return cleanTimelineText(note);
}

function compactRecentMemoryTexts(items: MemoryItem[]) {
  return items.slice(0, 3).map((item) => cleanMemorySummary(item.text)).join(' / ');
}

function normalizeClusterTag(tag: string | null) {
  return tag ? cleanTimelineText(tag) : null;
}

function normalizeEventHeadline(text: string | null) {
  return text ? cleanTimelineText(text) : null;
}

function normalizeDeltaLabel(text: string | null) {
  return text ? cleanTimelineText(text) : null;
}

function normalizePrimaryEvent(text: string) {
  return cleanTimelineText(text);
}

function normalizeRelationshipFallback(note: string, score: number) {
  return cleanTimelineText(note || relationshipFallbackText(score));
}

function normalizeMemoryText(text: string) {
  return cleanTimelineText(text);
}

function normalizeMetricChipLabel(label: string) {
  return cleanTimelineText(label);
}

function buildMemoryDebugLabel(item: MemoryItem, members: AICharacter[]) {
  return `${item.scope}/${item.kind}${compactLayeredMemorySubject(item, members) ? ` (${compactLayeredMemorySubject(item, members)})` : ''}`;
}

function buildOwnerDebugText(item: MemoryItem, members: AICharacter[]) {
  return `owner=${compactMemoryOwner(item.ownerId, members)} · recency=${item.recency.toFixed(2)} · salience=${item.salience.toFixed(2)}`;
}

function normalizeTimelineCaption(text: string | null) {
  return text ? cleanTimelineText(text) : null;
}

function normalizeChipLabel(label: string) {
  return cleanTimelineText(label);
}

function dedupeSameLine(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a === b ? a : `${a} · ${b}`;
}

function buildTimelineCaptionMerged(item: ProjectedRuntimeTimelineItem, members: AICharacter[]) {
  return dedupeSameLine(normalizeTimelineCaption(describeTimelineParticipants(item)), normalizeTimelineCaption(buildTimelineCaption(item, members)));
}

function buildRelationshipSummaryLine(text: string) {
  return cleanTimelineText(text);
}

function normalizeObservationChip(chip: string) {
  return cleanTimelineText(chip);
}


void relationshipScore;
void relationshipFallbackText;
void relationshipHeatColor;
void relationshipHeatLabel;
void RelationshipGraphDetails;
void RelationshipDeltaBlock;
void formatSpikeType;
void RelationshipAxisChips;
void RelationshipReasonDialog;
void buildRelationshipAxisMeta;

function readSocialEventCandidateMeta(item: { meta?: { socialEventCandidate?: SocialEventCandidatePayload } }) {
  return item.meta?.socialEventCandidate || null;
}

function readRoomShiftMeta(item: { meta?: { roomShift?: { delta?: { heat?: number; cohesion?: number; topicDrift?: number } } } }) {
  return item.meta?.roomShift || null;
}

function formatSocialEventKind(kind: SocialEventKind | string | undefined) {
  const labels: Record<string, string> = {
    pair_private_thread: '双人私聊',
    social_outing: '线下活动',
    post_moment: '朋友圈动态',
    status_update: '状态更新',
    gift_exchange: '礼物互动',
    conflict_expression: '冲突表达',
    custom: '自定义事件',
  };
  return kind ? (labels[kind] || kind) : '社交事件';
}

function formatSocialEventStage(stage: 'candidate' | 'artifact' | 'effect' | 'opened' | undefined) {
  const labels: Record<string, string> = {
    candidate: '候选',
    artifact: '产物',
    effect: '回流',
    opened: '已派生',
  };
  return stage ? (labels[stage] || stage) : '事件';
}

function formatSocialArtifactType(type: string | undefined) {
  const labels: Record<string, string> = {
    private_thread_opened: '私聊已开启',
    private_thread_summary: '私聊摘要',
    moment_text: '动态内容',
    outing_summary: '活动摘要',
    status_note: '状态记录',
    conflict_note: '冲突记录',
    gift_note: '礼物记录',
  };
  return type ? (labels[type] || type) : '产物';
}

function buildRuntimeEventKey(item: { type: string; createdAt: number; text: string }, index: number) {
  return `${item.type}-${item.createdAt}-${index}-${item.text.slice(0, 24)}`;
}

function clipLabel(text: string, max = 24) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

function describeEventHeadline(event: RuntimeEventV2 | null) {
  return event ? `${formatEventKind(event.kind)} · ${clipLabel(event.summary, 18)}` : null;
}

function formatNames(names: string[] | undefined) {
  return names?.length ? names.join('、') : null;
}

function describeTimelineParticipants(item: ProjectedRuntimeTimelineItem) {
  const actors = formatNames(item.actorNames);
  const targets = formatNames(item.targetNames);
  if (actors && targets) return `${actors} → ${targets}`;
  return actors || targets || null;
}

function buildTimelineMetaCaption(item: ProjectedRuntimeTimelineItem, members: AICharacter[]) {
  const clusterCaption = buildTimelineCaption(item, members);
  const participantCaption = describeTimelineParticipants(item);
  return clusterCaption || participantCaption;
}

function buildCompactStateRows(chat: GroupChat, primaryRecentEvent: string, dominantThreadLabel: string | null, structuredRoomState: GroupChat['worldState']['structuredRoomState'], members: AICharacter[]) {
  return [
    { key: 'phase', label: '阶段', value: chat.worldState.phase || 'idle' },
    { key: 'mood', label: '气氛', value: chat.worldState.mood || '未设置' },
    { key: 'focus', label: '焦点', value: chat.worldState.focus || '未设置' },
    { key: 'recent', label: '最近事件', value: primaryRecentEvent || '暂无' },
    ...(structuredRoomState ? [
      { key: 'thread', label: '主线程', value: dominantThreadLabel || '暂无' },
      { key: 'pileOn', label: '围攻目标', value: structuredRoomState.pileOnTarget ? (members.find((item) => item.id === structuredRoomState.pileOnTarget)?.name || structuredRoomState.pileOnTarget) : '无' },
    ] : []),
  ];
}

function buildRoomRelationNotes(dominantThreadLabel: string | null, allianceLabels: string[], conflictLabels: string[]) {
  return [
    dominantThreadLabel ? `主线程：${dominantThreadLabel}` : null,
    allianceLabels.length ? `联盟：${allianceLabels.slice(0, 3).join(' / ')}` : null,
    conflictLabels.length ? `对线：${conflictLabels.slice(0, 3).join(' / ')}` : null,
  ].filter(Boolean) as string[];
}

function compactLayeredMemorySubject(item: MemoryItem, members: AICharacter[]) {
  if (!item.subjectIds?.length) return null;
  return item.subjectIds.map((id) => members.find((member) => member.id === id)?.name || id).join(' ↔ ');
}

function compactMemoryOwner(ownerId: string | undefined, members: AICharacter[]) {
  if (!ownerId) return 'system';
  return members.find((member) => member.id === ownerId)?.name || ownerId;
}

function buildRuntimeFooterText(chat: GroupChat) {
  return !chat.worldState.structuredRoomState && !(chat.runtimeEventsV2 || []).length
    ? null
    : '当前面板优先展示本地 reducer 推导出的结构化互动、关系账本与房间态势。';
}

function renderRelationshipNote(note: string, score: number) {
  return note || relationshipFallbackText(score);
}

function buildRoomShiftChips(item: ProjectedRuntimeTimelineItem) {
  const delta = readRoomShiftMeta(item)?.delta;
  if (!delta) return [];
  return [
    { key: 'heat', label: buildSignedMetricLabel('热度', delta.heat) },
    { key: 'cohesion', label: buildSignedMetricLabel('凝聚', delta.cohesion) },
    { key: 'topicDrift', label: buildSignedMetricLabel('跑题', delta.topicDrift) },
  ];
}

function buildSocialCandidateChips(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  if (!candidate || readSocialEventClusterMeta(item)) return [];
  return [
    { key: 'event', label: `事件 ${formatSocialEventKind(candidate.eventKind)}` },
    { key: 'reason', label: `原因 ${candidate.reasonType}` },
    { key: 'confidence', label: `置信 ${formatPercent(candidate.confidence)}` },
  ];
}

function buildSocialArtifactChips(item: ProjectedRuntimeTimelineItem) {
  const artifact = readSocialEventArtifactMeta(item);
  if (!artifact || readSocialEventClusterMeta(item)) return [];
  return [
    artifact.eventKind ? { key: 'event', label: `事件 ${formatSocialEventKind(artifact.eventKind)}` } : null,
    artifact.artifactType ? { key: 'artifact', label: `产物 ${formatSocialArtifactType(artifact.artifactType)}` } : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>;
}

function buildMemoryCandidateChips(item: ProjectedRuntimeTimelineItem) {
  const memory = readMemoryCandidateMeta(item);
  if (!memory) return [];
  return [
    { key: 'kind', label: `类型 ${memory.kind}` },
    { key: 'salience', label: buildMetricLabel('显著性', memory.salience) },
    { key: 'confidence', label: `置信 ${formatPercent(memory.confidence)}` },
  ];
}

function buildTimelineChipRows(item: ProjectedRuntimeTimelineItem) {
  return {
    memory: buildMemoryCandidateChips(item),
    roomShift: buildRoomShiftChips(item),
    candidate: buildSocialCandidateChips(item),
    artifact: buildSocialArtifactChips(item),
  };
}

function renderChipRow(chips: Array<{ key: string; label: string; color?: 'default' | 'primary' | 'secondary' | 'success'; variant?: 'outlined' | 'filled' }>) {
  if (!chips.length) return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
      {chips.map((chip) => (
        <Chip key={chip.key} size="small" label={chip.label} color={chip.color} variant={chip.variant || 'outlined'} />
      ))}
    </Box>
  );
}

function renderKeyValueRows(rows: Array<{ key: string; label: string; value: string }>) {
  return (
    <Stack spacing={0.75}>
      {rows.map((row) => (
        <Typography key={row.key} variant="body2"><strong>{row.label}：</strong>{row.value}</Typography>
      ))}
    </Stack>
  );
}

function renderCaptionList(lines: string[]) {
  if (!lines.length) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {lines.map((line) => <Typography key={line} variant="caption" color="text.secondary">{line}</Typography>)}
    </Stack>
  );
}

function buildTimelineTimestamp(item: ProjectedRuntimeTimelineItem, isDeveloperView: boolean) {
  return isDeveloperView ? `${item.label} · ${new Date(item.createdAt).toLocaleString()}` : null;
}

function readRoomShiftDelta(event: RuntimeEventV2 | null) {
  if (!event || event.kind !== 'room_shift') return null;
  const payload = event.payload as { delta?: { heat?: number; cohesion?: number; topicDrift?: number } };
  return payload.delta || null;
}

function formatDelta(value: number | undefined) {
  if (!value) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

function describeRoomShiftDelta(event: RuntimeEventV2 | null) {
  const delta = readRoomShiftDelta(event);
  if (!delta) return null;
  return `Δ热度 ${formatDelta(delta.heat)} / Δ凝聚 ${formatDelta(delta.cohesion)} / Δ跑题 ${formatDelta(delta.topicDrift)}`;
}

function formatPercent(value: number | undefined) {
  if (typeof value !== 'number') return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatSignedNumber(value: number | undefined) {
  if (!value) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

function formatMetricValue(value: number | undefined) {
  if (typeof value !== 'number') return '0';
  return `${Math.round(value)}`;
}

function buildMetricLabel(label: string, value: number | undefined) {
  return `${label} ${formatMetricValue(value)}`;
}

function buildSignedMetricLabel(label: string, value: number | undefined) {
  return `${label} ${formatSignedNumber(value)}`;
}

function timelineEventLimit(isDeveloperView: boolean) {
  return isDeveloperView ? 12 : 8;
}

function timelinePreviewLimit(isDeveloperView: boolean) {
  return isDeveloperView ? 10 : 6;
}

function matchTimelineFilter(item: { type: 'note' | 'artifact' | 'relationship' }, filter: 'all' | 'note' | 'artifact' | 'relationship') {
  return filter === 'all' ? true : filter === 'artifact' ? item.type === 'artifact' || Boolean(readSocialEventClusterMeta(item as ProjectedRuntimeTimelineItem)) : item.type === filter;
}

type ClusterSummaryEntry = {
  eventKind?: string;
  stages: Set<'candidate' | 'artifact' | 'effect' | 'opened'>;
  count: number;
  participants: Set<string>;
  targets: Set<string>;
  title?: string | null;
  reason?: string | null;
};

type ClusterChip = { key: string; label: string; color?: 'default' | 'primary' | 'secondary' | 'success'; variant: 'outlined' | 'filled' };

function clusterChipColor(stage: 'candidate' | 'artifact' | 'effect' | 'opened' | undefined): 'default' | 'primary' | 'secondary' | 'success' {
  if (stage === 'candidate') return 'secondary';
  if (stage === 'artifact') return 'primary';
  if (stage === 'effect' || stage === 'opened') return 'success';
  return 'default';
}

function filterClusterTimeline(items: ProjectedRuntimeTimelineItem[]) {
  return items.filter((item) => Boolean(readSocialEventClusterMeta(item)));
}

function buildClusterSummary(items: ProjectedRuntimeTimelineItem[], members: AICharacter[]) {
  const grouped = new Map<string, ClusterSummaryEntry>();
  items.forEach((item) => {
    const cluster = readSocialEventClusterMeta(item);
    if (!cluster) return;
    const candidate = readSocialEventCandidateMeta(item);
    const artifact = readSocialEventArtifactMeta(item);
    const effect = readSocialEventEffectMeta(item);
    const key = `${cluster.eventKind || 'unknown'}::${cluster.dedupeKey || item.text}`;
    const current = grouped.get(key) || {
      eventKind: cluster.eventKind,
      stages: new Set<'candidate' | 'artifact' | 'effect' | 'opened'>(),
      count: 0,
      participants: new Set<string>(),
      targets: new Set<string>(),
      title: null,
      reason: null,
    };
    current.stages.add(cluster.stage);
    current.count += 1;
    [...(candidate?.participantIds || artifact?.participantIds || [])].forEach((id) => current.participants.add(members.find((member) => member.id === id)?.name || id));
    [...(candidate?.targetIds || artifact?.targetIds || [])].forEach((id) => current.targets.add(members.find((member) => member.id === id)?.name || id));
    current.title = candidate?.title || artifact?.title || artifact?.activityType || current.title;
    current.reason = candidate?.reasonType || artifact?.reasonType || effect?.effectType || current.reason;
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).slice(0, 4);
}

function shouldShowClusterSummary(items: ProjectedRuntimeTimelineItem[]) {
  return filterClusterTimeline(items).length > 0;
}

function buildClusterSummaryHeader(items: ProjectedRuntimeTimelineItem[]) {
  const clusters = filterClusterTimeline(items);
  if (!clusters.length) return null;
  const counts = { candidate: 0, artifact: 0, effect: 0, opened: 0 };
  clusters.forEach((item) => {
    const stage = readSocialEventClusterMeta(item)?.stage;
    if (stage) counts[stage] += 1;
  });
  const total = clusters.length;
  return `社交事件 ${total} 条 · 候选 ${counts.candidate} / 产物 ${counts.artifact} / 回流 ${counts.effect}`;
}

function buildClusterSummaryContent(items: ProjectedRuntimeTimelineItem[], members: AICharacter[]) {
  const stageCounts = { candidate: 0, artifact: 0, effect: 0, opened: 0 };
  filterClusterTimeline(items).forEach((item) => {
    const stage = readSocialEventClusterMeta(item)?.stage;
    if (stage) stageCounts[stage] += 1;
  });
  return {
    stages: (Object.entries(stageCounts) as Array<[keyof typeof stageCounts, number]>).filter(([, count]) => count > 0).map(([stage, count]) => ({
      key: stage,
      label: `${formatSocialEventStage(stage)} ${count}`,
      color: clusterChipColor(stage),
    })),
    descriptions: buildClusterSummary(items, members).map((entry, index) => ({
      key: `${entry.eventKind || 'unknown'}-${index}`,
      label: describeSocialClusterTitle(entry),
      description: buildSocialClusterDescription(entry),
    })),
  };
}

function hasClusterSummaryContent(items: ProjectedRuntimeTimelineItem[], members: AICharacter[]) {
  const content = buildClusterSummaryContent(items, members);
  return content.stages.length > 0 || content.descriptions.length > 0;
}

function describeSocialEventParticipants(ids: string[] | undefined, members: AICharacter[]) {
  if (!ids?.length) return null;
  return ids.map((id) => members.find((item) => item.id === id)?.name || id).join('、');
}

function describeSocialEventTargets(ids: string[] | undefined, members: AICharacter[]) {
  if (!ids?.length) return null;
  return ids.map((id) => members.find((item) => item.id === id)?.name || id).join('、');
}

function describeClusterProgress(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  const artifact = readSocialEventArtifactMeta(item);
  const effect = readSocialEventEffectMeta(item);
  if (candidate?.expectedArtifacts?.length) return `预期产物 ${candidate.expectedArtifacts.join(' / ')}`;
  if (artifact?.expectedArtifacts?.length) return `相关产物 ${artifact.expectedArtifacts.join(' / ')}`;
  if (effect) return `影响类型 ${effect.effectType}`;
  return null;
}

function describeClusterAnchor(item: ProjectedRuntimeTimelineItem, members: AICharacter[]) {
  const candidate = readSocialEventCandidateMeta(item);
  const artifact = readSocialEventArtifactMeta(item);
  const participants = describeSocialEventParticipants(candidate?.participantIds || artifact?.participantIds, members);
  const targets = describeSocialEventTargets(candidate?.targetIds || artifact?.targetIds, members);
  if (participants && targets) return `${participants} → ${targets}`;
  return participants || targets || null;
}

function describeClusterTimePlace(item: ProjectedRuntimeTimelineItem) {
  const artifact = readSocialEventArtifactMeta(item);
  const candidate = readSocialEventCandidateMeta(item);
  const values = [candidate?.timeHint || artifact?.timeHint, candidate?.locationHint || artifact?.locationHint].filter(Boolean);
  return values.length ? values.join(' · ') : null;
}

function describeClusterReason(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  const artifact = readSocialEventArtifactMeta(item);
  const effect = readSocialEventEffectMeta(item);
  return candidate?.reasonType || artifact?.reasonType || effect?.effectType || null;
}

function describeClusterConfidence(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  const effect = readSocialEventEffectMeta(item);
  if (typeof candidate?.confidence === 'number') return formatPercent(candidate.confidence);
  if (typeof effect?.confidence === 'number') return formatPercent(effect.confidence);
  return null;
}

function describeClusterArtifact(item: ProjectedRuntimeTimelineItem) {
  const artifact = readSocialEventArtifactMeta(item);
  return artifact?.artifactType ? formatSocialArtifactType(artifact.artifactType) : null;
}

function buildTimelineCardTone(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  if (!cluster) return 'action.hover';
  if (cluster.stage === 'candidate') return 'rgba(103, 80, 164, 0.08)';
  if (cluster.stage === 'artifact') return 'rgba(25, 118, 210, 0.08)';
  return 'rgba(46, 125, 50, 0.08)';
}

function buildTimelineBorder(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  if (!cluster) return 'transparent';
  if (cluster.stage === 'candidate') return 'rgba(103, 80, 164, 0.28)';
  if (cluster.stage === 'artifact') return 'rgba(25, 118, 210, 0.28)';
  return 'rgba(46, 125, 50, 0.28)';
}

function buildTimelineSectionLabel(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  if (!cluster) return null;
  return `${formatSocialEventKind(cluster.eventKind)} · ${formatSocialEventStage(cluster.stage)}`;
}

function buildClusterEventPill(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  const label = buildTimelineSectionLabel(item);
  if (!cluster || !label) return null;
  return { label, color: clusterChipColor(cluster.stage), variant: 'filled' as const };
}

function buildClusterTag(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  if (!cluster) return null;
  return [formatSocialEventKind(cluster.eventKind), cluster.dedupeKey ? `簇 ${String(cluster.dedupeKey).slice(0, 18)}` : null].filter(Boolean).join(' · ');
}

function buildClusterChipList(item: ProjectedRuntimeTimelineItem): ClusterChip[] {
  return [
    describeClusterReason(item) ? { key: 'reason', label: `原因 ${describeClusterReason(item)}`, variant: 'outlined' } : null,
    describeClusterConfidence(item) ? { key: 'confidence', label: `置信 ${describeClusterConfidence(item)}`, variant: 'outlined' } : null,
    describeClusterProgress(item) ? { key: 'progress', label: describeClusterProgress(item) as string, variant: 'outlined' } : null,
  ].filter((chip): chip is ClusterChip => Boolean(chip));
}

function buildTimelineText(item: ProjectedRuntimeTimelineItem) {
  const candidate = readSocialEventCandidateMeta(item);
  const artifact = readSocialEventArtifactMeta(item);
  const effect = readSocialEventEffectMeta(item);
  return buildTimelineHeadingText(item, candidate?.title || artifact?.title || artifact?.activityType || effect?.summary || item.text);
}

function buildTimelineCaption(item: ProjectedRuntimeTimelineItem, members: AICharacter[]) {
  return [describeClusterAnchor(item, members), describeClusterTimePlace(item), describeClusterArtifact(item)].filter(Boolean).join(' · ') || null;
}

function getClusterTimelineCard(item: ProjectedRuntimeTimelineItem, members: AICharacter[]) {
  const heading = buildTimelineText(item);
  return {
    pill: buildClusterEventPill(item),
    tag: normalizeClusterTag(buildClusterTag(item)),
    text: heading,
    body: buildTimelineBodyText(item, heading),
    caption: buildTimelineCaptionMerged(item, members),
    chips: buildClusterChipList(item).map((chip) => ({ ...chip, label: normalizeChipLabel(chip.label) })),
  };
}

function getClusterTimelineSx(item: ProjectedRuntimeTimelineItem) {
  const background = buildTimelineCardTone(item);
  const border = buildTimelineBorder(item);
  return {
    p: 1,
    borderRadius: 2,
    bgcolor: background,
    border: readSocialEventClusterMeta(item) ? `1px solid ${border}` : undefined,
  };
}

function getTimelineFilterOptions(isDeveloperView: boolean) {
  return [
    ['all', '全部'],
    ['note', isDeveloperView ? '沉淀记忆' : '记忆'],
    ['artifact', isDeveloperView ? '事件簇' : '社交事件'],
    ['relationship', '关系'],
  ] as const;
}

interface ChatRuntimePanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  privatePayloads?: Array<{ key: string; title: string; text: string }>;
}

export default function ChatRuntimePanel({ chat, members, privatePayloads = [] }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const [activeRelationshipAxis, setActiveRelationshipAxis] = useState<{ label: string; reasons: Array<{ axis: 'warmth' | 'competence' | 'trust' | 'threat'; value: number; reason: string; evidence: string; createdAt?: number }> } | null>(null);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;

  const relationshipPairs = ((chat.relationshipLedger && chat.relationshipLedger.length)
    ? chat.relationshipLedger.filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId)).map((entry) => ({
        source: members.find((item) => item.id === entry.actorId)?.name || entry.actorId,
        target: members.find((item) => item.id === entry.targetId)?.name || entry.targetId,
        relation: entry.current,
        derived: entry.derived,
        note: entry.recentEvents[entry.recentEvents.length - 1]?.summary || '',
        score: relationshipScore(entry.current),
      }))
    : []).slice(0, isDeveloperView ? 8 : 4);

  const structuredRoomState = chat.worldState.structuredRoomState;
  const projectedTimeline = useMemo(() => projectRuntimeTimeline(chat, members), [chat, members]);
  const runtimeMetrics = [
    { label: '成员数', value: members.length * 10, color: '#6750A4' },
    { label: '运行笔记', value: (chat.runtimeSeed?.notes?.length || 0) * 10, color: '#4E7E6B' },
    { label: '成果物', value: (chat.runtimeSeed?.artifacts?.length || 0) * 10, color: '#B26A00' },
    { label: '时间线事件', value: (chat.runtimeEventsV2?.length || chat.runtimeTimeline?.length || 0) * 5, color: '#C62828' },
    ...(structuredRoomState ? [
      { label: '热度', value: structuredRoomState.heat, color: '#D32F2F' },
      { label: '凝聚', value: structuredRoomState.cohesion, color: '#2E7D32' },
      { label: '跑题', value: structuredRoomState.topicDrift, color: '#1565C0' },
    ] : []),
  ];

  const filteredTimeline = useMemo(() => projectedTimeline.filter((item) => matchTimelineFilter(item, timelineFilter)).slice().reverse().slice(0, timelinePreviewLimit(isDeveloperView)), [projectedTimeline, timelineFilter, isDeveloperView]);
  const displayTimeline = filteredTimeline.slice(0, timelineEventLimit(isDeveloperView));
  const roomStateChips = structuredRoomState ? [
    { key: 'heat', label: buildMetricLabel('热度', structuredRoomState.heat) },
    { key: 'cohesion', label: buildMetricLabel('凝聚', structuredRoomState.cohesion) },
    { key: 'topicDrift', label: buildMetricLabel('跑题', structuredRoomState.topicDrift) },
    ...(structuredRoomState.pileOnTarget ? [{ key: 'pileOnTarget', label: `围攻 ${members.find((item) => item.id === structuredRoomState.pileOnTarget)?.name || structuredRoomState.pileOnTarget}` }] : []),
  ] : [];
  const dominantThreadLabel = structuredRoomState?.dominantThread ? structuredRoomState.dominantThread.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ') : null;
  const allianceLabels = (structuredRoomState?.alliances || []).map((pair) => pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' + '));
  const conflictLabels = (structuredRoomState?.conflictPairs || []).map((pair) => pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ '));
  const latestRuntimeEvent = projectLatestRuntimeEvent(chat);
  const topInteractionChip = normalizeEventHeadline(describeEventHeadline(latestRuntimeEvent));
  const roomShiftDeltaLabel = normalizeDeltaLabel(describeRoomShiftDelta(latestRuntimeEvent));
  const firstRelationshipPair = relationshipPairs[0];
  const firstRelationshipLabel = firstRelationshipPair ? buildRelationshipHeadline(firstRelationshipPair.source, firstRelationshipPair.target, firstRelationshipPair.score) : null;
  const primaryRecentEvent = normalizePrimaryEvent((chat as GroupChat & { primaryRecentEvent?: string }).primaryRecentEvent || buildPrimaryRecentEventLabel(structuredRoomState, chat.worldState.recentEvent));
  const observationChips = buildObservationChips(firstRelationshipLabel, topInteractionChip, roomShiftDeltaLabel, primaryRecentEvent).map(normalizeObservationChip);
  const metricItems = isDeveloperView ? runtimeMetrics : runtimeMetrics.slice(0, 4);
  const roomRelationNotes = buildRoomRelationNotes(dominantThreadLabel, allianceLabels, conflictLabels);
  const compactStateRows = buildCompactStateRows(chat, primaryRecentEvent, dominantThreadLabel, structuredRoomState, members);
  const runtimeFooterText = buildRuntimeFooterText(chat);
  const clusterSummaryContent = useMemo(() => buildClusterSummaryContent(displayTimeline, members), [displayTimeline, members]);
  const clusterSummaryHeader = useMemo(() => buildClusterSummaryHeader(displayTimeline), [displayTimeline]);

  const layeredMemories = useMemo(() => {
    const items = (chat.layeredMemories || []) as MemoryItem[];
    return retrieveRelevantMemories(items, {
      speakerId: chat.memberIds[0] || chat.id,
      targetId: chat.memberIds[1] || null,
      conversationId: chat.id,
      maxItems: isDeveloperView ? 8 : 4,
    });
  }, [chat.id, chat.layeredMemories, chat.memberIds, isDeveloperView]);

  const visibleMemories = isDeveloperView ? layeredMemories : layeredMemories.filter((item) => item.layer !== 'working').slice(0, 4);
  const memorySummary = compactRecentMemoryTexts(visibleMemories);

  return (
    <>
      <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态观察</Typography>
          <Typography variant="body2" color="text.secondary">
            {isDeveloperView ? '这里展示群聊在长期运行中沉淀出的完整运行态与记忆调试信息。' : (memorySummary || '这里展示群聊运行后逐渐沉淀下来的关键状态与关系变化。')}
          </Typography>
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {observationChips.map((chip) => <Chip key={chip} size="small" label={chip} variant="outlined" />)}
          </Box>
          {roomStateChips.length ? <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{roomStateChips.map((item) => <Chip key={item.key} size="small" label={normalizeMetricChipLabel(item.label)} />)}</Box> : null}
          {renderCaptionList(roomRelationNotes)}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>群聊状态</Typography>
          <Stack spacing={1.25}>
            {renderKeyValueRows(compactStateRows)}
            {isDeveloperView ? <SimpleBarChart title="群聊运行指标" items={metricItems} /> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isDeveloperView ? '成员关系发展' : '关系变化'}</Typography>
          {relationshipPairs.length ? (
            <Stack spacing={1}>
              {relationshipPairs.map((item, index) => (
                <Box key={`${item.source}-${item.target}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{item.source} → {item.target}</Typography>
                    <Chip size="small" color={relationshipHeatColor(item.score)} label={relationshipHeatLabel(item.score)} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">{normalizeRelationshipFallback(item.note, item.score)}</Typography>
                  {isDeveloperView ? <RelationshipGraphDetails relation={item.relation} derived={item.derived} /> : null}
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '暂无明显关系变化' : '暂无突出关系变化'}</Typography>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>运行视图</Typography>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              <Chip size="small" label="时间线" color={viewMode === 'timeline' ? 'primary' : 'default'} variant={viewMode === 'timeline' ? 'filled' : 'outlined'} onClick={() => setViewMode('timeline')} />
              <Chip size="small" label="关系图谱" color={viewMode === 'graph' ? 'primary' : 'default'} variant={viewMode === 'graph' ? 'filled' : 'outlined'} onClick={() => setViewMode('graph')} />
            </Box>
          </Box>
          {viewMode === 'timeline' ? (
            <>
              {isDeveloperView && !!(chat.layeredMemories || []).length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                  {(chat.layeredMemories || []).slice(-6).map((item) => <Chip key={item.id} size="small" label={`${item.scope}/${item.kind}${compactLayeredMemorySubject(item as MemoryItem, members) ? ` (${compactLayeredMemorySubject(item as MemoryItem, members)})` : ''}`} variant="outlined" />)}
                </Box>
              ) : null}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                {getTimelineFilterOptions(isDeveloperView).map(([value, label]) => (
                  <Chip key={value} size="small" label={label} color={timelineFilter === value ? 'primary' : 'default'} variant={timelineFilter === value ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(value as 'all' | 'note' | 'artifact' | 'relationship')} />
                ))}
              </Box>
              {shouldShowClusterSummary(displayTimeline) ? (
                <Box sx={{ mb: 1.25, p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  {clusterSummaryHeader ? <Typography variant="caption" color="text.secondary">{clusterSummaryHeader}</Typography> : null}
                  {clusterSummaryContent.stages.length ? (
                    <Box sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {clusterSummaryContent.stages.map((chip) => (
                        <Chip key={chip.key} size="small" label={chip.label} color={chip.color} variant="outlined" />
                      ))}
                    </Box>
                  ) : null}
                  {clusterSummaryContent.descriptions.length ? (
                    <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                      {clusterSummaryContent.descriptions.map((entry) => (
                        <Typography key={entry.key} variant="caption" color="text.secondary">{entry.label}{entry.description ? ` · ${clipLabel(entry.description, 64)}` : ''}</Typography>
                      ))}
                    </Stack>
                  ) : null}
                </Box>
              ) : null}
              {displayTimeline.length ? (
                <Stack spacing={1}>
                  {displayTimeline.map((item, index) => {
                    const clusterCard = getClusterTimelineCard(item, members);
                    return (
                      <Box key={buildRuntimeEventKey(item, index)} sx={getClusterTimelineSx(item)}>
                        {buildTimelineTimestamp(item, isDeveloperView) ? <Typography variant="caption" color="text.secondary">{buildTimelineTimestamp(item, isDeveloperView)}</Typography> : null}
                        {clusterCard.pill ? (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: isDeveloperView ? 0.75 : 0, mb: 0.75 }}>
                            <Chip size="small" label={clusterCard.pill.label} color={clusterCard.pill.color} variant={clusterCard.pill.variant} />
                            {clusterCard.tag ? <Chip size="small" label={clusterCard.tag} variant="outlined" /> : null}
                          </Box>
                        ) : null}
                        <Typography variant="body2">{sanitizeRuntimeCardText(clusterCard.body || clusterCard.text)}</Typography>
                        {clusterCard.caption ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{clusterCard.caption}</Typography> : null}
                        {renderChipRow(buildMemoryCandidateChips(item))}
                        {readRelationshipDeltaMeta(item) ? (
                          <RelationshipDeltaBlock item={readRelationshipDeltaMeta(item)!} onOpen={(label, reasons) => setActiveRelationshipAxis({ label, reasons })} />
                        ) : null}
                        {renderChipRow(clusterCard.chips)}
                        {renderChipRow(buildSocialCandidateChips(item))}
                        {renderChipRow(buildSocialArtifactChips(item))}
                        {renderChipRow(buildRoomShiftChips(item))}
                      </Box>
                    );
                  })}
                </Stack>
              ) : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '当前筛选下暂无运行时间线' : '当前暂无关键变化'}</Typography>}
            </>
          ) : relationshipPairs.length ? (
            <Stack spacing={1}>
              {relationshipPairs.map((item, index) => (
                <Box key={`${item.source}-${item.target}-graph-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.source} ⇄ {item.target}</Typography>
                  {isDeveloperView ? <RelationshipGraphDetails relation={item.relation} derived={item.derived} /> : <Typography variant="caption" color="text.secondary">{item.note || relationshipFallbackText(item.score)}</Typography>}
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>}

          <RelationshipReasonDialog open={Boolean(activeRelationshipAxis)} onClose={() => setActiveRelationshipAxis(null)} axisLabel={activeRelationshipAxis?.label || '关系轴'} reasons={activeRelationshipAxis?.reasons || []} />

          {structuredRoomState?.silencedActors.length ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>被压制成员</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {structuredRoomState.silencedActors.map((actorId) => <Chip key={actorId} size="small" label={members.find((item) => item.id === actorId)?.name || actorId} />)}
              </Box>
            </Box>
          ) : null}

          {structuredRoomState?.alliances.length ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>最近联盟</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {allianceLabels.slice(0, 6).map((label) => <Chip key={label} size="small" label={label} variant="outlined" />)}
              </Box>
            </Box>
          ) : null}

          {structuredRoomState?.conflictPairs.length ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>主要对线</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {conflictLabels.slice(0, 6).map((label) => <Chip key={label} size="small" label={label} variant="outlined" />)}
              </Box>
            </Box>
          ) : null}

          {runtimeFooterText ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {runtimeFooterText}
            </Typography>
          ) : null}
        </CardContent>
      </Card>

      <PrivatePayloadPanel payloads={privatePayloads} />
      {isSpeechStyleView ? <DialogueDebugPanel chat={chat} /> : null}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isDeveloperView ? '记忆体系' : '关键记忆'}</Typography>
          {visibleMemories.length ? (
            <Stack spacing={1.25}>
              {visibleMemories.map((item) => (
                <Box key={item.id} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                  {isDeveloperView ? (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 0.75 }}>
                      <Chip size="small" label={item.layer} color={item.layer === 'long_term' ? 'primary' : item.layer === 'episodic' ? 'secondary' : 'default'} />
                      <Chip size="small" label={item.scope} variant="outlined" />
                      <Chip size="small" label={item.kind} variant="outlined" />
                      {compactLayeredMemorySubject(item, members) ? <Chip size="small" label={compactLayeredMemorySubject(item, members) || ''} variant="outlined" /> : null}
                    </Box>
                  ) : null}
                  <Typography variant="body2" sx={{ mb: 0.5 }}>{item.text}</Typography>
                  {isDeveloperView ? (
                    <>
                      <Typography variant="caption" color="text.secondary">强化 {item.reinforcementCount} · 置信 {(item.confidence * 100).toFixed(0)}%</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>owner={compactMemoryOwner(item.ownerId, members)} · recency={item.recency.toFixed(2)} · salience={item.salience.toFixed(2)}</Typography>
                    </>
                  ) : null}
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">{isDeveloperView ? '暂无结构化记忆' : '暂无明显沉淀'}</Typography>
          )}
        </CardContent>
      </Card>

      {isDeveloperView ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>成果 / 可扩展</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {['群聊记忆', '事件时间线', '关系图谱', '精彩片段', '衍生文件'].map((item) => <Chip key={item} label={item} size="small" variant="outlined" />)}
            </Box>
          </CardContent>
        </Card>
      ) : null}
      </Stack>
      <RelationshipReasonDialog open={Boolean(activeRelationshipAxis)} onClose={() => setActiveRelationshipAxis(null)} axisLabel={activeRelationshipAxis?.label || '关系轴'} reasons={activeRelationshipAxis?.reasons || []} />
    </>
  );
}
