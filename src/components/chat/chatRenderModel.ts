import type { Message } from '../../types/message';

export interface LiveChatMessage {
  key: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  startedAt: number;
}

export interface ChatRenderItem {
  key: string;
  message: Message;
  pending: boolean;
}

function normalizeContent(content: string) {
  return content.replace(/\s+/g, ' ').trim();
}

function buildMessageIdentity(message: Message) {
  if (message.serverId) return `server:${message.serverId}`;
  return `${message.chatId}:${message.id}`;
}

function buildLiveMessage(liveMessage: LiveChatMessage): Message {
  return {
    id: liveMessage.key,
    clientKey: liveMessage.key,
    chatId: liveMessage.chatId,
    type: 'ai',
    senderId: liveMessage.senderId,
    senderName: liveMessage.senderName,
    content: liveMessage.content,
    emotion: 0,
    timestamp: liveMessage.startedAt,
    isDeleted: false,
    isOptimistic: true,
  };
}

function shouldSuppressCommittedForLive(message: Message, liveMessage: LiveChatMessage) {
  if (message.type !== 'ai') return false;
  if (message.senderId !== liveMessage.senderId) return false;
  if (!normalizeContent(liveMessage.content)) return false;
  return normalizeContent(message.content) === normalizeContent(liveMessage.content);
}


export function buildChatRenderItems(messages: Message[], liveMessage: LiveChatMessage | null): ChatRenderItem[] {
  const seenIds = new Set<string>();
  const items: ChatRenderItem[] = [];
  let liveMessageRenderedInPlace = false;

  for (const message of messages) {
    if (message.isDeleted) continue;
    if (message.isOptimistic) continue;

    const identity = buildMessageIdentity(message);
    if (seenIds.has(identity)) continue;
    seenIds.add(identity);

    if (liveMessage && shouldSuppressCommittedForLive(message, liveMessage)) {
      items.push({
        key: liveMessage.key,
        message: buildLiveMessage(liveMessage),
        pending: true,
      });
      liveMessageRenderedInPlace = true;
      continue;
    }

    items.push({
      key: message.clientKey || identity,
      message,
      pending: false,
    });
  }

  if (liveMessage && !liveMessageRenderedInPlace) {
    const liveAsMessage = buildLiveMessage(liveMessage);
    items.push({
      key: liveMessage.key,
      message: liveAsMessage,
      pending: true,
    });
  }

  return items;
}
