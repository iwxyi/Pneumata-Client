import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GroupChat } from '../types/chat';
import { normalizeConversation } from '../types/chat';
import { api } from '../services/api';
import { projectEntities, type SyncPatchOperation } from '../services/syncProjector';
import { useAuthStore } from './useAuthStore';

function isLocalOnlyMode() {
  return useAuthStore.getState().authMode === 'local';
}

function createLocalChatId() {
  return `local-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shouldSkipCloudSync() {
  return isLocalOnlyMode();
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

function migrateGuestChatsToCloud(chats: GroupChat[]) {
  localStorage.setItem('miragetea-guest-chats-upload-pending', JSON.stringify(chats));
}

function clearGuestChatUploadFlag() {
  localStorage.removeItem('miragetea-guest-chats-upload-pending');
}

function readGuestChatUploadFlag(): GroupChat[] {
  try {
    const raw = localStorage.getItem('miragetea-guest-chats-upload-pending');
    return raw ? (JSON.parse(raw) as GroupChat[]) : [];
  } catch {
    return [];
  }
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

interface ChatStore extends PersistedChatState {
  isLoading: boolean;
  pendingEditSyncCount: number;
  pendingEditSyncError: string | null;
  loadChats: () => Promise<void>;
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
  deleteChat: (id: string) => Promise<void>;
  restoreChats: (ids: string[]) => Promise<void>;
  purgeChats: (ids: string[]) => Promise<void>;
  emptyDeletedChats: () => Promise<void>;
  loadDeletedChats: () => Promise<GroupChat[]>;
  setCurrentChat: (id: string | null) => void;
  getCurrentChat: () => GroupChat | undefined;
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
  return {
    getItem: (name: string) => {
      const scopedName = getChatStorageKey();
      const legacyName = getLegacyChatStorageKey();
      if (name !== legacyName) return localStorage.getItem(name);
      return localStorage.getItem(scopedName) ?? localStorage.getItem(legacyName);
    },
    setItem: (name: string, value: string) => {
      const scopedName = getChatStorageKey();
      const legacyName = getLegacyChatStorageKey();
      if (name !== legacyName) {
        localStorage.setItem(name, value);
        return;
      }
      localStorage.setItem(scopedName, value);
      localStorage.removeItem(legacyName);
    },
    removeItem: (name: string) => {
      const scopedName = getChatStorageKey();
      const legacyName = getLegacyChatStorageKey();
      if (name !== legacyName) {
        localStorage.removeItem(name);
        return;
      }
      localStorage.removeItem(scopedName);
      localStorage.removeItem(legacyName);
    },
  };
}

function normalizeChats(items: GroupChat[]) {
  return items.map((item) => normalizeConversation(item));
}

function sortChats(chats: GroupChat[]) {
  return [...chats].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function mergeChats(localChats: GroupChat[], remoteChats: GroupChat[], pendingOperations: PendingChatOperation[] = []) {
  const merged = new Map<string, GroupChat>();

  for (const chat of normalizeChats(localChats)) {
    merged.set(chat.id, chat);
  }

  for (const remote of normalizeChats(remoteChats)) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      merged.set(remote.id, remote);
    }
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

function classifySyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|登录已过期|未登录/i.test(message)) return `auth: ${message}`;
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) return `network: ${message}`;
  if (/500|502|503|504|服务器错误/i.test(message)) return `server_unavailable: ${message}`;
  if (/404|不存在|未删除/i.test(message)) return `conflict_ignored: ${message}`;
  return `validation: ${message}`;
}

function latestChatError(queue: PendingChatOperation[]) {
  return [...queue].reverse().find((item) => item.lastError)?.lastError || null;
}

function projectVisibleChats(chats: GroupChat[], pendingOperations: PendingChatOperation[]) {
  return projectEntities(chats, pendingOperations).filter((item) => item.deletedAt == null);
}

function projectDeletedChats(chats: GroupChat[], pendingOperations: PendingChatOperation[]) {
  return projectEntities(chats, pendingOperations).filter((item) => item.deletedAt != null);
}

function createPendingChatOperation(kind: PendingChatOperation['kind'], targetIds: string[] = [], patch: Record<string, unknown> = {}, timestamp = Date.now()): PendingChatOperation {
  return {
    id: `${kind}-${timestamp}-${targetIds[0] || 'all'}`,
    kind,
    entityId: targetIds[0] || '',
    patch,
    targetIds,
    clientTimestamp: timestamp,
    attemptCount: 0,
    status: 'pending',
    lastError: undefined,
  };
}

function removePendingChatOperation(queue: PendingChatOperation[], operationId: string) {
  return queue.filter((item) => item.id !== operationId);
}

function updatePendingChatOperation(queue: PendingChatOperation[], operationId: string, patch: Partial<PendingChatOperation>) {
  return queue.map((item) => item.id === operationId ? { ...item, ...patch } : item);
}

let chatSyncTimer: ReturnType<typeof setTimeout> | null = null;
const CHAT_SYNC_DELAYS = [1000, 3000, 10000, 30000];

function scheduleChatFlush(flush: () => Promise<void>, delay = 0) {
  if (chatSyncTimer) clearTimeout(chatSyncTimer);
  chatSyncTimer = setTimeout(() => { void flush(); }, delay);
}

function canSyncChats() {
  return !shouldSkipCloudSync() && (typeof navigator === 'undefined' || navigator.onLine);
}

async function executeChatOperation(operation: PendingChatOperation) {
  return api.syncChatPatch(operation.entityId, {
    operationId: operation.id,
    clientTimestamp: operation.clientTimestamp,
    patch: operation.patch,
  });
}

async function applyChatDelete(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) {
    await api.deleteChat(normalizedIds[0]);
    return;
  }
  await api.bulkDeleteChats(normalizedIds);
}

async function applyChatRestore(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) {
    await api.restoreChat(normalizedIds[0]);
    return;
  }
  await api.bulkRestoreChats(normalizedIds);
}

async function applyChatPurge(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) {
    await api.purgeChat(normalizedIds[0]);
    return;
  }
  await api.bulkPurgeChats(normalizedIds);
}

async function applyEmptyDeletedChats() {
  await api.emptyDeletedChats();
}

export function clearPersistedChatStore() {
  localStorage.removeItem(getChatStorageKey());
  localStorage.removeItem(getLegacyChatStorageKey());
}

const chatStorage = createChatStorage();
let chatSyncLifecycleRegistered = false;

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
          const remoteChats = await api.getChats() as unknown as GroupChat[];
          const nextQueue = removePendingChatOperation(get().pendingOperations, nextOperation.id);
          set({
            chats: mergeChats(get().chats, remoteChats, nextQueue),
            pendingOperations: nextQueue,
            pendingEditSyncCount: nextQueue.length,
            pendingEditSyncError: latestChatError(nextQueue),
            lastSyncedAt: Date.now(),
          });
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

      if (!chatSyncLifecycleRegistered && typeof window !== 'undefined') {
        window.addEventListener('online', () => scheduleChatFlush(flushPendingOperations, 300));
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') scheduleChatFlush(flushPendingOperations, 300);
        });
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
          set((state) => ({ isLoading: state.chats.length === 0 }));
          if (shouldSkipCloudSync()) {
            set((state) => ({
              chats: projectVisibleChats(state.chats, state.pendingOperations),
              isLoading: false,
              pendingEditSyncCount: state.pendingOperations.length,
              pendingEditSyncError: latestChatError(state.pendingOperations),
            }));
            return;
          }
          try {
            await maybeUploadGuestChats(get);
            const projectedState = await reloadProjectedChatState(get().pendingOperations);
            set({
              chats: projectedState.visible,
              isLoading: false,
              lastSyncedAt: Date.now(),
              pendingEditSyncCount: get().pendingOperations.length,
              pendingEditSyncError: latestChatError(get().pendingOperations),
            });
          } catch (error) {
            set({ isLoading: false, pendingEditSyncError: classifySyncError(error) });
          }
        },

        flushPendingOperations,

        queuePatch: (entityId, patch, kind = 'patch') => {
          const operation = createPendingChatOperation(kind, entityId ? [entityId] : [], patch);
          set((state) => {
            const pendingOperations = [...state.pendingOperations, operation];
            return {
              pendingOperations,
              chats: projectEntities(state.chats, [operation]),
              pendingEditSyncCount: pendingOperations.length,
              pendingEditSyncError: latestChatError(pendingOperations),
            };
          });
          scheduleChatFlush(flushPendingOperations, 50);
        },

        loadProjectedDeletedChats: async () => {
          const { deleted } = await reloadProjectedChatState(get().pendingOperations);
          return deleted;
        },
        loadProjectedChats: async () => {
          const { visible } = await reloadProjectedChatState(get().pendingOperations);
          return visible;
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
          await get().syncPatch(id, updates, 'patch');
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
            set((state) => ({
              chats: applyLocalChatPurge(state.chats, normalizedIds),
              currentChatId: normalizedIds.includes(state.currentChatId || '') ? null : state.currentChatId,
            }));
            return;
          }
          await applyChatPurge(normalizedIds);
          const projectedState = await reloadProjectedChatState(get().pendingOperations);
          set((state) => ({
            chats: projectedState.visible,
            currentChatId: normalizedIds.includes(state.currentChatId || '') ? null : state.currentChatId,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestChatError(get().pendingOperations),
          }));
        },

        emptyDeletedChats: async () => {
          if (shouldSkipCloudSync()) {
            set((state) => ({
              chats: applyLocalEmptyDeletedChats(state.chats),
              currentChatId: state.chats.some((chat) => chat.id === state.currentChatId && chat.deletedAt == null) ? state.currentChatId : null,
            }));
            return;
          }
          await applyEmptyDeletedChats();
          const projectedState = await reloadProjectedChatState(get().pendingOperations);
          set((state) => ({
            chats: projectedState.visible,
            currentChatId: projectedState.visible.some((chat) => chat.id === state.currentChatId) ? state.currentChatId : null,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestChatError(get().pendingOperations),
          }));
        },

        loadDeletedChats: async () => get().loadProjectedDeletedChats(),
        setCurrentChat: (id) => set({ currentChatId: id }),
        getCurrentChat: () => {
          const { chats, currentChatId } = get();
          return chats.find((c) => c.id === currentChatId);
        },
      };
    },
    {
      name: 'mirageTea-chats',
      storage: chatStorage as never,
      partialize: ((state: ChatStore) => ({
        chats: state.chats,
        currentChatId: state.currentChatId,
        lastSyncedAt: state.lastSyncedAt,
        pendingOperations: state.pendingOperations,
      })) as never,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<PersistedChatState>),
        chats: projectVisibleChats(
          Array.isArray((persistedState as Partial<PersistedChatState>)?.chats)
            ? normalizeChats((persistedState as Partial<PersistedChatState>).chats || [])
            : [],
          Array.isArray((persistedState as Partial<PersistedChatState>)?.pendingOperations)
            ? (persistedState as Partial<PersistedChatState>).pendingOperations || []
            : []
        ),
        pendingOperations: Array.isArray((persistedState as Partial<PersistedChatState>)?.pendingOperations)
          ? (persistedState as Partial<PersistedChatState>).pendingOperations || []
          : [],
      }),
    }
  )
);
