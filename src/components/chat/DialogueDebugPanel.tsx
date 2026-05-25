import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';
import { formatConflictHookLabels, formatConflictPressureLabel, formatConflictStageLabel, formatConflictTypeLabel } from '../../services/runtimeEventFactory';
import { sanitizeDistillationTexts } from '../../services/distillationText';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import { getExperienceLensLabel } from '../../services/experienceChangePresentation';
import DebugChip from '../common/DebugChip';

interface DialogueDebugPanelProps {
  chat: GroupChat;
  members?: AICharacter[];
}

function buildRecentSignal(chat: GroupChat, members: AICharacter[] = []) {
  const recentEvent = sanitizeUserFacingText(chat.worldState.recentEvent || '暂无', members);
  const focus = chat.worldState.focus || '未设置';
  const mood = chat.worldState.mood || '未设置';
  return { recentEvent, focus, mood };
}

function formatEventKind(kind: RuntimeEventV2['kind'], isZh: boolean) {
  const labels: Record<RuntimeEventV2['kind'], string> = {
    message_generated: isZh ? '消息生成' : 'Message',
    interaction: isZh ? '互动' : 'Interaction',
    relationship_delta: isZh ? '关系变化' : 'Relationship delta',
    room_shift: isZh ? '房间态势' : 'Room shift',
    memory_candidate: isZh ? '记忆候选' : 'Memory candidate',
    artifact: isZh ? '产物' : 'Artifact',
    event_candidate: isZh ? '事件候选' : 'Event candidate',
    director_intervention: isZh ? '导演干预' : 'Director intervention',
    decision_trace: isZh ? '决策痕迹' : 'Decision trace',
    phase_transition: isZh ? '阶段切换' : 'Phase transition',
    action_resolution: isZh ? '动作结算' : 'Action resolution',
    board_state: isZh ? '棋盘状态' : 'Board state',
    score_update: isZh ? '分数更新' : 'Score update',
  };
  return labels[kind] || kind;
}

function buildProjectionMeta(item: RuntimeEventV2, isZh: boolean) {
  const payload = item.payload as Record<string, unknown>;
  const projectionKind = typeof payload?.projectionKind === 'string' ? payload.projectionKind : null;
  const topicSnippet = typeof payload?.topicSnippet === 'string' ? payload.topicSnippet : typeof payload?.summarySnippet === 'string' ? payload.summarySnippet : null;
  const participantNames = Array.isArray(payload?.participantNames) ? payload.participantNames.filter((value): value is string => typeof value === 'string') : [];
  if (!projectionKind && !topicSnippet && !participantNames.length) return null;
  return [formatProjectionKind(projectionKind, isZh), participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · ');
}

function formatProjectionKind(projectionKind: string | null | undefined, isZh = true) {
  const map: Record<string, string> = {
    relationship_backflow: isZh ? '关系回流' : 'Relationship backflow',
    summary_backflow: isZh ? '摘要回流' : 'Summary backflow',
    source_chat_patch: isZh ? '群聊投影' : 'Source chat projection',
  };
  return projectionKind ? map[projectionKind] || projectionKind : '';
}

function buildProjectionTitle(item: RuntimeEventV2, isZh: boolean) {
  const payload = item.payload as Record<string, unknown>;
  const projectionKind = typeof payload?.projectionKind === 'string' ? payload.projectionKind : '';
  return formatProjectionKind(projectionKind, isZh) || formatEventKind(item.kind, isZh);
}

function buildProjectionDescription(item: RuntimeEventV2, members: AICharacter[] = []) {
  const payload = item.payload as Record<string, unknown>;
  const participantNames = Array.isArray(payload?.participantNames) ? payload.participantNames.filter((value): value is string => typeof value === 'string') : [];
  const topicSnippet = typeof payload?.topicSnippet === 'string' ? payload.topicSnippet : typeof payload?.summarySnippet === 'string' ? payload.summarySnippet : null;
  return sanitizeUserFacingText([participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · '), members);
}

function buildDebugChipLabels(isZh: boolean) {
  return isZh
    ? ['发言指纹', '消息原型', '立场记忆', '反标准答案']
    : ['Speech fingerprint', 'Message archetype', 'Stance memory', 'Anti-answer filter'];
}

function buildConflictDebugState(chat: GroupChat, members: AICharacter[] = []) {
  const primary = chat.worldState.conflictState?.primaryConflict;
  if (!primary) return null;
  return {
    type: formatConflictTypeLabel(primary.type),
    stage: formatConflictStageLabel(primary.stage),
    severity: primary.severity.toFixed(2),
    pressure: formatConflictPressureLabel(primary.nextPressure),
    hooks: formatConflictHookLabels(primary.developmentHooks),
    summary: sanitizeUserFacingText(primary.summary, members),
  };
}

function readMemoryDistillationPayload(item: RuntimeEventV2) {
  const payload = item.payload as Record<string, unknown>;
  return payload?.eventType === 'memory_distillation' ? payload : null;
}

function formatMemoryDistillationReason(reason: unknown, isZh: boolean) {
  const value = typeof reason === 'string' ? reason : '';
  const labels: Record<string, string> = {
    distilled: isZh ? '已完成本地蒸馏' : 'Local distillation completed',
    llm_distilled: isZh ? '已完成 LLM 蒸馏' : 'LLM distillation completed',
    below_threshold: isZh ? '暂未达到蒸馏阈值' : 'Below the distillation threshold',
    cooldown: isZh ? '仍在蒸馏冷却期' : 'Still in distillation cooldown',
    already_distilled_recently: isZh ? '这批证据最近已蒸馏过' : 'This evidence was distilled recently',
    insufficient_new_evidence: isZh ? '新增证据还不够' : 'Not enough new evidence yet',
    no_candidates: isZh ? '本轮没有形成稳定候选' : 'No stable candidates this round',
  };
  return labels[value] || value;
}

function formatMemoryDistillationOwner(payload: Record<string, unknown>, isZh: boolean) {
  if (typeof payload.ownerLabel === 'string' && payload.ownerLabel) return payload.ownerLabel;
  return payload.ownerType === 'character' ? (isZh ? '角色记忆' : 'Character memory') : (isZh ? '群聊记忆' : 'Chat memory');
}

function formatMemoryDistillationMergeMode(payload: Record<string, unknown>, isZh: boolean) {
  if (typeof payload.mergeModeLabel === 'string' && payload.mergeModeLabel) return payload.mergeModeLabel;
  if (typeof payload.mergeMode === 'string' && payload.mergeMode) {
    const labels: Record<string, string> = {
      reinforce_same_bucket: isZh ? '同类证据强化' : 'Reinforce similar evidence',
      revise_existing: isZh ? '修订已有记忆' : 'Revise existing memory',
      merge_related: isZh ? '合并相关记忆' : 'Merge related memories',
      append_new: isZh ? '新增记忆' : 'Append new memory',
    };
    return labels[payload.mergeMode] || payload.mergeMode;
  }
  return isZh ? '同类证据强化合并' : 'Reinforce similar evidence';
}

function formatMemorySourceTag(sourceTag: string | null | undefined, isZh: boolean) {
  const lensLabel = getExperienceLensLabel(sourceTag, isZh ? 'zh' : 'en');
  if (lensLabel) return lensLabel;
  const labels: Record<string, string> = {
    llm_memory_objective_event: isZh ? '客观事件' : 'Objective event',
    llm_memory_character_perspective: isZh ? '主观理解' : 'Character perspective',
    llm_memory_relationship_imprint: isZh ? '关系印记' : 'Relationship imprint',
    llm_memory_emotion_effect: isZh ? '情绪后效' : 'Emotion effect',
    llm_memory_growth_signal: isZh ? '成长信号' : 'Growth signal',
    llm_memory_distillation: isZh ? 'LLM 蒸馏' : 'LLM distillation',
    memory_distillation: isZh ? '记忆蒸馏' : 'Memory distillation',
  };
  return sourceTag ? labels[sourceTag] || sourceTag : labels.memory_distillation;
}

function formatMemoryDistillationCounts(payload: Record<string, unknown>, isZh: boolean) {
  const evidenceCount = typeof payload.newEvidenceCount === 'number' ? payload.newEvidenceCount : 0;
  return isZh ? `证据事件 ${evidenceCount}` : `Evidence events ${evidenceCount}`;
}

function buildMemoryDistillationHeadline(payload: Record<string, unknown>, isZh: boolean) {
  const owner = formatMemoryDistillationOwner(payload, isZh);
  return `${owner}蒸馏`;
}

function buildMemoryDistillationBody(payload: Record<string, unknown>, members: AICharacter[] = []) {
  const candidateTexts = Array.isArray(payload.candidateTexts)
    ? sanitizeDistillationTexts(payload.candidateTexts.filter((value: unknown): value is string => typeof value === 'string'))
    : [];
  return candidateTexts.map((text) => sanitizeUserFacingText(text, members));
}

function buildMemoryDistillationCaption(payload: Record<string, unknown>, isZh: boolean) {
  return `${formatMemoryDistillationCounts(payload, isZh)} · ${isZh ? '合并方式' : 'Merge'} ${formatMemoryDistillationMergeMode(payload, isZh)}`;
}

function renderMemoryDistillationBlock(chat: GroupChat, isZh: boolean, members: AICharacter[] = []) {
  const runtimeEventItems = (chat.runtimeEventsV2 || [])
    .filter((item) => item.kind === 'artifact' && readMemoryDistillationPayload(item))
    .slice(-4)
    .reverse();
  const distilledMemoryItems = (chat.layeredMemories || [])
    .filter((item) => item.origin === 'distilled')
    .slice()
    .sort((left, right) => (right.distilledAt || right.updatedAt || 0) - (left.distilledAt || left.updatedAt || 0))
    .slice(0, 4);
  if (!runtimeEventItems.length && !distilledMemoryItems.length) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{isZh ? '记忆蒸馏' : 'Memory distillation'}</Typography>
      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
        {runtimeEventItems.map((item) => {
          const payload = readMemoryDistillationPayload(item) as Record<string, unknown>;
          const candidateTexts = buildMemoryDistillationBody(payload, members);
          return (
            <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">{new Date(item.createdAt).toLocaleString()}</Typography>
              <Typography variant="body2">{buildMemoryDistillationHeadline(payload, isZh)}</Typography>
              {candidateTexts.length ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>{candidateTexts.join(' / ')}</Typography> : null}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{buildMemoryDistillationCaption(payload, isZh)}</Typography>
            </Box>
          );
        })}
        {!runtimeEventItems.length ? distilledMemoryItems.map((item) => (
          <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">{new Date(item.distilledAt || item.updatedAt).toLocaleString()}</Typography>
            <Typography variant="body2">{`${item.ownerId === chat.id ? (isZh ? '群聊记忆' : 'Chat memory') : (isZh ? '角色记忆' : 'Character memory')} · ${isZh ? '已写入核心蒸馏' : 'Distilled into long-term memory'}`}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>{sanitizeUserFacingText(item.text, members)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{isZh ? `来源 ${formatMemorySourceTag(item.sourceTag, isZh)} · 强化 ${item.reinforcementCount}` : `Source ${formatMemorySourceTag(item.sourceTag, isZh)} · Reinforcement ${item.reinforcementCount}`}</Typography>
          </Box>
        )) : null}
      </Stack>
    </Box>
  );
}

function renderConflictDebugBlock(chat: GroupChat, members: AICharacter[] = []) {
  const state = buildConflictDebugState(chat, members);
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

export default function DialogueDebugPanel({ chat, members = [] }: DialogueDebugPanelProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const dramaBoost = useSettingsStore((state) => state.developerUI.dramaBoost);
  const signal = buildRecentSignal(chat, members);
  const latestItems = (chat.runtimeEventsV2 || []).slice(-5).reverse();
  const projectionItems = latestItems.filter((item) => {
    const payload = item.payload as Record<string, unknown>;
    return typeof payload?.projectionKind === 'string';
  }).slice(0, 4);
  const hasDebugContent = Boolean(signal.recentEvent && signal.recentEvent !== '暂无') || latestItems.length > 0 || projectionItems.length > 0 || Boolean(chat.worldState.conflictState?.primaryConflict);
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

          {projectionItems.length ? (
            <Box>
              <Typography variant="caption" color="text.secondary">{isZh ? '投影事件' : 'Projection events'}</Typography>
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {projectionItems.map((item) => (
                  <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">{buildProjectionTitle(item, isZh)} · {new Date(item.createdAt).toLocaleString()}</Typography>
                    <Typography variant="body2">{sanitizeUserFacingText(item.summary, members)}</Typography>
                    {buildProjectionDescription(item, members) ? <Typography variant="caption" color="text.secondary">{buildProjectionDescription(item, members)}</Typography> : null}
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}

          {renderMemoryDistillationBlock(chat, isZh, members)}

          <Box>
            <Typography variant="caption" color="text.secondary">{isZh ? '最近结构化事件' : 'Recent structured events'}</Typography>
            {latestItems.length ? (
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {latestItems.map((item) => {
                  const projectionMeta = buildProjectionMeta(item, isZh);
                  return (
                    <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{formatEventKind(item.kind, isZh)} · {new Date(item.createdAt).toLocaleString()}</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{sanitizeUserFacingText(item.summary, members)}</Typography>
                      {projectionMeta ? <Typography variant="caption" color="text.secondary">{sanitizeUserFacingText(projectionMeta, members)}</Typography> : null}
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
