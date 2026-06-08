import type { AICharacter } from '../types/character';
import { normalizeCharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import { useCharacterArtifactStore, type CharacterArtifactEntry } from '../stores/useCharacterArtifactStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import { scheduleSyncWorkersByPriority } from '../stores/storeSyncScheduler';

type RecoverySnapshot = {
  version?: number;
  data?: {
    characters?: unknown;
    chats?: unknown;
    activeMessages?: unknown;
    messageWindowsByChatId?: unknown;
    characterArtifacts?: {
      items?: unknown;
      jobs?: unknown;
    };
    pendingOperations?: {
      characters?: unknown;
      chats?: unknown;
      messages?: unknown;
    };
    settings?: unknown;
  };
};

type CachedMessageWindow = {
  messages: Message[];
  lastSyncedAt: number;
  updatedAt: number;
  remoteExhausted?: boolean;
};

type ImportCounters = {
  imported: number;
  preserved: number;
  skipped: number;
};

export type LocalRecoveryImportResult = {
  importedAt: number;
  counts: {
    characters: ImportCounters;
    chats: ImportCounters;
    messageWindows: ImportCounters;
    messages: ImportCounters;
    characterArtifacts: ImportCounters;
    artifactJobs: ImportCounters;
    pendingOperations: ImportCounters;
  };
  ignored: string[];
  scheduledWorkers: string[];
};

const MAX_IMPORTED_WINDOWS = 12;
const MAX_IMPORTED_MESSAGES_PER_WINDOW = 1000;
const MAX_ACTIVE_MESSAGES = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function newerTimestamp(item: { updatedAt?: unknown; createdAt?: unknown; timestamp?: unknown }) {
  return Number(item.updatedAt || item.createdAt || item.timestamp || 0);
}

function createCounter(): ImportCounters {
  return { imported: 0, preserved: 0, skipped: 0 };
}

function preferNewer<T extends Record<string, unknown>>(existing: T, incoming: T) {
  return newerTimestamp(incoming) > newerTimestamp(existing) ? incoming : existing;
}

function mergeById<T extends Record<string, unknown>>(existingItems: T[], incomingItems: T[], counter: ImportCounters): T[] {
  const merged = new Map<string, T>();
  for (const item of existingItems) {
    if (typeof item.id === 'string') merged.set(item.id, item);
  }
  for (const item of incomingItems) {
    if (typeof item.id !== 'string') {
      counter.skipped += 1;
      continue;
    }
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      counter.imported += 1;
      continue;
    }
    const next = preferNewer(existing, item);
    merged.set(item.id, next);
    if (next === existing) counter.preserved += 1;
    else counter.imported += 1;
  }
  return Array.from(merged.values());
}

function normalizeMessageCandidate(value: unknown): Message | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.chatId !== 'string') return null;
  if (typeof value.senderId !== 'string' || typeof value.senderName !== 'string') return null;
  return {
    id: value.id,
    clientKey: typeof value.clientKey === 'string' ? value.clientKey : undefined,
    serverId: typeof value.serverId === 'string' ? value.serverId : undefined,
    chatId: value.chatId,
    type: value.type === 'ai' || value.type === 'user' || value.type === 'system' || value.type === 'god' || value.type === 'event' ? value.type : 'system',
    senderId: value.senderId,
    senderName: value.senderName,
    content: typeof value.content === 'string' ? value.content : '',
    metadata: isRecord(value.metadata) ? value.metadata as Message['metadata'] : undefined,
    emotion: typeof value.emotion === 'number' ? value.emotion : 0,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
    isDeleted: Boolean(value.isDeleted),
    isOptimistic: Boolean(value.isOptimistic),
    isStreaming: Boolean(value.isStreaming),
  };
}

function messageIdentityKeys(message: Message) {
  return [
    message.id,
    message.clientKey,
    message.serverId,
  ].filter((item): item is string => Boolean(item));
}

function mergeMessageList(existingMessages: Message[], incomingMessages: Message[], counter: ImportCounters) {
  const merged: Message[] = [];
  const identityIndex = new Map<string, number>();
  const remember = (message: Message, index: number) => {
    for (const key of messageIdentityKeys(message)) identityIndex.set(key, index);
  };

  for (const message of existingMessages) {
    const index = merged.length;
    merged.push(message);
    remember(message, index);
  }

  for (const message of incomingMessages) {
    const index = messageIdentityKeys(message)
      .map((key) => identityIndex.get(key))
      .find((item): item is number => item !== undefined);
    if (index === undefined) {
      const nextIndex = merged.length;
      merged.push(message);
      remember(message, nextIndex);
      counter.imported += 1;
      continue;
    }
    const existing = merged[index];
    const next = message.timestamp > existing.timestamp ? { ...existing, ...message } : existing;
    merged[index] = next;
    remember(next, index);
    if (next === existing) counter.preserved += 1;
    else counter.imported += 1;
  }

  return merged
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-MAX_IMPORTED_MESSAGES_PER_WINDOW);
}

function normalizeWindow(value: unknown, chatId: string, skippedCounter: ImportCounters): CachedMessageWindow | null {
  if (!isRecord(value)) return null;
  const messages = asArray(value.messages)
    .map(normalizeMessageCandidate)
    .filter((message): message is Message => Boolean(message && message.chatId === chatId));
  const skipped = asArray(value.messages).length - messages.length;
  if (skipped > 0) skippedCounter.skipped += skipped;
  if (!messages.length) return null;
  const newest = Math.max(...messages.map((message) => message.timestamp), Number(value.updatedAt || 0), Date.now());
  return {
    messages: messages.slice(-MAX_IMPORTED_MESSAGES_PER_WINDOW),
    lastSyncedAt: Number(value.lastSyncedAt || 0),
    updatedAt: newest,
    remoteExhausted: Boolean(value.remoteExhausted),
  };
}

function mergeWindows(
  existing: Record<string, CachedMessageWindow>,
  incoming: unknown,
  windowCounter: ImportCounters,
  messageCounter: ImportCounters,
) {
  if (!isRecord(incoming)) return existing;
  const merged: Record<string, CachedMessageWindow> = { ...existing };
  for (const [chatId, rawWindow] of Object.entries(incoming)) {
    const incomingWindow = normalizeWindow(rawWindow, chatId, messageCounter);
    if (!incomingWindow) {
      windowCounter.skipped += 1;
      continue;
    }
    const existingWindow = merged[chatId];
    if (!existingWindow) {
      merged[chatId] = incomingWindow;
      windowCounter.imported += 1;
      messageCounter.imported += incomingWindow.messages.length;
      continue;
    }
    merged[chatId] = {
      messages: mergeMessageList(existingWindow.messages || [], incomingWindow.messages || [], messageCounter),
      lastSyncedAt: Math.max(existingWindow.lastSyncedAt || 0, incomingWindow.lastSyncedAt || 0),
      updatedAt: Math.max(existingWindow.updatedAt || 0, incomingWindow.updatedAt || 0),
      remoteExhausted: Boolean(existingWindow.remoteExhausted && incomingWindow.remoteExhausted),
    };
    windowCounter.preserved += 1;
  }
  return Object.fromEntries(
    Object.entries(merged)
      .sort((left, right) => (right[1].updatedAt || 0) - (left[1].updatedAt || 0))
      .slice(0, MAX_IMPORTED_WINDOWS)
  );
}

function normalizeCharacters(value: unknown, counter: ImportCounters): AICharacter[] {
  return asArray(value)
    .map((item) => {
      if (!isRecord(item)) {
        counter.skipped += 1;
        return null;
      }
      try {
        return normalizeCharacter(item as unknown as AICharacter);
      } catch {
        counter.skipped += 1;
        return null;
      }
    })
    .filter((item): item is AICharacter => Boolean(item));
}

function normalizeChats(value: unknown, counter: ImportCounters): GroupChat[] {
  return asArray(value)
    .map((item) => {
      if (!isRecord(item)) {
        counter.skipped += 1;
        return null;
      }
      try {
        return normalizeConversation(item as unknown as GroupChat);
      } catch {
        counter.skipped += 1;
        return null;
      }
    })
    .filter((item): item is GroupChat => Boolean(item));
}

function computeUnreadLetters(items: CharacterArtifactEntry[]) {
  return items.filter((item) => item.deletedAt == null && item.unread && (item.kind === 'birth_letter' || item.kind === 'final_letter')).length;
}

function latestError(operations: Array<{ status?: unknown; lastError?: unknown; updatedAt?: unknown; createdAt?: unknown; timestamp?: unknown }>) {
  const failed = operations
    .filter((operation) => operation.status === 'failed' && typeof operation.lastError === 'string')
    .sort((left, right) => newerTimestamp(right) - newerTimestamp(left));
  return typeof failed[0]?.lastError === 'string' ? failed[0].lastError : null;
}

export function importLocalRecoverySnapshot(snapshot: unknown): LocalRecoveryImportResult {
  if (!isRecord(snapshot) || !isRecord((snapshot as RecoverySnapshot).data)) {
    throw new Error('不是有效的本地恢复快照');
  }

  const data = (snapshot as RecoverySnapshot).data || {};
  const result: LocalRecoveryImportResult = {
    importedAt: Date.now(),
    counts: {
      characters: createCounter(),
      chats: createCounter(),
      messageWindows: createCounter(),
      messages: createCounter(),
      characterArtifacts: createCounter(),
      artifactJobs: createCounter(),
      pendingOperations: createCounter(),
    },
    ignored: [],
    scheduledWorkers: [],
  };

  const incomingCharacters = normalizeCharacters(data.characters, result.counts.characters);
  useCharacterStore.setState((state) => {
    const characters = mergeById(state.characters as unknown as Array<Record<string, unknown>>, incomingCharacters as unknown as Array<Record<string, unknown>>, result.counts.characters) as unknown as AICharacter[];
    const pendingOperations = mergeById(
      state.pendingOperations as unknown as Array<Record<string, unknown>>,
      asArray(data.pendingOperations?.characters).filter(isRecord),
      result.counts.pendingOperations,
    ) as unknown as typeof state.pendingOperations;
    return {
      characters,
      pendingOperations,
      pendingEditSyncCount: pendingOperations.length,
      pendingEditSyncError: latestError(pendingOperations),
      isLoading: false,
    };
  });

  const incomingChats = normalizeChats(data.chats, result.counts.chats);
  useChatStore.setState((state) => {
    const chats = mergeById(state.chats as unknown as Array<Record<string, unknown>>, incomingChats as unknown as Array<Record<string, unknown>>, result.counts.chats) as unknown as GroupChat[];
    const pendingOperations = mergeById(
      state.pendingOperations as unknown as Array<Record<string, unknown>>,
      asArray(data.pendingOperations?.chats).filter(isRecord),
      result.counts.pendingOperations,
    ) as unknown as typeof state.pendingOperations;
    return {
      chats,
      pendingOperations,
      pendingEditSyncCount: pendingOperations.length,
      pendingEditSyncError: latestError(pendingOperations),
      isLoading: false,
    };
  });

  useMessageStore.setState((state) => {
    const messageWindowsByChatId = mergeWindows(
      state.messageWindowsByChatId as Record<string, CachedMessageWindow>,
      data.messageWindowsByChatId,
      result.counts.messageWindows,
      result.counts.messages,
    );
    const activeChatId = state.activeChatId;
    const activeMessages = activeChatId && messageWindowsByChatId[activeChatId]
      ? messageWindowsByChatId[activeChatId].messages.slice(-MAX_ACTIVE_MESSAGES)
      : state.messages;
    const pendingOperations = mergeById(
      state.pendingOperations as unknown as Array<Record<string, unknown>>,
      asArray(data.pendingOperations?.messages).filter(isRecord),
      result.counts.pendingOperations,
    ) as unknown as typeof state.pendingOperations;
    return {
      messageWindowsByChatId,
      messages: activeMessages,
      pendingOperations,
      isLoading: false,
      isLoadingOlder: false,
    };
  });

  const artifactData = isRecord(data.characterArtifacts) ? data.characterArtifacts : {};
  useCharacterArtifactStore.setState((state) => {
    const items = mergeById(
      state.items as unknown as Array<Record<string, unknown>>,
      asArray(artifactData.items).filter(isRecord),
      result.counts.characterArtifacts,
    ) as unknown as CharacterArtifactEntry[];
    const jobs = mergeById(
      state.jobs as unknown as Array<Record<string, unknown>>,
      asArray(artifactData.jobs).filter(isRecord),
      result.counts.artifactJobs,
    ) as unknown as typeof state.jobs;
    return {
      items,
      jobs,
      unreadLetterCount: computeUnreadLetters(items),
      isProcessing: false,
    };
  });

  if (data.settings !== undefined) {
    result.ignored.push('settings');
  }
  if (data.activeMessages !== undefined) {
    result.ignored.push('activeMessages');
  }

  result.scheduledWorkers = scheduleSyncWorkersByPriority(100);
  void useCharacterArtifactStore.getState().resumeProcessing();
  return result;
}
