import type { Message } from '../types/message';
import type { GroupChat } from '../types/chat';
import { buildMessageIdentityKeys, getMessageRenderIdentity, messagesShareIdentity } from './messageIdentity';
import { isMessageBranchingEnabled, projectActiveBranchMessages } from './messageBranching';

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

function normalizeContentForSignature(content: string) {
  return content.trim().replace(/\s+/g, ' ');
}

function buildSemanticMessageSignature(message: Message) {
  const content = normalizeContentForSignature(message.content);
  if (!content) return null;
  const narrativeTurnId = message.metadata?.narrativeTurn?.turnId || '';
  return JSON.stringify([message.type, message.senderId, narrativeTurnId, content]);
}

function hasMatchingNeighbor(params: {
  cachedMessages: Message[];
  activeMessages: Message[];
  cachedIndex: number;
  activeIndex: number;
}) {
  const previousCached = params.cachedMessages[params.cachedIndex - 1];
  const previousActive = params.activeMessages[params.activeIndex - 1];
  if (
    previousCached
    && previousActive
    && buildSemanticMessageSignature(previousCached) === buildSemanticMessageSignature(previousActive)
  ) return true;

  const nextCached = params.cachedMessages[params.cachedIndex + 1];
  const nextActive = params.activeMessages[params.activeIndex + 1];
  return Boolean(
    nextCached
    && nextActive
    && buildSemanticMessageSignature(nextCached) === buildSemanticMessageSignature(nextActive)
  );
}

function removeHydratedCacheDuplicates(cachedMessages: Message[], activeMessages: Message[]) {
  if (!activeMessages.length || !cachedMessages.length) return cachedMessages;

  const activeBySignature = new Map<string, number[]>();
  activeMessages.forEach((message, index) => {
    if (message.isStreaming) return;
    const signature = buildSemanticMessageSignature(message);
    if (!signature) return;
    const indexes = activeBySignature.get(signature) || [];
    indexes.push(index);
    activeBySignature.set(signature, indexes);
  });

  return cachedMessages.filter((message, cachedIndex) => {
    if (message.isStreaming) return true;
    const signature = buildSemanticMessageSignature(message);
    if (!signature) return true;
    const activeIndexes = activeBySignature.get(signature) || [];
    return !activeIndexes.some((activeIndex) => {
      const activeMessage = activeMessages[activeIndex];
      return activeMessage.timestamp === message.timestamp || hasMatchingNeighbor({
        cachedMessages,
        activeMessages,
        cachedIndex,
        activeIndex,
      });
    });
  });
}

function sharesIdentityWithAnyActiveMessage(message: Message, activeMessages: Message[]) {
  const keys = buildMessageIdentityKeys(message);
  if (!keys.length) return false;
  return activeMessages.some((active) => {
    const activeKeys = new Set(buildMessageIdentityKeys(active));
    return keys.some((key) => activeKeys.has(key));
  });
}

export function projectCurrentChatMessages(params: {
  chatId: string;
  chat?: Pick<GroupChat, 'sessionKind' | 'messageBranchState'> & Partial<Pick<GroupChat, 'mode'>> | null;
  activeMessages: Message[];
  cachedWindow?: MessageWindowLike | null;
}) {
  const byId = new Map<string, Message>();
  const identityIndex = new Map<string, string>();
  const indexMessage = (identity: string, message: Message) => {
    for (const key of buildMessageIdentityKeys(message)) identityIndex.set(key, identity);
  };
  const activeMessages = params.activeMessages.filter((message) => message.chatId === params.chatId);
  const cachedMessages = removeHydratedCacheDuplicates(
    (params.cachedWindow?.messages || [])
      .filter((message) => message.chatId === params.chatId)
      .filter((message) => !activeMessages.length || sharesIdentityWithAnyActiveMessage(message, activeMessages))
      .slice(-40),
    activeMessages,
  );
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

  const projected = Array.from(byId.values()).sort(compareByTimeline);
  return isMessageBranchingEnabled(params.chat)
    ? projectActiveBranchMessages(params.chat, projected)
    : projected;
}
