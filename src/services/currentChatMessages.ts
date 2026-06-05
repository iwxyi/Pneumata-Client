import type { Message } from '../types/message';
import { buildMessageIdentityKeys, getMessageRenderIdentity, messagesShareIdentity } from './messageIdentity';

export interface MessageWindowLike {
  messages?: Message[];
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
  const identityIndex = new Map<string, string>();
  const indexMessage = (identity: string, message: Message) => {
    for (const key of buildMessageIdentityKeys(message)) identityIndex.set(key, identity);
  };
  const activeMessages = params.activeMessages.filter((message) => message.chatId === params.chatId);
  const cachedMessages = (params.cachedWindow?.messages || [])
    .filter((message) => message.chatId === params.chatId)
    .slice(-40);
  const candidates = [
    ...cachedMessages,
    ...activeMessages,
  ];

  for (const message of candidates) {
    let identity = buildMessageIdentityKeys(message)
      .map((key) => identityIndex.get(key))
      .find((candidate): candidate is string => Boolean(candidate)) || null;
    let existing = identity ? byId.get(identity) || null : null;

    if (!existing || !identity) {
      const nextIdentity = getMessageRenderIdentity(message);
      byId.set(nextIdentity, message);
      indexMessage(nextIdentity, message);
      continue;
    }

    const merged = mergeProjectedMessage(existing, message);
    const nextIdentity = getMessageRenderIdentity(merged);
    if (nextIdentity !== identity) byId.delete(identity);
    byId.set(nextIdentity, merged);
    indexMessage(nextIdentity, merged);
  }

  return Array.from(byId.values()).sort(compareByTimeline);
}
