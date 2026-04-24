import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import type { GroupChat } from '../../types/chat';

interface DialogueDebugPanelProps {
  chat: GroupChat;
}

function buildRecentSignal(chat: GroupChat) {
  const recentEvent = chat.worldState.recentEvent || '暂无';
  const focus = chat.worldState.focus || '未设置';
  const mood = chat.worldState.mood || '未设置';
  return { recentEvent, focus, mood };
}

export default function DialogueDebugPanel({ chat }: DialogueDebugPanelProps) {
  const signal = buildRecentSignal(chat);
  const runtimeTimeline = chat.runtimeTimeline || [];
  const latestItems = runtimeTimeline.slice(-5).reverse();

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>发言风格</Typography>
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip size="small" label={`phase ${chat.worldState.phase || 'idle'}`} variant="outlined" />
            <Chip size="small" label={`mood ${signal.mood}`} variant="outlined" />
            <Chip size="small" label={`focus ${signal.focus}`} variant="outlined" />
          </Box>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">最近事件</Typography>
            <Typography variant="body2">{signal.recentEvent}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">最近运行时间线</Typography>
            {latestItems.length ? (
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {latestItems.map((item, index) => (
                  <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">{item.type} · {new Date(item.createdAt).toLocaleString()}</Typography>
                    <Typography variant="body2">{item.text}</Typography>
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
