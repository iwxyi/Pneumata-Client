import type { Message } from '../types/message';
import { getMessageRenderIdentity, messagesShareIdentity } from './messageIdentity';

export interface MessageWindowLike {
  messages?: Message[];
}

function contentIdentity(message: Message) {
  return `${message.chatId}::${message.type}::${message.senderId}::${message.content}`;
}

function shouldKeepExistingMessage(existing: Message, incoming: Message) {
  return Boolean(incoming.isStreaming && !existing.isStreaming && messagesShareIdentity(existing, incoming));
}

function mergeProjectedMessage(existing: Message, incoming: Message) {
  if (shouldKeepExistingMessage(existing, incoming)) return existing;
  return {
    ...existing,
    ...incoming,
    id: existing.clientKey ? existing.id : incoming.id || existing.id,
    clientKey: existing.clientKey || incoming.clientKey,
    serverId: incoming.serverId || existing.serverId,
    metadata: incoming.metadata && Object.keys(incoming.metadata).length ? incoming.metadata : existing.metadata,
    timestamp: existing.clientKey ? existing.timestamp : incoming.timestamp,
  };
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
    const matched = Array.from(byId.entries()).find(([, existing]) => messagesShareIdentity(existing, message));
    if (!matched) {
      byId.set(getMessageRenderIdentity(message), message);
      continue;
    }
    const [id, existing] = matched;
    byId.set(id, mergeProjectedMessage(existing, message));
  }

  const merged = Array.from(byId.values());
  return merged
    .filter((message, index, array) => array.findIndex((candidate) => {
      if (messagesShareIdentity(candidate, message)) return true;
      if (contentIdentity(candidate) !== contentIdentity(message)) return false;
      return Math.abs(candidate.timestamp - message.timestamp) <= 5000;
    }) === index)
    .sort(compareByTimeline);
}
