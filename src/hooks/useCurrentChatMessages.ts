import { useMemo } from 'react';
import type { Message } from '../types/message';
import type { GroupChat } from '../types/chat';
import { projectCurrentChatMessages, type MessageWindowLike } from '../services/currentChatMessages';

export function useCurrentChatMessages(params: {
  chatId?: string | null;
  chat?: Pick<GroupChat, 'sessionKind' | 'messageBranchState'> & Partial<Pick<GroupChat, 'mode'>> | null;
  activeMessages: Message[];
  cachedWindows: Record<string, MessageWindowLike | undefined>;
}) {
  return useMemo(() => (
    params.chatId
      ? projectCurrentChatMessages({
        chatId: params.chatId,
        chat: params.chat,
        activeMessages: params.activeMessages,
        cachedWindow: params.cachedWindows[params.chatId],
      })
      : []
  ), [params.activeMessages, params.cachedWindows, params.chat, params.chatId]);
}
