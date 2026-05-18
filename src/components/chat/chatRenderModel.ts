import type { Message } from '../../types/message';

export interface ChatRenderItem {
  key: string;
  message: Message;
  pending: boolean;
}

function buildMessageIdentity(message: Message) {
  if (message.serverId) return `server:${message.serverId}`;
  return `${message.chatId}:${message.id}`;
}

export function buildChatRenderItems(messages: Message[]): ChatRenderItem[] {
  const seenIds = new Set<string>();
  const items: Array<ChatRenderItem & { order: number }> = [];

  for (const [order, message] of messages.entries()) {
    if (message.isDeleted) continue;

    const identity = buildMessageIdentity(message);
    if (seenIds.has(identity)) continue;
    seenIds.add(identity);

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
