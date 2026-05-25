import type { Message } from '../../types/message';
import { getMessageRenderIdentity, messagesShareIdentity } from '../../services/messageIdentity';

export interface ChatRenderItem {
  key: string;
  message: Message;
  pending: boolean;
}

export function buildChatRenderItems(messages: Message[]): ChatRenderItem[] {
  const items: Array<ChatRenderItem & { order: number }> = [];

  for (const [order, message] of messages.entries()) {
    if (message.isDeleted) continue;

    if (items.some((item) => messagesShareIdentity(item.message, message))) continue;
    const identity = `${message.chatId}:${getMessageRenderIdentity(message)}`;

    items.push({
      key: message.clientKey || identity,
      message,
      pending: Boolean(message.isStreaming),
      order,
    });
  }

  return items
    .sort((a, b) => {
      if (a.message.timestamp !== b.message.timestamp) return a.message.timestamp - b.message.timestamp;
      if (a.message.type === 'event' && b.message.type !== 'event') return 1;
      if (a.message.type !== 'event' && b.message.type === 'event') return -1;
      return a.order - b.order;
    })
    .map((item) => ({
      key: item.key,
      message: item.message,
      pending: item.pending,
    }));
}
