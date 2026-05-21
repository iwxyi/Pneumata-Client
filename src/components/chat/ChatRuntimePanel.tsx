import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import PageSection from '../common/PageSection';
import PrivatePayloadPanel from '../session/PrivatePayloadPanel';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { Message } from '../../types/message';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeDistillationTexts } from '../../services/distillationText';
import DialogueDebugPanel from './DialogueDebugPanel';
import { projectRuntimeTimeline, type ProjectedRuntimeTimelineItem } from '../../services/sessionProjection';
import { projectRuntimeDecisionTrace, type RuntimeDecisionTraceItem } from '../../services/runtimeDecisionTrace';
import { formatConflictPressureLabel, formatConflictTypeLabel } from '../../services/runtimeEventFactory';

interface ChatRuntimePanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  messages?: Message[];
  privatePayloads?: Array<{ key: string; title: string; text: string }>;
}

function cleanText(text: string) {
  return text
    .replace(/\{[\s\S]*"eventType"[\s\S]*\}/g, '系统事件')
    .replace(/relationship_backflow/g, '关系回流')
    .replace(/summary_backflow/g, '摘要回流')
    .replace(/source_chat_patch/g, '群聊投影')
    .replace(/memory_candidate/g, '记忆候选')
    .replace(/relationship_delta/g, '关系变化')
    .replace(/room_shift/g, '房间态势')
    .replace(/message_generated/g, '消息生成')
    .replace(/trait_evidence/g, '性格证据')
    .replace(/status_shift/g, '状态变化')
    .replace(/thread_effect/g, '线程影响')
    .replace(/long_term/g, '长期记忆')
    .replace(/episodic/g, '片段记忆')
    .replace(/working/g, '工作记忆')
    .replace(/resentment/g, '不满')
    .replace(/conflict/g, '冲突')
    .replace(/bond/g, '亲近')
    .replace(/artifact/g, '产物')
    .replace(/decision/g, '决策')
    .replace(/亲近/g, '亲和')
    .replace(/尊重/g, '能力')
    .replace(/态度发生变化/g, '关系发生变化')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '成员')
    .replace(/\bNaN\b/g, '0')
    .trim();
}

function buildDebugChip(isZh = true) {
  return <Chip size="small" label={isZh ? '调试' : 'Debug'} color="warning" variant="outlined" />;
}

function clip(text: string, max = 64) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatSigned(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `${safeValue > 0 ? '+' : ''}${Math.round(safeValue)}`;
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

function readMemoryDistillationMeta(item: ProjectedRuntimeTimelineItem) {
  return (item.meta as { memoryDistillation?: Record<string, unknown> } | undefined)?.memoryDistillation || null;
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
    director_intervention: '导演干预',
    decision_trace: '决策痕迹',
    phase_transition: '阶段切换',
    action_resolution: '动作结算',
    board_state: '棋盘状态',
    score_update: '分数更新',
  };
  return labels[kind] || kind;
}

function formatMemoryKind(kind: string | undefined) {
  const labels: Record<string, string> = {
    decision: '决策',
    conflict: '冲突',
    bond: '亲近',
    resentment: '不满',
    status_shift: '状态变化',
    trait_evidence: '性格证据',
    bias: '偏见',
    taboo: '禁忌',
    obsession: '执念',
    artifact: '产物',
    thread_effect: '线程影响',
  };
  return kind ? labels[kind] || cleanText(kind) : '记忆';
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
  const distillation = readMemoryDistillationMeta(item);
  const payload = item.event?.payload as Record<string, unknown> | undefined;
  const topicSnippet = typeof payload?.topicSnippet === 'string' ? payload.topicSnippet : null;
  const participantNames = Array.isArray(payload?.participantNames) ? payload.participantNames.filter((value): value is string => typeof value === 'string') : [];
  if (distillation) {
    const candidateTexts = Array.isArray(distillation.candidateTexts)
      ? sanitizeDistillationTexts(distillation.candidateTexts.filter((value: unknown): value is string => typeof value === 'string'))
      : [];
    return clip(cleanText(candidateTexts.join(' / ') || item.text), 88);
  }
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
  const distillation = readMemoryDistillationMeta(item);
  const payload = item.event?.payload as Record<string, unknown> | undefined;
  const projectionKind = typeof payload?.projectionKind === 'string' ? payload.projectionKind : null;
  if (distillation) {
    const owner = distillation.ownerType === 'character' ? '角色' : '群聊';
    const evidence = typeof distillation.newEvidenceCount === 'number' ? distillation.newEvidenceCount : 0;
    const reason = typeof distillation.reason === 'string' ? cleanText(distillation.reason) : '';
    return cleanText(`${owner}蒸馏 · 证据 ${evidence} · ${reason}`);
  }
  if (candidate) return cleanText(`候选 · ${formatSocialEventKind(candidate.eventKind)}`);
  if (effect) return cleanText(`回流 · ${projectionKind || effect.effectType}`);
  if (relation) {
    const from = item.actorNames?.join('、') || '某成员';
    const to = item.targetNames?.join('、') || '某成员';
    return cleanText(`${from} → ${to}`);
  }
  if (room?.delta?.heat || room?.delta?.cohesion || room?.delta?.topicDrift) return `热度 ${formatSigned(room.delta?.heat)} / 凝聚 ${formatSigned(room.delta?.cohesion)}`;
  if (memory) return cleanText(`${formatMemoryKind(memory.kind)} · ${Math.round(memory.confidence * 100)}%`);
  return null;
}

function buildTimelineCaption(item: ProjectedRuntimeTimelineItem) {
  const cluster = readSocialEventClusterMeta(item);
  const distillation = readMemoryDistillationMeta(item);
  if (cluster?.eventKind === 'pair_private_thread' && cluster.stage === 'opened') return null;
  if (distillation) return null;
  if (item.event?.kind === 'interaction' || item.event?.kind === 'relationship_delta') return null;
  const actors = item.actorNames?.length ? item.actorNames.join('、') : null;
  const targets = item.targetNames?.length ? item.targetNames.join('、') : null;
  if (!actors && !targets) return null;
  return clip(cleanText(actors && targets ? `${actors} → ${targets}` : actors || targets || ''), 36);
}

function buildOverviewRoomLabel(room: NonNullable<GroupChat['worldState']['structuredRoomState']>) {
  return `热度 ${Math.round(room.heat)} / 凝聚 ${Math.round(room.cohesion)} / 话题漂移 ${Math.round(room.topicDrift)}`;
}

function buildOverviewStageLabel(chat: GroupChat) {
  return chat.worldState.phase === 'idle' ? '自由聊天' : chat.worldState.phase;
}

function buildOverviewRows(chat: GroupChat & { primaryRecentEvent?: string }, members: AICharacter[]) {
  const room = chat.worldState.structuredRoomState;
  const stageLabel = buildOverviewStageLabel(chat);
  return [
    room ? { key: 'overview-room', label: '局势', value: buildOverviewRoomLabel(room) } : null,
    { key: 'overview-stage', label: '阶段', value: stageLabel },
  ].filter(Boolean) as Array<{ key: string; label: string; value: string }>;
}

function timelineTone(item: ProjectedRuntimeTimelineItem) {
  if (readSocialEventClusterMeta(item)) return 'rgba(25, 118, 210, 0.06)';
  if (readRelationshipDeltaMeta(item)) return 'rgba(142, 36, 170, 0.05)';
  if (readRoomShiftMeta(item)) return 'rgba(67, 160, 71, 0.05)';
  return 'action.hover';
}

function timelineTypeLabel(item: ProjectedRuntimeTimelineItem) {
  if (readRelationshipDeltaMeta(item) || item.event?.kind === 'interaction') return '关系';
  if (readSocialEventClusterMeta(item)) return '事件';
  if (item.type === 'artifact') return '产物';
  if (readRoomShiftMeta(item)) return '局势';
  if (readMemoryCandidateMeta(item) || readMemoryDistillationMeta(item)) return '记忆';
  return item.type === 'note' ? '记录' : buildTimelineTitle(item);
}

function buildRelationshipDeltaChips(item: ProjectedRuntimeTimelineItem) {
  const relation = readRelationshipDeltaMeta(item);
  if (!relation) return [];
  return [
    relation.delta.warmth ? `亲和 ${formatSigned(relation.delta.warmth)}` : '',
    relation.delta.competence ? `能力 ${formatSigned(relation.delta.competence)}` : '',
    relation.delta.trust ? `信任 ${formatSigned(relation.delta.trust)}` : '',
    relation.delta.threat ? `威胁感 ${formatSigned(relation.delta.threat)}` : '',
  ].filter(Boolean);
}

function buildRoomShiftChips(item: ProjectedRuntimeTimelineItem) {
  const room = readRoomShiftMeta(item);
  if (!room?.delta) return [];
  return [
    room.delta.heat ? `热度 ${formatSigned(room.delta.heat)}` : '',
    room.delta.cohesion ? `凝聚 ${formatSigned(room.delta.cohesion)}` : '',
    room.delta.topicDrift ? `漂移 ${formatSigned(room.delta.topicDrift)}` : '',
  ].filter(Boolean);
}

function renderTimelineBody(item: ProjectedRuntimeTimelineItem) {
  const relationshipChips = buildRelationshipDeltaChips(item);
  if (relationshipChips.length) {
    return <Box sx={{ mt: 0.55 }}><StatChipRow items={relationshipChips} /></Box>;
  }
  const roomChips = buildRoomShiftChips(item);
  if (roomChips.length) {
    return <Box sx={{ mt: 0.55 }}><StatChipRow items={roomChips} /></Box>;
  }
  return <Typography variant="body2" sx={{ mt: 0.35 }}>{buildTimelineBody(item)}</Typography>;
}

function buildScenarioRows(chat: GroupChat, members: AICharacter[]) {
  const scenario = chat.scenarioState;
  if (!scenario) return [];
  const roleSummary = (scenario.roleAssignments || []).slice(0, 4).map((item) => `${members.find((member) => member.id === item.actorId)?.name || '成员'}${item.roleId ? `：${item.roleId}` : ''}`).join(' / ');
  const factionSummary = (scenario.factions || []).slice(0, 4).map((item) => item.label).join(' / ');
  const rows = [] as Array<{ key: string; label: string; value: string }>;
  if (roleSummary) rows.push({ key: 'roles', label: '角色位', value: roleSummary });
  if (factionSummary) rows.push({ key: 'factions', label: '阵营', value: factionSummary });
  if (scenario.currentTurnActorId) rows.push({ key: 'currentTurn', label: '当前轮次', value: members.find((item) => item.id === scenario.currentTurnActorId)?.name || '成员' });
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

function memberName(id: string, members: AICharacter[]) {
  return members.find((item) => item.id === id)?.name || '成员';
}

function buildConflictItems(chat: GroupChat, members: AICharacter[]) {
  const seen = new Set<string>();
  const active = [
    chat.worldState.conflictState?.primaryConflict,
    ...(chat.worldState.conflictState?.activeConflicts || []),
  ].filter(Boolean)
    .filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return item.stage !== 'resolved';
    })
    .map((item) => {
      const participants = [...(item?.participantIds || []), ...(item?.targetIds || [])]
        .filter((id, index, list) => id && list.indexOf(id) === index)
        .map((id) => memberName(id, members));
      return {
        key: item?.id || `conflict-${seen.size}`,
        title: formatConflictTypeLabel(item?.type),
        text: cleanText(item?.summary || ''),
        chips: [
          item?.stage === 'cooling' ? '降温中' : item?.stage === 'escalating' ? '升温中' : item?.stage === 'open' ? '公开拉扯' : item?.stage === 'emerging' ? '正在浮现' : '',
          item?.nextPressure ? formatConflictPressureLabel(item.nextPressure) : '',
          ...participants.slice(0, 3),
        ].filter(Boolean) as string[],
      };
    });
  const axes = (chat.worldState.conflictAxes || [])
    .filter((axis) => Math.abs(axis.currentTilt || 0) >= 8)
    .map((axis, index) => ({
      key: `axis-${axis.title}-${index}`,
      title: axis.title,
      text: `${axis.poles[0]} / ${axis.poles[1]}`,
      chips: [axis.currentTilt && axis.currentTilt < 0 ? axis.poles[1] : axis.poles[0]].filter(Boolean) as string[],
    }));
  return [...active, ...axes];
}

function renderConflictPanel(chat: GroupChat, members: AICharacter[]) {
  const items = buildConflictItems(chat, members);
  return (
    <SurfaceCard>
      <SectionHeader title="矛盾" dense />
      <Stack spacing={0.8}>
        {items.length ? items.map((item) => (
          <Box key={item.key} sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'rgba(244, 67, 54, 0.06)' }}>
            <Typography variant="caption" color="text.secondary">{item.title}</Typography>
            {item.text ? <Typography variant="body2" sx={{ mt: 0.25 }}>{item.text}</Typography> : null}
            {item.chips.length ? <Box sx={{ mt: 0.65 }}><StatChipRow items={item.chips.map((chip) => cleanText(chip))} /></Box> : null}
          </Box>
        )) : <Typography variant="caption" color="text.secondary">暂无正在生效的矛盾</Typography>}
      </Stack>
    </SurfaceCard>
  );
}

function renderDecisionTracePanel(items: RuntimeDecisionTraceItem[], isAdvancedRuntimeView: boolean) {
  if (!items.length) return null;
  return (
    <SurfaceCard>
      <SectionHeader title="调度痕迹" dense action={buildDebugChip()} />
      <Stack spacing={0.8}>
        {items.map((item) => (
          <Box key={item.messageId} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">{cleanText(item.senderName)}</Typography>
            <Typography variant="body2" sx={{ mt: 0.2 }}>{cleanText(item.directorLabel)}</Typography>
            {item.primaryLineLabel ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{cleanText(item.primaryLineLabel)}</Typography> : null}
            {item.score ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{cleanText(item.score)}</Typography> : null}
            {item.reasonLabels.length ? <Box sx={{ mt: 0.65 }}><StatChipRow items={item.reasonLabels.slice(0, 3).map((reason) => cleanText(reason))} /></Box> : null}
            {isAdvancedRuntimeView ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{cleanText(item.rawDirector)}{item.rawPrimaryLine ? ` / ${cleanText(item.rawPrimaryLine)}` : ''}</Typography> : null}
            {isAdvancedRuntimeView && item.reasonLabels.length ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{item.reasonLabels.slice(0, 4).map((reason) => cleanText(reason)).join(' / ')}</Typography> : null}
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

export default function ChatRuntimePanel({ chat, members, messages = [], privatePayloads = [] }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;
  const isAdvancedRuntimeView = developerMode && showAdvancedRuntimePanels;

  const roomRows = useMemo(() => buildOverviewRows(chat, members), [chat, members]);
  const projectedTimeline = useMemo(() => projectRuntimeTimeline(chat, members), [chat, members]);
  const displayTimeline = useMemo(() => projectedTimeline
    .filter((item) => timelineFilter === 'all' ? true : timelineFilter === 'artifact' ? item.type === 'artifact' || Boolean(readSocialEventClusterMeta(item)) : item.type === timelineFilter)
    .slice()
    .reverse()
    .slice(0, timelineExpanded ? 16 : 6), [projectedTimeline, timelineFilter, timelineExpanded]);
  const decisionTrace = useMemo(() => projectRuntimeDecisionTrace(messages, 5), [messages]);
  const structureRows = [...buildScenarioRows(chat, members), ...buildBoardRows(chat)];

  return (
    <>
      <PageSection spacing={1.5}>
        <SurfaceCard>
          <SectionHeader title="动态概览" dense />
          <Stack spacing={0.8}>
            {roomRows.length ? roomRows.map((row) => (
              <Box key={row.key} sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">{row.label}</Typography>
                <Typography variant="body2" sx={{ mt: 0.2 }}>{cleanText(row.value)}</Typography>
              </Box>
            )) : <Typography variant="body2">暂无结构化房间态势</Typography>}
            {structureRows.length && isDeveloperView ? (
              <Box sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">场景规则</Typography>
                <Typography variant="body2" sx={{ mt: 0.2 }}>{structureRows.map((row) => cleanText(`${row.label} ${row.value}`)).join(' / ')}</Typography>
              </Box>
            ) : null}
          </Stack>
        </SurfaceCard>

        {renderConflictPanel(chat, members)}

        <SurfaceCard>
          <SectionHeader title="运行时间线" dense />
          <Stack spacing={0.8}>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(['all', 'relationship', 'artifact', 'note'] as const).map((filter) => <Chip key={filter} size="small" label={filter === 'all' ? '全部' : filter === 'note' ? '记录' : filter === 'artifact' ? '产物/事件' : '关系'} color={timelineFilter === filter ? 'primary' : 'default'} variant={timelineFilter === filter ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(filter)} />)}
            </Box>
            {displayTimeline.length ? displayTimeline.map((item, index) => (
              <Box key={`${item.label}-${index}`} sx={{ p: 0.9, borderRadius: 2, bgcolor: timelineTone(item) }}>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip size="small" label={timelineTypeLabel(item)} variant="outlined" sx={{ height: 22 }} />
                  <Typography variant="caption" color="text.secondary">{buildTimelineTitle(item)}</Typography>
                  {buildTimelineMeta(item) ? <Typography variant="caption" color="text.secondary">{buildTimelineMeta(item)}</Typography> : null}
                </Stack>
                {renderTimelineBody(item)}
                {buildTimelineCaption(item) ? <Typography variant="caption" color="text.secondary">{buildTimelineCaption(item)}</Typography> : null}
              </Box>
            )) : <Typography variant="body2">暂无运行事件</Typography>}
            {projectedTimeline.length > 6 ? <Button size="small" variant="text" onClick={() => setTimelineExpanded((prev) => !prev)}>{timelineExpanded ? '收起' : '展开更多'}</Button> : null}
          </Stack>
        </SurfaceCard>

        {isAdvancedRuntimeView ? renderDecisionTracePanel(decisionTrace, isAdvancedRuntimeView) : null}

        {privatePayloads.length ? <PrivatePayloadPanel payloads={privatePayloads} /> : null}
        {(isSpeechStyleView || isAdvancedRuntimeView) ? <DialogueDebugPanel chat={chat} /> : null}
      </PageSection>
    </>
  );
}
