import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import PageSection from '../common/PageSection';
import PrivatePayloadPanel from '../session/PrivatePayloadPanel';
import DebugChip from '../common/DebugChip';
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
import { buildMemberInnerLifeSummary } from '../../services/memberInnerLifePresentation';
import { sanitizeUserFacingText, type DisplayTextMember } from '../../services/displayTextSanitizer';
import { formatInnerImpulseLabel, formatSoulMetricLabel } from '../../services/runtimeDecisionLabels';
import { formatScenarioBoardKind, formatScenarioRoleLabel } from '../../services/scenarioPresentation';
import { projectMemoryReactivationItems, projectMemoryRecallItems } from '../../services/memoryRecallPresentation';

interface ChatRuntimePanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  messages?: Message[];
  privatePayloads?: Array<{ key: string; title: string; text: string }>;
}

function cleanText(text: string | undefined | null, members: DisplayTextMember[] = []) {
  return sanitizeUserFacingText(text || '', members)
    .replace(/relationship_backflow/g, '关系回流')
    .replace(/summary_backflow/g, '摘要回流')
    .replace(/source_chat_patch/g, '群聊投影')
    .replace(/亲近/g, '亲和')
    .replace(/尊重/g, '能力')
    .replace(/态度发生变化/g, '关系发生变化')
    .trim();
}

function clip(text: string, max = 64) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatSigned(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return `${safeValue > 0 ? '+' : ''}${Math.round(safeValue)}`;
}

function roomHeatLabel(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safeValue >= 70) return '互动很热';
  if (safeValue >= 35) return '互动偏热';
  if (safeValue <= 8) return '互动安静';
  return '互动平稳';
}

function roomCohesionLabel(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safeValue >= 24) return '氛围靠拢';
  if (safeValue >= 8) return '氛围略合';
  if (safeValue <= -24) return '氛围分裂';
  if (safeValue <= -8) return '氛围分散';
  return '氛围中性';
}

function roomTopicLabel(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safeValue >= 70) return '话题明显发散';
  if (safeValue >= 35) return '话题有点发散';
  return '话题稳定';
}

function roomDeltaLabel(kind: 'heat' | 'cohesion' | 'topic', value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  if (safeValue === 0) return '';
  if (kind === 'heat') return safeValue > 0 ? '互动升温' : '互动降温';
  if (kind === 'cohesion') return safeValue > 0 ? '氛围靠拢' : '氛围分散';
  return safeValue > 0 ? '话题发散' : '回到主线';
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

function buildTimelineBody(item: ProjectedRuntimeTimelineItem, members: DisplayTextMember[] = []) {
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
      ? sanitizeDistillationTexts(distillation.candidateTexts
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value) => cleanText(value, members)))
      : [];
    return clip(cleanText(candidateTexts.join(' / ') || item.text, members), 88);
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
  return clip(cleanText(candidate?.title || artifact?.title || artifact?.activityType || (participantNames.length ? `${participantNames.join(' ↔ ')} · ${topicSnippet || effect?.summary || item.text}` : null) || topicSnippet || effect?.summary || item.text, members), 88);
}

function buildTimelineMeta(item: ProjectedRuntimeTimelineItem, members: DisplayTextMember[] = []) {
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
    const reason = typeof distillation.reason === 'string' ? cleanText(distillation.reason, members) : '';
    return cleanText(`${owner}蒸馏 · 证据 ${evidence} · ${reason}`, members);
  }
  if (candidate) return cleanText(`候选 · ${formatSocialEventKind(candidate.eventKind)}`, members);
  if (effect) return cleanText(`回流 · ${projectionKind || effect.effectType}`, members);
  if (relation) {
    const from = item.actorNames?.join('、') || '某成员';
    const to = item.targetNames?.join('、') || '某成员';
    return cleanText(`${from} → ${to}`, members);
  }
  if (room?.delta?.heat || room?.delta?.cohesion || room?.delta?.topicDrift) {
    return [
      roomDeltaLabel('heat', room.delta?.heat),
      roomDeltaLabel('cohesion', room.delta?.cohesion),
      roomDeltaLabel('topic', room.delta?.topicDrift),
    ].filter(Boolean).join(' / ');
  }
  if (memory) return cleanText(`${formatMemoryKind(memory.kind)} · 有记忆沉淀`, members);
  return null;
}

function buildTimelineCaption(item: ProjectedRuntimeTimelineItem, members: DisplayTextMember[] = []) {
  const cluster = readSocialEventClusterMeta(item);
  const distillation = readMemoryDistillationMeta(item);
  if (cluster?.eventKind === 'pair_private_thread' && cluster.stage === 'opened') return null;
  if (distillation) return null;
  if (item.event?.kind === 'interaction' || item.event?.kind === 'relationship_delta') return null;
  const actors = item.actorNames?.length ? item.actorNames.join('、') : null;
  const targets = item.targetNames?.length ? item.targetNames.join('、') : null;
  if (!actors && !targets) return null;
  return clip(cleanText(actors && targets ? `${actors} → ${targets}` : actors || targets || '', members), 36);
}

function buildOverviewRoomLabel(room: NonNullable<GroupChat['worldState']['structuredRoomState']>) {
  return [roomHeatLabel(room.heat), roomCohesionLabel(room.cohesion), roomTopicLabel(room.topicDrift)].join(' / ');
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
    room.delta.heat ? roomDeltaLabel('heat', room.delta.heat) : '',
    room.delta.cohesion ? roomDeltaLabel('cohesion', room.delta.cohesion) : '',
    room.delta.topicDrift ? roomDeltaLabel('topic', room.delta.topicDrift) : '',
  ].filter(Boolean);
}

function renderTimelineBody(item: ProjectedRuntimeTimelineItem, members: DisplayTextMember[] = []) {
  const relationshipChips = buildRelationshipDeltaChips(item);
  if (relationshipChips.length) {
    return <Box sx={{ mt: 0.55 }}><StatChipRow items={relationshipChips} /></Box>;
  }
  const roomChips = buildRoomShiftChips(item);
  if (roomChips.length) {
    return <Box sx={{ mt: 0.55 }}><StatChipRow items={roomChips} /></Box>;
  }
  return <Typography variant="body2" sx={{ mt: 0.35 }}>{buildTimelineBody(item, members)}</Typography>;
}

function buildScenarioRows(chat: GroupChat, members: AICharacter[], language: string) {
  const scenario = chat.scenarioState;
  if (!scenario) return [];
  const roleSummary = (scenario.roleAssignments || []).slice(0, 4).map((item) => `${members.find((member) => member.id === item.actorId)?.name || '成员'}${item.roleId ? `：${formatScenarioRoleLabel(item.roleId, language)}` : ''}`).join(' / ');
  const factionSummary = (scenario.factions || []).slice(0, 4).map((item) => item.label).join(' / ');
  const rows = [] as Array<{ key: string; label: string; value: string }>;
  if (roleSummary) rows.push({ key: 'roles', label: '角色位', value: roleSummary });
  if (factionSummary) rows.push({ key: 'factions', label: '阵营', value: factionSummary });
  if (scenario.currentTurnActorId) rows.push({ key: 'currentTurn', label: '当前轮次', value: members.find((item) => item.id === scenario.currentTurnActorId)?.name || '成员' });
  return rows;
}

function buildBoardRows(chat: GroupChat, language: string) {
  const board = chat.scenarioState?.board;
  if (!board) return [];
  return [
    { key: 'boardKind', label: '棋盘', value: formatScenarioBoardKind(board.schema.kind, language) },
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
        text: cleanText(item?.summary || '', members),
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
      title: cleanText(axis.title, members),
      text: cleanText(`${axis.poles[0]} / ${axis.poles[1]}`, members),
      chips: [axis.currentTilt && axis.currentTilt < 0 ? axis.poles[1] : axis.poles[0]].filter(Boolean).map((chip) => cleanText(chip, members)) as string[],
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
            {item.chips.length ? <Box sx={{ mt: 0.65 }}><StatChipRow items={item.chips.map((chip) => cleanText(chip, members))} /></Box> : null}
          </Box>
        )) : <Typography variant="caption" color="text.secondary">暂无正在生效的矛盾</Typography>}
      </Stack>
    </SurfaceCard>
  );
}

function renderInnerLifePanel(members: AICharacter[], isZh: boolean) {
  const language = isZh ? 'zh' : 'en';
  const items = members
    .filter((member) => member.soulState)
    .slice()
    .sort((a, b) => (b.soulState?.updatedAt || 0) - (a.soulState?.updatedAt || 0))
    .slice(0, 6);
  if (!items.length) return null;
  return (
    <SurfaceCard>
      <SectionHeader title="内心状态" dense action={<DebugChip />} />
      <Stack spacing={0.8}>
        {items.map((member) => {
          const state = member.soulState;
          if (!state) return null;
          const summary = buildMemberInnerLifeSummary(member, isZh ? 'zh-CN' : 'en');
          const chips = summary?.chips.map((chip) => chip.label) || [`${isZh ? '冲动' : 'Impulse'} ${formatInnerImpulseLabel(state.lastImpulse, language)}`];
          return (
            <Box key={member.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">{member.name}</Typography>
                <Tooltip title={summary?.debugHint || ''} arrow>
                  <Chip size="small" label="参数" color="warning" variant="outlined" sx={{ height: 20, cursor: 'help' }} />
                </Tooltip>
              </Box>
              <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 650 }}>{summary?.title || formatInnerImpulseLabel(state.lastImpulse, language)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
                {cleanText(summary?.text || state.lastImpulseReason || '最近互动还没有留下特别清晰的内心余波。', members)}
              </Typography>
              <Box sx={{ mt: 0.6 }}><StatChipRow items={chips} /></Box>
            </Box>
          );
        })}
      </Stack>
    </SurfaceCard>
  );
}

function renderMemoryRecallPanel(chat: GroupChat, members: AICharacter[], messages: Message[]) {
  const items = projectMemoryRecallItems(chat, members, messages);
  const reactivatedItems = projectMemoryReactivationItems(members, messages);
  if (!items.length && !reactivatedItems.length) return null;
  return (
    <SurfaceCard>
      <SectionHeader title="记忆唤醒" subtitle="本轮注入才表示旧档进入 prompt；候选线索只说明当前上下文可命中旧档。" dense action={<DebugChip />} />
      <Stack spacing={0.8}>
        {items.map((item) => (
          <Tooltip key={item.key} title={item.tooltip} arrow placement="top-start">
            <Box sx={{ p: 0.9, borderRadius: 2, bgcolor: 'rgba(255, 152, 0, 0.08)', '&:hover .recall-title': { textDecoration: 'underline' } }}>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip size="small" label={item.memberName} variant="outlined" sx={{ height: 22 }} />
                <Chip size="small" label={item.statusLabel} color="warning" variant="outlined" sx={{ height: 22 }} />
                {item.secondaryLabel ? <Chip size="small" label={item.secondaryLabel} variant="outlined" sx={{ height: 22 }} /> : null}
                {item.tokens.map((token) => <Chip key={token} size="small" label={token} sx={{ height: 22 }} />)}
              </Stack>
              <Typography className="recall-title" variant="body2" sx={{ mt: 0.65, fontWeight: 650 }}>{item.summary}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{item.caption}</Typography>
            </Box>
          </Tooltip>
        ))}
        {reactivatedItems.length ? (
          <Stack spacing={0.75} sx={{ pt: items.length ? 0.25 : 0 }}>
            {reactivatedItems.map((item) => (
              <Tooltip key={item.key} title={item.tooltip} arrow placement="top-start">
                <Box sx={{ p: 0.9, borderRadius: 2, bgcolor: 'rgba(255, 152, 0, 0.12)', '&:hover .reactivated-memory': { textDecoration: 'underline' } }}>
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip size="small" label={item.memberName} variant="outlined" sx={{ height: 22 }} />
                    <Chip size="small" label="已重新激活" color="warning" variant="outlined" sx={{ height: 22 }} />
                    {item.matchedTokens.slice(0, 4).map((token) => <Chip key={token} size="small" label={token} sx={{ height: 22 }} />)}
                  </Stack>
                  <Typography className="reactivated-memory" variant="body2" sx={{ mt: 0.65, fontWeight: 650 }}>{item.summary}</Typography>
                </Box>
              </Tooltip>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </SurfaceCard>
  );
}

function reasonTone(reason: string) {
  if (/矛盾|冲突|挑战|对立|升级|压力/.test(reason)) return 'rgba(244, 67, 54, 0.08)';
  if (/关系|维护|共情|降温|安慰|亲近/.test(reason)) return 'rgba(46, 125, 50, 0.08)';
  if (/内在|面子|证明|想被看见|找补|回避|沉默/.test(reason)) return 'rgba(156, 39, 176, 0.08)';
  if (/被点名|回应|邀请|待回应/.test(reason)) return 'rgba(25, 118, 210, 0.08)';
  return 'action.hover';
}

function buildDecisionReasonGroups(item: RuntimeDecisionTraceItem, members: DisplayTextMember[] = []) {
  const groups: Array<{ key: string; label: string; items: string[]; hint?: string; tone?: string; statusLabel?: string; statusHint?: string }> = [];
  const speakerReasons = item.reasonLabels.slice(0, 4).map((reason) => cleanText(reason, members));
  if (speakerReasons.length) {
    groups.push({
      key: 'speaker',
      label: '发言原因',
      items: speakerReasons,
      hint: item.rawReasons.map((reason) => cleanText(reason, members)).join(' / '),
      tone: reasonTone(speakerReasons.join(' ')),
    });
  }
  const memoryClues = item.runtimeClueSections.find((section) => section.key === 'memory');
  if (memoryClues?.items.length) {
    groups.push({
      key: 'memory',
      label: '记忆线索',
      items: memoryClues.items.slice(0, 4).map((text) => cleanText(text, members)),
      hint: memoryClues.items.map((text) => cleanText(text, members)).join(' / '),
      statusLabel: memoryClues.statusLabel,
      statusHint: memoryClues.statusHint,
      tone: 'rgba(255, 152, 0, 0.08)',
    });
  }
  if (item.primaryLineLabel || item.directorLabel !== '无调度意图') {
    groups.push({
      key: 'narrative',
      label: '剧情压力',
      items: [item.directorLabel !== '无调度意图' ? cleanText(item.directorLabel, members) : '', item.primaryLineLabel ? cleanText(item.primaryLineLabel, members) : ''].filter(Boolean),
      hint: [item.rawDirector, item.rawPrimaryLine].filter(Boolean).map((text) => cleanText(text || '', members)).join(' / '),
      tone: 'rgba(25, 118, 210, 0.06)',
    });
  }
  if (item.innerLifeLabel) {
    groups.push({
      key: 'inner',
      label: '内心冲动',
      items: [cleanText(item.innerLifeLabel, members)],
      hint: [item.innerLifeReason, ...item.innerLifeEvidence].filter(Boolean).map((text) => cleanText(text || '', members)).join(' / '),
      tone: 'rgba(156, 39, 176, 0.06)',
    });
  }
  if (item.surfaceLabel || item.expressionLabel) {
    groups.push({
      key: 'expression',
      label: '表达形态',
      items: [item.surfaceLabel ? cleanText(item.surfaceLabel, members) : '', item.expressionLabel ? cleanText(item.expressionLabel, members) : ''].filter(Boolean),
      hint: [...item.surfaceBasis, ...item.expressionReasons].map((reason) => cleanText(reason, members)).join(' / '),
      tone: 'rgba(245, 124, 0, 0.06)',
    });
  }
  if (item.expressionFeedbackRetrievedLabels.length || item.expressionFeedbackAppliedLabels.length) {
    groups.push({
      key: 'feedback',
      label: '表达反馈',
      items: [
        ...item.expressionFeedbackRetrievedLabels.slice(0, 2).map((label) => `已检索 ${cleanText(label, members)}`),
        ...item.expressionFeedbackAppliedLabels.slice(0, 2).map((label) => `已影响 ${cleanText(label, members)}`),
      ],
      hint: [...item.expressionFeedbackRetrievedReasons, ...item.expressionFeedbackAppliedReasons].map((reason) => cleanText(reason, members)).join(' / '),
      tone: 'rgba(255, 152, 0, 0.08)',
    });
  }
  return groups;
}

function renderDecisionReasonGroup(group: ReturnType<typeof buildDecisionReasonGroups>[number]) {
  const content = (
    <Box sx={{ p: 0.85, borderRadius: 2, bgcolor: group.tone || 'action.hover' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
        <Typography className="decision-group-title" variant="caption" color="text.secondary">{group.label}</Typography>
        {group.statusLabel ? (
          <Tooltip title={group.statusHint || ''} arrow>
            <Chip size="small" label={group.statusLabel} color="warning" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }} />
          </Tooltip>
        ) : null}
      </Box>
      <Box sx={{ mt: 0.55 }}>
        <StatChipRow items={group.items} />
      </Box>
    </Box>
  );
  if (!group.hint) return content;
  return (
    <Tooltip key={group.key} title={group.hint} arrow>
      <Box sx={{ '&:hover .decision-group-title': { textDecoration: 'underline' } }}>
        {content}
      </Box>
    </Tooltip>
  );
}

function renderAdvancedDecisionDetail(item: RuntimeDecisionTraceItem, members: DisplayTextMember[] = []) {
  if (!item.debugDetailLabel) return null;
  const content = (
    <Typography
      className="decision-advanced-detail"
      variant="caption"
      color="text.secondary"
      sx={{ display: 'block', mt: 0.5 }}
    >
      {cleanText(item.debugDetailLabel, members)}
    </Typography>
  );
  if (!item.rawDebugHint) return content;
  return (
    <Tooltip title={cleanText(item.rawDebugHint, members)} arrow>
      <Box sx={{ '&:hover .decision-advanced-detail': { textDecoration: 'underline' } }}>
        {content}
      </Box>
    </Tooltip>
  );
}

function renderDecisionTracePanel(items: RuntimeDecisionTraceItem[], isAdvancedRuntimeView: boolean, members: DisplayTextMember[] = []) {
  if (!items.length) return null;
  return (
    <SurfaceCard>
      <SectionHeader title="发言调度" subtitle="解释本轮为什么由这个角色发言，以及表达形态如何被影响。" dense action={<DebugChip />} />
      <Stack spacing={0.8}>
        {items.map((item) => {
          const groups = buildDecisionReasonGroups(item, members);
          return (
          <Box key={item.messageId} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{cleanText(item.senderName, members)}</Typography>
              {item.score ? <Chip size="small" label={cleanText(item.score, members)} variant="outlined" sx={{ height: 22 }} /> : null}
            </Box>
            {groups.length ? (
              <Stack spacing={0.65} sx={{ mt: 0.75 }}>
                {groups.map((group) => <Box key={group.key}>{renderDecisionReasonGroup(group)}</Box>)}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>暂无可读调度原因</Typography>
            )}
            {isAdvancedRuntimeView ? renderAdvancedDecisionDetail(item, members) : null}
            {isAdvancedRuntimeView && item.innerLifeState ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {Object.entries(item.innerLifeState).slice(0, 6).map(([key, value]) => `${formatSoulMetricLabel(key)} ${String(value)}`).join(' / ')}
              </Typography>
            ) : null}
          </Box>
          );
        })}
      </Stack>
    </SurfaceCard>
  );
}

export default function ChatRuntimePanel({ chat, members, messages = [], privatePayloads = [] }: ChatRuntimePanelProps) {
  const { i18n } = useTranslation();
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;
  const isAdvancedRuntimeView = developerMode && showAdvancedRuntimePanels;
  const isZh = i18n.language.startsWith('zh');

  const roomRows = useMemo(() => buildOverviewRows(chat, members), [chat, members]);
  const projectedTimeline = useMemo(() => projectRuntimeTimeline(chat, members), [chat, members]);
  const displayTimeline = useMemo(() => projectedTimeline
    .filter((item) => timelineFilter === 'all' ? true : timelineFilter === 'artifact' ? item.type === 'artifact' || Boolean(readSocialEventClusterMeta(item)) : item.type === timelineFilter)
    .slice()
    .reverse()
    .slice(0, timelineExpanded ? 16 : 6), [projectedTimeline, timelineFilter, timelineExpanded]);
  const decisionTrace = useMemo(() => projectRuntimeDecisionTrace(messages, 5, members), [members, messages]);
  const structureRows = [...buildScenarioRows(chat, members, i18n.language), ...buildBoardRows(chat, i18n.language)];

  return (
    <>
      <PageSection spacing={1.5}>
        <SurfaceCard>
          <SectionHeader title="动态概览" dense />
          <Stack spacing={0.8}>
            {roomRows.length ? roomRows.map((row) => (
              <Box key={row.key} sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">{row.label}</Typography>
                <Typography variant="body2" sx={{ mt: 0.2 }}>{cleanText(row.value, members)}</Typography>
              </Box>
            )) : <Typography variant="body2">暂无结构化房间态势</Typography>}
            {structureRows.length && isDeveloperView ? (
              <Box sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">场景规则</Typography>
                <Typography variant="body2" sx={{ mt: 0.2 }}>{structureRows.map((row) => cleanText(`${row.label} ${row.value}`, members)).join(' / ')}</Typography>
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
                  {buildTimelineMeta(item, members) ? <Typography variant="caption" color="text.secondary">{buildTimelineMeta(item, members)}</Typography> : null}
                </Stack>
                {renderTimelineBody(item, members)}
                {buildTimelineCaption(item, members) ? <Typography variant="caption" color="text.secondary">{buildTimelineCaption(item, members)}</Typography> : null}
              </Box>
            )) : <Typography variant="body2">暂无运行事件</Typography>}
            {projectedTimeline.length > 6 ? <Button size="small" variant="text" onClick={() => setTimelineExpanded((prev) => !prev)}>{timelineExpanded ? '收起' : '展开更多'}</Button> : null}
          </Stack>
        </SurfaceCard>

        {isDeveloperView ? renderMemoryRecallPanel(chat, members, messages) : null}
        {isAdvancedRuntimeView ? renderInnerLifePanel(members, isZh) : null}
        {isAdvancedRuntimeView ? renderDecisionTracePanel(decisionTrace, isAdvancedRuntimeView, members) : null}

        {privatePayloads.length ? <PrivatePayloadPanel payloads={privatePayloads} /> : null}
        {(isSpeechStyleView || isAdvancedRuntimeView) ? <DialogueDebugPanel chat={chat} members={members} /> : null}
      </PageSection>
    </>
  );
}
