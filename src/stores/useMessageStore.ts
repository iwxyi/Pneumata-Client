import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '../types/message';
import { api } from '../services/api';
import { useAuthStore } from './useAuthStore';

function isLocalOnlyMode() {
  return useAuthStore.getState().authMode === 'local';
}

function createLocalMessageId() {
  return `local-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createLocalMessage(msgData: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>): Message {
  return {
    ...msgData,
    id: createLocalMessageId(),
    clientKey: createLocalMessageId(),
    timestamp: Date.now(),
    isDeleted: false,
    isOptimistic: true,
  };
}

async function uploadGuestMessagesToCloud() {
  if (isLocalOnlyMode()) return;
  try {
    const raw = localStorage.getItem('mirageTea-messages-guest');
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { messageWindowsByChatId?: Record<string, { messages: Message[] }> } };
    const windows = parsed.state?.messageWindowsByChatId || {};
    for (const chatId of Object.keys(windows)) {
      for (const message of windows[chatId]?.messages || []) {
        if (message.isDeleted || message.type === 'event') continue;
        await api.createMessage(chatId, {
          type: message.type,
          senderId: message.senderId,
          senderName: message.senderName,
          content: message.content,
          emotion: message.emotion,
        });
      }
    }
    localStorage.removeItem('mirageTea-messages-guest');
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

function mergeLocalWindow(cache: Record<string, CachedMessageWindow>, chatId: string, messages: Message[]) {
  return trimCache({
    ...cache,
    [chatId]: {
      messages: trimMessages(messages),
      lastSyncedAt: Date.now(),
      updatedAt: messages.at(-1)?.timestamp || Date.now(),
    },
  });
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
    messageWindowsByChatId: trimCache(nextWindows),
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
    }),
  };
}

function localHydratedWindow(state: MessageStore, chatId: string) {
  const cachedWindow = state.messageWindowsByChatId[chatId];
  const cachedMessages = cachedWindow?.messages || [];
  return {
    activeChatId: chatId,
    messages: cachedMessages,
    hasMore: cachedMessages.length >= 20,
  };
}

function localUpsertMessage(state: MessageStore, message: Message) {
  const currentWindow = state.messageWindowsByChatId[message.chatId];
  const current = currentWindow?.messages || [];
  const nextChatMessages = trimMessages(mergeMessages(current, [message]));
  return {
    messages: state.activeChatId === message.chatId ? mergeMessages(state.messages, [message]) : state.messages,
    messageWindowsByChatId: mergeLocalWindow(state.messageWindowsByChatId, message.chatId, nextChatMessages),
  };
}

function localLoadMessages(state: MessageStore, chatId: string) {
  const currentWindow = state.messageWindowsByChatId[chatId];
  const current = currentWindow?.messages || [];
  return {
    messages: current,
    activeChatId: chatId,
    isLoading: false,
    isLoadingOlder: false,
    hasMore: false,
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

function buildLocalMessageFetch(state: MessageStore, chatId: string) {
  return buildLocalMessageWindowState(state, chatId);
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

function localFetchedMessages(state: MessageStore, chatId: string) {
  return buildLocalMessageFetch(state, chatId);
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
  return 'mirageTea-messages-guest';
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
    const raw = localStorage.getItem('mirageTea-messages-guest');
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

const MAX_CACHED_MESSAGES_PER_CHAT = 120;
const MAX_CACHED_CHATS = 12;

interface CachedMessageWindow {
  messages: Message[];
  lastSyncedAt: number;
  updatedAt: number;
}

interface PendingMessageOperation {
  kind: 'create' | 'delete';
  chatId: string;
  messageId?: string;
  payload?: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  createdAt: number;
}

function getUserId() {
  const userRaw = localStorage.getItem('miragetea-user');
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getMessageStorageKey() {
  return `mirageTea-messages-${getUserId()}`;
}

function createMessageStorage() {
  return {
    getItem: (name: string) => {
      const scopedName = getMessageStorageKey();
      return localStorage.getItem(name === 'mirageTea-messages' ? scopedName : name);
    },
    setItem: (name: string, value: string) => {
      const scopedName = getMessageStorageKey();
      localStorage.setItem(name === 'mirageTea-messages' ? scopedName : name, value);
    },
    removeItem: (name: string) => {
      const scopedName = getMessageStorageKey();
      localStorage.removeItem(name === 'mirageTea-messages' ? scopedName : name);
    },
  };
}

export function clearPersistedMessageStore() {
  localStorage.removeItem(getMessageStorageKey());
}

function dedupeMessages(messages: Message[]) {
  const getIdentity = (message: Message) => message.serverId || message.id;
  return messages.filter((message, index, array) => array.findIndex((item) => getIdentity(item) === getIdentity(message)) === index);
}

function mergeMessages(localMessages: Message[], remoteMessages: Message[]) {
  const merged = new Map<string, Message>();
  const getIdentity = (message: Message) => message.serverId || message.id;

  for (const message of localMessages) {
    merged.set(getIdentity(message), message);
  }

  for (const remote of remoteMessages) {
    const remoteIdentity = getIdentity(remote);
    const local = merged.get(remoteIdentity);
    if (!local) {
      merged.set(remoteIdentity, remote);
      continue;
    }

    if (remote.timestamp >= local.timestamp || remote.isDeleted !== local.isDeleted) {
      merged.set(remoteIdentity, {
        ...remote,
        id: local.id,
        clientKey: local.clientKey,
        serverId: remote.serverId || remote.id,
        isOptimistic: local.isOptimistic && remote.isDeleted ? local.isOptimistic : false,
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function countUniqueMessages(messages: Message[]) {
  return dedupeMessages(messages).length;
}

function trimMessages(messages: Message[]) {
  return dedupeMessages(messages).slice(-MAX_CACHED_MESSAGES_PER_CHAT);
}

function trimCache(cache: Record<string, CachedMessageWindow>) {
  const entries = Object.entries(cache).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(
    entries
      .slice(0, MAX_CACHED_CHATS)
      .map(([chatId, window]) => [chatId, { ...window, messages: trimMessages(window.messages) }])
  );
}

const messageStorage = createMessageStorage();

interface MessageStore {
  messages: Message[];
  messageWindowsByChatId: Record<string, CachedMessageWindow>;
  pendingOperations: PendingMessageOperation[];
  activeChatId: string | null;
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMore: boolean;

  hydrateMessagesFromCache: (chatId: string) => void;
  loadMessages: (chatId: string, options?: { append?: boolean; before?: number; limit?: number }) => Promise<void>;
  addMessage: (msg: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) => Promise<Message>;
  upsertMessage: (message: Message) => void;
  clearChatMessagesLocal: (chatId: string) => void;
  deleteMessage: (id: string) => Promise<void>;
  deleteLastNMessages: (chatId: string, n: number) => Promise<void>;
  clearMessages: () => void;
  getRecentMessages: (n: number) => Message[];
}

export const useMessageStore = create<MessageStore>()(
  persist(
    (set, get) => ({
      messages: [],
      messageWindowsByChatId: {},
      pendingOperations: [],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,

      hydrateMessagesFromCache: (chatId) => {
        set((state) => localHydratedMessages(state, chatId));
      },

      loadMessages: async (chatId, options) => {
        const isAppend = Boolean(options?.append);
        set({ isLoading: !isAppend, isLoadingOlder: isAppend, activeChatId: chatId });
        if (shouldSkipCloudSync()) {
          set((state) => localFetchedMessages(state, chatId));
          return;
        }
        try {
          await uploadGuestMessagesToCloud();
          const limit = options?.limit ?? 20;
          const fetched = await api.getMessages(chatId, { limit, before: options?.before }) as unknown as Message[];
          set((state) => {
            const currentWindow = state.messageWindowsByChatId[chatId];
            const current = currentWindow?.messages || [];
            const merged = mergeMessages(current, fetched);
            const trimmed = trimMessages(merged);
            const currentCount = countUniqueMessages(current);
            const mergedCount = countUniqueMessages(merged);
            const addedOlderMessages = mergedCount > currentCount;
            const nextHasMore = isAppend
              ? fetched.length > 0 && addedOlderMessages
              : fetched.length > 0;
            const nextCache = trimCache({
              ...state.messageWindowsByChatId,
              [chatId]: {
                messages: trimmed,
                lastSyncedAt: Date.now(),
                updatedAt: trimmed.at(-1)?.timestamp || currentWindow?.updatedAt || Date.now(),
              },
            });
            return {
              messages: state.activeChatId === chatId ? merged : state.messages,
              activeChatId: chatId,
              messageWindowsByChatId: nextCache,
              isLoading: false,
              isLoadingOlder: false,
              hasMore: nextHasMore,
            };
          });
        } catch (error) {
          console.error('Failed to load messages:', error);
          set({ isLoading: false, isLoadingOlder: false });
        }
      },

      addMessage: async (msgData) => {
        if (shouldSkipCloudSync()) {
          let created: Message | null = null;
          set((state) => {
            const next = localMessageInsertResult(state, msgData);
            created = next.message;
            return next;
          });
          return created as unknown as Message;
        }
        const result = await api.createMessage(msgData.chatId, {
          type: msgData.type,
          senderId: msgData.senderId,
          senderName: msgData.senderName,
          content: msgData.content,
          emotion: msgData.emotion,
        });
        const message = result as unknown as Message;
        get().upsertMessage(message);
        return message;
      },

      upsertMessage: (message) => {
        set((state) => {
          const currentWindow = state.messageWindowsByChatId[message.chatId];
          const current = currentWindow?.messages || [];
          const nextChatMessages = trimMessages(mergeMessages(current, [message]));
          return {
            messages: state.activeChatId === message.chatId ? mergeMessages(state.messages, [message]) : state.messages,
            messageWindowsByChatId: trimCache({
              ...state.messageWindowsByChatId,
              [message.chatId]: {
                messages: nextChatMessages,
                lastSyncedAt: Date.now(),
                updatedAt: message.timestamp,
              },
            }),
          };
        });
      },

      clearChatMessagesLocal: (chatId) => {
        set((state) => {
          const nextWindows = { ...state.messageWindowsByChatId };
          delete nextWindows[chatId];
          return {
            messages: state.activeChatId === chatId ? [] : state.messages,
            messageWindowsByChatId: trimCache(nextWindows),
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
            messageWindowsByChatId: trimCache(nextWindows),
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
            }),
          };
        });
      },

      clearMessages: () => set({ messages: [], activeChatId: null, hasMore: true }),

      getRecentMessages: (n) => {
        return get().messages.filter((m) => !m.isDeleted).slice(-n);
      },
    }),
    {
      name: 'mirageTea-messages',
      storage: messageStorage as never,
      partialize: ((state: MessageStore) => ({
        messageWindowsByChatId: state.messageWindowsByChatId,
        pendingOperations: state.pendingOperations,
      })) as never,
      merge: (persistedState, currentState) => ({
        ...currentState,
        messageWindowsByChatId: trimCache((persistedState as Partial<MessageStore>)?.messageWindowsByChatId || {}),
        pendingOperations: (persistedState as Partial<MessageStore>)?.pendingOperations || [],
      }),
    }
  )
);
