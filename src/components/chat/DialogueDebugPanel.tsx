import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GroupChat } from '../../types/chat';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface DialogueDebugPanelProps {
  chat: GroupChat;
}

function buildRecentSignal(chat: GroupChat) {
  const recentEvent = chat.worldState.recentEvent || '暂无';
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
    phase_transition: isZh ? '阶段切换' : 'Phase transition',
    action_resolution: isZh ? '动作结算' : 'Action resolution',
    board_state: isZh ? '棋盘状态' : 'Board state',
    score_update: isZh ? '分数更新' : 'Score update',
  };
  return labels[kind] || kind;
}

function buildProjectionMeta(item: RuntimeEventV2) {
  const payload = item.payload as Record<string, unknown>;
  const projectionKind = typeof payload?.projectionKind === 'string' ? payload.projectionKind : null;
  const topicSnippet = typeof payload?.topicSnippet === 'string' ? payload.topicSnippet : typeof payload?.summarySnippet === 'string' ? payload.summarySnippet : null;
  const participantNames = Array.isArray(payload?.participantNames) ? payload.participantNames.filter((value): value is string => typeof value === 'string') : [];
  if (!projectionKind && !topicSnippet && !participantNames.length) return null;
  return [projectionKind, participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · ');
}

function buildProjectionTitle(item: RuntimeEventV2, isZh: boolean) {
  const payload = item.payload as Record<string, unknown>;
  const projectionKind = typeof payload?.projectionKind === 'string' ? payload.projectionKind : '';
  const map: Record<string, string> = {
    relationship_backflow: isZh ? '关系回流' : 'Relationship backflow',
    summary_backflow: isZh ? '摘要回流' : 'Summary backflow',
    source_chat_patch: isZh ? '群聊投影' : 'Source chat projection',
  };
  return map[projectionKind] || formatEventKind(item.kind, isZh);
}

function buildProjectionDescription(item: RuntimeEventV2) {
  const payload = item.payload as Record<string, unknown>;
  const participantNames = Array.isArray(payload?.participantNames) ? payload.participantNames.filter((value): value is string => typeof value === 'string') : [];
  const topicSnippet = typeof payload?.topicSnippet === 'string' ? payload.topicSnippet : typeof payload?.summarySnippet === 'string' ? payload.summarySnippet : null;
  return [participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · ');
}

function buildDebugChipLabels(isZh: boolean) {
  return isZh
    ? ['发言指纹', '消息原型', '立场记忆', '反标准答案']
    : ['Speech fingerprint', 'Message archetype', 'Stance memory', 'Anti-answer filter'];
}

export default function DialogueDebugPanel({ chat }: DialogueDebugPanelProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const dramaBoost = useSettingsStore((state) => state.developerUI.dramaBoost);
  const signal = buildRecentSignal(chat);
  const latestItems = (chat.runtimeEventsV2 || []).slice(-5).reverse();
  const projectionItems = latestItems.filter((item) => {
    const payload = item.payload as Record<string, unknown>;
    return typeof payload?.projectionKind === 'string';
  }).slice(0, 4);
  const hasDebugContent = Boolean(signal.recentEvent && signal.recentEvent !== '暂无') || latestItems.length > 0 || projectionItems.length > 0;
  if (!hasDebugContent) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{isZh ? '发言调试' : 'Speech debug'}</Typography>
          <Chip size="small" label={isZh ? '调试' : 'Debug'} color="warning" variant="outlined" />
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

          {projectionItems.length ? (
            <Box>
              <Typography variant="caption" color="text.secondary">{isZh ? '投影事件' : 'Projection events'}</Typography>
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {projectionItems.map((item) => (
                  <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">{buildProjectionTitle(item, isZh)} · {new Date(item.createdAt).toLocaleString()}</Typography>
                    <Typography variant="body2">{item.summary}</Typography>
                    {buildProjectionDescription(item) ? <Typography variant="caption" color="text.secondary">{buildProjectionDescription(item)}</Typography> : null}
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}

          <Box>
            <Typography variant="caption" color="text.secondary">{isZh ? '最近结构化事件' : 'Recent structured events'}</Typography>
            {latestItems.length ? (
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {latestItems.map((item) => {
                  const projectionMeta = buildProjectionMeta(item);
                  return (
                    <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{formatEventKind(item.kind, isZh)} · {new Date(item.createdAt).toLocaleString()}</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{item.summary}</Typography>
                      {projectionMeta ? <Typography variant="caption" color="text.secondary">{projectionMeta}</Typography> : null}
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
