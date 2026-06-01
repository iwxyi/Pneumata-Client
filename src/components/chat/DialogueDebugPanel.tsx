import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import DebugChip from '../common/DebugChip';
import { buildCalendarPatchDebugChips, buildCalendarPatchSummary, buildCalendarPatchTimelineTitle } from '../../services/worldCalendarPatchPresentation';
import { projectActiveUserGuidance } from '../../services/activeUserGuidancePresentation';
import {
  projectRuntimeTimeline,
  readProjectionInfoMeta,
  type ProjectedRuntimeTimelineItem,
} from '../../services/sessionProjection';
import {
  projectConflictDebugState,
  projectDialogueStructuredEventCard,
  projectDialogueRecentSignal,
  projectProjectionDescription,
  projectProjectionTitle,
} from '../../services/dialogueDebugProjection';
import { projectMemoryDistillationDebug } from '../../services/memoryDistillationDebugProjection';

interface DialogueDebugPanelProps {
  chat: GroupChat;
  members?: AICharacter[];
  messages?: Message[];
}


function buildDebugChipLabels(isZh: boolean) {
  return isZh
    ? ['发言指纹', '消息原型', '立场记忆', '反标准答案']
    : ['Speech fingerprint', 'Message archetype', 'Stance memory', 'Anti-answer filter'];
}


function renderMemoryDistillationBlock(chat: GroupChat, timeline: ProjectedRuntimeTimelineItem[], isZh: boolean, members: AICharacter[] = []) {
  const projection = projectMemoryDistillationDebug(chat, timeline, isZh, members);
  if (!projection) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{projection.sectionTitle}</Typography>
      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
        {projection.runtimeEventItems.map((item) => {
          return (
            <Box key={item.key} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">{new Date(item.timestamp).toLocaleString()}</Typography>
              <Typography variant="body2">{item.headline}</Typography>
              {item.bodyTexts.length ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>{item.bodyTexts.join(' / ')}</Typography> : null}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item.caption}</Typography>
            </Box>
          );
        })}
        {!projection.runtimeEventItems.length ? projection.persistedItems.map((item) => (
          <Box key={item.key} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">{new Date(item.timestamp).toLocaleString()}</Typography>
            <Typography variant="body2">{item.headline}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>{item.bodyText}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item.caption}</Typography>
          </Box>
        )) : null}
      </Stack>
    </Box>
  );
}

function renderConflictDebugBlock(chat: GroupChat, members: AICharacter[] = []) {
  const state = projectConflictDebugState(chat, members);
  if (!state) return null;
  const chips = [state.type, state.stage, state.pressure ? `走向 ${state.pressure}` : ''].filter(Boolean);
  return (
    <>
      <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary">当前矛盾焦点</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{state.summary}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{`${state.type} · ${state.stage} · 强度 ${state.severity}`}</Typography>
        {state.pressure ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{`走向：${state.pressure}`}</Typography> : null}
        {state.hooks.length ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{`建议：${state.hooks.join(' / ')}`}</Typography> : null}
      </Box>
      {chips.length ? <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>{chips.map((item) => <Chip key={item} size="small" label={item} variant="outlined" />)}</Box> : null}
    </>
  );
}

function renderGuidanceDebugBlock(guidance: ReturnType<typeof projectActiveUserGuidance>, members: AICharacter[] = []) {
  if (!guidance) return null;
  return (
    <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'rgba(25, 118, 210, 0.08)' }}>
      <Typography variant="caption" color="text.secondary">当前引导（统一投影）</Typography>
      <Typography variant="body2" sx={{ mt: 0.25 }}>{sanitizeUserFacingText(`${guidance.sourceLabel} · ${guidance.statusLabel} · ${guidance.title}`, members)}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{sanitizeUserFacingText(guidance.emphasisLabel, members)}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{sanitizeUserFacingText(guidance.effectText, members)}</Typography>
      {guidance.chips.length ? (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.6 }}>
          {guidance.chips.slice(0, 8).map((item) => <Chip key={item} size="small" label={sanitizeUserFacingText(item, members)} variant="outlined" />)}
        </Box>
      ) : null}
      {guidance.warning ? (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
          {sanitizeUserFacingText(guidance.warning, members)}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function DialogueDebugPanel({ chat, members = [], messages = [] }: DialogueDebugPanelProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const dramaBoost = useSettingsStore((state) => state.developerUI.dramaBoost);
  const aiProfiles = useSettingsStore((state) => state.aiProfiles);
  const signal = projectDialogueRecentSignal(chat, members);
  const runtimeTimeline = projectRuntimeTimeline(chat, members);
  const latestItems = runtimeTimeline.filter((item) => item.event).slice(-5).reverse();
  const projectionItems = latestItems.filter((item) => {
    return Boolean(readProjectionInfoMeta(item)?.projectionKind);
  }).slice(0, 4);
  const activeGuidance = projectActiveUserGuidance({
    chat,
    members,
    messages,
    aiProfiles,
  });
  const hasDebugContent = Boolean(signal.recentEvent && signal.recentEvent !== '暂无') || latestItems.length > 0 || projectionItems.length > 0 || Boolean(chat.worldState.conflictState?.primaryConflict) || Boolean(activeGuidance);
  if (!hasDebugContent) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{isZh ? '发言调试' : 'Speech debug'}</Typography>
            <Typography variant="caption" color="text.secondary">{isZh ? '用于排查发言调度、记忆蒸馏和事件投影。' : 'For inspecting speech routing, memory distillation, and event projection.'}</Typography>
          </Box>
          <DebugChip />
        </Box>
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip size="small" label={`${isZh ? '阶段' : 'Phase'} ${chat.worldState.phase || 'idle'}`} variant="outlined" />
            <Chip size="small" label={`${isZh ? '气氛' : 'Mood'} ${signal.mood}`} variant="outlined" />
            <Chip size="small" label={`${isZh ? '焦点' : 'Focus'} ${signal.focus}`} variant="outlined" />
            <Chip size="small" color={dramaBoost ? 'warning' : 'default'} label={dramaBoost ? (isZh ? '戏剧增强开' : 'Drama boost on') : (isZh ? '戏剧增强关' : 'Drama boost off')} variant="outlined" />
          </Box>

          <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">{isZh ? '最近事件' : 'Recent event'}</Typography>
            <Typography variant="body2">{signal.recentEvent}</Typography>
          </Box>

          {renderConflictDebugBlock(chat, members)}
          {renderGuidanceDebugBlock(activeGuidance, members)}

          {projectionItems.length ? (
            <Box>
              <Typography variant="caption" color="text.secondary">{isZh ? '投影事件' : 'Projection events'}</Typography>
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {projectionItems.map((item) => (
                  <Box key={item.event?.id || item.createdAt} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">{projectProjectionTitle(item, isZh)} · {new Date(item.createdAt).toLocaleString()}</Typography>
                    <Typography variant="body2">{sanitizeUserFacingText(item.text, members)}</Typography>
                    {projectProjectionDescription(item, members) ? <Typography variant="caption" color="text.secondary">{projectProjectionDescription(item, members)}</Typography> : null}
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}

          {renderMemoryDistillationBlock(chat, runtimeTimeline, isZh, members)}

          <Box>
            <Typography variant="caption" color="text.secondary">{isZh ? '最近结构化事件' : 'Recent structured events'}</Typography>
            {latestItems.length ? (
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {latestItems.map((item) => {
                  const display = projectDialogueStructuredEventCard(item, isZh, members);
                  return (
                    <Box key={item.event?.id || item.createdAt} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{display.title} · {display.timestampLabel}</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{display.bodyText}</Typography>
                      {display.summaryText ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{display.summaryText}</Typography> : null}
                      {display.chips.length ? <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.45 }}>{display.chips.map((chip) => <Chip key={`${item.event?.id || item.createdAt}-${chip}`} size="small" label={chip} variant="outlined" />)}</Box> : null}
                      {display.guidanceMetaLine ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{sanitizeUserFacingText(display.guidanceMetaLine, members)}</Typography> : null}
                      {display.attentionMetaLine ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{sanitizeUserFacingText(display.attentionMetaLine, members)}</Typography> : null}
                      {display.projectionMetaLine ? <Typography variant="caption" color="text.secondary">{sanitizeUserFacingText(display.projectionMetaLine, members)}</Typography> : null}
                    </Box>
                  );
                })}
              </Stack>
            ) : <Typography variant="caption" color="text.secondary">{isZh ? '暂无运行调试数据' : 'No runtime debug data'}</Typography>}
          </Box>

          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {buildDebugChipLabels(isZh).map((item) => <Chip key={item} size="small" label={item} />)}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
