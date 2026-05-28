import type { Message } from '../../types/message';
import { getMessageRenderIdentity, messagesShareIdentity } from '../../services/messageIdentity';
import { parseRuntimeEvent } from '../../services/runtimeEventFactory';

export interface ChatRenderItem {
  key: string;
  message: Message;
  pending: boolean;
}

function getEventSourceMessageId(message: Message) {
  if (message.type !== 'event') return null;
  const event = parseRuntimeEvent(message.content);
  return event?.sourceMessageId || null;
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

  const timestampByMessageId = new Map<string, number>();
  items.forEach((item) => {
    timestampByMessageId.set(item.message.id, item.message.timestamp);
    if (item.message.serverId) timestampByMessageId.set(item.message.serverId, item.message.timestamp);
    if (item.message.clientKey) timestampByMessageId.set(item.message.clientKey, item.message.timestamp);
  });

  return items
    .sort((a, b) => {
      const aSourceOrder = getEventSourceMessageId(a.message);
      const bSourceOrder = getEventSourceMessageId(b.message);
      const aSortTime = aSourceOrder ? (timestampByMessageId.get(aSourceOrder) ?? a.message.timestamp) : a.message.timestamp;
      const bSortTime = bSourceOrder ? (timestampByMessageId.get(bSourceOrder) ?? b.message.timestamp) : b.message.timestamp;
      if (aSortTime !== bSortTime) return aSortTime - bSortTime;
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
