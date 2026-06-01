import type { Message } from '../types/message';
import { api } from './api';
import { resolveCommittedStreamContent } from './streamingMessageLifecycle';
import { reportRecoverableError } from './diagnostics';

interface PersistLocalFirstMessageParams {
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  upsertMessage: (message: Message) => void;
  onPersisted?: (message: Message) => void;
  timestamp?: number;
  existingLocalMessage?: Message | null;
  deferLocalUpsert?: boolean;
  withdrawalRevealDelayMs?: number;
  delay?: (ms: number) => Promise<void>;
}

interface PersistLocalFirstMessagesParams {
  messages: Array<{
    message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
    timestamp?: number;
    onPersisted?: (message: Message) => void;
  }>;
  upsertMessages: (messages: Message[]) => void;
  deferLocalUpsert?: boolean;
}

function deferUiWrite(task: () => void) {
  const scheduler = (globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof scheduler === 'function') {
    scheduler(task, { timeout: 300 });
    return;
  }
  setTimeout(task, 0);
}

function writeMessage(upsertMessage: (message: Message) => void, message: Message, deferred?: boolean) {
  if (deferred) {
    deferUiWrite(() => upsertMessage(message));
    return;
  }
  upsertMessage(message);
}

function writeMessages(upsertMessages: (messages: Message[]) => void, messages: Message[], deferred?: boolean) {
  if (!messages.length) return;
  if (deferred) {
    deferUiWrite(() => upsertMessages(messages));
    return;
  }
  upsertMessages(messages);
}

function mergeServerConfirmation(localMessage: Message, savedMessage: unknown): Message {
  const saved = savedMessage as Partial<Message> | null | undefined;
  return {
    id: localMessage.id,
    clientKey: localMessage.clientKey,
    serverId: saved?.serverId || saved?.id,
    chatId: localMessage.chatId,
    type: localMessage.type,
    senderId: localMessage.senderId,
    senderName: localMessage.senderName,
    content: localMessage.content,
    metadata: localMessage.metadata,
    emotion: localMessage.emotion,
    timestamp: localMessage.timestamp,
    isDeleted: Boolean(saved?.isDeleted ?? localMessage.isDeleted),
    isOptimistic: false,
    isStreaming: false,
  };
}

function delayMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function stableMessageSeed(parts: Array<string | number | undefined>) {
  const joined = parts.filter((item) => item !== undefined && item !== null && String(item).length > 0).join('|');
  let hash = 0;
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 33 + joined.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function buildPreWithdrawalRevealMessage(message: Message): Message | null {
  const withdrawal = message.metadata?.withdrawal;
  if (!withdrawal?.withdrawn || !withdrawal.originalContent) return null;
  return {
    ...message,
    content: withdrawal.originalContent,
    metadata: {
      ...(message.metadata || {}),
      withdrawal: {
        ...withdrawal,
        visiblePending: true,
      },
    },
  };
}

export function createCommittedLocalMessage(
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>,
  options?: { timestamp?: number },
): Message {
  const timestamp = options?.timestamp ?? Date.now();
  const id = `local-message-${timestamp}-${stableMessageSeed([
    message.chatId,
    message.type,
    message.senderId,
    message.senderName,
    message.content,
    message.emotion,
    message.metadata ? JSON.stringify(message.metadata) : '',
  ])}`;
  return {
    ...message,
    id,
    clientKey: id,
    timestamp,
    isDeleted: false,
    isOptimistic: false,
  };
}

export async function persistLocalFirstMessage(params: PersistLocalFirstMessageParams) {
  const messageContent = params.existingLocalMessage
    ? resolveCommittedStreamContent(params.message.content, params.existingLocalMessage.content)
    : params.message.content;
  const messagePayload = {
    ...params.message,
    content: messageContent,
  };
  const localMessage = params.existingLocalMessage
    ? {
        ...params.existingLocalMessage,
        ...messagePayload,
        content: messagePayload.content,
        metadata: messagePayload.metadata,
        emotion: messagePayload.emotion,
        timestamp: params.existingLocalMessage.timestamp,
        isDeleted: false,
        isOptimistic: false,
        isStreaming: false,
      }
    : createCommittedLocalMessage(messagePayload, { timestamp: params.timestamp });
  const revealMessage = buildPreWithdrawalRevealMessage(localMessage);
  if (revealMessage) {
    writeMessage(params.upsertMessage, revealMessage, params.deferLocalUpsert);
    await (params.delay || delayMs)(params.withdrawalRevealDelayMs ?? 1200);
  }
  writeMessage(params.upsertMessage, localMessage, params.deferLocalUpsert);

  void api.createMessage(messagePayload.chatId, {
    type: messagePayload.type,
    senderId: messagePayload.senderId,
    senderName: messagePayload.senderName,
    content: messagePayload.content,
    metadata: messagePayload.metadata,
    emotion: messagePayload.emotion,
  }).then((savedMessage) => {
    const persistedMessage = mergeServerConfirmation(localMessage, savedMessage);
    writeMessage(params.upsertMessage, persistedMessage, params.deferLocalUpsert);
    params.onPersisted?.(persistedMessage);
  }).catch((error) => {
    reportRecoverableError({
      location: 'chat-commit-message.persist-one',
      error,
      userMessage: '消息保存到云端失败，本地内容已保留。',
      extra: { chatId: messagePayload.chatId, senderId: messagePayload.senderId, messageType: messagePayload.type },
    });
  });

  return localMessage;
}

export async function persistLocalFirstMessages(params: PersistLocalFirstMessagesParams) {
  if (!params.messages.length) return [];
  const localMessages = params.messages.map((entry) => createCommittedLocalMessage(entry.message, { timestamp: entry.timestamp }));
  writeMessages(params.upsertMessages, localMessages, params.deferLocalUpsert);

  void Promise.all(params.messages.map((entry, index) => api.createMessage(entry.message.chatId, {
    type: entry.message.type,
    senderId: entry.message.senderId,
    senderName: entry.message.senderName,
    content: entry.message.content,
    metadata: entry.message.metadata,
    emotion: entry.message.emotion,
  }).then((savedMessage) => {
    const localMessage = localMessages[index];
    const persistedMessage = mergeServerConfirmation(localMessage, savedMessage);
    entry.onPersisted?.(persistedMessage);
    return persistedMessage;
  }))).then((persistedMessages) => {
    writeMessages(params.upsertMessages, persistedMessages, params.deferLocalUpsert);
  }).catch((error) => {
    reportRecoverableError({
      location: 'chat-commit-message.persist-batch',
      error,
      userMessage: '部分消息保存到云端失败，本地内容已保留。',
      extra: { count: params.messages.length },
    });
  });

  return localMessages;
}

export async function persistStreamingMessage(params: PersistLocalFirstMessageParams) {
  return persistLocalFirstMessage(params);
}
