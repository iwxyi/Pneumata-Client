import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GroupChat } from '../types/chat';
import { normalizeConversation } from '../types/chat';
import { api } from '../services/api';
import { projectEntities, type SyncPatchOperation } from '../services/syncProjector';
import { buildWarmState } from './storeWarmHelpers';
import { createScopedBufferedJsonStorage, createScopedStorage } from './storePersistenceScope';
import { createSyncScheduler } from './storeSyncScheduler';
import { createGuestUploadFlag } from './storeGuestUpload';
import { CLIENT_STORE_SCHEMA_VERSION, migrateChatStoreState } from './storeMigrations';
import { isRuntimeMemoryMonitorEnabled, recordRuntimeMemory } from '../services/runtimeMemoryMonitor';
import {
  canAttemptOnlineSync,
  classifySyncError,
  createPendingOperation,
  latestSyncError,
  removePendingOperation,
  shouldSkipCloudSync,
  updatePendingOperation,
} from './storeSyncHelpers';

function createLocalChatId() {
  return `local-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyLocalChatCreate(chatData: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) {
  const now = Date.now();
  return normalizeConversation({
    ...chatData,
    id: createLocalChatId(),
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  } as GroupChat);
}

function applyLocalChatUpdate(chat: GroupChat, updates: Partial<GroupChat>) {
  return normalizeConversation({
    ...chat,
    ...updates,
    updatedAt: Date.now(),
    lastMessageAt: updates.lastMessageAt ?? chat.lastMessageAt,
  });
}

function applyLocalChatDelete(chat: GroupChat) {
  return normalizeConversation({
    ...chat,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

function applyLocalChatRestore(chat: GroupChat) {
  return normalizeConversation({
    ...chat,
    deletedAt: null,
    updatedAt: Date.now(),
  });
}

function applyLocalChatPurge(chats: GroupChat[], ids: string[]) {
  const normalizedIds = new Set(ids);
  return chats.filter((chat) => !normalizedIds.has(chat.id));
}

function applyLocalEmptyDeletedChats(chats: GroupChat[]) {
  return chats.filter((chat) => chat.deletedAt == null);
}

const guestChatUploadFlag = createGuestUploadFlag<GroupChat>('miragetea-guest-chats-upload-pending');

function migrateGuestChatsToCloud(chats: GroupChat[]) {
  guestChatUploadFlag.write(chats);
}

function clearGuestChatUploadFlag() {
  guestChatUploadFlag.clear();
}

function readGuestChatUploadFlag(): GroupChat[] {
  return guestChatUploadFlag.read();
}

async function flushGuestChatsToCloud(addChatRemote: (chat: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>) {
  const pending = readGuestChatUploadFlag();
  if (!pending.length) return;
  for (const chat of pending) {
    await addChatRemote({
      ...chat,
      sourceChatId: chat.sourceChatId || null,
      sourceMemberIds: chat.sourceMemberIds || [],
    });
  }
  clearGuestChatUploadFlag();
}

async function createChatRemote(chatData: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) {
  const result = await api.createChat({
    type: chatData.type,
    mode: chatData.mode,
    modeConfig: chatData.modeConfig,
    modeState: chatData.modeState,
    name: chatData.name,
    topic: chatData.topic,
    style: chatData.style,
    memberIds: chatData.memberIds,
    speed: chatData.speed,
    isActive: chatData.isActive,
    allowIntervention: chatData.allowIntervention,
    showRoleActions: chatData.showRoleActions,
    topicSeed: chatData.topicSeed,
    sourceChatId: chatData.sourceChatId,
    sourceMemberIds: chatData.sourceMemberIds,
    runtimeSeed: chatData.runtimeSeed,
    layeredMemories: chatData.layeredMemories,
    runtimeTimeline: chatData.runtimeTimeline,
    runtimeEventsV2: chatData.runtimeEventsV2,
    relationshipLedger: chatData.relationshipLedger,
    governance: chatData.governance,
    dramaRules: chatData.dramaRules,
    worldState: chatData.worldState,
    directorControls: chatData.directorControls,
  });
  return normalizeConversation(result as unknown as GroupChat);
}

interface PendingChatOperation extends SyncPatchOperation<Record<string, unknown>> {
  kind: 'patch';
  targetIds: string[];
}

interface PersistedChatState {
  chats: GroupChat[];
  currentChatId: string | null;
  lastSyncedAt: number;
  pendingOperations: PendingChatOperation[];
}

const CHAT_RUNTIME_PERSIST_LIMITS = {
  layeredMemories: 80,
  runtimeSeedNotes: 40,
  runtimeSeedArtifacts: 40,
  runtimeTimeline: 80,
  runtimeEventsV2: 120,
  relationshipLedger: 120,
};

function takeRecentItems<T>(items: T[] | undefined, limit: number): T[] {
  if (!Array.isArray(items)) return [];
  return items.length > limit ? items.slice(-limit) : items;
}

function compactRuntimeSeedForPersistence(runtimeSeed: GroupChat['runtimeSeed']): GroupChat['runtimeSeed'] {
  return {
    notes: takeRecentItems(runtimeSeed?.notes, CHAT_RUNTIME_PERSIST_LIMITS.runtimeSeedNotes),
    artifacts: takeRecentItems(runtimeSeed?.artifacts, CHAT_RUNTIME_PERSIST_LIMITS.runtimeSeedArtifacts),
  };
}

function compactChatRuntimeFieldsForPersistence<T extends Partial<GroupChat>>(chat: T): T {
  return {
    ...chat,
    ...(chat.layeredMemories !== undefined ? {
      layeredMemories: takeRecentItems(chat.layeredMemories, CHAT_RUNTIME_PERSIST_LIMITS.layeredMemories),
    } : {}),
    ...(chat.runtimeSeed !== undefined ? {
      runtimeSeed: compactRuntimeSeedForPersistence(chat.runtimeSeed),
    } : {}),
    ...(chat.runtimeTimeline !== undefined ? {
      runtimeTimeline: takeRecentItems(chat.runtimeTimeline, CHAT_RUNTIME_PERSIST_LIMITS.runtimeTimeline),
    } : {}),
    ...(chat.runtimeEventsV2 !== undefined ? {
      runtimeEventsV2: takeRecentItems(chat.runtimeEventsV2, CHAT_RUNTIME_PERSIST_LIMITS.runtimeEventsV2),
    } : {}),
    ...(chat.relationshipLedger !== undefined ? {
      relationshipLedger: takeRecentItems(chat.relationshipLedger, CHAT_RUNTIME_PERSIST_LIMITS.relationshipLedger),
    } : {}),
  };
}

function compactChatPatchForCloud(patch: PendingChatOperation['patch']) {
  if (!patch || typeof patch !== 'object') return {};
  const nextPatch = compactChatRuntimeFieldsForPersistence({ ...patch } as Partial<GroupChat>) as Record<string, unknown>;
  delete nextPatch.updatedAt;
  delete nextPatch.lastMessageAt;
  return nextPatch;
}

function buildPersistedChatState(state: PersistedChatState): PersistedChatState {
  if (shouldSkipCloudSync()) return state;
  if (isRuntimeMemoryMonitorEnabled()) {
    recordRuntimeMemory('chat-store:partialize:start', {
      extra: {
        chatCount: state.chats.length,
        pendingOperationCount: state.pendingOperations.length,
      },
    });
  }
  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const persisted = {
    chats: state.chats.map((chat) => normalizeConversation({
      ...compactChatRuntimeFieldsForPersistence(chat),
    } as GroupChat)),
    currentChatId: state.currentChatId,
    lastSyncedAt: state.lastSyncedAt,
    pendingOperations: state.pendingOperations
      .map((operation) => ({
        ...operation,
        patch: compactChatPatchForCloud(operation.patch),
      }))
      .filter((operation) => Object.keys(operation.patch || {}).length > 0),
  };
  if (isRuntimeMemoryMonitorEnabled()) {
    recordRuntimeMemory('chat-store:partialize:finish', {
      extra: {
        chatCount: persisted.chats.length,
        pendingOperationCount: persisted.pendingOperations.length,
        elapsedMs: typeof performance !== 'undefined' ? Math.round((performance.now() - startedAt) * 10) / 10 : 0,
      },
    });
  }
  return persisted;
}

interface ChatStore extends PersistedChatState {
  isLoading: boolean;
  pendingEditSyncCount: number;
  pendingEditSyncError: string | null;
  loadChats: () => Promise<void>;
  prefetchChats: () => Promise<void>;
  flushPendingOperations: () => Promise<void>;
  queuePatch: (entityId: string, patch: Record<string, unknown>, kind?: PendingChatOperation['kind']) => void;
  loadProjectedDeletedChats: () => Promise<GroupChat[]>;
  loadProjectedChats: () => Promise<GroupChat[]>;
  loadProjectedState: () => Promise<void>;
  getPendingOperations: () => PendingChatOperation[];
  getPendingEditError: () => string | null;
  getPendingEditCount: () => number;
  clearPendingOperations: () => void;
  loadPendingSnapshot: () => Promise<GroupChat[]>;
  loadProjectedRecycleBin: () => Promise<GroupChat[]>;
  hydrateProjectedState: () => void;
  resumeSync: () => void;
  syncPatch: (entityId: string, patch: Record<string, unknown>, kind?: PendingChatOperation['kind']) => Promise<void>;
  loadProjectedVisibleChats: () => Promise<GroupChat[]>;
  addChat: (chat: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>;
  updateChat: (id: string, updates: Partial<GroupChat>) => Promise<void>;
  applyChatRuntimeDelta: (id: string, delta: NonNullable<import('../types/chat').DriverMessageCommitTransition['chatRuntimeDelta']>, patch?: Partial<GroupChat>) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  restoreChats: (ids: string[]) => Promise<void>;
  purgeChats: (ids: string[]) => Promise<void>;
  emptyDeletedChats: () => Promise<void>;
  loadDeletedChats: () => Promise<GroupChat[]>;
  setCurrentChat: (id: string | null) => void;
  getCurrentChat: () => GroupChat | undefined;
  getChat: (id: string) => GroupChat | undefined;
  hasChatLoaded: (id: string) => boolean;
  getChatsLoadedAt: () => number;
  markChatsWarm: () => void;
}

function getUserId() {
  const userRaw = localStorage.getItem('miragetea-user');
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getChatStorageKey() {
  return `mirageTea-chats-${getUserId()}`;
}

function getLegacyChatStorageKey() {
  return 'mirageTea-chats';
}

function createChatStorage() {
  return createScopedStorage({
    getScopedKey: getChatStorageKey,
    legacyKey: getLegacyChatStorageKey(),
  });
}

function normalizeChats(items: GroupChat[]) {
  return items.map((item) => normalizeConversation(item));
}

function sortChats(chats: GroupChat[]) {
  return [...chats].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function applyRuntimeEventsDelta(chat: GroupChat, delta: NonNullable<import('../types/chat').DriverMessageCommitTransition['chatRuntimeDelta']>['runtimeEventsV2']) {
  if (!delta) return chat.runtimeEventsV2 || [];
  const byId = new Map((chat.runtimeEventsV2 || []).map((item) => [item.id, item] as const));
  delta.upserts.forEach((item) => byId.set(item.id, item));
  return delta.orderedIds.map((id) => byId.get(id)).filter(Boolean) as NonNullable<GroupChat['runtimeEventsV2']>;
}

function applyRelationshipLedgerDelta(chat: GroupChat, delta: NonNullable<import('../types/chat').DriverMessageCommitTransition['chatRuntimeDelta']>['relationshipLedger']) {
  if (!delta) return chat.relationshipLedger || [];
  const byKey = new Map((chat.relationshipLedger || []).map((item) => [item.pairKey, item] as const));
  delta.upserts.forEach((item) => byKey.set(item.pairKey, item));
  return delta.orderedPairKeys.map((key) => byKey.get(key)).filter(Boolean) as NonNullable<GroupChat['relationshipLedger']>;
}

function applyLocalChatRuntimeDelta(
  chat: GroupChat,
  delta: NonNullable<import('../types/chat').DriverMessageCommitTransition['chatRuntimeDelta']>,
  patch: Partial<GroupChat> = {},
) {
  return applyLocalChatUpdate(chat, {
    ...patch,
    ...(delta.runtimeEventsV2 ? { runtimeEventsV2: applyRuntimeEventsDelta(chat, delta.runtimeEventsV2) } : {}),
    ...(delta.relationshipLedger ? { relationshipLedger: applyRelationshipLedgerDelta(chat, delta.relationshipLedger) } : {}),
  });
}

function mergeChats(localChats: GroupChat[], remoteChats: GroupChat[], pendingOperations: PendingChatOperation[] = []) {
  const merged = new Map<string, GroupChat>();

  for (const chat of normalizeChats(localChats)) merged.set(chat.id, chat);

  for (const remote of normalizeChats(remoteChats)) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) merged.set(remote.id, remote);
  }

  return sortChats(projectEntities(Array.from(merged.values()), pendingOperations));
}

function mergeVisibleChats(localChats: GroupChat[], remoteChats: GroupChat[], pendingOperations: PendingChatOperation[] = []) {
  return mergeChats(localChats, remoteChats, pendingOperations).filter((chat) => chat.deletedAt == null);
}

function mergeDeletedChats(localChats: GroupChat[], remoteChats: GroupChat[], pendingOperations: PendingChatOperation[] = []) {
  return mergeChats(localChats, remoteChats, pendingOperations).filter((chat) => chat.deletedAt != null);
}

async function fetchChatSnapshot() {
  const result = await api.getChats() as unknown as GroupChat[];
  return normalizeChats(result);
}

async function fetchDeletedChatSnapshot() {
  const result = await api.getDeletedChats() as unknown as Record<string, unknown>[];
  return result.map((item) => normalizeConversation(item as unknown as GroupChat));
}

async function reloadProjectedChatState(pendingOperations: PendingChatOperation[]) {
  const [active, deleted] = await Promise.all([fetchChatSnapshot(), fetchDeletedChatSnapshot()]);
  return {
    visible: mergeVisibleChats([], active, pendingOperations),
    deleted: mergeDeletedChats([], [...active, ...deleted], pendingOperations),
  };
}

async function reloadVisibleChatState(pendingOperations: PendingChatOperation[]) {
  const active = await fetchChatSnapshot();
  return mergeVisibleChats([], active, pendingOperations);
}

function projectVisibleChats(chats: GroupChat[], pendingOperations: PendingChatOperation[]) {
  return projectEntities(chats, pendingOperations).filter((item) => item.deletedAt == null);
}

const latestChatError = latestSyncError;
const createPendingChatOperation = createPendingOperation<Record<string, unknown>, PendingChatOperation>;
const removePendingChatOperation = removePendingOperation;
const updatePendingChatOperation = updatePendingOperation;
const canSyncChats = canAttemptOnlineSync;
const CHAT_SYNC_DELAYS = [1000, 3000, 10000, 30000];
const CHAT_REFRESH_TTL_MS = 30_000;
const chatSyncScheduler = createSyncScheduler();

function scheduleChatFlush(flush: () => Promise<void>, delay = 0) {
  chatSyncScheduler.schedule(flush, delay);
}

function mergeChatPatchOperations(operations: PendingChatOperation[]) {
  const merged = new Map<string, PendingChatOperation>();
  for (const operation of operations) {
    const cloudPatch = compactChatPatchForCloud(operation.patch);
    if (Object.keys(cloudPatch).length === 0) continue;
    const compactedOperation = {
      ...operation,
      patch: cloudPatch,
    };
    const existing = merged.get(operation.entityId);
    if (!existing) {
      merged.set(operation.entityId, compactedOperation);
      continue;
    }
    merged.set(operation.entityId, {
      ...existing,
      id: compactedOperation.id,
      patch: {
        ...(existing.patch || {}),
        ...(compactedOperation.patch || {}),
      },
      clientTimestamp: compactedOperation.clientTimestamp,
      status: existing.status === 'syncing' ? 'syncing' : compactedOperation.status,
      attemptCount: Math.max(existing.attemptCount || 0, compactedOperation.attemptCount || 0),
      lastError: compactedOperation.lastError || existing.lastError,
      targetIds: compactedOperation.targetIds?.length ? compactedOperation.targetIds : existing.targetIds,
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.clientTimestamp - right.clientTimestamp);
}

async function executeChatOperation(operation: PendingChatOperation) {
  return api.syncChatPatch(operation.entityId, {
    operationId: operation.id,
    clientTimestamp: operation.clientTimestamp,
    patch: operation.patch,
  });
}

async function applyChatRestore(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) return api.restoreChat(normalizedIds[0]);
  await api.bulkRestoreChats(normalizedIds);
}

async function applyChatPurge(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) return api.purgeChat(normalizedIds[0]);
  await api.bulkPurgeChats(normalizedIds);
}

async function applyEmptyDeletedChats() {
  await api.emptyDeletedChats();
}

async function maybeUploadGuestChats(get: () => ChatStore) {
  if (shouldSkipCloudSync()) return;
  const guestKey = 'mirageTea-chats-guest';
  const raw = localStorage.getItem(guestKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { state?: { chats?: GroupChat[] } };
    const guestChats = (parsed.state?.chats || []).filter((chat) => !chat.deletedAt);
    if (!guestChats.length) return;
    migrateGuestChatsToCloud(guestChats);
    await flushGuestChatsToCloud(createChatRemote);
    localStorage.removeItem(guestKey);
    await get().loadChats();
  } catch {
    // ignore malformed guest cache
  }
}

export function clearPersistedChatStore() {
  localStorage.removeItem(getChatStorageKey());
  localStorage.removeItem(getLegacyChatStorageKey());
}

const chatStorage = createScopedBufferedJsonStorage<PersistedChatState>({
  getScopedKey: getChatStorageKey,
  legacyKey: getLegacyChatStorageKey(),
  flushDelayMs: 96,
});
let chatSyncLifecycleRegistered = false;
let chatHydrationPromise: Promise<void> | null = null;

function ensureChatStoreHydrated() {
  if (useChatStore.persist.hasHydrated()) return Promise.resolve();
  chatHydrationPromise ??= Promise.resolve(useChatStore.persist.rehydrate()).finally(() => {
    chatHydrationPromise = null;
  });
  return chatHydrationPromise;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => {
      const flushPendingOperations = async () => {
        const state = get();
        const nextOperation = state.pendingOperations.find((item) => item.status === 'pending');
        if (!nextOperation || !canSyncChats()) return;

        set((current) => ({
          pendingOperations: updatePendingChatOperation(current.pendingOperations, nextOperation.id, { status: 'syncing' }),
        }));

        try {
          await executeChatOperation(nextOperation);
          const nextQueue = removePendingChatOperation(get().pendingOperations, nextOperation.id);
          set((current) => ({
            chats: projectEntities(current.chats, nextQueue).filter((chat) => chat.deletedAt == null),
            pendingOperations: nextQueue,
            pendingEditSyncCount: nextQueue.length,
            pendingEditSyncError: latestChatError(nextQueue),
            lastSyncedAt: Date.now(),
          }));
          scheduleChatFlush(flushPendingOperations, 50);
        } catch (error) {
          const classified = classifySyncError(error);
          const attemptCount = nextOperation.attemptCount + 1;
          set((current) => ({
            pendingOperations: updatePendingChatOperation(current.pendingOperations, nextOperation.id, {
              status: 'pending',
              attemptCount,
              lastError: classified,
            }),
            pendingEditSyncCount: current.pendingOperations.length,
            pendingEditSyncError: classified,
          }));
          scheduleChatFlush(flushPendingOperations, CHAT_SYNC_DELAYS[Math.min(attemptCount, CHAT_SYNC_DELAYS.length - 1)]);
        }
      };

      if (!chatSyncLifecycleRegistered) {
        chatSyncScheduler.registerLifecycle(flushPendingOperations, 300);
        chatSyncLifecycleRegistered = true;
      }

      return {
        chats: [],
        currentChatId: null,
        lastSyncedAt: 0,
        pendingOperations: [],
        pendingEditSyncCount: 0,
        pendingEditSyncError: null,
        isLoading: false,

        loadChats: async () => {
          await ensureChatStoreHydrated();
          set((state) => ({
            ...buildWarmState({
              items: state.chats,
              projectVisible: (items) => projectVisibleChats(items, state.pendingOperations),
              pendingEditSyncCount: state.pendingOperations.length,
              pendingEditSyncError: latestChatError(state.pendingOperations),
              isLoading: state.chats.length === 0,
            }),
            chats: projectVisibleChats(state.chats, state.pendingOperations),
          }));
          if (shouldSkipCloudSync()) {
            set({ isLoading: false });
            return;
          }
          try {
            await maybeUploadGuestChats(get);
            const visible = await reloadVisibleChatState(get().pendingOperations);
            set({
              chats: visible,
              isLoading: false,
              lastSyncedAt: Date.now(),
              pendingEditSyncCount: get().pendingOperations.length,
              pendingEditSyncError: latestChatError(get().pendingOperations),
            });
          } catch (error) {
            set({ isLoading: false, pendingEditSyncError: classifySyncError(error) });
          }
        },

        prefetchChats: async () => {
          const state = get();
          if (state.chats.length > 0 && Date.now() - state.lastSyncedAt < CHAT_REFRESH_TTL_MS) return;
          void get().loadChats();
        },

        getChat: (id) => get().chats.find((chat) => chat.id === id),
        hasChatLoaded: (id) => Boolean(get().chats.find((chat) => chat.id === id)),
        getChatsLoadedAt: () => get().lastSyncedAt,
        markChatsWarm: () => {
          set((state) => ({
            ...buildWarmState({
              items: state.chats,
              projectVisible: (items) => projectVisibleChats(items, state.pendingOperations),
              pendingEditSyncCount: state.pendingOperations.length,
              pendingEditSyncError: latestChatError(state.pendingOperations),
              isLoading: state.isLoading,
            }),
            chats: projectVisibleChats(state.chats, state.pendingOperations),
          }));
        },

        flushPendingOperations,

        queuePatch: (entityId, patch, kind = 'patch') => {
          const cloudPatch = compactChatPatchForCloud(patch);
          const operation = Object.keys(cloudPatch).length > 0
            ? createPendingChatOperation({ kind, targetIds: entityId ? [entityId] : [], patch: cloudPatch })
            : null;
          set((state) => {
            const pendingOperations = operation
              ? mergeChatPatchOperations([...state.pendingOperations, operation])
              : mergeChatPatchOperations(state.pendingOperations);
            if (isRuntimeMemoryMonitorEnabled()) {
              recordRuntimeMemory('chat-store:queue-patch', {
                chatId: entityId,
                chat: state.chats.find((chat) => chat.id === entityId) || null,
                extra: {
                  kind,
                  patchKeys: Object.keys(patch || {}),
                  cloudPatchKeys: Object.keys(cloudPatch || {}),
                  pendingOperationCount: pendingOperations.length,
                  pendingOperationsJson: (() => {
                    try {
                      return JSON.stringify(pendingOperations).length;
                    } catch {
                      return -1;
                    }
                  })(),
                  patchJson: (() => {
                    try {
                      return JSON.stringify(patch).length;
                    } catch {
                      return -1;
                    }
                  })(),
                  cloudPatchJson: (() => {
                    try {
                      return JSON.stringify(cloudPatch).length;
                    } catch {
                      return -1;
                    }
                  })(),
                },
              });
            }
            return {
              pendingOperations,
              chats: state.chats.map((chat) => chat.id === entityId ? applyLocalChatUpdate(chat, patch as Partial<GroupChat>) : chat),
              pendingEditSyncCount: pendingOperations.length,
              pendingEditSyncError: latestChatError(pendingOperations),
            };
          });
          if (operation) scheduleChatFlush(flushPendingOperations, 120);
        },

        loadProjectedDeletedChats: async () => {
          const { deleted } = await reloadProjectedChatState(get().pendingOperations);
          return deleted;
        },
        loadProjectedChats: async () => {
          return reloadVisibleChatState(get().pendingOperations);
        },
        loadProjectedState: async () => { await get().loadChats(); },
        getPendingOperations: () => get().pendingOperations,
        getPendingEditError: () => latestChatError(get().pendingOperations),
        getPendingEditCount: () => get().pendingOperations.length,
        clearPendingOperations: () => set({ pendingOperations: [], pendingEditSyncCount: 0, pendingEditSyncError: null }),
        loadPendingSnapshot: async () => get().loadProjectedChats(),
        loadProjectedRecycleBin: async () => get().loadProjectedDeletedChats(),
        hydrateProjectedState: () => set((state) => ({ chats: projectVisibleChats(state.chats, state.pendingOperations) })),
        resumeSync: () => scheduleChatFlush(flushPendingOperations, 100),
        syncPatch: async (entityId, patch, kind = 'patch') => {
          get().queuePatch(entityId, patch, kind);
        },
        loadProjectedVisibleChats: async () => projectVisibleChats(get().chats, get().pendingOperations),

        addChat: async (chatData) => {
          if (shouldSkipCloudSync()) {
            const chat = applyLocalChatCreate(chatData);
            set((state) => ({
              chats: [chat, ...state.chats.filter((item) => item.id !== chat.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
              currentChatId: chat.id,
            }));
            return chat;
          }
          const chat = await createChatRemote(chatData);
          set((state) => ({
            chats: [chat, ...state.chats.filter((item) => item.id !== chat.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
            lastSyncedAt: Date.now(),
          }));
          return chat;
        },

        updateChat: async (id, updates) => {
          if (shouldSkipCloudSync()) {
            set((state) => ({
              chats: state.chats.map((chat) => chat.id === id ? applyLocalChatUpdate(chat, updates) : chat),
            }));
            return;
          }
          if (Object.keys(compactChatPatchForCloud(updates as Record<string, unknown>)).length === 0) {
            set((state) => ({
              chats: state.chats.map((chat) => chat.id === id ? applyLocalChatUpdate(chat, updates) : chat),
            }));
            return;
          }
          await get().syncPatch(id, updates, 'patch');
        },

        applyChatRuntimeDelta: async (id, delta, patch = {}) => {
          set((state) => ({
            chats: state.chats.map((chat) => chat.id === id ? applyLocalChatRuntimeDelta(chat, delta, patch) : chat),
          }));
        },

        deleteChat: async (id) => {
          if (!id) return;
          if (shouldSkipCloudSync()) {
            set((state) => ({
              chats: state.chats.map((chat) => chat.id === id ? applyLocalChatDelete(chat) : chat).filter((chat) => chat.deletedAt == null),
              currentChatId: state.currentChatId === id ? null : state.currentChatId,
            }));
            return;
          }
          await api.deleteChat(id);
          const projectedState = await reloadProjectedChatState(get().pendingOperations);
          set((state) => ({
            chats: projectedState.visible,
            currentChatId: state.currentChatId === id ? null : state.currentChatId,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestChatError(get().pendingOperations),
          }));
        },

        restoreChats: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          if (shouldSkipCloudSync()) {
            set((state) => ({
              chats: state.chats.map((chat) => normalizedIds.includes(chat.id) ? applyLocalChatRestore(chat) : chat).filter((chat) => chat.deletedAt == null),
            }));
            return;
          }
          await applyChatRestore(normalizedIds);
          const projectedState = await reloadProjectedChatState(get().pendingOperations);
          set({
            chats: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestChatError(get().pendingOperations),
          });
        },

        purgeChats: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          if (shouldSkipCloudSync()) {
            set((state) => ({ chats: applyLocalChatPurge(state.chats, normalizedIds) }));
            return;
          }
          await applyChatPurge(normalizedIds);
          const projectedState = await reloadProjectedChatState(get().pendingOperations);
          set({
            chats: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestChatError(get().pendingOperations),
          });
        },

        emptyDeletedChats: async () => {
          if (shouldSkipCloudSync()) {
            set((state) => ({ chats: applyLocalEmptyDeletedChats(state.chats) }));
            return;
          }
          await applyEmptyDeletedChats();
          const projectedState = await reloadProjectedChatState(get().pendingOperations);
          set({
            chats: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestChatError(get().pendingOperations),
          });
        },

        loadDeletedChats: async () => {
          const { deleted } = await reloadProjectedChatState(get().pendingOperations);
          return deleted;
        },

        setCurrentChat: (id) => set({ currentChatId: id }),
        getCurrentChat: () => get().chats.find((chat) => chat.id === get().currentChatId),
      };
    },
    {
      name: getLegacyChatStorageKey(),
      storage: chatStorage,
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => migrateChatStoreState(persistedState as PersistedChatState) as PersistedChatState,
      partialize: (state) => buildPersistedChatState({
        chats: state.chats,
        currentChatId: state.currentChatId,
        lastSyncedAt: state.lastSyncedAt,
        pendingOperations: state.pendingOperations,
      }),
      skipHydration: true,
    }
  )
);

export const __chatRuntimePersistenceForTests = {
  compactChatPatchForCloud,
  buildPersistedChatState,
  limits: CHAT_RUNTIME_PERSIST_LIMITS,
};
