import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
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

export default function DialogueDebugPanel({ chat }: DialogueDebugPanelProps) {
  const dramaBoost = useSettingsStore((state) => state.developerUI.dramaBoost);
  const signal = buildRecentSignal(chat);
  const latestItems = (chat.runtimeEventsV2 || []).slice(-5).reverse();

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>发言风格</Typography><Chip size="small" label="调试" color="warning" variant="outlined" /></Box>
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip size="small" label={`阶段 ${chat.worldState.phase || 'idle'}`} variant="outlined" />
            <Chip size="small" label={`气氛 ${signal.mood}`} variant="outlined" />
            <Chip size="small" label={`焦点 ${signal.focus}`} variant="outlined" />
            <Chip size="small" color={dramaBoost ? 'warning' : 'default'} label={dramaBoost ? '戏剧增强开' : '戏剧增强关'} variant="outlined" />
          </Box>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">最近事件</Typography>
            <Typography variant="body2">{signal.recentEvent}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">最近结构化事件</Typography>
            {latestItems.length ? (
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {latestItems.map((item) => (
                  <Box key={item.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">{formatEventKind(item.kind)} · {new Date(item.createdAt).toLocaleString()}</Typography>
                    <Typography variant="body2">{item.summary}</Typography>
                  </Box>
                ))}
              </Stack>
            ) : <Typography variant="caption" color="text.secondary">暂无运行调试数据</Typography>}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {['speech_fingerprint', 'message_archetype', 'stance_memory', 'anti_answer_filter'].map((item) => <Chip key={item} size="small" label={item} />)}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
