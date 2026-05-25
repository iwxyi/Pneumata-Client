import type { Message } from '../types/message';

export type MessageIdentityLike = Pick<Message, 'id' | 'clientKey' | 'serverId' | 'chatId'>;

export function isLocalOnlyMessageId(id: string | undefined | null) {
  return Boolean(id && /^local[-_]/i.test(id));
}

export function buildMessageIdentityKeys(message: MessageIdentityLike) {
  const keys = new Set<string>();
  if (message.clientKey) keys.add(`client:${message.clientKey}`);
  if (message.id) {
    keys.add(`id:${message.id}`);
    if (!isLocalOnlyMessageId(message.id)) keys.add(`server:${message.id}`);
  }
  if (message.serverId) keys.add(`server:${message.serverId}`);
  return Array.from(keys);
}

export function messagesShareIdentity(left: MessageIdentityLike, right: MessageIdentityLike) {
  if (left.chatId && right.chatId && left.chatId !== right.chatId) return false;
  const leftKeys = new Set(buildMessageIdentityKeys(left));
  return buildMessageIdentityKeys(right).some((key) => leftKeys.has(key));
}

export function getMessageRenderIdentity(message: MessageIdentityLike) {
  return message.clientKey || message.id || message.serverId || 'message';
}
