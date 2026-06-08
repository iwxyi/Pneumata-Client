import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '../types/message';
import { buildMessageIdentityKeys, getMessageRenderIdentity, isLocalOnlyMessageId, messagesShareIdentity } from '../services/messageIdentity';
import { api, type SyncChangeScope } from '../services/api';
import { reportRecoverableError } from '../services/diagnostics';
import { hasLocalDataUrlMedia, scrubLocalMediaUrlsForCloud, uploadLocalMessageMediaToCloud } from '../services/richMessageMedia';
import { useAuthStore } from './useAuthStore';
import { CLIENT_STORE_SCHEMA_VERSION, migrateMessageStoreState } from './storeMigrations';
import { createScopedIndexedDbBufferedJsonStorage } from './storePersistenceScope';
import { createSyncScheduler } from './storeSyncScheduler';
import { canAttemptOnlineSync, getPendingQueueWorkerPriority, recoverInterruptedOperations, retryFailedOperations, runPendingOperationQueue } from './storeSyncHelpers';
import { scopedStorageKey, storageKey } from '../constants/brand';
import { getLocalDataUserId } from '../services/authStorageScope';
import { isCloudSyncEnabled } from '../services/cloudSyncPreference';
import { createSyncScopeMetadata, type SyncScopeSnapshot } from './syncScopeMetadata';

function isLocalOnlyMode() {
  return useAuthStore.getState().authMode === 'local' || !isCloudSyncEnabled();
}

function createLocalMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'> & { timestamp?: number }): Message {
  const timestamp = typeof msgData.timestamp === 'number' ? msgData.timestamp : Date.now();
  const id = `local-message-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...msgData,
    id,
    clientKey: id,
    timestamp,
    isDeleted: false,
    isOptimistic: true,
  };
}

async function uploadGuestMessagesToCloud() {
  if (isLocalOnlyMode()) return;
  try {
    const raw = localStorage.getItem(scopedStorageKey('messages-guest'));
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { messageWindowsByChatId?: Record<string, { messages: Message[] }> } };
    const windows = parsed.state?.messageWindowsByChatId || {};
    for (const chatId of Object.keys(windows)) {
      for (const message of windows[chatId]?.messages || []) {
        if (message.isDeleted || message.type === 'event') continue;
        const cloudMessage = await api.createMessage(chatId, {
          type: message.type,
          senderId: message.senderId,
          senderName: message.senderName,
          content: message.content,
          metadata: hasLocalDataUrlMedia(message) ? scrubLocalMediaUrlsForCloud(message) : message.metadata,
          emotion: message.emotion,
        }) as unknown as Message;
        if (hasLocalDataUrlMedia(message)) {
          await uploadLocalMessageMediaToCloud({ localMessage: message, cloudMessage });
        }
      }
    }
    localStorage.removeItem(scopedStorageKey('messages-guest'));
  } catch {
    // ignore malformed guest cache
  }
}

function localDeleteMessage(message: Message) {
  return { ...message, isDeleted: true };
}

function shouldSkipCloudSync() {
  return isLocalOnlyMode();
}

function projectLocalMessages(messages: Message[]) {
  return messages;
}

function mergeLocalWindow(cache: Record<string, CachedMessageWindow>, chatId: string, messages: Message[], pendingOperations: PendingMessageOperation[] = []) {
  const currentWindow = cache[chatId];
  return trimCache({
    ...cache,
    [chatId]: {
      messages: trimMessages(messages),
      lastSyncedAt: Date.now(),
      updatedAt: messages.at(-1)?.timestamp || Date.now(),
      remoteExhausted: currentWindow?.remoteExhausted,
    },
  }, pendingOperations);
}

function locallyMarkDeleted(state: MessageStore, id: string) {
  const nextWindows = Object.fromEntries(
    Object.entries(state.messageWindowsByChatId).map(([chatId, window]) => [
      chatId,
      { ...window, messages: window.messages.map((message) => (message.id === id ? localDeleteMessage(message) : message)) },
    ])
  );
  return {
    messages: state.messages.map((message) => (message.id === id ? localDeleteMessage(message) : message)),
    messageWindowsByChatId: trimCache(nextWindows, state.pendingOperations),
  };
}

function locallyDeleteLastN(state: MessageStore, chatId: string, n: number) {
  const msgs = state.messages.filter((message) => message.chatId === chatId && !message.isDeleted).slice(-n);
  const ids = new Set(msgs.map((message) => message.id));
  const nextMessages = state.messages.map((message) => (ids.has(message.id) ? localDeleteMessage(message) : message));
  const currentWindow = state.messageWindowsByChatId[chatId];
  const nextChatMessages = (currentWindow?.messages || []).map((message) => (ids.has(message.id) ? localDeleteMessage(message) : message));
  return {
    messages: nextMessages,
    messageWindowsByChatId: trimCache({
      ...state.messageWindowsByChatId,
      [chatId]: {
        messages: nextChatMessages,
        lastSyncedAt: Date.now(),
        updatedAt: nextChatMessages.at(-1)?.timestamp || currentWindow?.updatedAt || Date.now(),
      },
    }, state.pendingOperations),
  };
}

function activeMessageWindow(messages: Message[], limit = DEFAULT_MESSAGE_WINDOW_LIMIT) {
  return messages.slice(-limit);
}

function canLoadMoreFromWindow(window: CachedMessageWindow | undefined, activeMessages: Message[], limit: number) {
  const cachedMessages = window?.messages || [];
  if (cachedMessages.length > activeMessages.length) return true;
  if (shouldSkipCloudSync()) return cachedMessages.length >= limit;
  return !window?.remoteExhausted;
}

function localHydratedWindow(state: MessageStore, chatId: string) {
  const cachedWindow = state.messageWindowsByChatId[chatId];
  const cachedMessages = cachedWindow?.messages || [];
  const activeMessages = activeMessageWindow(cachedMessages);
  return {
    activeChatId: chatId,
    messages: activeMessages,
    hasMore: canLoadMoreFromWindow(cachedWindow, activeMessages, DEFAULT_MESSAGE_WINDOW_LIMIT),
  };
}

function localUpsertMessage(state: MessageStore, message: Message) {
  const currentWindow = state.messageWindowsByChatId[message.chatId];
  const current = currentWindow?.messages || [];
  const nextChatMessages = trimMessages(mergeMessages(current, [message]));
  const nextActiveMessages = trimActiveMessages(mergeMessages(state.messages, [message]));
  return {
    messages: state.activeChatId === message.chatId ? nextActiveMessages : state.messages,
    messageWindowsByChatId: mergeLocalWindow(state.messageWindowsByChatId, message.chatId, nextChatMessages, state.pendingOperations),
  };
}

function localLoadMessages(state: MessageStore, chatId: string, options?: { append?: boolean; before?: number; limit?: number }) {
  const currentWindow = state.messageWindowsByChatId[chatId];
  const current = currentWindow?.messages || [];
  const limit = options?.limit ?? DEFAULT_MESSAGE_WINDOW_LIMIT;
  if (options?.append && options.before !== undefined) {
    const olderMessages = current.filter((message) => message.timestamp < Number(options.before)).slice(-limit);
    const activeCurrent = state.activeChatId === chatId ? state.messages : activeMessageWindow(current, limit);
    const nextMessages = trimActiveMessages(mergeMessages(activeCurrent, olderMessages));
    const earliestTimestamp = nextMessages.find((message) => message.chatId === chatId && !message.isDeleted)?.timestamp ?? Number.NEGATIVE_INFINITY;
    const hasMoreLocal = current.some((message) => !message.isDeleted && message.timestamp < earliestTimestamp);
    return {
      messages: nextMessages,
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: hasMoreLocal,
    };
  }
  const activeMessages = activeMessageWindow(current, limit);
  return {
    messages: activeMessages,
    activeChatId: chatId,
    isLoading: false,
    isLoadingOlder: false,
    hasMore: canLoadMoreFromWindow(currentWindow, activeMessages, limit),
  };
}

function localAddMessage(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  const message = createLocalMessage(msgData);
  return {
    message,
    ...localUpsertMessage(state, message),
  };
}

function projectVisibleMessageWindows(cache: Record<string, CachedMessageWindow>) {
  return trimCache(cache);
}

function localMessageWindowState(state: MessageStore, chatId: string) {
  return state.messageWindowsByChatId[chatId]?.messages || [];
}

function localRecentMessages(state: MessageStore, n: number) {
  return state.messages.filter((message) => !message.isDeleted).slice(-n);
}

function localCreateWindow(cache: Record<string, CachedMessageWindow>, chatId: string, messages: Message[]) {
  return mergeLocalWindow(cache, chatId, messages);
}

function localMessagesForChat(state: MessageStore, chatId: string) {
  return localMessageWindowState(state, chatId);
}

function localDeleteById(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

function localAppendMessage(state: MessageStore, message: Message) {
  return localUpsertMessage(state, message);
}

function localMessageMode() {
  return shouldSkipCloudSync();
}

function shouldUploadGuestMessages() {
  return !localMessageMode();
}

function currentLocalMessages(state: MessageStore) {
  return projectLocalMessages(state.messages);
}

function buildLocalMessageWindowState(state: MessageStore, chatId: string) {
  return {
    ...localLoadMessages(state, chatId),
    messages: localMessagesForChat(state, chatId),
  };
}

function localDeleteWindowMessages(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

function localCacheHydration(state: MessageStore, chatId: string) {
  return localHydratedWindow(state, chatId);
}

void currentLocalMessages;

function buildLocalMessageState(cache: Record<string, CachedMessageWindow>) {
  return projectVisibleMessageWindows(cache);
}

void buildLocalMessageState;

function localMessageUploadAllowed() {
  return shouldUploadGuestMessages();
}

void localMessageUploadAllowed;

function createLocalPendingMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalMessage(msgData);
}

function applyLocalMessageInsert(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

function applyLocalMessageDelete(state: MessageStore, id: string) {
  return localDeleteById(state, id);
}

function applyLocalMessageDeleteLastN(state: MessageStore, chatId: string, n: number) {
  return localDeleteWindowMessages(state, chatId, n);
}

function buildLocalMessageFetch(state: MessageStore, chatId: string, options?: { append?: boolean; before?: number; limit?: number }) {
  return localLoadMessages(state, chatId, options);
}

function hydrateLocalChatWindow(state: MessageStore, chatId: string) {
  return localCacheHydration(state, chatId);
}

function localMessageInsertResult(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return applyLocalMessageInsert(state, msgData);
}

function localMessageDeletionResult(state: MessageStore, id: string) {
  return applyLocalMessageDelete(state, id);
}

function localMessageDeleteBatchResult(state: MessageStore, chatId: string, n: number) {
  return applyLocalMessageDeleteLastN(state, chatId, n);
}

function localFetchedMessages(state: MessageStore, chatId: string, options?: { append?: boolean; before?: number; limit?: number }) {
  return buildLocalMessageFetch(state, chatId, options);
}

function localHydratedMessages(state: MessageStore, chatId: string) {
  return hydrateLocalChatWindow(state, chatId);
}

function localMessageServerSkip() {
  return shouldSkipCloudSync();
}

void localMessageServerSkip;

function shouldUseLocalMessages() {
  return shouldSkipCloudSync();
}

void shouldUseLocalMessages;

function localMessageStoreProject(state: MessageStore) {
  return state;
}

void localMessageStoreProject;

function shouldLoadMessagesLocally() {
  return shouldSkipCloudSync();
}

void shouldLoadMessagesLocally;

function shouldCreateMessagesLocally() {
  return shouldSkipCloudSync();
}

function shouldDeleteMessagesLocally() {
  return shouldSkipCloudSync();
}

function localMessageUploadKey() {
  return scopedStorageKey('messages-guest');
}

void localMessageUploadKey;

function uploadGuestMessagesIfNeeded() {
  return uploadGuestMessagesToCloud();
}

function makeLocalMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalPendingMessage(msgData);
}

void makeLocalMessage;

function localWindowForChat(state: MessageStore, chatId: string) {
  return localMessagesForChat(state, chatId);
}

void localWindowForChat;

function localMessageWindows(cache: Record<string, CachedMessageWindow>) {
  return projectVisibleMessageWindows(cache);
}

void localMessageWindows;

function localMarkDeletedState(state: MessageStore, id: string) {
  return applyLocalMessageDelete(state, id);
}

void localMarkDeletedState;

function localDeleteLastState(state: MessageStore, chatId: string, n: number) {
  return applyLocalMessageDeleteLastN(state, chatId, n);
}

void localDeleteLastState;

function localHydrateState(state: MessageStore, chatId: string) {
  return hydrateLocalChatWindow(state, chatId);
}

void localHydrateState;

function localFetchState(state: MessageStore, chatId: string) {
  return buildLocalMessageFetch(state, chatId);
}

void localFetchState;

function localInsertState(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return applyLocalMessageInsert(state, msgData);
}

void localInsertState;

function localDeleteState(state: MessageStore, id: string) {
  return applyLocalMessageDelete(state, id);
}

void localDeleteState;

function localBatchDeleteState(state: MessageStore, chatId: string, n: number) {
  return applyLocalMessageDeleteLastN(state, chatId, n);
}

void localBatchDeleteState;

function localModeEnabled() {
  return shouldSkipCloudSync();
}

void localModeEnabled;

function uploadGuestMessagesNow() {
  return uploadGuestMessagesIfNeeded();
}

void uploadGuestMessagesNow;

function localMessageMerge(state: MessageStore, message: Message) {
  return localAppendMessage(state, message);
}

void localMessageMerge;

function localMessageCache(chatId: string, state: MessageStore) {
  return state.messageWindowsByChatId[chatId];
}

void localMessageCache;

function localMessageWindow(cache: Record<string, CachedMessageWindow>, chatId: string, messages: Message[]) {
  return localCreateWindow(cache, chatId, messages);
}

void localMessageWindow;

function shouldBypassCloudMessages() {
  return shouldSkipCloudSync();
}

void shouldBypassCloudMessages;

function guestMessageUpload() {
  return uploadGuestMessagesToCloud();
}

void guestMessageUpload;

function mergeLocalMessageState(state: MessageStore, message: Message) {
  return localAppendMessage(state, message);
}

void mergeLocalMessageState;

function localViewMessages(state: MessageStore, chatId: string) {
  return state.messageWindowsByChatId[chatId]?.messages || [];
}

void localViewMessages;

function messageLocalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalMessage(msgData);
}

void messageLocalCreate;

function shouldHydrateLocally() {
  return shouldSkipCloudSync();
}

void shouldHydrateLocally;

function shouldFetchLocally() {
  return shouldSkipCloudSync();
}

void shouldFetchLocally;

function shouldPersistLocallyOnly() {
  return shouldSkipCloudSync();
}

void shouldPersistLocallyOnly;

function readGuestMessageCache() {
  try {
    const raw = localStorage.getItem(scopedStorageKey('messages-guest'));
    if (!raw) return {} as Record<string, CachedMessageWindow>;
    const parsed = JSON.parse(raw) as { state?: { messageWindowsByChatId?: Record<string, CachedMessageWindow> } };
    return parsed.state?.messageWindowsByChatId || {};
  } catch {
    return {} as Record<string, CachedMessageWindow>;
  }
}

void readGuestMessageCache;

function localMessageStateForChat(state: MessageStore, chatId: string) {
  return {
    messages: localMessagesForChat(state, chatId),
    activeChatId: chatId,
    isLoading: false,
    isLoadingOlder: false,
    hasMore: false,
  };
}

void localMessageStateForChat;

function localMessageInsertProjection(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageInsertProjection;

function localMessageDeleteProjection(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteProjection;

function localMessageDeleteCountProjection(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteCountProjection;

function localModeActive() {
  return shouldSkipCloudSync();
}

void localModeActive;

function maybeUploadGuestMessageWindows() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageWindows;

function localMessageProjectionState(state: MessageStore, chatId: string) {
  return localMessageStateForChat(state, chatId);
}

void localMessageProjectionState;

function projectLocalMessageHydration(state: MessageStore, chatId: string) {
  return localHydratedWindow(state, chatId);
}

void projectLocalMessageHydration;

function localMessageVisibleState(state: MessageStore) {
  return state.messages;
}

void localMessageVisibleState;

function shouldUseLocalMessageWindows() {
  return shouldSkipCloudSync();
}

void shouldUseLocalMessageWindows;

function maybeUploadGuestMessageData() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageData;

function localMessageCreateFlow(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageCreateFlow;

function localMessageDeleteFlow(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteFlow;

function localMessageDeleteLastFlow(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteLastFlow;

function uploadGuestMessagesLater() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessagesLater;

function shouldTreatMessagesAsLocalOnly() {
  return shouldSkipCloudSync();
}

void shouldTreatMessagesAsLocalOnly;

function localMessageWindowProjection(state: MessageStore, chatId: string) {
  return localMessageStateForChat(state, chatId);
}

void localMessageWindowProjection;

function localMessageHydrationProjection(state: MessageStore, chatId: string) {
  return localHydratedWindow(state, chatId);
}

void localMessageHydrationProjection;

function localMessageWriteProjection(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageWriteProjection;

function localMessageEraseProjection(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageEraseProjection;

function localMessageEraseBatchProjection(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageEraseBatchProjection;

function localCloudBypass() {
  return shouldSkipCloudSync();
}

void localCloudBypass;

function guestMessagesUploadPending() {
  return uploadGuestMessagesToCloud();
}

void guestMessagesUploadPending;

function createOfflineMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalMessage(msgData);
}

void createOfflineMessage;

function markOfflineMessageDeleted(message: Message) {
  return localDeleteMessage(message);
}

void markOfflineMessageDeleted;

function localMessageCacheProject(cache: Record<string, CachedMessageWindow>) {
  return trimCache(cache);
}

void localMessageCacheProject;

function localUploadMessageData() {
  return uploadGuestMessagesToCloud();
}

void localUploadMessageData;

function localCreateMessageState(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localCreateMessageState;

function localDeleteMessageState(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localDeleteMessageState;

function localDeleteMessagesState(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localDeleteMessagesState;

function localMessageModeEnabled() {
  return shouldSkipCloudSync();
}

void localMessageModeEnabled;

function uploadGuestMessagesAfterLogin() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessagesAfterLogin;

function isOfflineMessageMode() {
  return shouldSkipCloudSync();
}

void isOfflineMessageMode;

function localMessageHydrateWindow(state: MessageStore, chatId: string) {
  return localHydratedWindow(state, chatId);
}

void localMessageHydrateWindow;

function localMessageFetchWindow(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void localMessageFetchWindow;

function localInsertMessageWindow(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localInsertMessageWindow;

function localRemoveMessageWindow(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localRemoveMessageWindow;

function localRemoveLastMessagesWindow(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localRemoveLastMessagesWindow;

function localMessageFallbackMode() {
  return shouldSkipCloudSync();
}

void localMessageFallbackMode;

function maybeUploadGuestMessagesOnCloudEntry() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessagesOnCloudEntry;

function localMessagePersistedWindows() {
  return readGuestMessageCache();
}

void localMessagePersistedWindows;

function localUpsertProjection(state: MessageStore, message: Message) {
  return localUpsertMessage(state, message);
}

void localUpsertProjection;

function localHydrateProjection(state: MessageStore, chatId: string) {
  return localHydratedWindow(state, chatId);
}

void localHydrateProjection;

function localFetchProjection(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void localFetchProjection;

function localCreateProjection(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localCreateProjection;

function localDeleteProjection(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localDeleteProjection;

function localDeleteManyProjection(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localDeleteManyProjection;

function localMessageOnlyMode() {
  return shouldSkipCloudSync();
}

void localMessageOnlyMode;

function maybeUploadGuestMessagesEventually() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessagesEventually;

function localMessageWindowCache(state: MessageStore, chatId: string) {
  return state.messageWindowsByChatId[chatId];
}

void localMessageWindowCache;

function createLocalOnlyMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalMessage(msgData);
}

void createLocalOnlyMessage;

function localMessageDeleteMark(message: Message) {
  return localDeleteMessage(message);
}

void localMessageDeleteMark;

function offlineMessageMode() {
  return shouldSkipCloudSync();
}

void offlineMessageMode;

function queueGuestMessageUpload() {
  return uploadGuestMessagesToCloud();
}

void queueGuestMessageUpload;

function localMessageWindowMerge(cache: Record<string, CachedMessageWindow>, chatId: string, messages: Message[]) {
  return mergeLocalWindow(cache, chatId, messages);
}

void localMessageWindowMerge;

function localMessageInsert(cacheState: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(cacheState, msgData);
}

void localMessageInsert;

function localMessageRemove(cacheState: MessageStore, id: string) {
  return locallyMarkDeleted(cacheState, id);
}

void localMessageRemove;

function localMessageRemoveLast(cacheState: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(cacheState, chatId, n);
}

void localMessageRemoveLast;

function skipCloudMessageApis() {
  return shouldSkipCloudSync();
}

void skipCloudMessageApis;

function uploadGuestMessageCache() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessageCache;

function localMessageProjection(cacheState: MessageStore, chatId: string) {
  return localLoadMessages(cacheState, chatId);
}

void localMessageProjection;

function localMessageHydrationState(cacheState: MessageStore, chatId: string) {
  return localHydratedWindow(cacheState, chatId);
}

void localMessageHydrationState;

function localMessageCreateState(cacheState: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(cacheState, msgData);
}

void localMessageCreateState;

function localMessageDeleteStateById(cacheState: MessageStore, id: string) {
  return locallyMarkDeleted(cacheState, id);
}

void localMessageDeleteStateById;

function localMessageDeleteStateByCount(cacheState: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(cacheState, chatId, n);
}

void localMessageDeleteStateByCount;

function guestMessageSyncLater() {
  return uploadGuestMessagesToCloud();
}

void guestMessageSyncLater;

function localMessageFallback() {
  return shouldSkipCloudSync();
}

void localMessageFallback;

function uploadGuestMessageWindowsLater() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessageWindowsLater;

function isLocalMessagesEnabled() {
  return shouldSkipCloudSync();
}

void isLocalMessagesEnabled;

function offlineMessageUpload() {
  return uploadGuestMessagesToCloud();
}

void offlineMessageUpload;

function readGuestMessagesWindowCache() {
  return readGuestMessageCache();
}

void readGuestMessagesWindowCache;

function shouldRunMessageApis() {
  return !shouldSkipCloudSync();
}

void shouldRunMessageApis;

function shouldRunMessageCloudUpload() {
  return !shouldSkipCloudSync();
}

void shouldRunMessageCloudUpload;

function localMessageProcessing(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void localMessageProcessing;

function localMessageCreation(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageCreation;

function localMessageDeletion(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeletion;

function localMessageDeletionBatch(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeletionBatch;

function guestMessagesNeedUpload() {
  return !shouldSkipCloudSync();
}

void guestMessagesNeedUpload;

function localMessageRestoreNotNeeded() {
  return true;
}

void localMessageRestoreNotNeeded;

function localMessageCloudMode() {
  return !shouldSkipCloudSync();
}

void localMessageCloudMode;

function maybeUploadGuestMessageBacklog() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageBacklog;

function offlineMessagesFlow() {
  return shouldSkipCloudSync();
}

void offlineMessagesFlow;

function queueOfflineMessageUpload() {
  return uploadGuestMessagesToCloud();
}

void queueOfflineMessageUpload;

function localMessageOpsEnabled() {
  return shouldSkipCloudSync();
}

void localMessageOpsEnabled;

function maybeUploadGuestMessagesImmediately() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessagesImmediately;

function localMessageWork(cacheState: MessageStore, chatId: string) {
  return localLoadMessages(cacheState, chatId);
}

void localMessageWork;

function localMessageWorkCreate(cacheState: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(cacheState, msgData);
}

void localMessageWorkCreate;

function localMessageWorkDelete(cacheState: MessageStore, id: string) {
  return locallyMarkDeleted(cacheState, id);
}

void localMessageWorkDelete;

function localMessageWorkDeleteCount(cacheState: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(cacheState, chatId, n);
}

void localMessageWorkDeleteCount;

function localMessageUploadEventually() {
  return uploadGuestMessagesToCloud();
}

void localMessageUploadEventually;

function localOnlyMessages() {
  return shouldSkipCloudSync();
}

void localOnlyMessages;

function maybeSyncGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeSyncGuestMessages;

function createLocalTemporaryMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalMessage(msgData);
}

void createLocalTemporaryMessage;

function deleteLocalTemporaryMessage(message: Message) {
  return localDeleteMessage(message);
}

void deleteLocalTemporaryMessage;

function localMessageQueueDisabled() {
  return shouldSkipCloudSync();
}

void localMessageQueueDisabled;

function localMessageApiDisabled() {
  return shouldSkipCloudSync();
}

void localMessageApiDisabled;

function uploadGuestMessagesDeferred() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessagesDeferred;

function localMessageStateMessages(state: MessageStore) {
  return state.messages;
}

void localMessageStateMessages;

function localMessageStateWindows(state: MessageStore) {
  return state.messageWindowsByChatId;
}

void localMessageStateWindows;

function localModeForMessages() {
  return shouldSkipCloudSync();
}

void localModeForMessages;

function maybeUploadLocalMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadLocalMessages;

function applyLocalMessageWindow(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void applyLocalMessageWindow;

function applyLocalMessageCreate(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void applyLocalMessageCreate;

function applyLocalMessageDeleteById(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void applyLocalMessageDeleteById;

function applyLocalMessageDeleteByCount(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void applyLocalMessageDeleteByCount;

function maybeUploadGuestMessagesOnLogin() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessagesOnLogin;

function localMessagesFlowEnabled() {
  return shouldSkipCloudSync();
}

void localMessagesFlowEnabled;

function shouldBypassMessageApis() {
  return shouldSkipCloudSync();
}

void shouldBypassMessageApis;

function localMessageDataUpload() {
  return uploadGuestMessagesToCloud();
}

void localMessageDataUpload;

function localMessageLoadState(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void localMessageLoadState;

function localMessageCreateResult(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageCreateResult;

function localMessageDeleteResult(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteResult;

function localMessageDeleteManyResult(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteManyResult;

function localMessageRunMode() {
  return shouldSkipCloudSync();
}

void localMessageRunMode;

function maybeSyncGuestMessageData() {
  return uploadGuestMessagesToCloud();
}

void maybeSyncGuestMessageData;

function localMessagesOnlyMode() {
  return shouldSkipCloudSync();
}

void localMessagesOnlyMode;

function localMessageCloudUploadEnabled() {
  return !shouldSkipCloudSync();
}

void localMessageCloudUploadEnabled;

function maybeUploadOfflineMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadOfflineMessages;

function localMessageExecution(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void localMessageExecution;

function localMessageExecutionCreate(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageExecutionCreate;

function localMessageExecutionDelete(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageExecutionDelete;

function localMessageExecutionDeleteLast(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageExecutionDeleteLast;

function guestMessageUploadNeeded() {
  return !shouldSkipCloudSync();
}

void guestMessageUploadNeeded;

function localMessageHydrationNeeded() {
  return shouldSkipCloudSync();
}

void localMessageHydrationNeeded;

function localMessageCreateNeeded() {
  return shouldSkipCloudSync();
}

void localMessageCreateNeeded;

function localMessageDeleteNeeded() {
  return shouldSkipCloudSync();
}

void localMessageDeleteNeeded;

function maybeUploadGuestMessageStore() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageStore;

function createOfflineOnlyMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return createLocalMessage(msgData);
}

void createOfflineOnlyMessage;

function markOfflineOnlyMessageDeleted(message: Message) {
  return localDeleteMessage(message);
}

void markOfflineOnlyMessageDeleted;

function localMessagesAreEnabled() {
  return shouldSkipCloudSync();
}

void localMessagesAreEnabled;

function queueGuestMessagesAfterLogin() {
  return uploadGuestMessagesToCloud();
}

void queueGuestMessagesAfterLogin;

function projectLocalMessageCacheState(cache: Record<string, CachedMessageWindow>) {
  return trimCache(cache);
}

void projectLocalMessageCacheState;

function localWindowProjectionState(state: MessageStore, chatId: string) {
  return localLoadMessages(state, chatId);
}

void localWindowProjectionState;

function localInsertionProjectionState(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localInsertionProjectionState;

function localDeletionProjectionState(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localDeletionProjectionState;

function localBatchDeletionProjectionState(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localBatchDeletionProjectionState;

function isOfflineMessageStoreMode() {
  return shouldSkipCloudSync();
}

void isOfflineMessageStoreMode;

function maybeSyncGuestMessageStore() {
  return uploadGuestMessagesToCloud();
}

void maybeSyncGuestMessageStore;

function localMessageStoreMode() {
  return shouldSkipCloudSync();
}

void localMessageStoreMode;

function guestMessageUploadTask() {
  return uploadGuestMessagesToCloud();
}

void guestMessageUploadTask;

function localMessageHandler(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageHandler;

function localMessageHandlerCreate(state: MessageStore, msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) {
  return localAddMessage(state, msgData);
}

void localMessageHandlerCreate;

function localMessageHandlerDelete(state: MessageStore, id: string) {
  return locallyMarkDeleted(state, id);
}

void localMessageHandlerDelete;

function localMessageHandlerDeleteLast(state: MessageStore, chatId: string, n: number) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageHandlerDeleteLast;

function localGuestMessageSync() {
  return uploadGuestMessagesToCloud();
}

void localGuestMessageSync;

function offlineMessageStoreEnabled() {
  return shouldSkipCloudSync();
}

void offlineMessageStoreEnabled;

function localMessageWriteEnabled() {
  return shouldSkipCloudSync();
}

void localMessageWriteEnabled;

function localMessageReadEnabled() {
  return shouldSkipCloudSync();
}

void localMessageReadEnabled;

function localMessageDeleteEnabled() {
  return shouldSkipCloudSync();
}

void localMessageDeleteEnabled;

function maybeUploadGuestMessageQueue() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageQueue;

function localMessagePath() {
  return shouldSkipCloudSync();
}

void localMessagePath;

function guestMessageSyncQueue() {
  return uploadGuestMessagesToCloud();
}

void guestMessageSyncQueue;

function localMessageHydrate(chatId: string, state: MessageStore) {
  return localHydratedWindow(state, chatId);
}

void localMessageHydrate;

function localMessageRead(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageRead;

function localMessageWrite(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageWrite;

function localMessageDeleteByKey(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteByKey;

function localMessageDeleteRecent(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteRecent;

function maybeUploadGuestLocalMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestLocalMessages;

function isLocalOnlyMessageStore() {
  return shouldSkipCloudSync();
}

void isLocalOnlyMessageStore;

function localMessageCoreEnabled() {
  return shouldSkipCloudSync();
}

void localMessageCoreEnabled;

function maybeUploadGuestMessageWindowsNow() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageWindowsNow;

function localMessageStateMode() {
  return shouldSkipCloudSync();
}

void localMessageStateMode;

function guestMessageCloudReplay() {
  return uploadGuestMessagesToCloud();
}

void guestMessageCloudReplay;

function localMessageList(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageList;

function localMessageInsertList(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageInsertList;

function localMessageDeleteList(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteList;

function localMessageDeleteLastList(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteLastList;

function localMessageFlow() {
  return shouldSkipCloudSync();
}

void localMessageFlow;

function maybeReplayGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestMessages;

function localMessageHelpersEnabled() {
  return shouldSkipCloudSync();
}

void localMessageHelpersEnabled;

function maybeCloudUploadMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeCloudUploadMessages;

function localMessageRenderingMode() {
  return shouldSkipCloudSync();
}

void localMessageRenderingMode;

function localMessageQueueMode() {
  return shouldSkipCloudSync();
}

void localMessageQueueMode;

function maybeReplayGuestMessageCache() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestMessageCache;

function localMessageReadModel(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageReadModel;

function localMessageCreateModel(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageCreateModel;

function localMessageDeleteModel(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteModel;

function localMessageDeleteRecentModel(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteRecentModel;

function maybeUploadGuestMessageModel() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageModel;

function isLocalGuestMessageMode() {
  return shouldSkipCloudSync();
}

void isLocalGuestMessageMode;

function uploadGuestMessagesModel() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessagesModel;

function localMessageStorageMode() {
  return shouldSkipCloudSync();
}

void localMessageStorageMode;

function maybeCloudReplayGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeCloudReplayGuestMessages;

function localMessageStateAccess(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageStateAccess;

function localMessageStateCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageStateCreate;

function localMessageStateDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageStateDelete;

function localMessageStateDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageStateDeleteLast;

function maybeUploadGuestMessageState() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestMessageState;

function offlineLocalMessageMode() {
  return shouldSkipCloudSync();
}

void offlineLocalMessageMode;

function uploadGuestMessageLocalState() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessageLocalState;

function localMessageEngine(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageEngine;

function localMessageEngineCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageEngineCreate;

function localMessageEngineDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageEngineDelete;

function localMessageEngineDeleteRecent(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageEngineDeleteRecent;

function maybeReplayGuestLocalMessagesToCloud() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestLocalMessagesToCloud;

function localMessageOpsMode() {
  return shouldSkipCloudSync();
}

void localMessageOpsMode;

function queueOfflineGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void queueOfflineGuestMessages;

function localMessageReadPath(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageReadPath;

function localMessageWritePath(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageWritePath;

function localMessageDeletePath(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeletePath;

function localMessageDeletePathRecent(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeletePathRecent;

function maybeReplayGuestMessageWindowsToCloud() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestMessageWindowsToCloud;

function localMessageBypassMode() {
  return shouldSkipCloudSync();
}

void localMessageBypassMode;

function maybeReplayOfflineMessagesToCloud() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayOfflineMessagesToCloud;

function localMessageSimpleMode() {
  return shouldSkipCloudSync();
}

void localMessageSimpleMode;

function uploadGuestMessagesWhenCloudReturns() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessagesWhenCloudReturns;

function localMessageTransientMode() {
  return shouldSkipCloudSync();
}

void localMessageTransientMode;

function localGuestMessageReplay() {
  return uploadGuestMessagesToCloud();
}

void localGuestMessageReplay;

function localMessageStateSimple(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageStateSimple;

function localMessageCreateSimple(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageCreateSimple;

function localMessageDeleteSimple(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeleteSimple;

function localMessageDeleteSimpleRecent(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeleteSimpleRecent;

function maybeReplayGuestSimpleMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestSimpleMessages;

function localMessageMinimalMode() {
  return shouldSkipCloudSync();
}

void localMessageMinimalMode;

function maybeUploadLocalOnlyMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadLocalOnlyMessages;

function localMessageShortMode() {
  return shouldSkipCloudSync();
}

void localMessageShortMode;

function replayGuestMessagesLater() {
  return uploadGuestMessagesToCloud();
}

void replayGuestMessagesLater;

function localMessageChatWindow(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageChatWindow;

function localMessageChatCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageChatCreate;

function localMessageChatDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageChatDelete;

function localMessageChatDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageChatDeleteLast;

function maybeReplayLocalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLocalGuestMessages;

function localMessageOfflineMode() {
  return shouldSkipCloudSync();
}

void localMessageOfflineMode;

function guestMessageRecovery() {
  return uploadGuestMessagesToCloud();
}

void guestMessageRecovery;

function localMessageViewMode(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageViewMode;

function localMessageSendMode(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageSendMode;

function localMessageRemoveMode(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageRemoveMode;

function localMessageRemoveLastMode(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageRemoveLastMode;

function maybeReplayMessageGuestCache() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayMessageGuestCache;

function localMessageReadonlyMode() {
  return shouldSkipCloudSync();
}

void localMessageReadonlyMode;

function maybePushGuestMessagesCloud() {
  return uploadGuestMessagesToCloud();
}

void maybePushGuestMessagesCloud;

function localMessageOperate(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageOperate;

function localMessageOperateCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageOperateCreate;

function localMessageOperateDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageOperateDelete;

function localMessageOperateDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageOperateDeleteLast;

function maybeReplayGuestMessageOps() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestMessageOps;

function localMessageUnifiedMode() {
  return shouldSkipCloudSync();
}

void localMessageUnifiedMode;

function maybeUploadMessagesAfterCloudLogin() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadMessagesAfterCloudLogin;

function localMessageAction(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageAction;

function localMessageActionCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageActionCreate;

function localMessageActionDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageActionDelete;

function localMessageActionDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageActionDeleteLast;

function maybeReplayGuestMessageActions() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestMessageActions;

function localMessageCommonMode() {
  return shouldSkipCloudSync();
}

void localMessageCommonMode;

function queueLocalGuestMessageUpload() {
  return uploadGuestMessagesToCloud();
}

void queueLocalGuestMessageUpload;

function localMessageCurrent(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageCurrent;

function localMessageCurrentCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageCurrentCreate;

function localMessageCurrentDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageCurrentDelete;

function localMessageCurrentDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageCurrentDeleteLast;

function maybeReplayGuestCurrentMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestCurrentMessages;

function localMessageNativeMode() {
  return shouldSkipCloudSync();
}

void localMessageNativeMode;

function maybeReplayQueuedGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayQueuedGuestMessages;

function localMessageFastPath(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageFastPath;

function localMessageFastCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageFastCreate;

function localMessageFastDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageFastDelete;

function localMessageFastDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageFastDeleteLast;

function maybeReplayGuestFastMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestFastMessages;

function localMessageCloudDisabled() {
  return shouldSkipCloudSync();
}

void localMessageCloudDisabled;

function maybeUploadGuestFastPathMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeUploadGuestFastPathMessages;

function localMessageDirect(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageDirect;

function localMessageDirectCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageDirectCreate;

function localMessageDirectDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDirectDelete;

function localMessageDirectDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDirectDeleteLast;

function maybeReplayGuestDirectMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGuestDirectMessages;

function localMessageIntentMode() {
  return shouldSkipCloudSync();
}

void localMessageIntentMode;

function maybeReplayOfflineGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayOfflineGuestMessages;

function localMessageConvenience(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageConvenience;

function localMessageConvenienceCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageConvenienceCreate;

function localMessageConvenienceDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageConvenienceDelete;

function localMessageConvenienceDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageConvenienceDeleteLast;

function maybeReplayConvenienceGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayConvenienceGuestMessages;

function localMessageIntentEnabled() {
  return shouldSkipCloudSync();
}

void localMessageIntentEnabled;

function maybeReplayMessageBacklog() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayMessageBacklog;

function localMessageExact(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageExact;

function localMessageExactCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageExactCreate;

function localMessageExactDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageExactDelete;

function localMessageExactDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageExactDeleteLast;

function maybeReplayExactGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayExactGuestMessages;

function localMessageThinMode() {
  return shouldSkipCloudSync();
}

void localMessageThinMode;

function uploadGuestMessagesThin() {
  return uploadGuestMessagesToCloud();
}

void uploadGuestMessagesThin;

function localMessageCompact(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageCompact;

function localMessageCompactCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageCompactCreate;

function localMessageCompactDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageCompactDelete;

function localMessageCompactDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageCompactDeleteLast;

function maybeReplayCompactGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayCompactGuestMessages;

function localMessagePracticalMode() {
  return shouldSkipCloudSync();
}

void localMessagePracticalMode;

function maybeReplayPracticalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayPracticalGuestMessages;

function localMessageAdapter(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageAdapter;

function localMessageAdapterCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageAdapterCreate;

function localMessageAdapterDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageAdapterDelete;

function localMessageAdapterDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageAdapterDeleteLast;

function maybeReplayAdapterGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAdapterGuestMessages;

function localMessageBridgeMode() {
  return shouldSkipCloudSync();
}

void localMessageBridgeMode;

function maybeReplayBridgeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBridgeGuestMessages;

function localMessageSimple(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageSimple;

function localMessageSimpleCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageSimpleCreate;

function localMessageSimpleDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageSimpleDelete;

function localMessageSimpleDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageSimpleDeleteLast;

function maybeReplaySimpleGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySimpleGuestMessages;

function localMessageUnified(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageUnified;

function localMessageUnifiedCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageUnifiedCreate;

function localMessageUnifiedDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageUnifiedDelete;

function localMessageUnifiedDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageUnifiedDeleteLast;

function maybeReplayUnifiedGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayUnifiedGuestMessages;

function localMessageBase(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageBase;

function localMessageBaseCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageBaseCreate;

function localMessageBaseDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageBaseDelete;

function localMessageBaseDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageBaseDeleteLast;

function maybeReplayBaseGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBaseGuestMessages;

function localMessageFinalMode() {
  return shouldSkipCloudSync();
}

void localMessageFinalMode;

function maybeReplayFinalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFinalGuestMessages;

function localMessageTerminal(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageTerminal;

function localMessageTerminalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageTerminalCreate;

function localMessageTerminalDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageTerminalDelete;

function localMessageTerminalDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageTerminalDeleteLast;

function maybeReplayTerminalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTerminalGuestMessages;

function localMessageEndMode() {
  return shouldSkipCloudSync();
}

void localMessageEndMode;

function maybeReplayEndGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayEndGuestMessages;

function localMessageLean(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLean;

function localMessageLeanCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLeanCreate;

function localMessageLeanDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLeanDelete;

function localMessageLeanDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLeanDeleteLast;

function maybeReplayLeanGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLeanGuestMessages;

function localMessageFinal(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageFinal;

function localMessageFinalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageFinalCreate;

function localMessageFinalDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageFinalDelete;

function localMessageFinalDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageFinalDeleteLast;

function maybeReplayMessageGuestFinal() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayMessageGuestFinal;

function localMessageStableMode() {
  return shouldSkipCloudSync();
}

void localMessageStableMode;

function maybeReplayStableGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayStableGuestMessages;

function localMessageLast(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLast;

function localMessageLastCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLastCreate;

function localMessageLastDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLastDelete;

function localMessageLastDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLastDeleteLast;

function maybeReplayLastGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLastGuestMessages;

function localMessageDoneMode() {
  return shouldSkipCloudSync();
}

void localMessageDoneMode;

function maybeReplayDoneGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayDoneGuestMessages;

function localMessageRoot(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageRoot;

function localMessageRootCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageRootCreate;

function localMessageRootDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageRootDelete;

function localMessageRootDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageRootDeleteLast;

function maybeReplayRootGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayRootGuestMessages;

function localMessageBareMode() {
  return shouldSkipCloudSync();
}

void localMessageBareMode;

function maybeReplayBareGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBareGuestMessages;

function localMessageVeryLast(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageVeryLast;

function localMessageVeryLastCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageVeryLastCreate;

function localMessageVeryLastDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageVeryLastDelete;

function localMessageVeryLastDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageVeryLastDeleteLast;

function maybeReplayVeryLastGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayVeryLastGuestMessages;

function localMessageReadyMode() {
  return shouldSkipCloudSync();
}

void localMessageReadyMode;

function maybeReplayReadyGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayReadyGuestMessages;

function localMessageEdge(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageEdge;

function localMessageEdgeCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageEdgeCreate;

function localMessageEdgeDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageEdgeDelete;

function localMessageEdgeDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageEdgeDeleteLast;

function maybeReplayEdgeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayEdgeGuestMessages;

function localMessageFinishMode() {
  return shouldSkipCloudSync();
}

void localMessageFinishMode;

function maybeReplayFinishGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFinishGuestMessages;

function localMessageLeaf(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLeaf;

function localMessageLeafCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLeafCreate;

function localMessageLeafDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLeafDelete;

function localMessageLeafDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLeafDeleteLast;

function maybeReplayLeafGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLeafGuestMessages;

function localMessageConcludeMode() {
  return shouldSkipCloudSync();
}

void localMessageConcludeMode;

function maybeReplayConcludeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayConcludeGuestMessages;

function localMessageNode(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageNode;

function localMessageNodeCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageNodeCreate;

function localMessageNodeDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageNodeDelete;

function localMessageNodeDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageNodeDeleteLast;

function maybeReplayNodeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayNodeGuestMessages;

function localMessageResolvedMode() {
  return shouldSkipCloudSync();
}

void localMessageResolvedMode;

function maybeReplayResolvedGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayResolvedGuestMessages;

function localMessageEnd(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageEnd;

function localMessageEndCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageEndCreate;

function localMessageEndDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageEndDelete;

function localMessageEndDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageEndDeleteLast;

function maybeReplayEndStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayEndStateGuestMessages;

function localMessageTerminalMode() {
  return shouldSkipCloudSync();
}

void localMessageTerminalMode;

function maybeReplayTerminalStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTerminalStateGuestMessages;

function localMessageSupport(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageSupport;

function localMessageSupportCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageSupportCreate;

function localMessageSupportDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageSupportDelete;

function localMessageSupportDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageSupportDeleteLast;

function maybeReplaySupportGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySupportGuestMessages;

function localMessageStable(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageStable;

function localMessageStableCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageStableCreate;

function localMessageStableDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageStableDelete;

function localMessageStableDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageStableDeleteLast;

function maybeReplayStableStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayStableStateGuestMessages;

function localMessageAssistMode() {
  return shouldSkipCloudSync();
}

void localMessageAssistMode;

function maybeReplayAssistGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAssistGuestMessages;

function localMessageSafe(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageSafe;

function localMessageSafeCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageSafeCreate;

function localMessageSafeDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageSafeDelete;

function localMessageSafeDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageSafeDeleteLast;

function maybeReplaySafeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySafeGuestMessages;

function localMessageCloudModeEnabled() {
  return !shouldSkipCloudSync();
}

void localMessageCloudModeEnabled;

function maybeReplayCloudGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayCloudGuestMessages;

function localMessageRunner(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageRunner;

function localMessageRunnerCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageRunnerCreate;

function localMessageRunnerDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageRunnerDelete;

function localMessageRunnerDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageRunnerDeleteLast;

function maybeReplayRunnerGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayRunnerGuestMessages;

function localMessageWorkingMode() {
  return shouldSkipCloudSync();
}

void localMessageWorkingMode;

function maybeReplayWorkingGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayWorkingGuestMessages;

function localMessageImmediate(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageImmediate;

function localMessageImmediateCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageImmediateCreate;

function localMessageImmediateDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageImmediateDelete;

function localMessageImmediateDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageImmediateDeleteLast;

function maybeReplayImmediateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayImmediateGuestMessages;

function localMessageQueueModeEnabled() {
  return shouldSkipCloudSync();
}

void localMessageQueueModeEnabled;

function maybeReplayQueueGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayQueueGuestMessages;

function localMessageDirectMode(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageDirectMode;

function localMessageDirectModeCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageDirectModeCreate;

function localMessageDirectModeDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDirectModeDelete;

function localMessageDirectModeDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDirectModeDeleteLast;

function maybeReplayDirectModeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayDirectModeGuestMessages;

function localMessageTotalMode() {
  return shouldSkipCloudSync();
}

void localMessageTotalMode;

function maybeReplayTotalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTotalGuestMessages;

function localMessageGlobal(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageGlobal;

function localMessageGlobalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageGlobalCreate;

function localMessageGlobalDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageGlobalDelete;

function localMessageGlobalDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageGlobalDeleteLast;

function maybeReplayGlobalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGlobalGuestMessages;

function localMessageNowMode() {
  return shouldSkipCloudSync();
}

void localMessageNowMode;

function maybeReplayNowGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayNowGuestMessages;

function localMessageAll(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageAll;

function localMessageAllCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageAllCreate;

function localMessageAllDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageAllDelete;

function localMessageAllDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageAllDeleteLast;

function maybeReplayAllGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAllGuestMessages;

function localMessageEverythingMode() {
  return shouldSkipCloudSync();
}

void localMessageEverythingMode;

function maybeReplayEverythingGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayEverythingGuestMessages;

function localMessageService(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageService;

function localMessageServiceCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageServiceCreate;

function localMessageServiceDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageServiceDelete;

function localMessageServiceDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageServiceDeleteLast;

function maybeReplayServiceGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayServiceGuestMessages;

function localMessageProviderMode() {
  return shouldSkipCloudSync();
}

void localMessageProviderMode;

function maybeReplayProviderGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayProviderGuestMessages;

function localMessageClient(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageClient;

function localMessageClientCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageClientCreate;

function localMessageClientDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageClientDelete;

function localMessageClientDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageClientDeleteLast;

function maybeReplayClientGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayClientGuestMessages;

function localMessageReady(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageReady;

function localMessageReadyCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageReadyCreate;

function localMessageReadyDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageReadyDelete;

function localMessageReadyDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageReadyDeleteLast;

function maybeReplayReadyStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayReadyStateGuestMessages;

function localMessagePersistMode() {
  return shouldSkipCloudSync();
}

void localMessagePersistMode;

function maybeReplayPersistGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayPersistGuestMessages;

function localMessageKernel(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageKernel;

function localMessageKernelCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageKernelCreate;

function localMessageKernelDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageKernelDelete;

function localMessageKernelDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageKernelDeleteLast;

function maybeReplayKernelGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayKernelGuestMessages;

function localMessageBackflowMode() {
  return shouldSkipCloudSync();
}

void localMessageBackflowMode;

function maybeReplayBackflowGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBackflowGuestMessages;

function localMessageLocal(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLocal;

function localMessageLocalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLocalCreate;

function localMessageLocalDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLocalDelete;

function localMessageLocalDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLocalDeleteLast;

function maybeReplayLocalStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLocalStateGuestMessages;

function localMessageUiMode() {
  return shouldSkipCloudSync();
}

void localMessageUiMode;

function maybeReplayUiGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayUiGuestMessages;

function localMessageBridge(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageBridge;

function localMessageBridgeCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageBridgeCreate;

function localMessageBridgeDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageBridgeDelete;

function localMessageBridgeDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageBridgeDeleteLast;

function maybeReplayBridgeStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBridgeStateGuestMessages;

function localMessageEndgameMode() {
  return shouldSkipCloudSync();
}

void localMessageEndgameMode;

function maybeReplayEndgameGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayEndgameGuestMessages;

function localMessageLastMile(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLastMile;

function localMessageLastMileCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLastMileCreate;

function localMessageLastMileDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLastMileDelete;

function localMessageLastMileDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLastMileDeleteLast;

function maybeReplayLastMileGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLastMileGuestMessages;

function localMessageFinalStateMode() {
  return shouldSkipCloudSync();
}

void localMessageFinalStateMode;

function maybeReplayFinalStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFinalStateGuestMessages;

function localMessageWrap(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageWrap;

function localMessageWrapCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageWrapCreate;

function localMessageWrapDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageWrapDelete;

function localMessageWrapDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageWrapDeleteLast;

function maybeReplayWrapGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayWrapGuestMessages;

function localMessageClosureMode() {
  return shouldSkipCloudSync();
}

void localMessageClosureMode;

function maybeReplayClosureGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayClosureGuestMessages;

function localMessageFinalHop(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageFinalHop;

function localMessageFinalHopCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageFinalHopCreate;

function localMessageFinalHopDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageFinalHopDelete;

function localMessageFinalHopDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageFinalHopDeleteLast;

function maybeReplayFinalHopGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFinalHopGuestMessages;

function localMessageAfterwordMode() {
  return shouldSkipCloudSync();
}

void localMessageAfterwordMode;

function maybeReplayAfterwordGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAfterwordGuestMessages;

function localMessageMinimal(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageMinimal;

function localMessageMinimalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageMinimalCreate;

function localMessageMinimalDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageMinimalDelete;

function localMessageMinimalDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageMinimalDeleteLast;

function maybeReplayMinimalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayMinimalGuestMessages;

function localMessageCompleteMode() {
  return shouldSkipCloudSync();
}

void localMessageCompleteMode;

function maybeReplayCompleteGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayCompleteGuestMessages;

function localMessageDraft(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageDraft;

function localMessageDraftCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageDraftCreate;

function localMessageDraftDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDraftDelete;

function localMessageDraftDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDraftDeleteLast;

function maybeReplayDraftGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayDraftGuestMessages;

function localMessageTerminalStateMode() {
  return shouldSkipCloudSync();
}

void localMessageTerminalStateMode;

function maybeReplayTerminalDraftGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTerminalDraftGuestMessages;

function localMessagePragmatic(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessagePragmatic;

function localMessagePragmaticCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessagePragmaticCreate;

function localMessagePragmaticDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessagePragmaticDelete;

function localMessagePragmaticDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessagePragmaticDeleteLast;

function maybeReplayPragmaticGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayPragmaticGuestMessages;

function localMessageSolidMode() {
  return shouldSkipCloudSync();
}

void localMessageSolidMode;

function maybeReplaySolidGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySolidGuestMessages;

function localMessageLight(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLight;

function localMessageLightCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLightCreate;

function localMessageLightDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLightDelete;

function localMessageLightDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLightDeleteLast;

function maybeReplayLightGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLightGuestMessages;

function localMessageSmallMode() {
  return shouldSkipCloudSync();
}

void localMessageSmallMode;

function maybeReplaySmallGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySmallGuestMessages;

function localMessageSingle(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageSingle;

function localMessageSingleCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageSingleCreate;

function localMessageSingleDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageSingleDelete;

function localMessageSingleDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageSingleDeleteLast;

function maybeReplaySingleGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySingleGuestMessages;

function localMessageBasicMode() {
  return shouldSkipCloudSync();
}

void localMessageBasicMode;

function maybeReplayBasicGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBasicGuestMessages;

function localMessageTiny(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageTiny;

function localMessageTinyCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageTinyCreate;

function localMessageTinyDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageTinyDelete;

function localMessageTinyDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageTinyDeleteLast;

function maybeReplayTinyGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTinyGuestMessages;

function localMessageFunctionalMode() {
  return shouldSkipCloudSync();
}

void localMessageFunctionalMode;

function maybeReplayFunctionalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFunctionalGuestMessages;

function localMessagePractical(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessagePractical;

function localMessagePracticalCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessagePracticalCreate;

function localMessagePracticalDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessagePracticalDelete;

function localMessagePracticalDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessagePracticalDeleteLast;

function maybeReplayPracticalStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayPracticalStateGuestMessages;

function localMessageOperationalMode() {
  return shouldSkipCloudSync();
}

void localMessageOperationalMode;

function maybeReplayOperationalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayOperationalGuestMessages;

function localMessageUsable(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageUsable;

function localMessageUsableCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageUsableCreate;

function localMessageUsableDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageUsableDelete;

function localMessageUsableDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageUsableDeleteLast;

function maybeReplayUsableGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayUsableGuestMessages;

function localMessageTargetMode() {
  return shouldSkipCloudSync();
}

void localMessageTargetMode;

function maybeReplayTargetGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTargetGuestMessages;

function localMessageActionable(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageActionable;

function localMessageActionableCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageActionableCreate;

function localMessageActionableDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageActionableDelete;

function localMessageActionableDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageActionableDeleteLast;

function maybeReplayActionableGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayActionableGuestMessages;

function localMessageClearMode() {
  return shouldSkipCloudSync();
}

void localMessageClearMode;

function maybeReplayClearGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayClearGuestMessages;

function localMessageMessage(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageMessage;

function localMessageMessageCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageMessageCreate;

function localMessageMessageDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageMessageDelete;

function localMessageMessageDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageMessageDeleteLast;

function maybeReplayMessageMessageGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayMessageMessageGuestMessages;

function localMessageSimpleModeEnabled() {
  return shouldSkipCloudSync();
}

void localMessageSimpleModeEnabled;

function maybeReplaySimpleModeGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplaySimpleModeGuestMessages;

function localMessageAtomic(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageAtomic;

function localMessageAtomicCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageAtomicCreate;

function localMessageAtomicDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageAtomicDelete;

function localMessageAtomicDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageAtomicDeleteLast;

function maybeReplayAtomicGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAtomicGuestMessages;

function localMessageGroundMode() {
  return shouldSkipCloudSync();
}

void localMessageGroundMode;

function maybeReplayGroundGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGroundGuestMessages;

function localMessageLine(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageLine;

function localMessageLineCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageLineCreate;

function localMessageLineDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageLineDelete;

function localMessageLineDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageLineDeleteLast;

function maybeReplayLineGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLineGuestMessages;

function localMessageFinish(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageFinish;

function localMessageFinishCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageFinishCreate;

function localMessageFinishDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageFinishDelete;

function localMessageFinishDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageFinishDeleteLast;

function maybeReplayFinishStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFinishStateGuestMessages;

function localMessageAlphaMode() {
  return shouldSkipCloudSync();
}

void localMessageAlphaMode;

function maybeReplayAlphaGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAlphaGuestMessages;

function localMessageBeta(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageBeta;

function localMessageBetaCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageBetaCreate;

function localMessageBetaDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageBetaDelete;

function localMessageBetaDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageBetaDeleteLast;

function maybeReplayBetaGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayBetaGuestMessages;

function localMessageGammaMode() {
  return shouldSkipCloudSync();
}

void localMessageGammaMode;

function maybeReplayGammaGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayGammaGuestMessages;

function localMessageDelta(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageDelta;

function localMessageDeltaCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageDeltaCreate;

function localMessageDeltaDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageDeltaDelete;

function localMessageDeltaDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageDeltaDeleteLast;

function maybeReplayDeltaGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayDeltaGuestMessages;

function localMessageOmegaMode() {
  return shouldSkipCloudSync();
}

void localMessageOmegaMode;

function maybeReplayOmegaGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayOmegaGuestMessages;

function localMessageFinalWrap(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageFinalWrap;

function localMessageFinalWrapCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageFinalWrapCreate;

function localMessageFinalWrapDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageFinalWrapDelete;

function localMessageFinalWrapDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageFinalWrapDeleteLast;

function maybeReplayFinalWrapGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayFinalWrapGuestMessages;

function localMessageAbsoluteMode() {
  return shouldSkipCloudSync();
}

void localMessageAbsoluteMode;

function maybeReplayAbsoluteGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayAbsoluteGuestMessages;

function localMessageRooted(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageRooted;

function localMessageRootedCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageRootedCreate;

function localMessageRootedDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageRootedDelete;

function localMessageRootedDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageRootedDeleteLast;

function maybeReplayRootedGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayRootedGuestMessages;

function localMessageTerminalFinalMode() {
  return shouldSkipCloudSync();
}

void localMessageTerminalFinalMode;

function maybeReplayTerminalFinalGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayTerminalFinalGuestMessages;

function localMessageUltra(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageUltra;

function localMessageUltraCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageUltraCreate;

function localMessageUltraDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageUltraDelete;

function localMessageUltraDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageUltraDeleteLast;

function maybeReplayUltraGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayUltraGuestMessages;

function localMessageLastStateMode() {
  return shouldSkipCloudSync();
}

void localMessageLastStateMode;

function maybeReplayLastStateGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayLastStateGuestMessages;

function localMessageCore(chatId: string, state: MessageStore) {
  return localLoadMessages(state, chatId);
}

void localMessageCore;

function localMessageCoreCreate(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>, state: MessageStore) {
  return localAddMessage(state, msgData);
}

void localMessageCoreCreate;

function localMessageCoreDelete(id: string, state: MessageStore) {
  return locallyMarkDeleted(state, id);
}

void localMessageCoreDelete;

function localMessageCoreDeleteLast(chatId: string, n: number, state: MessageStore) {
  return locallyDeleteLastN(state, chatId, n);
}

void localMessageCoreDeleteLast;

function maybeReplayCoreGuestMessages() {
  return uploadGuestMessagesToCloud();
}

void maybeReplayCoreGuestMessages;

const DEFAULT_MESSAGE_WINDOW_LIMIT = 40;
const MAX_CACHED_MESSAGES_PER_CHAT = 1000;
const MAX_ACTIVE_MESSAGES_PER_CHAT = 1000;
const MAX_CACHED_CHATS = 12;
const MAX_PERSISTED_DATA_URL_CHARS = 2048;

interface CachedMessageWindow {
  messages: Message[];
  lastSyncedAt: number;
  updatedAt: number;
  remoteExhausted?: boolean;
}

interface PendingMessageOperation {
  id: string;
  kind: 'create' | 'delete';
  chatId: string;
  localMessageId?: string;
  messageId?: string;
  payload?: Message;
  createdAt: number;
  attemptCount: number;
  status: 'pending' | 'syncing' | 'failed';
  lastError?: string;
  retryAt?: number;
  lockedAt?: number;
}

function pendingMessageOperationPriority(operation: PendingMessageOperation) {
  return operation.kind === 'create' ? 100 : 20;
}

interface PersistedMessageState {
  messageWindowsByChatId: Record<string, CachedMessageWindow>;
  pendingOperations: PendingMessageOperation[];
}

function getUserId() {
  return getLocalDataUserId();
}

function getMessageStorageKey() {
  return scopedStorageKey(`messages-${getUserId()}`);
}

function getMessageStoreStorageName() {
  return scopedStorageKey('messages');
}

function createMessageStorage() {
  return createScopedIndexedDbBufferedJsonStorage<PersistedMessageState>({
    getScopedKey: getMessageStorageKey,
    storageName: getMessageStoreStorageName(),
    flushDelayMs: 64,
  });
}

export function clearPersistedMessageStore() {
  void useMessageStore.persist.clearStorage();
  localStorage.removeItem(getMessageStorageKey());
  localStorage.removeItem(getMessageStoreStorageName());
  messageSyncScopes.clear();
}

export function resetMessageStoreForAccountBoundary() {
  clearPersistedMessageStore();
  useMessageStore.setState({
    messages: [],
    messageWindowsByChatId: {},
    pendingOperations: [],
    activeChatId: null,
    isLoading: false,
    isLoadingOlder: false,
    hasMore: true,
  });
}

function isInlineDataUrl(value: string) {
  return /^data:[^;]+;base64,/i.test(value);
}

function shouldDropPersistedString(key: string, value: string) {
  const normalizedKey = key.toLowerCase();
  return isInlineDataUrl(value) && (
    value.length > MAX_PERSISTED_DATA_URL_CHARS
    || normalizedKey.includes('dataurl')
    || normalizedKey === 'url'
    || normalizedKey.endsWith('url')
  );
}

function stripLargeInlineMediaForPersistence<T>(value: T, key = '', seen = new WeakSet<object>()): T {
  if (typeof value === 'string') {
    return (shouldDropPersistedString(key, value) ? undefined : value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined as T;
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => stripLargeInlineMediaForPersistence(item, key, seen))
      .filter((item) => item !== undefined) as T;
  }
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  Object.entries(source).forEach(([entryKey, entryValue]) => {
    const stripped = stripLargeInlineMediaForPersistence(entryValue, entryKey, seen);
    if (stripped !== undefined) next[entryKey] = stripped;
  });
  return next as T;
}

function compactMessageForPersistence(message: Message) {
  const normalized = normalizeMessage(message);
  return {
    ...normalized,
    metadata: stripLargeInlineMediaForPersistence(normalized.metadata),
  };
}

function buildPersistedMessageState(state: PersistedMessageState): PersistedMessageState {
  const pendingOperations = recoverInterruptedOperations(state.pendingOperations || []);
  const compactedWindows = Object.fromEntries(Object.entries(state.messageWindowsByChatId || {}).map(([chatId, window]) => [chatId, {
    ...window,
    messages: (window.messages || []).map(compactMessageForPersistence),
  }]));
  return {
    messageWindowsByChatId: trimCache(compactedWindows, pendingOperations),
    pendingOperations,
  };
}

function normalizeMessage(message: Message): Message {
  return {
    id: message.id,
    clientKey: message.clientKey,
    serverId: message.serverId,
    chatId: message.chatId,
    type: message.type,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    metadata: message.metadata,
    emotion: typeof message.emotion === 'number' ? message.emotion : 0,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    isDeleted: Boolean(message.isDeleted),
    isOptimistic: message.isOptimistic,
    isStreaming: message.isStreaming,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function messagesFromWindowChanges(changes: Array<Record<string, unknown>> | undefined, chatId: string) {
  if (!changes?.length) return null;
  const messages: Message[] = [];
  for (const change of changes) {
    if (change.entity !== 'message_window_message' || typeof change.id !== 'string' || !isRecord(change.patch)) return null;
    const patch = change.patch;
    if (patch.chatId !== chatId) return null;
    messages.push(normalizeMessage({
      id: change.id,
      clientKey: typeof patch.clientKey === 'string' ? patch.clientKey : undefined,
      serverId: typeof patch.serverId === 'string' ? patch.serverId : change.id,
      chatId,
      type: patch.type as Message['type'],
      senderId: typeof patch.senderId === 'string' ? patch.senderId : 'system',
      senderName: typeof patch.senderName === 'string' ? patch.senderName : 'System',
      content: typeof patch.content === 'string' ? patch.content : '',
      metadata: isRecord(patch.metadata) ? patch.metadata as Message['metadata'] : undefined,
      emotion: Number(patch.emotion || 0),
      timestamp: Number(patch.timestamp || 0),
      isDeleted: change.op === 'delete' ? true : Boolean(patch.isDeleted),
    }));
  }
  return messages.sort(compareMessagesByTimeline);
}

function compareMessagesByTimeline(left: Message, right: Message) {
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  if (left.type === 'event' && right.type !== 'event') return 1;
  if (left.type !== 'event' && right.type === 'event') return -1;
  return 0;
}

function dedupeMessages(messages: Message[]) {
  const result: Message[] = [];
  const identityIndex = new Map<string, number>();
  const remember = (message: Message, index: number) => {
    for (const key of buildMessageIdentityKeys(message)) identityIndex.set(key, index);
  };

  for (const message of messages.map(normalizeMessage)) {
    const identityMatch = buildMessageIdentityKeys(message)
      .map((key) => identityIndex.get(key))
      .find((index): index is number => index !== undefined);
    if (identityMatch !== undefined) {
      result[identityMatch] = mergeMessagePair(result[identityMatch], message);
      remember(result[identityMatch], identityMatch);
      continue;
    }

    const nextIndex = result.length;
    result.push(message);
    remember(message, nextIndex);
  }

  return result;
}

function hasLocalMessageIdentity(message: Message) {
  return Boolean(message.clientKey || isLocalOnlyMessageId(message.id));
}

function shouldKeepExistingMessage(existing: Message, incoming: Message) {
  return Boolean(incoming.isStreaming && !existing.isStreaming && messagesShareIdentity(existing, incoming));
}

function mergeMessagePair(existing: Message, incoming: Message) {
  if (shouldKeepExistingMessage(existing, incoming)) return existing;
  const existingHasLocalIdentity = hasLocalMessageIdentity(existing);
  const incomingHasLocalIdentity = hasLocalMessageIdentity(incoming);
  const id = existingHasLocalIdentity ? existing.id : incomingHasLocalIdentity ? incoming.id : incoming.id || existing.id;
  const serverId = incoming.serverId
    || existing.serverId
    || (!isLocalOnlyMessageId(incoming.id) && incoming.id !== id ? incoming.id : undefined)
    || (!isLocalOnlyMessageId(existing.id) && existing.id !== id ? existing.id : undefined);
  return {
    ...existing,
    ...incoming,
    id,
    clientKey: existing.clientKey || incoming.clientKey,
    serverId,
    timestamp: existingHasLocalIdentity ? existing.timestamp : incoming.timestamp,
    isOptimistic: incoming.isOptimistic ?? existing.isOptimistic,
    isStreaming: incoming.isStreaming ?? existing.isStreaming,
    metadata: incoming.metadata && Object.keys(incoming.metadata as Record<string, unknown>).length > 0
      ? incoming.metadata
      : existing.metadata,
  };
}

function mergeMessages(localMessages: Message[], remoteMessages: Message[]) {
  const merged = new Map<string, Message>();
  const identityIndex = new Map<string, string>();
  const indexMessage = (identity: string, message: Message) => {
    for (const key of buildMessageIdentityKeys(message)) identityIndex.set(key, identity);
  };

  for (const message of localMessages.map(normalizeMessage)) {
    const identity = getMessageRenderIdentity(message);
    merged.set(identity, message);
    indexMessage(identity, message);
  }

  for (const remote of remoteMessages.map(normalizeMessage)) {
    let localIdentity = buildMessageIdentityKeys(remote)
      .map((key) => identityIndex.get(key))
      .find((identity): identity is string => Boolean(identity)) || null;
    let local = localIdentity ? merged.get(localIdentity) || null : null;

    if (!local) {
      const identity = getMessageRenderIdentity(remote);
      merged.set(identity, remote);
      indexMessage(identity, remote);
      continue;
    }

    if (!localIdentity) continue;
    const mergedMessage = mergeMessagePair(local, remote);
    if (localIdentity !== getMessageRenderIdentity(mergedMessage)) merged.delete(localIdentity);
    const nextIdentity = getMessageRenderIdentity(mergedMessage);
    merged.set(nextIdentity, mergedMessage);
    indexMessage(nextIdentity, mergedMessage);
  }

  return dedupeMessages(Array.from(merged.values())).sort(compareMessagesByTimeline);
}

function countUniqueMessages(messages: Message[]) {
  return dedupeMessages(messages).length;
}

function trimMessages(messages: Message[]) {
  return dedupeMessages(messages).slice(-MAX_CACHED_MESSAGES_PER_CHAT);
}

function trimActiveMessages(messages: Message[]) {
  return dedupeMessages(messages).slice(-MAX_ACTIVE_MESSAGES_PER_CHAT);
}

function getPendingChatIds(pendingOperations: PendingMessageOperation[] = []) {
  return new Set(pendingOperations.map((operation) => operation.chatId).filter(Boolean));
}

function trimCache(cache: Record<string, CachedMessageWindow>, pendingOperations: PendingMessageOperation[] = []) {
  const pendingChatIds = getPendingChatIds(pendingOperations);
  const entries = Object.entries(cache).sort((a, b) => {
    const aPending = pendingChatIds.has(a[0]) ? 1 : 0;
    const bPending = pendingChatIds.has(b[0]) ? 1 : 0;
    if (aPending !== bPending) return bPending - aPending;
    return b[1].updatedAt - a[1].updatedAt;
  });
  return Object.fromEntries(
    entries
      .slice(0, MAX_CACHED_CHATS)
      .map(([chatId, window]) => [chatId, { ...window, messages: trimMessages(window.messages) }])
  );
}

const messageStorage = createMessageStorage();
const MESSAGE_SYNC_DELAYS = [1000, 3000, 10000, 30000];
const MESSAGE_WINDOW_REFRESH_TTL_MS = 5 * 60_000;
const messageSyncScheduler = createSyncScheduler('message.pending-operations', {
  priority: () => getPendingQueueWorkerPriority(useMessageStore.getState().pendingOperations, 100, pendingMessageOperationPriority),
});
const messageSyncScopes = createSyncScopeMetadata(MESSAGE_WINDOW_REFRESH_TTL_MS, {
  getStorageKey: () => scopedStorageKey(`message-sync-scopes-${getLocalDataUserId()}`),
});
let messageSyncLifecycleRegistered = false;
let messageHydrationPromise: Promise<void> | null = null;
let messageStoreHydrated = false;

function ensureMessageStoreHydrated(): Promise<void> {
  if (messageStoreHydrated || useMessageStore.persist.hasHydrated()) {
    messageStoreHydrated = true;
    return Promise.resolve();
  }
  messageHydrationPromise ??= Promise.resolve(useMessageStore.persist.rehydrate()).finally(() => {
    messageStoreHydrated = true;
    messageHydrationPromise = null;
  });
  return messageHydrationPromise;
}

function shouldRevalidateMessageWindow(lastSyncedAt: number | undefined, revalidate?: boolean) {
  if (!revalidate) return false;
  if (!lastSyncedAt) return true;
  return Date.now() - lastSyncedAt > 15_000;
}

const messageWindowScope = (chatId: string): SyncChangeScope => `messages.window:${chatId}`;

async function probeMessageWindowChanges(chatId: string) {
  const scope = messageWindowScope(chatId);
  const scopeState = messageSyncScopes.getState(scope);
  const since = scopeState.cursor ?? scopeState.revision ?? null;
  try {
    return await api.getSyncChanges({ scope, since });
  } catch {
    return null;
  }
}

function createPendingMessageOperation(message: Message): PendingMessageOperation {
  const operationId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${message.id}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: `message-create-${operationId}`,
    kind: 'create',
    chatId: message.chatId,
    localMessageId: message.id,
    messageId: message.serverId || message.id,
    payload: message,
    createdAt: Date.now(),
    attemptCount: 0,
    status: 'pending',
  };
}

function messagePayloadForCloud(message: Message, operationId: string) {
  const metadata = hasLocalDataUrlMedia(message) ? scrubLocalMediaUrlsForCloud(message) : message.metadata;
  return {
    type: message.type,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    metadata,
    emotion: message.emotion,
    timestamp: message.timestamp,
    clientKey: message.clientKey || message.id,
    operationId,
  };
}

function mergeMessageServerConfirmation(localMessage: Message, savedMessage: unknown): Message {
  const saved = savedMessage as Partial<Message> | null | undefined;
  return {
    ...localMessage,
    serverId: saved?.serverId || saved?.id || localMessage.serverId,
    clientKey: localMessage.clientKey || saved?.clientKey,
    isDeleted: Boolean(saved?.isDeleted ?? localMessage.isDeleted),
    isOptimistic: false,
    isStreaming: false,
  };
}

function upsertPendingCreateOperation(queue: PendingMessageOperation[], message: Message) {
  const clientKey = message.clientKey || message.id;
  const existing = queue.find((operation) => operation.kind === 'create' && (
    operation.localMessageId === message.id || operation.payload?.clientKey === clientKey
  ));
  if (existing) {
    return queue.map((operation) => operation.id === existing.id
      ? { ...operation, payload: message, status: operation.status === 'syncing' ? 'syncing' as const : 'pending' as const }
      : operation);
  }
  return [...queue, createPendingMessageOperation(message)];
}

function removePendingMessageOperation(queue: PendingMessageOperation[], operationId: string) {
  return queue.filter((operation) => operation.id !== operationId);
}

function updatePendingMessageOperation(queue: PendingMessageOperation[], operationId: string, patch: Partial<PendingMessageOperation>) {
  return queue.map((operation) => operation.id === operationId ? { ...operation, ...patch } : operation);
}

interface MessageStore {
  messages: Message[];
  messageWindowsByChatId: Record<string, CachedMessageWindow>;
  pendingOperations: PendingMessageOperation[];
  activeChatId: string | null;
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMore: boolean;

  hydrateMessagesFromCache: (chatId: string) => Promise<void>;
  openChatWindow: (chatId: string, options?: { limit?: number; revalidate?: boolean }) => Promise<void>;
  closeChatWindow: (chatId: string, options?: { clearActiveOnly?: boolean }) => void;
  prefetchMessages: (chatId: string, options?: { limit?: number }) => Promise<void>;
  hasMessageWindow: (chatId: string) => boolean;
  loadMessages: (chatId: string, options?: { append?: boolean; before?: number; limit?: number }) => Promise<void>;
  addMessage: (msg: Omit<Message, 'id' | 'timestamp' | 'isDeleted'> & { timestamp?: number }) => Promise<Message>;
  upsertMessage: (message: Message) => void;
  upsertMessages: (messages: Message[]) => void;
  queueMessageSync: (message: Message) => void;
  flushPendingOperations: () => Promise<void>;
  discardFailedOperation: (operationId: string) => void;
  retryFailedOperations: () => void;
  clearChatMessagesLocal: (chatId: string) => void;
  deleteMessage: (id: string) => Promise<void>;
  deleteLastNMessages: (chatId: string, n: number) => Promise<void>;
  clearMessages: () => void;
  getRecentMessages: (n: number) => Message[];
  getSyncScopeStates: () => SyncScopeSnapshot[];
}

export const useMessageStore = create<MessageStore>()(
  persist(
    (set, get) => {
      const flushPendingOperations = async () => {
        await runPendingOperationQueue<PendingMessageOperation>({
          getOperations: () => get().pendingOperations,
          canRun: canAttemptOnlineSync,
          retryDelays: MESSAGE_SYNC_DELAYS,
          priority: pendingMessageOperationPriority,
          updateOperation: (operationId, operation) => {
            set((current) => ({
              pendingOperations: updatePendingMessageOperation(current.pendingOperations, operationId, operation),
            }));
          },
          execute: async (operation) => {
            if (operation.kind === 'create' && operation.payload) {
              const localMessage = operation.payload;
              const savedMessage = await api.createMessage(localMessage.chatId, messagePayloadForCloud(localMessage, operation.id));
              const persistedMessage = mergeMessageServerConfirmation(localMessage, savedMessage);
              set((current) => ({
                ...localUpsertMessage(current, persistedMessage),
                pendingOperations: removePendingMessageOperation(current.pendingOperations, operation.id),
              }));
              if (hasLocalDataUrlMedia(localMessage)) {
                await uploadLocalMessageMediaToCloud({ localMessage, cloudMessage: persistedMessage });
              }
            }
          },
          onSuccess: (operation) => {
            set((current) => ({
              pendingOperations: removePendingMessageOperation(current.pendingOperations, operation.id),
            }));
          },
          scheduleNext: (delay) => messageSyncScheduler.schedule(flushPendingOperations, delay),
        });
      };

      if (!messageSyncLifecycleRegistered) {
        messageSyncScheduler.registerLifecycle(flushPendingOperations, 300);
        messageSyncLifecycleRegistered = true;
      }

      return {
        messages: [],
      messageWindowsByChatId: {},
      pendingOperations: [],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,

      hydrateMessagesFromCache: (chatId) => {
        const applyCachedWindow = () => {
          set((state) => localHydratedMessages(state, chatId));
        };
        if (messageStoreHydrated) {
          applyCachedWindow();
          return Promise.resolve();
        }
        return ensureMessageStoreHydrated().then(applyCachedWindow);
      },

      openChatWindow: async (chatId: string, options?: { limit?: number; revalidate?: boolean }) => {
        await ensureMessageStoreHydrated();
        if (!shouldSkipCloudSync()) messageSyncScheduler.schedule(flushPendingOperations, 100);
        await get().hydrateMessagesFromCache(chatId);
        const currentWindow = get().messageWindowsByChatId[chatId];
        const shouldRevalidate = shouldRevalidateMessageWindow(currentWindow?.lastSyncedAt, options?.revalidate ?? true);
        if (!get().hasMessageWindow(chatId) || shouldRevalidate) {
          await get().loadMessages(chatId, { limit: options?.limit ?? DEFAULT_MESSAGE_WINDOW_LIMIT });
        }
      },

      closeChatWindow: (chatId: string, options?: { clearActiveOnly?: boolean }) => {
        if (options?.clearActiveOnly) {
          set((state) => ({
            activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
            messages: state.activeChatId === chatId ? [] : state.messages,
            hasMore: state.activeChatId === chatId ? false : state.hasMore,
          }));
          return;
        }
        get().clearChatMessagesLocal(chatId);
      },

      prefetchMessages: async (chatId: string, options?: { limit?: number }) => {
        await ensureMessageStoreHydrated();
        if (get().messageWindowsByChatId[chatId]?.messages?.length) return;
        await get().loadMessages(chatId, { limit: options?.limit ?? DEFAULT_MESSAGE_WINDOW_LIMIT });
      },

      hasMessageWindow: (chatId: string) => Boolean(get().messageWindowsByChatId[chatId]?.messages?.length),

      loadMessages: async (chatId, options) => {
        const isAppend = Boolean(options?.append);
        set({ isLoading: !isAppend, isLoadingOlder: isAppend, activeChatId: chatId });
        if (shouldSkipCloudSync()) {
          set((state) => localFetchedMessages(state, chatId, options));
          return;
        }
        try {
          await uploadGuestMessagesToCloud();
          const limit = options?.limit ?? DEFAULT_MESSAGE_WINDOW_LIMIT;
          const currentWindowBeforeFetch = get().messageWindowsByChatId[chatId];
          const canProbeWindow = !isAppend && !options?.before && Boolean(currentWindowBeforeFetch?.messages?.length);
          if (canProbeWindow && messageSyncScopes.isFresh(messageWindowScope(chatId))) {
            const activeMessages = activeMessageWindow(currentWindowBeforeFetch?.messages || [], limit);
            set((state) => ({
              activeChatId: chatId,
              messages: state.activeChatId === chatId && state.messages.some((message) => message.chatId === chatId)
                ? state.messages
                : activeMessages,
              isLoading: false,
              isLoadingOlder: false,
              hasMore: canLoadMoreFromWindow(currentWindowBeforeFetch, activeMessages, limit),
            }));
            return;
          }
          const changeProbe = canProbeWindow ? await probeMessageWindowChanges(chatId) : null;
          if (changeProbe?.status === 'not_modified') {
            const activeMessages = activeMessageWindow(currentWindowBeforeFetch?.messages || [], limit);
            messageSyncScopes.markChecked(messageWindowScope(chatId), {
              cursor: changeProbe.cursor,
              revision: changeProbe.revision,
              applied: false,
            });
            set((state) => ({
              activeChatId: chatId,
              messages: state.activeChatId === chatId && state.messages.some((message) => message.chatId === chatId)
                ? state.messages
                : activeMessages,
              isLoading: false,
              isLoadingOlder: false,
              hasMore: canLoadMoreFromWindow(currentWindowBeforeFetch, activeMessages, limit),
            }));
            return;
          }
          const fetchedFromChanges = messagesFromWindowChanges(changeProbe?.changes, chatId);
          const fetched = fetchedFromChanges
            || await api.getMessages(chatId, { limit, before: options?.before }) as unknown as Message[];
          set((state) => {
            const currentWindow = state.messageWindowsByChatId[chatId];
            const current = currentWindow?.messages || [];
            const activeMessagesForChat = state.messages.filter((message) => message.chatId === chatId);
            const activeCurrent = activeMessagesForChat.length ? activeMessagesForChat : activeMessageWindow(current, limit);
            const merged = mergeMessages(current, fetched);
            const trimmed = trimMessages(merged);
            const mergedActiveMessages = mergeMessages(activeCurrent, fetched);
            const nextActiveMessages = isAppend
              ? trimActiveMessages(mergedActiveMessages)
              : activeMessageWindow(mergedActiveMessages, limit);
            const currentVisibleCount = countUniqueMessages(activeCurrent);
            const nextVisibleCount = countUniqueMessages(nextActiveMessages);
            const addedOlderMessages = nextVisibleCount > currentVisibleCount;
            const remoteExhausted = fetchedFromChanges
              ? Boolean(currentWindow?.remoteExhausted)
              : isAppend
                ? fetched.length < limit || !addedOlderMessages
                : fetched.length < limit;
            const nextHasMore = isAppend
              ? !remoteExhausted
              : canLoadMoreFromWindow({ ...(currentWindow || { messages: [] as Message[], lastSyncedAt: 0, updatedAt: 0 }), messages: trimmed, remoteExhausted }, nextActiveMessages, limit);
            const nextCache = trimCache({
              ...state.messageWindowsByChatId,
              [chatId]: {
                messages: trimmed,
                lastSyncedAt: Date.now(),
                updatedAt: trimmed.at(-1)?.timestamp || currentWindow?.updatedAt || Date.now(),
                remoteExhausted,
              },
            }, state.pendingOperations);
            if (!isAppend && !options?.before) {
              messageSyncScopes.markChecked(messageWindowScope(chatId), {
                cursor: changeProbe?.cursor,
                revision: changeProbe?.revision,
                applied: fetched.length > 0,
              });
            }
            return {
              messages: state.activeChatId === chatId ? nextActiveMessages : state.messages,
              activeChatId: chatId,
              messageWindowsByChatId: nextCache,
              isLoading: false,
              isLoadingOlder: false,
              hasMore: nextHasMore,
            };
          });
        } catch (error) {
          if (!isAppend && !options?.before) messageSyncScopes.markError(messageWindowScope(chatId), error);
          reportRecoverableError({
            location: 'cloud-sync:messages-load',
            error,
            userMessage: '消息云同步失败，请检查网络后重试。',
            extra: { chatId },
          });
          set((state) => ({
            ...(isAppend ? {} : localFetchedMessages(state, chatId)),
            isLoading: false,
            isLoadingOlder: false,
          }));
        }
      },

      addMessage: async (msgData) => {
        let created: Message | null = null;
        set((state) => {
          const next = localMessageInsertResult(state, msgData);
          created = next.message;
          const pendingOperations = shouldSkipCloudSync()
            ? state.pendingOperations
            : upsertPendingCreateOperation(state.pendingOperations, next.message);
          return {
            ...next,
            pendingOperations,
          };
        });
        if (!shouldSkipCloudSync()) messageSyncScheduler.schedule(flushPendingOperations, 120);
        return created as unknown as Message;
      },

      upsertMessage: (message) => {
        set((state) => {
          const currentWindow = state.messageWindowsByChatId[message.chatId];
          const current = currentWindow?.messages || [];
          const nextChatMessages = trimMessages(mergeMessages(current, [message]));
          const nextActiveMessages = trimActiveMessages(mergeMessages(state.messages, [message]));
          return {
            messages: state.activeChatId === message.chatId ? nextActiveMessages : state.messages,
            messageWindowsByChatId: trimCache({
              ...state.messageWindowsByChatId,
              [message.chatId]: {
                messages: nextChatMessages,
                lastSyncedAt: Date.now(),
                updatedAt: message.timestamp,
              },
            }, state.pendingOperations),
          };
        });
      },

      upsertMessages: (nextMessages) => {
        if (!nextMessages.length) return;
        set((state) => {
          const messagesByChatId = new Map<string, Message[]>();
          for (const message of nextMessages) {
            messagesByChatId.set(message.chatId, [...(messagesByChatId.get(message.chatId) || []), message]);
          }

          let nextCache = state.messageWindowsByChatId;
          for (const [chatId, chatMessages] of messagesByChatId.entries()) {
            const currentWindow = nextCache[chatId];
            const current = currentWindow?.messages || [];
            const merged = trimMessages(mergeMessages(current, chatMessages));
            nextCache = {
              ...nextCache,
              [chatId]: {
                messages: merged,
                lastSyncedAt: Date.now(),
                updatedAt: Math.max(...chatMessages.map((message) => message.timestamp), currentWindow?.updatedAt || 0, Date.now()),
              },
            };
          }

          const activeMessages = messagesByChatId.get(state.activeChatId || '') || [];
          return {
            messages: activeMessages.length ? trimActiveMessages(mergeMessages(state.messages, activeMessages)) : state.messages,
            messageWindowsByChatId: trimCache(nextCache, state.pendingOperations),
          };
        });
      },

      queueMessageSync: (message) => {
        if (shouldSkipCloudSync()) return;
        const normalized = normalizeMessage({
          ...message,
          clientKey: message.clientKey || message.id,
        });
        set((state) => ({
          ...localUpsertMessage(state, normalized),
          pendingOperations: upsertPendingCreateOperation(state.pendingOperations, normalized),
        }));
        messageSyncScheduler.schedule(flushPendingOperations, 120);
      },

      flushPendingOperations,

      discardFailedOperation: (operationId) => set((state) => {
        const operation = state.pendingOperations.find((item) => item.id === operationId);
        if (operation?.status !== 'failed') return {};
        return { pendingOperations: removePendingMessageOperation(state.pendingOperations, operationId) };
      }),
      retryFailedOperations: () => set((state) => {
        const pendingOperations = retryFailedOperations(state.pendingOperations);
        if (pendingOperations === state.pendingOperations) return {};
        return { pendingOperations };
      }),

      clearChatMessagesLocal: (chatId) => {
        set((state) => {
          const nextWindows = { ...state.messageWindowsByChatId };
          delete nextWindows[chatId];
          return {
            messages: state.activeChatId === chatId ? [] : state.messages,
            messageWindowsByChatId: trimCache(nextWindows, state.pendingOperations),
            hasMore: state.activeChatId === chatId ? false : state.hasMore,
          };
        });
      },

      deleteMessage: async (id) => {
        if (shouldSkipCloudSync()) {
          set((state) => localMessageDeletionResult(state, id));
          return;
        }
        const targetMessage = get().messages.find((message) => message.id === id)
          || Object.values(get().messageWindowsByChatId).flatMap((window) => window.messages).find((message) => message.id === id);
        await api.deleteMessage(targetMessage?.serverId || targetMessage?.id || id);
        set((state) => {
          const nextWindows = Object.fromEntries(
            Object.entries(state.messageWindowsByChatId).map(([chatId, window]) => {
              const nextMessages = window.messages.map((message) => (message.id === id ? { ...message, isDeleted: true } : message));
              return [chatId, { ...window, messages: nextMessages }];
            })
          );
          return {
            messages: state.messages.map((m) => (m.id === id ? { ...m, isDeleted: true } : m)),
            messageWindowsByChatId: trimCache(nextWindows, state.pendingOperations),
          };
        });
      },

      deleteLastNMessages: async (chatId, n) => {
        if (shouldSkipCloudSync()) {
          set((state) => localMessageDeleteBatchResult(state, chatId, n));
          return;
        }
        const msgs = get().messages.filter((m) => m.chatId === chatId && !m.isDeleted).slice(-n);
        for (const msg of msgs) {
          await api.deleteMessage(msg.serverId || msg.id);
        }
        set((state) => {
          const nextMessages = state.messages.map((m) => (
            msgs.find((dm) => dm.id === m.id) ? { ...m, isDeleted: true } : m
          ));
          const currentWindow = state.messageWindowsByChatId[chatId];
          const nextChatMessages = (currentWindow?.messages || []).map((m) => (
            msgs.find((dm) => dm.id === m.id) ? { ...m, isDeleted: true } : m
          ));
          return {
            messages: nextMessages,
            messageWindowsByChatId: trimCache({
              ...state.messageWindowsByChatId,
              [chatId]: {
                messages: nextChatMessages,
                lastSyncedAt: Date.now(),
                updatedAt: nextChatMessages.at(-1)?.timestamp || currentWindow?.updatedAt || Date.now(),
              },
            }, state.pendingOperations),
          };
        });
      },

      clearMessages: () => set({ messages: [], activeChatId: null, hasMore: true }),

      getRecentMessages: (n) => {
        return get().messages.filter((m) => !m.isDeleted).slice(-n);
      },
      getSyncScopeStates: () => messageSyncScopes.listStates(),
      };
    },
    {
      name: getMessageStoreStorageName(),
      storage: messageStorage,
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => {
        const migrated = migrateMessageStoreState(
          persistedState as PersistedMessageState & { messages?: Array<Record<string, unknown>>; messageWindowsByChatId?: Record<string, { messages?: Array<Record<string, unknown>> }> }
        ) as Partial<PersistedMessageState>;
        return {
          messageWindowsByChatId: migrated.messageWindowsByChatId || {},
          pendingOperations: migrated.pendingOperations || [],
        } satisfies PersistedMessageState;
      },
      partialize: (state: MessageStore) => buildPersistedMessageState({
        messageWindowsByChatId: state.messageWindowsByChatId,
        pendingOperations: state.pendingOperations,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedMessageState>;
        const pendingOperations = persisted.pendingOperations || [];
        return {
          ...currentState,
          messageWindowsByChatId: trimCache(persisted.messageWindowsByChatId || {}, pendingOperations),
          pendingOperations,
        };
      },
      skipHydration: true,
    }
  )
);
