import { useMemo } from 'react';
import type { Message } from '../types/message';
import { projectCurrentChatMessages, type MessageWindowLike } from '../services/currentChatMessages';

export function useCurrentChatMessages(params: {
  chatId?: string | null;
  activeMessages: Message[];
  cachedWindows: Record<string, MessageWindowLike | undefined>;
}) {
  return useMemo(() => (
    params.chatId
      ? projectCurrentChatMessages({
        chatId: params.chatId,
        activeMessages: params.activeMessages,
        cachedWindow: params.cachedWindows[params.chatId],
      })
      : []
  ), [params.activeMessages, params.cachedWindows, params.chatId]);
}

