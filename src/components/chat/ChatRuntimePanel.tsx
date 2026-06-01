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
import DialogueDebugPanel from './DialogueDebugPanel';
import {
  projectRuntimeTimeline,
  readSocialEventArtifactMeta as readTimelineSocialEventArtifactMeta,
  readSocialEventCandidateMeta as readTimelineSocialEventCandidateMeta,
  readSocialEventClusterMeta as readTimelineSocialEventClusterMeta,
  readSocialEventEffectMeta as readTimelineSocialEventEffectMeta,
  readRelationshipDeltaMeta as readTimelineRelationshipDeltaMeta,
  readRoomShiftMeta as readTimelineRoomShiftMeta,
  readMemoryCandidateMeta as readTimelineMemoryCandidateMeta,
  readCalendarPatchMeta as readTimelineCalendarPatchMeta,
  readAttentionInfoMeta as readTimelineAttentionInfoMeta,
  readAttentionFollowupMeta as readTimelineAttentionFollowupMeta,
  readMemoryDistillationMeta as readTimelineMemoryDistillationMeta,
  readProjectionInfoMeta as readTimelineProjectionInfoMeta,
  type ProjectedRuntimeTimelineItem,
} from '../../services/sessionProjection';
import { projectRuntimeDecisionTrace, type RuntimeDecisionTraceItem } from '../../services/runtimeDecisionTrace';
import { buildDecisionReasonGroups } from '../../services/runtimeDecisionTraceGroups';
import { buildMemberInnerLifeSummary } from '../../services/memberInnerLifePresentation';
import { sanitizeUserFacingText, type DisplayTextMember } from '../../services/displayTextSanitizer';
import { formatInnerImpulseLabel, formatSoulMetricLabel } from '../../services/runtimeDecisionLabels';
import { projectMemoryReactivationItems, projectMemoryRecallItems } from '../../services/memoryRecallPresentation';
import { projectActiveUserGuidance, type ActiveUserGuidanceProjection } from '../../services/activeUserGuidancePresentation';
import { projectMediaGenerationItems, type ProjectedMediaGenerationItem } from '../../services/mediaGenerationPresentation';
import { projectConflictPanelItems } from '../../services/conflictPanelProjection';
import { projectRoomOverviewRows } from '../../services/roomOverviewProjection';
import { projectRuntimeStructureRows } from '../../services/runtimeStructureProjection';
import { projectFilteredRuntimeTimeline, projectRuntimeTimelineFilterLabel, type RuntimeTimelineFilter } from '../../services/runtimeTimelineFilterProjection';
import {
  projectRuntimeTimelineDisplayItem,
} from '../../services/runtimeTimelinePresentation';
import { compactPillChipSx, microPillChipSx } from '../../styles/interaction';

interface ChatRuntimePanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  messages?: Message[];
  privatePayloads?: Array<{ key: string; title: string; text: string }>;
  privatePayloadTitle?: string;
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

function roomDeltaLabel(kind: 'heat' | 'cohesion' | 'topic', value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  if (safeValue === 0) return '';
  if (kind === 'heat') return safeValue > 0 ? '互动升温' : '互动降温';
  if (kind === 'cohesion') return safeValue > 0 ? '氛围靠拢' : '氛围分散';
  return safeValue > 0 ? '话题发散' : '回到主线';
}

function readSocialEventClusterMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineSocialEventClusterMeta(item);
}

function readSocialEventCandidateMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineSocialEventCandidateMeta(item);
}

function readSocialEventArtifactMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineSocialEventArtifactMeta(item);
}

function readSocialEventEffectMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineSocialEventEffectMeta(item);
}

function readRelationshipDeltaMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineRelationshipDeltaMeta(item);
}

function readRoomShiftMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineRoomShiftMeta(item);
}

function readMemoryCandidateMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineMemoryCandidateMeta(item);
}

function readMemoryDistillationMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineMemoryDistillationMeta(item);
}

function readCalendarPatchMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineCalendarPatchMeta(item);
}

function readAttentionInfoMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineAttentionInfoMeta(item);
}

function readAttentionFollowupMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineAttentionFollowupMeta(item);
}

function readProjectionInfoMeta(item: ProjectedRuntimeTimelineItem) {
  return readTimelineProjectionInfoMeta(item);
}

function renderConflictPanel(chat: GroupChat, members: AICharacter[]) {
  const items = projectConflictPanelItems(chat, members);
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

function renderActiveGuidancePanel(guidance: ActiveUserGuidanceProjection | null, isAdvancedRuntimeView: boolean, members: DisplayTextMember[] = []) {
  if (!guidance) return null;
  const detailTone = (tone: NonNullable<ActiveUserGuidanceProjection['detailRows'][number]['tone']> | undefined) => {
    if (tone === 'primary') return 'rgba(25, 118, 210, 0.09)';
    if (tone === 'success') return 'rgba(46, 125, 50, 0.09)';
    if (tone === 'warning') return 'rgba(237, 108, 2, 0.11)';
    return 'action.hover';
  };
  return (
    <SurfaceCard>
      <SectionHeader title="当前引导" subtitle="最新用户话题引导或主持指令会优先于叙事、矛盾和关系压力。" dense action={isAdvancedRuntimeView ? <DebugChip /> : undefined} />
      <Box sx={{ p: { xs: 1, sm: 1.1 }, borderRadius: 2, bgcolor: 'rgba(25, 118, 210, 0.07)', border: '1px solid', borderColor: 'primary.light' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">{cleanText(`${guidance.sourceLabel} · ${guidance.statusLabel}`, members)}</Typography>
            <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 700 }}>{cleanText(guidance.title, members)}</Typography>
          </Box>
          <Tooltip title={guidance.statusHint} arrow>
            <Chip size="small" label={guidance.statusLabel} color="primary" variant="outlined" sx={{ ...compactPillChipSx, cursor: 'help' }} />
          </Tooltip>
        </Box>
        <Typography variant="body2" sx={{ mt: 0.65, fontWeight: 700 }}>
          {cleanText(guidance.emphasisLabel, members)}
        </Typography>
        {guidance.detailRows.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.65, mt: 0.8 }}>
            {guidance.detailRows.map((row) => (
              <Box key={`${row.label}-${row.value}`} sx={{ p: 0.75, borderRadius: 1.5, bgcolor: detailTone(row.tone) }}>
                <Typography variant="caption" color="text.secondary">{row.label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.15, wordBreak: 'break-word' }}>{cleanText(row.value, members)}</Typography>
              </Box>
            ))}
          </Box>
        ) : null}
        <Typography variant="body2" sx={{ mt: 0.65 }}>
          {cleanText(guidance.effectText, members)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {cleanText(guidance.rawText, members)}
        </Typography>
        <Box sx={{ mt: 0.75 }}>
          <StatChipRow items={guidance.chips.map((item) => cleanText(item, members))} />
        </Box>
        {guidance.warning ? (
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.6 }}>
            {cleanText(guidance.warning, members)}
          </Typography>
        ) : null}
        {isAdvancedRuntimeView ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.6 }}>
            {guidance.debugChips.map((item) => cleanText(item, members)).join(' / ')}
          </Typography>
        ) : null}
      </Box>
    </SurfaceCard>
  );
}

function renderMediaGenerationPanel(items: ProjectedMediaGenerationItem[], isAdvancedRuntimeView: boolean, members: DisplayTextMember[] = []) {
  if (!items.length) return null;
  return (
    <SurfaceCard>
      <SectionHeader title="媒体生成" subtitle="展示 AI 决策后的图片、语音附件状态。" dense action={isAdvancedRuntimeView ? <DebugChip /> : undefined} />
      <Stack spacing={0.8}>
        {items.map((item) => {
          const body = (
            <Box sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: item.tone }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">{cleanText(item.title, members)}</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 650 }}>{cleanText(item.summary, members)}</Typography>
                </Box>
                <Chip size="small" label={item.statusLabel} color={item.status === 'failed' ? 'error' : item.status === 'ready' ? 'success' : 'primary'} variant="outlined" sx={compactPillChipSx} />
              </Box>
              {item.detailText ? (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: item.status === 'failed' ? 'error.main' : 'text.secondary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {cleanText(item.detailText, members)}
                </Typography>
              ) : null}
              <Box sx={{ mt: 0.7 }}>
                <StatChipRow items={item.chips.map((chip) => cleanText(chip, members))} />
              </Box>
              {isAdvancedRuntimeView && item.debugHint ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {cleanText(item.debugHint, members)}
                </Typography>
              ) : null}
            </Box>
          );
          return <Box key={item.key}>{body}</Box>;
        })}
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
                  <Chip size="small" label="参数" color="warning" variant="outlined" sx={{ ...microPillChipSx, cursor: 'help' }} />
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
                <Chip size="small" label={item.memberName} variant="outlined" sx={compactPillChipSx} />
                <Chip size="small" label={item.statusLabel} color="warning" variant="outlined" sx={compactPillChipSx} />
                {item.secondaryLabel ? <Chip size="small" label={item.secondaryLabel} variant="outlined" sx={compactPillChipSx} /> : null}
                {item.tokens.map((token) => <Chip key={token} size="small" label={token} sx={compactPillChipSx} />)}
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
                    <Chip size="small" label={item.memberName} variant="outlined" sx={compactPillChipSx} />
                    <Chip size="small" label="已重新激活" color="warning" variant="outlined" sx={compactPillChipSx} />
                    {item.matchedTokens.slice(0, 4).map((token) => <Chip key={token} size="small" label={token} sx={compactPillChipSx} />)}
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

function renderDecisionReasonGroup(group: ReturnType<typeof buildDecisionReasonGroups>[number]) {
  const content = (
    <Box sx={{ p: 0.85, borderRadius: 2, bgcolor: group.tone || 'action.hover' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
        <Typography className="decision-group-title" variant="caption" color="text.secondary">{group.label}</Typography>
        {group.statusLabel ? (
          <Tooltip title={group.statusHint || ''} arrow>
            <Chip size="small" label={group.statusLabel} color="warning" variant="outlined" sx={microPillChipSx} />
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
              {item.score ? <Chip size="small" label={cleanText(item.score, members)} variant="outlined" sx={compactPillChipSx} /> : null}
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

export default function ChatRuntimePanel({ chat, members, messages = [], privatePayloads = [], privatePayloadTitle }: ChatRuntimePanelProps) {
  const { i18n } = useTranslation();
  const [timelineFilter, setTimelineFilter] = useState<RuntimeTimelineFilter>('all');
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const aiProfiles = useSettingsStore((state) => state.aiProfiles);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;
  const isAdvancedRuntimeView = developerMode && showAdvancedRuntimePanels;
  const isZh = i18n.language.startsWith('zh');

  const roomRows = useMemo(() => projectRoomOverviewRows(chat, members), [chat, members]);
  const projectedTimeline = useMemo(() => projectRuntimeTimeline(chat, members), [chat, members]);
  const displayTimeline = useMemo(
    () => projectFilteredRuntimeTimeline(projectedTimeline, timelineFilter, timelineExpanded),
    [projectedTimeline, timelineFilter, timelineExpanded],
  );
  const decisionTrace = useMemo(() => projectRuntimeDecisionTrace(messages, 5, members), [members, messages]);
  const activeGuidance = useMemo(() => projectActiveUserGuidance({ chat, members, messages, aiProfiles }), [aiProfiles, chat, members, messages]);
  const mediaItems = useMemo(() => projectMediaGenerationItems(messages, members, 5), [members, messages]);
  const structureRows = useMemo(() => projectRuntimeStructureRows(chat, members, i18n.language), [chat, members, i18n.language]);

  return (
    <>
      <PageSection spacing={1.5} animate={false}>
        {renderActiveGuidancePanel(activeGuidance, isAdvancedRuntimeView, members)}

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
        {renderMediaGenerationPanel(mediaItems, isAdvancedRuntimeView, members)}

        <SurfaceCard>
          <SectionHeader title="运行时间线" dense />
          <Stack spacing={0.8}>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(['all', 'relationship', 'artifact', 'note'] as const).map((filter) => <Chip key={filter} size="small" label={projectRuntimeTimelineFilterLabel(filter)} color={timelineFilter === filter ? 'primary' : 'default'} variant={timelineFilter === filter ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(filter)} sx={compactPillChipSx} />)}
            </Box>
            {displayTimeline.length ? displayTimeline.map((item, index) => {
              const display = projectRuntimeTimelineDisplayItem(item, members);
              return (
                <Box key={`${item.label}-${index}`} sx={{ p: 0.9, borderRadius: 2, bgcolor: display.tone }}>
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <Tooltip title={display.title} arrow placement="top-start">
                      <Chip size="small" label={display.typeLabel} variant="outlined" sx={{ ...compactPillChipSx, cursor: 'help' }} />
                    </Tooltip>
                    {display.meta ? <Typography variant="caption" color="text.secondary">{display.meta}</Typography> : null}
                  </Stack>
                  {display.relationshipChips.length ? (
                    <Box sx={{ mt: 0.55 }}><StatChipRow items={display.relationshipChips} /></Box>
                  ) : display.roomShiftChips.length ? (
                    <Box sx={{ mt: 0.55 }}><StatChipRow items={display.roomShiftChips} /></Box>
                  ) : (
                    <Typography variant="body2" sx={{ mt: 0.35 }}>{display.bodyText}</Typography>
                  )}
                  {display.caption ? <Typography variant="caption" color="text.secondary">{display.caption}</Typography> : null}
                </Box>
              );
            }) : <Typography variant="body2">暂无运行事件</Typography>}
            {projectedTimeline.length > 6 ? <Button size="small" variant="text" onClick={() => setTimelineExpanded((prev) => !prev)}>{timelineExpanded ? '收起' : '展开更多'}</Button> : null}
          </Stack>
        </SurfaceCard>

        {isDeveloperView ? renderMemoryRecallPanel(chat, members, messages) : null}
        {isAdvancedRuntimeView ? renderInnerLifePanel(members, isZh) : null}
        {isAdvancedRuntimeView ? renderDecisionTracePanel(decisionTrace, isAdvancedRuntimeView, members) : null}

        {privatePayloads.length ? <PrivatePayloadPanel payloads={privatePayloads} title={privatePayloadTitle} /> : null}
        {(isSpeechStyleView || isAdvancedRuntimeView) ? <DialogueDebugPanel chat={chat} members={members} messages={messages} /> : null}
      </PageSection>
    </>
  );
}
