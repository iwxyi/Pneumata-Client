import type { Message } from '../types/message';
import { api } from './api';

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
  const id = `local-message-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
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
  const localMessage = params.existingLocalMessage
    ? {
        ...params.existingLocalMessage,
        ...params.message,
        content: params.message.content,
        metadata: params.message.metadata,
        emotion: params.message.emotion,
        timestamp: params.existingLocalMessage.timestamp,
        isDeleted: false,
        isOptimistic: false,
        isStreaming: false,
      }
    : createCommittedLocalMessage(params.message, { timestamp: params.timestamp });
  const revealMessage = buildPreWithdrawalRevealMessage(localMessage);
  if (revealMessage) {
    writeMessage(params.upsertMessage, revealMessage, params.deferLocalUpsert);
    await (params.delay || delayMs)(params.withdrawalRevealDelayMs ?? 1200);
  }
  writeMessage(params.upsertMessage, localMessage, params.deferLocalUpsert);

  void api.createMessage(params.message.chatId, {
    type: params.message.type,
    senderId: params.message.senderId,
    senderName: params.message.senderName,
    content: params.message.content,
    metadata: params.message.metadata,
    emotion: params.message.emotion,
  }).then((savedMessage) => {
    const persistedMessage = mergeServerConfirmation(localMessage, savedMessage);
    writeMessage(params.upsertMessage, persistedMessage, params.deferLocalUpsert);
    params.onPersisted?.(persistedMessage);
  }).catch((error) => {
    console.error('Failed to persist streamed message:', error);
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
    console.error('Failed to persist streamed messages:', error);
  });

  return localMessages;
}

export async function persistStreamingMessage(params: PersistLocalFirstMessageParams) {
  return persistLocalFirstMessage(params);
}
