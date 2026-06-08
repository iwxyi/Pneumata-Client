import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import MessageList from '../components/chat/MessageList';
import { api } from '../services/api';
import type { Message } from '../types/message';

const PUBLIC_CHAT_PAGE_SIZE = 40;

function mergeMessages(current: Message[], incoming: Message[]) {
  const byId = new Map<string, Message>();
  [...current, ...incoming].forEach((message) => {
    if (!message.isDeleted) byId.set(message.id, message);
  });
  return Array.from(byId.values()).sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

export default function PublicSharedChatPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [chatName, setChatName] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');

  const loadLatest = useCallback(async (mode: 'replace' | 'merge' = 'replace') => {
    if (!token) return;
    const result = await api.getPublicChatShare(token, { limit: PUBLIC_CHAT_PAGE_SIZE });
    setChatName(result.chat.name);
    setViewerCount(result.chat.viewerCount);
    setHasMore(result.hasMore);
    setMessages((current) => mode === 'merge' ? mergeMessages(current, result.messages) : result.messages);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadLatest('replace')
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLatest]);

  useEffect(() => {
    if (!token || error) return undefined;
    const timer = window.setInterval(() => {
      void loadLatest('merge').catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [error, loadLatest, token]);

  const loadOlder = useCallback(async () => {
    if (!token || loadingOlder || !hasMore || !messages.length) return;
    setLoadingOlder(true);
    try {
      const before = messages[0]?.timestamp;
      const result = await api.getPublicChatShare(token, { limit: PUBLIC_CHAT_PAGE_SIZE, before });
      setChatName(result.chat.name);
      setViewerCount(result.chat.viewerCount);
      setHasMore(result.hasMore);
      setMessages((current) => mergeMessages(result.messages, current));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, loadingOlder, messages, token]);

  const title = useMemo(() => chatName || '聊天记录', [chatName]);

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: 1,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 56,
        }}
      >
        <IconButton edge="start" onClick={() => navigate('/')}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>{title}</Typography>
          <Typography variant="caption" color="text.secondary">只读聊天记录 · 访问人数 {viewerCount}</Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={() => void loadLatest('merge')}>刷新</Button>
      </Box>

      {loading ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : error ? (
        <Stack sx={{ p: 2 }} spacing={1.5}>
          <Alert severity="error">{error}</Alert>
          <Button variant="outlined" onClick={() => navigate('/')}>回到首页</Button>
        </Stack>
      ) : (
        <MessageList
          messages={messages}
          characters={[]}
          onReachTop={loadOlder}
          isLoadingOlder={loadingOlder}
          hasMore={hasMore}
          topHint="没有更早的消息"
          loadingText="加载更多聊天记录…"
          topInset={1.5}
          bottomInset={2}
        />
      )}
    </Box>
  );
}
