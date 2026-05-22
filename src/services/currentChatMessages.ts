import type { Message } from '../types/message';

export interface MessageWindowLike {
  messages?: Message[];
}

function messageIdentity(message: Message) {
  return message.serverId || message.id;
}

function contentIdentity(message: Message) {
  return `${message.chatId}::${message.type}::${message.senderId}::${message.content}`;
}

function compareByTimeline(left: Message, right: Message) {
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  if (left.type === 'event' && right.type !== 'event') return 1;
  if (left.type !== 'event' && right.type === 'event') return -1;
  return 0;
}

export function projectCurrentChatMessages(params: {
  chatId: string;
  activeMessages: Message[];
  cachedWindow?: MessageWindowLike | null;
}) {
  const byId = new Map<string, Message>();
  const candidates = [
    ...(params.cachedWindow?.messages || []),
    ...params.activeMessages.filter((message) => message.chatId === params.chatId),
  ].filter((message) => message.chatId === params.chatId);

  for (const message of candidates) {
    const id = messageIdentity(message);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, message);
      continue;
    }
    byId.set(id, {
      ...existing,
      ...message,
      metadata: message.metadata && Object.keys(message.metadata).length ? message.metadata : existing.metadata,
    });
  }

  const merged = Array.from(byId.values());
  return merged
    .filter((message, index, array) => array.findIndex((candidate) => {
      if (messageIdentity(candidate) === messageIdentity(message)) return true;
      if (contentIdentity(candidate) !== contentIdentity(message)) return false;
      return Math.abs(candidate.timestamp - message.timestamp) <= 5000;
    }) === index)
    .sort(compareByTimeline);
}

