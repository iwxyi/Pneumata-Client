import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GroupChat } from '../types/chat';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import { api, type SyncChangeScope } from '../services/api';
import { reportRecoverableError, reportRecoverableWarning } from '../services/diagnostics';
import { projectEntities, type SyncPatchOperation } from '../services/syncProjector';
import { clearResolvedFieldConflicts, detectPendingFieldConflicts, type FieldConflictRecord } from '../services/syncConflictRecords';
import { buildWarmState } from './storeWarmHelpers';
import { createScopedIndexedDbBufferedJsonStorage, createScopedIndexedDbStorage } from './storePersistenceScope';
import { createSyncScheduler } from './storeSyncScheduler';
import { createSyncScopeMetadata, type SyncScopeSnapshot } from './syncScopeMetadata';
import { createGuestUploadFlag } from './storeGuestUpload';
import { CLIENT_STORE_SCHEMA_VERSION, migrateChatStoreState } from './storeMigrations';
import { isRuntimeMemoryMonitorEnabled, recordRuntimeMemory } from '../services/runtimeMemoryMonitor';
import { scopedStorageKey, storageKey } from '../constants/brand';
import { getLocalDataUserId } from '../services/authStorageScope';
import {
  canAttemptOnlineSync,
  classifySyncError,
  createPendingOperation,
  getPendingQueueWorkerPriority,
  latestSyncError,
  recoverInterruptedOperations,
  removePendingOperation,
  retryFailedOperations,
  runPendingOperationQueue,
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

function createConflictCopyChatData(chat: GroupChat): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    lastMessageAt: _lastMessageAt,
    deletedAt: _deletedAt,
    fieldVersions: _fieldVersions,
    latestMessage: _latestMessage,
    runtimeDetailLoaded: _runtimeDetailLoaded,
    worldRuntimeLoaded: _worldRuntimeLoaded,
    ...data
  } = chat;
  return {
    ...data,
    name: `${chat.name || '未命名聊天'}（本地副本）`,
    sourceChatId: chat.sourceChatId || chat.id,
    sourceMemberIds: chat.sourceMemberIds?.length ? chat.sourceMemberIds : chat.memberIds,
    deletedAt: null,
  };
}

function applyLocalEmptyDeletedChats(chats: GroupChat[]) {
  return chats.filter((chat) => chat.deletedAt == null);
}

const guestChatUploadFlag = createGuestUploadFlag<GroupChat>(
  storageKey('guest-chats-upload-pending'),
);

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

type ChatCreatePayload = Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> & { id?: string; operationId?: string };

async function createChatRemote(chatData: ChatCreatePayload) {
  const result = await api.createChat({
    id: chatData.id,
    operationId: chatData.operationId,
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
  kind: 'create' | 'patch';
  targetIds: string[];
}

function pendingChatOperationPriority(operation: PendingChatOperation) {
  if (operation.kind === 'create') return 100;
  if ('deletedAt' in operation.patch) return 80;
  return 10;
}

interface PersistedChatState {
  chats: GroupChat[];
  currentChatId: string | null;
  lastSyncedAt: number;
  pendingOperations: PendingChatOperation[];
  fieldConflicts?: FieldConflictRecord[];
}

const CHAT_RUNTIME_PERSIST_LIMITS = {
  layeredMemories: 80,
  runtimeSeedNotes: 40,
  runtimeSeedArtifacts: 40,
  runtimeTimeline: 80,
  runtimeEventsV2: 120,
  relationshipLedger: 120,
};
const MAX_PERSISTED_DATA_URL_CHARS = 2048;

function isInlineDataUrl(value: string) {
  return /^data:[^;]+;base64,/i.test(value);
}

function shouldDropPersistedString(key: string, value: string) {
  const normalizedKey = key.toLowerCase();
  return isInlineDataUrl(value) && (value.length > MAX_PERSISTED_DATA_URL_CHARS || normalizedKey.includes('dataurl') || normalizedKey === 'url' || normalizedKey.endsWith('url'));
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
      runtimeEventsV2: stripLargeInlineMediaForPersistence(takeRecentItems(chat.runtimeEventsV2, CHAT_RUNTIME_PERSIST_LIMITS.runtimeEventsV2)),
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
    pendingOperations: recoverInterruptedOperations(state.pendingOperations)
      .map((operation) => ({
        ...operation,
        patch: compactChatPatchForCloud(operation.patch),
      }))
      .filter((operation) => Object.keys(operation.patch || {}).length > 0),
    fieldConflicts: state.fieldConflicts || [],
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
  remoteDeletedChatIds: string[];
  remoteDeletedChats: GroupChat[];
  fieldConflicts: FieldConflictRecord[];
  loadChats: () => Promise<void>;
  loadChat: (id: string) => Promise<GroupChat | null>;
  loadWorldRuntime: () => Promise<void>;
  prefetchChats: () => Promise<void>;
  prefetchWorldRuntime: () => Promise<void>;
  refreshChatSummaryFromCloud: () => Promise<void>;
  flushPendingOperations: () => Promise<void>;
  queuePatch: (entityId: string, patch: Record<string, unknown>, kind?: PendingChatOperation['kind']) => void;
  loadProjectedDeletedChats: () => Promise<GroupChat[]>;
  loadProjectedChats: () => Promise<GroupChat[]>;
  loadProjectedState: () => Promise<void>;
  getPendingOperations: () => PendingChatOperation[];
  getPendingEditError: () => string | null;
  getPendingEditCount: () => number;
  clearPendingOperations: () => void;
  confirmCreateOperationsSynced: (entityIds: string[]) => void;
  discardFailedOperation: (operationId: string) => void;
  resolveRemoteDeleteConflict: (id: string, resolution: 'restore_local' | 'discard_local' | 'save_as_new') => Promise<void>;
  retryFailedOperations: () => void;
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
  getSyncScopeStates: () => SyncScopeSnapshot[];
  markChatsWarm: () => void;
}

function getUserId() {
  return getLocalDataUserId();
}

function getChatStorageKey() {
  return scopedStorageKey(`chats-${getUserId()}`);
}

function getChatStoreStorageName() {
  return scopedStorageKey('chats');
}

function createChatStorageForKey(key: string) {
  return createScopedIndexedDbStorage({
    getScopedKey: () => key,
    storageName: getChatStoreStorageName(),
  });
}

function normalizeChats(items: GroupChat[]) {
  return items.map((item) => normalizeConversation(item));
}

function sortChats(chats: GroupChat[]) {
  return [...chats].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function getErrorStatus(error: unknown) {
  return typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : null;
}

function getErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : null;
}

function buildChatListSignature(chats: GroupChat[]) {
  return chats
    .map((chat) => [
      chat.id,
      chat.updatedAt || 0,
      chat.lastMessageAt || 0,
      chat.deletedAt || 0,
      chat.latestMessage?.id || '',
      chat.latestMessage?.timestamp || 0,
      chat.latestMessage?.content || '',
      chat.runtimeDetailLoaded ? 1 : 0,
      chat.worldRuntimeLoaded ? 1 : 0,
      chat.runtimeEventsV2?.at(-1)?.id || '',
      chat.runtimeEventsV2?.length || 0,
      chat.relationshipLedger?.length || 0,
    ].join(':'))
    .join('|');
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

function mergeChatRecord(local: GroupChat | undefined, remote: GroupChat) {
  if (local && remote.runtimeDetailLoaded !== false && local.updatedAt >= remote.updatedAt) {
    return {
      ...remote,
      id: local.id,
      type: local.type,
      mode: local.mode,
      name: local.name,
      topic: local.topic,
      style: local.style,
      runtimeEvolutionIntensity: local.runtimeEvolutionIntensity,
      memberIds: local.memberIds,
      sourceChatId: local.sourceChatId,
      sourceMemberIds: local.sourceMemberIds,
      speed: local.speed,
      isActive: local.isActive,
      allowIntervention: local.allowIntervention,
      showRoleActions: local.showRoleActions,
      topicSeed: local.topicSeed,
      deletedAt: local.deletedAt,
      fieldVersions: { ...(remote.fieldVersions || {}), ...(local.fieldVersions || {}) },
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      lastMessageAt: local.lastMessageAt,
      worldState: local.worldState,
      latestMessage: local.latestMessage,
      runtimeDetailLoaded: true,
    };
  }
  if (!local || remote.runtimeDetailLoaded !== false || local.runtimeDetailLoaded === false) {
    return remote;
  }
  return {
    ...local,
    id: remote.id,
    type: remote.type,
    mode: remote.mode,
    name: remote.name,
    topic: remote.topic,
    style: remote.style,
    runtimeEvolutionIntensity: remote.runtimeEvolutionIntensity,
    memberIds: remote.memberIds,
    sourceChatId: remote.sourceChatId,
    sourceMemberIds: remote.sourceMemberIds,
    speed: remote.speed,
    isActive: remote.isActive,
    allowIntervention: remote.allowIntervention,
    showRoleActions: remote.showRoleActions,
    topicSeed: remote.topicSeed,
    deletedAt: remote.deletedAt,
    fieldVersions: remote.fieldVersions,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    lastMessageAt: remote.lastMessageAt,
    worldState: remote.worldState,
    latestMessage: remote.latestMessage,
    runtimeDetailLoaded: true,
  };
}

function mergeWorldRuntimeRecord(local: GroupChat | undefined, remote: GroupChat) {
  if (!local || local.runtimeDetailLoaded === false) return remote;
  return {
    ...local,
    worldRuntimeLoaded: true,
    runtimeEventsV2: remote.runtimeEventsV2 || local.runtimeEventsV2,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    lastMessageAt: Math.max(local.lastMessageAt || 0, remote.lastMessageAt || 0),
  };
}

function mergeChats(localChats: GroupChat[], remoteChats: GroupChat[], pendingOperations: PendingChatOperation[] = []) {
  const merged = new Map<string, GroupChat>();

  for (const chat of normalizeChats(localChats)) merged.set(chat.id, chat);

  for (const remote of normalizeChats(remoteChats)) {
    const local = merged.get(remote.id);
    const fillsMissingDetail = Boolean(remote.runtimeDetailLoaded && !local?.runtimeDetailLoaded);
    const fillsMissingWorldRuntime = Boolean(remote.worldRuntimeLoaded && !local?.worldRuntimeLoaded);
    if (!local || remote.updatedAt > local.updatedAt || fillsMissingDetail || fillsMissingWorldRuntime) {
      merged.set(remote.id, normalizeConversation(mergeChatRecord(local, remote)));
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

function hasNonDeletePendingChatOperation(pendingOperations: PendingChatOperation[], chatId: string) {
  return pendingOperations.some((operation) => (
    operation.entityId === chatId
    && operation.patch.deletedAt == null
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeChatSummaryChange(change: Record<string, unknown>) {
  if (change.entity !== 'chat_summary' || typeof change.id !== 'string') return null;
  const patch = isRecord(change.patch) ? change.patch : {};
  const chat = normalizeConversation({
    ...patch,
    id: change.id,
    latestMessage: isRecord(patch.latestMessage) ? patch.latestMessage as unknown as Message : null,
  } as unknown as GroupChat);
  return {
    op: change.op === 'delete' ? 'delete' as const : 'upsert' as const,
    chat,
  };
}

function chatSummariesFromChanges(changes: Array<Record<string, unknown>>) {
  const parsed = changes.map(normalizeChatSummaryChange).filter(Boolean) as Array<ReturnType<typeof normalizeChatSummaryChange> & {}>;
  if (parsed.length !== changes.length) return null;
  return {
    upserts: parsed.filter((item) => item.op === 'upsert').map((item) => item.chat),
    deletes: parsed.filter((item) => item.op === 'delete').map((item) => item.chat),
  };
}

function worldRuntimeChatsFromChanges(changes: Array<Record<string, unknown>> | undefined) {
  if (!changes?.length) return null;
  const chats: GroupChat[] = [];
  for (const change of changes) {
    if (change.entity !== 'world_runtime_chat' || change.op !== 'upsert' || typeof change.id !== 'string' || !isRecord(change.patch)) {
      return null;
    }
    chats.push(normalizeConversation({
      ...change.patch,
      id: change.id,
      runtimeDetailLoaded: false,
      worldRuntimeLoaded: true,
    } as unknown as GroupChat));
  }
  return chats;
}

function chatDetailFromChanges(changes: Array<Record<string, unknown>> | undefined, id: string) {
  if (!changes?.length) return null;
  const change = changes.find((item) => item.entity === 'chat_detail' && item.id === id);
  if (!change) return null;
  if (change.op === 'delete') {
    return normalizeConversation({
      id,
      ...(isRecord(change.patch) ? change.patch : {}),
      deletedAt: isRecord(change.patch) && typeof change.patch.deletedAt === 'number' ? change.patch.deletedAt : Date.now(),
      runtimeDetailLoaded: true,
    } as unknown as GroupChat);
  }
  if (!isRecord(change.patch)) return null;
  return normalizeConversation({
    ...change.patch,
    id,
    runtimeDetailLoaded: true,
  } as unknown as GroupChat);
}

async function fetchChatSnapshot() {
  const result = await api.getChats() as unknown as GroupChat[];
  return normalizeChats(result);
}

async function fetchChatDetail(id: string) {
  const result = await api.getChat(id);
  return normalizeConversation(result as unknown as GroupChat);
}

async function fetchWorldRuntimeSnapshot() {
  const result = await api.getWorldRuntimeChats();
  return normalizeChats(result as unknown as GroupChat[]);
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

async function probeChatScopeChanges(scope: SyncChangeScope, options: { forceFull?: boolean } = {}) {
  const scopeState = chatSyncScopes.getState(scope);
  const since = options.forceFull ? null : scopeState.cursor ?? scopeState.revision ?? null;
  try {
    return await api.getSyncChanges({ scope, since });
  } catch {
    return null;
  }
}

function projectVisibleChats(chats: GroupChat[], pendingOperations: PendingChatOperation[]) {
  return projectEntities(chats, pendingOperations).filter((item) => item.deletedAt == null);
}

function markChatsLoadingIdle(state: ChatStore) {
  if (!state.isLoading) return state;
  return { isLoading: false };
}

function buildProjectedChatStoreState(state: ChatStore, isLoading: boolean) {
  const visibleChats = projectVisibleChats(state.chats, state.pendingOperations);
  const pendingEditSyncCount = state.pendingOperations.length;
  const pendingEditSyncError = latestChatError(state.pendingOperations);
  if (
    state.isLoading === isLoading
    && state.pendingEditSyncCount === pendingEditSyncCount
    && state.pendingEditSyncError === pendingEditSyncError
    && buildChatListSignature(visibleChats) === buildChatListSignature(state.chats)
  ) {
    return state;
  }
  return {
    ...buildWarmState({
      items: state.chats,
      projectVisible: (items) => projectVisibleChats(items, state.pendingOperations),
      pendingEditSyncCount,
      pendingEditSyncError,
      isLoading,
    }),
    chats: visibleChats,
  };
}

function buildWarmChatStoreState(state: ChatStore) {
  return buildProjectedChatStoreState(state, state.chats.length === 0);
}

function buildMarkedWarmChatStoreState(state: ChatStore) {
  return buildProjectedChatStoreState(state, state.isLoading);
}

const latestChatError = latestSyncError;
const createPendingChatOperation = createPendingOperation<Record<string, unknown>, PendingChatOperation>;
const removePendingChatOperation = removePendingOperation;
const updatePendingChatOperation = updatePendingOperation;
const canSyncChats = canAttemptOnlineSync;
const CHAT_SYNC_DELAYS = [1000, 3000, 10000, 30000];
const CHAT_REFRESH_TTL_MS = 30_000;
const CHAT_DETAIL_REFRESH_TTL_MS = 120_000;
const CHAT_SUMMARY_SCOPE: SyncChangeScope = 'chats.summary';
const WORLD_RUNTIME_SCOPE: SyncChangeScope = 'world-runtime.window';
const chatDetailScope = (id: string): SyncChangeScope => `chats.detail:${id}`;
const chatSyncScheduler = createSyncScheduler('chat.pending-operations', {
  priority: () => getPendingQueueWorkerPriority(useChatStore.getState().pendingOperations, 80, pendingChatOperationPriority),
});
const chatScopeSyncScheduler = createSyncScheduler('chat.scope-refresh', { priority: 30 });
const chatSyncScopes = createSyncScopeMetadata(CHAT_REFRESH_TTL_MS, {
  getStorageKey: () => scopedStorageKey(`chat-sync-scopes-${getLocalDataUserId()}`),
});
const requestedChatScopeChecks = new Set<SyncChangeScope>();

function scheduleChatFlush(flush: () => Promise<void>, delay = 0) {
  chatSyncScheduler.schedule(flush, delay);
}

function scheduleChatScopeRefresh(flush: () => Promise<void>, scope: SyncChangeScope, delay = 0) {
  requestedChatScopeChecks.add(scope);
  chatScopeSyncScheduler.schedule(flush, delay);
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
  if (operation.kind === 'create') {
    return createChatRemote({
      ...(operation.patch as ChatCreatePayload),
      id: operation.entityId,
      operationId: operation.id,
    });
  }
  return api.syncChatPatch(operation.entityId, {
    operationId: operation.id,
    clientTimestamp: operation.clientTimestamp,
    patch: operation.patch,
  });
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
  const guestKey = scopedStorageKey('chats-guest');
  const guestStorage = createChatStorageForKey(guestKey);
  const raw = await guestStorage.getItem(getChatStoreStorageName());
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { state?: { chats?: GroupChat[] } };
    const guestChats = (parsed.state?.chats || []).filter((chat) => !chat.deletedAt);
    if (!guestChats.length) return;
    migrateGuestChatsToCloud(guestChats);
    await flushGuestChatsToCloud(createChatRemote);
    await guestStorage.removeItem(getChatStoreStorageName());
    await get().loadChats();
  } catch {
    // ignore malformed guest cache
  }
}

export function clearPersistedChatStore() {
  void useChatStore.persist.clearStorage();
  localStorage.removeItem(getChatStorageKey());
  localStorage.removeItem(getChatStoreStorageName());
  chatSyncScopes.clear();
}

export function resetChatStoreForAccountBoundary() {
  clearPersistedChatStore();
  useChatStore.setState({
    chats: [],
    currentChatId: null,
    lastSyncedAt: 0,
    pendingOperations: [],
    pendingEditSyncCount: 0,
    pendingEditSyncError: null,
    remoteDeletedChatIds: [],
    remoteDeletedChats: [],
    fieldConflicts: [],
    isLoading: false,
  });
}

const chatStorage = createScopedIndexedDbBufferedJsonStorage<PersistedChatState>({
  getScopedKey: getChatStorageKey,
  storageName: getChatStoreStorageName(),
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
        await runPendingOperationQueue<PendingChatOperation>({
          getOperations: () => get().pendingOperations,
          canRun: canSyncChats,
          retryDelays: CHAT_SYNC_DELAYS,
          isTerminalError: (classified) => classified.startsWith('validation:'),
          priority: pendingChatOperationPriority,
          updateOperation: (operationId, operation) => {
            set((current) => ({
              pendingOperations: updatePendingChatOperation(current.pendingOperations, operationId, operation),
            }));
          },
          execute: executeChatOperation,
          onSuccess: (operation) => {
            const nextQueue = removePendingChatOperation(get().pendingOperations, operation.id);
            set((current) => ({
              chats: projectEntities(current.chats, nextQueue).filter((chat) => chat.deletedAt == null),
              pendingOperations: nextQueue,
              fieldConflicts: clearResolvedFieldConflicts(current.fieldConflicts, { entityType: 'chat', operationIds: [operation.id] }),
              pendingEditSyncCount: nextQueue.length,
              pendingEditSyncError: latestChatError(nextQueue),
              lastSyncedAt: Date.now(),
            }));
          },
          onFailure: (_operation, _error, retry) => {
            set((current) => ({
              pendingEditSyncCount: current.pendingOperations.length,
              pendingEditSyncError: retry.classified,
            }));
          },
          scheduleNext: (delay) => scheduleChatFlush(flushPendingOperations, delay),
        });
      };
      const flushRequestedChatScopes = async () => {
        const scopes = Array.from(requestedChatScopeChecks);
        for (const scope of scopes) {
          if (scope === CHAT_SUMMARY_SCOPE) {
            await get().loadChats();
          } else if (scope === WORLD_RUNTIME_SCOPE) {
            await get().loadWorldRuntime();
          }
        }
      };

      if (!chatSyncLifecycleRegistered) {
        chatSyncScheduler.registerLifecycle(flushPendingOperations, 300);
        chatScopeSyncScheduler.registerLifecycle(flushRequestedChatScopes, 600);
        chatSyncLifecycleRegistered = true;
      }

      return {
        chats: [],
        currentChatId: null,
        lastSyncedAt: 0,
        pendingOperations: [],
        pendingEditSyncCount: 0,
        pendingEditSyncError: null,
        remoteDeletedChatIds: [],
        remoteDeletedChats: [],
        fieldConflicts: [],
        isLoading: false,

        loadChats: async () => {
          await ensureChatStoreHydrated();
          set(buildWarmChatStoreState);
          if (shouldSkipCloudSync()) {
            set(markChatsLoadingIdle);
            return;
          }
          if (get().chats.length > 0 && chatSyncScopes.isFresh(CHAT_SUMMARY_SCOPE)) {
            set(markChatsLoadingIdle);
            return;
          }
          return chatSyncScopes.run(CHAT_SUMMARY_SCOPE, async () => {
            try {
              await maybeUploadGuestChats(get);
              const changeProbe = await probeChatScopeChanges(CHAT_SUMMARY_SCOPE, { forceFull: get().chats.length === 0 });
              if (changeProbe?.status === 'not_modified') {
                chatSyncScopes.markChecked(CHAT_SUMMARY_SCOPE, {
                  cursor: changeProbe.cursor,
                  revision: changeProbe.revision,
                  applied: false,
                });
                set(markChatsLoadingIdle);
                return;
              }
              const summaryChanges = changeProbe?.changes?.length ? chatSummariesFromChanges(changeProbe.changes) : null;
              if (summaryChanges) {
                set((state) => {
                  const deleteConflicts = summaryChanges.deletes.filter((chat) => hasNonDeletePendingChatOperation(state.pendingOperations, chat.id));
                  const applicableDeletes = summaryChanges.deletes.filter((chat) => !hasNonDeletePendingChatOperation(state.pendingOperations, chat.id));
                  const changedChats = [...summaryChanges.upserts, ...applicableDeletes];
                  const fieldConflicts = detectPendingFieldConflicts({
                    entityType: 'chat',
                    localEntities: state.chats,
                    remoteEntities: changedChats,
                    pendingOperations: state.pendingOperations,
                    existingConflicts: state.fieldConflicts,
                  });
                  const merged = mergeChats(state.chats, changedChats, state.pendingOperations);
                  const nextChats = merged.filter((chat) => chat.deletedAt == null);
                  const deletedIds = new Set(applicableDeletes.map((chat) => chat.id));
                  const deletedSnapshots = merged.filter((chat) => deletedIds.has(chat.id) && chat.deletedAt != null);
                  const conflictSnapshots = deleteConflicts.map((remote) => state.chats.find((chat) => chat.id === remote.id) || remote);
                  const changed = buildChatListSignature(nextChats) !== buildChatListSignature(state.chats);
                  chatSyncScopes.markChecked(CHAT_SUMMARY_SCOPE, {
                    cursor: changeProbe?.cursor,
                    revision: changeProbe?.revision,
                    applied: changed || deletedSnapshots.length > 0 || conflictSnapshots.length > 0,
                  });
                  return {
                    ...(changed ? { chats: nextChats } : {}),
                    remoteDeletedChatIds: Array.from(new Set([
                      ...state.remoteDeletedChatIds.filter((id) => !summaryChanges.upserts.some((chat) => chat.id === id)),
                      ...deletedSnapshots.map((chat) => chat.id),
                      ...deleteConflicts.map((chat) => chat.id),
                    ])),
                    remoteDeletedChats: [
                      ...conflictSnapshots,
                      ...deletedSnapshots,
                      ...state.remoteDeletedChats
                        .filter((chat) => !summaryChanges.upserts.some((visibleChat) => visibleChat.id === chat.id))
                        .filter((chat) => !conflictSnapshots.some((conflictChat) => conflictChat.id === chat.id))
                        .filter((chat) => !deletedSnapshots.some((deletedChat) => deletedChat.id === chat.id)),
                    ],
                    fieldConflicts,
                    isLoading: false,
                    lastSyncedAt: Date.now(),
                    pendingEditSyncCount: state.pendingOperations.length,
                    pendingEditSyncError: latestChatError(state.pendingOperations),
                  };
                });
                return;
              }
              const visible = await reloadVisibleChatState(get().pendingOperations);
              set((state) => ({
                ...(() => {
                  const nextChats = mergeVisibleChats(state.chats, visible, state.pendingOperations);
                  const changed = buildChatListSignature(nextChats) !== buildChatListSignature(state.chats);
                  chatSyncScopes.markChecked(CHAT_SUMMARY_SCOPE, {
                    cursor: changeProbe?.cursor,
                    revision: changeProbe?.revision,
                    applied: changed,
                  });
                  return changed ? { chats: nextChats } : {};
                })(),
                remoteDeletedChatIds: state.remoteDeletedChatIds.filter((id) => !visible.some((chat) => chat.id === id)),
                remoteDeletedChats: state.remoteDeletedChats.filter((chat) => !visible.some((visibleChat) => visibleChat.id === chat.id)),
                isLoading: false,
                lastSyncedAt: Date.now(),
                pendingEditSyncCount: get().pendingOperations.length,
                pendingEditSyncError: latestChatError(get().pendingOperations),
              }));
            } catch (error) {
              chatSyncScopes.markError(CHAT_SUMMARY_SCOPE, error);
              reportRecoverableError({
                location: 'cloud-sync:chats-load',
                error,
                userMessage: '聊天云同步失败，请检查网络后重试。',
              });
              set({ isLoading: false, pendingEditSyncError: classifySyncError(error) });
            }
          }, { markCheckedOnSuccess: false });
        },

        loadChat: async (id) => {
          if (!id) return null;
          await ensureChatStoreHydrated();
          const cached = get().chats.find((chat) => chat.id === id);
          if (shouldSkipCloudSync()) return cached || null;
          const scope = chatDetailScope(id);
          if (cached && chatSyncScopes.isFresh(scope, CHAT_DETAIL_REFRESH_TTL_MS)) {
            return cached;
          }
          return chatSyncScopes.run(scope, async () => {
            try {
              const changeProbe = cached?.runtimeDetailLoaded ? await probeChatScopeChanges(scope) : null;
              if (changeProbe?.status === 'not_modified') {
                chatSyncScopes.markChecked(scope, {
                  cursor: changeProbe.cursor,
                  revision: changeProbe.revision,
                  applied: false,
                });
                return cached || null;
              }
              const detail = chatDetailFromChanges(changeProbe?.changes, id) || await fetchChatDetail(id);
              if (detail.deletedAt != null) {
                const snapshot = cached || detail;
                const hasPendingConflict = hasNonDeletePendingChatOperation(get().pendingOperations, id);
                chatSyncScopes.markChecked(scope, {
                  cursor: changeProbe?.cursor,
                  revision: changeProbe?.revision,
                  applied: true,
                });
                set((state) => ({
                  chats: hasPendingConflict ? projectVisibleChats(state.chats, state.pendingOperations) : state.chats.filter((chat) => chat.id !== id),
                  remoteDeletedChatIds: Array.from(new Set([...state.remoteDeletedChatIds, id])),
                  remoteDeletedChats: [snapshot, ...state.remoteDeletedChats.filter((chat) => chat.id !== id)],
                  lastSyncedAt: state.lastSyncedAt || Date.now(),
                  pendingEditSyncCount: state.pendingOperations.length,
                  pendingEditSyncError: latestChatError(state.pendingOperations),
                }));
                return snapshot;
              }
              set((state) => {
                const fieldConflicts = detectPendingFieldConflicts({
                  entityType: 'chat',
                  localEntities: state.chats,
                  remoteEntities: [detail],
                  pendingOperations: state.pendingOperations,
                  existingConflicts: state.fieldConflicts,
                });
                const nextChats = mergeVisibleChats(state.chats, [detail], state.pendingOperations);
                const changed = buildChatListSignature(nextChats) !== buildChatListSignature(state.chats);
                chatSyncScopes.markChecked(scope, {
                  cursor: changeProbe?.cursor,
                  revision: changeProbe?.revision,
                  applied: changed,
                });
                return {
                  ...(changed ? { chats: nextChats } : {}),
                  remoteDeletedChatIds: state.remoteDeletedChatIds.filter((chatId) => chatId !== id),
                  remoteDeletedChats: state.remoteDeletedChats.filter((chat) => chat.id !== id),
                  fieldConflicts,
                  lastSyncedAt: state.lastSyncedAt || Date.now(),
                  pendingEditSyncCount: state.pendingOperations.length,
                  pendingEditSyncError: latestChatError(state.pendingOperations),
                };
              });
              return detail;
            } catch (error) {
              const fallback = get().chats.find((chat) => chat.id === id) || null;
              if (getErrorStatus(error) === 404 && fallback) {
                chatSyncScopes.markChecked(scope, { applied: false });
                return fallback;
              }
              chatSyncScopes.markError(scope, error);
              const diagnostics = {
                chatId: id,
                status: getErrorStatus(error),
                code: getErrorCode(error),
                hasLocalFallback: Boolean(fallback),
                cachedDetailLoaded: Boolean(fallback?.runtimeDetailLoaded),
                pendingOperationCount: get().pendingOperations.filter((operation) => operation.entityId === id).length,
              };
              if (fallback) {
                reportRecoverableWarning({
                  location: 'cloud-sync:chat-detail-load',
                  error,
                  message: '聊天云端详情暂时不可用，已继续使用本地会话数据。',
                  extra: diagnostics,
                });
                return fallback;
              }
              reportRecoverableError({
                location: 'cloud-sync:chat-detail-load',
                error,
                userMessage: '聊天详情同步失败，请检查网络后重试。',
                extra: diagnostics,
              });
              return null;
            }
          }, { markCheckedOnSuccess: false });
        },

        loadWorldRuntime: async () => {
          await ensureChatStoreHydrated();
          if (shouldSkipCloudSync()) return;
          if (chatSyncScopes.isFresh(WORLD_RUNTIME_SCOPE)) return;
          return chatSyncScopes.run(WORLD_RUNTIME_SCOPE, async () => {
            try {
              const changeProbe = await probeChatScopeChanges(WORLD_RUNTIME_SCOPE);
              if (changeProbe?.status === 'not_modified') {
                chatSyncScopes.markChecked(WORLD_RUNTIME_SCOPE, {
                  cursor: changeProbe.cursor,
                  revision: changeProbe.revision,
                  applied: false,
                });
                return;
              }
              const snapshot = worldRuntimeChatsFromChanges(changeProbe?.changes) || await fetchWorldRuntimeSnapshot();
              set((state) => {
                const byId = new Map(state.chats.map((chat) => [chat.id, chat] as const));
                const mergedRuntime = snapshot.map((remote) => normalizeConversation(mergeWorldRuntimeRecord(byId.get(remote.id), remote)));
                const nextChats = mergeVisibleChats(state.chats, mergedRuntime, state.pendingOperations);
                const changed = buildChatListSignature(nextChats) !== buildChatListSignature(state.chats);
                chatSyncScopes.markChecked(WORLD_RUNTIME_SCOPE, {
                  cursor: changeProbe?.cursor,
                  revision: changeProbe?.revision,
                  applied: changed,
                });
                return {
                  ...(changed ? { chats: nextChats } : {}),
                  pendingEditSyncCount: state.pendingOperations.length,
                  pendingEditSyncError: latestChatError(state.pendingOperations),
                };
              });
            } catch (error) {
              chatSyncScopes.markError(WORLD_RUNTIME_SCOPE, error);
              reportRecoverableError({
                location: 'cloud-sync:world-runtime-load',
                error,
                userMessage: '世界运行摘要同步失败，请检查网络后重试。',
              });
            }
          }, { markCheckedOnSuccess: false });
        },

        prefetchChats: async () => {
          const state = get();
          if (state.chats.length > 0 && chatSyncScopes.isFresh(CHAT_SUMMARY_SCOPE)) return;
          scheduleChatScopeRefresh(flushRequestedChatScopes, CHAT_SUMMARY_SCOPE);
        },

        refreshChatSummaryFromCloud: async () => {
          chatSyncScopes.clear(CHAT_SUMMARY_SCOPE);
          void get().loadChats();
        },

        prefetchWorldRuntime: async () => {
          if (chatSyncScopes.isFresh(WORLD_RUNTIME_SCOPE)) return;
          scheduleChatScopeRefresh(flushRequestedChatScopes, WORLD_RUNTIME_SCOPE);
        },

        getChat: (id) => get().chats.find((chat) => chat.id === id),
        hasChatLoaded: (id) => Boolean(get().chats.find((chat) => chat.id === id)),
        getChatsLoadedAt: () => get().lastSyncedAt,
        getSyncScopeStates: () => chatSyncScopes.listStates(),
        markChatsWarm: () => set(buildMarkedWarmChatStoreState),

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
        clearPendingOperations: () => set({ pendingOperations: [], pendingEditSyncCount: 0, pendingEditSyncError: null, fieldConflicts: [] }),
        confirmCreateOperationsSynced: (entityIds) => set((state) => {
          const normalizedIds = new Set(entityIds.filter(Boolean));
          if (!normalizedIds.size) return {};
          const pendingOperations = state.pendingOperations.filter((operation) => (
            operation.kind !== 'create' || !normalizedIds.has(operation.entityId)
          ));
          if (pendingOperations.length === state.pendingOperations.length) return {};
          return {
            chats: projectVisibleChats(state.chats, pendingOperations),
            pendingOperations,
            fieldConflicts: clearResolvedFieldConflicts(state.fieldConflicts, { entityType: 'chat', entityIds: Array.from(normalizedIds) }),
            pendingEditSyncCount: pendingOperations.length,
            pendingEditSyncError: latestChatError(pendingOperations),
          };
        }),
        discardFailedOperation: (operationId) => set((state) => {
          const operation = state.pendingOperations.find((item) => item.id === operationId);
          if (operation?.status !== 'failed') return {};
          const pendingOperations = removePendingChatOperation(state.pendingOperations, operationId);
          return {
            chats: projectVisibleChats(state.chats, pendingOperations),
            pendingOperations,
            fieldConflicts: clearResolvedFieldConflicts(state.fieldConflicts, { entityType: 'chat', operationIds: [operationId] }),
            pendingEditSyncCount: pendingOperations.length,
            pendingEditSyncError: latestChatError(pendingOperations),
          };
        }),
        resolveRemoteDeleteConflict: async (id, resolution) => {
          if (!id) return;
          if (resolution === 'restore_local') {
            set((state) => ({
              remoteDeletedChatIds: state.remoteDeletedChatIds.filter((chatId) => chatId !== id),
              remoteDeletedChats: state.remoteDeletedChats.filter((chat) => chat.id !== id),
              fieldConflicts: clearResolvedFieldConflicts(state.fieldConflicts, { entityType: 'chat', entityIds: [id] }),
            }));
            await get().syncPatch(id, { deletedAt: null, isActive: true }, 'patch');
            scheduleChatFlush(flushPendingOperations, 100);
            return;
          }
          if (resolution === 'save_as_new') {
            const snapshot = get().chats.find((chat) => chat.id === id) || get().remoteDeletedChats.find((chat) => chat.id === id);
            if (snapshot) await get().addChat(createConflictCopyChatData(snapshot));
          }
          set((state) => {
            const pendingOperations = state.pendingOperations.filter((operation) => operation.entityId !== id);
            return {
              chats: state.chats.filter((chat) => chat.id !== id),
              currentChatId: state.currentChatId === id ? null : state.currentChatId,
              pendingOperations,
              fieldConflicts: clearResolvedFieldConflicts(state.fieldConflicts, { entityType: 'chat', entityIds: [id] }),
              pendingEditSyncCount: pendingOperations.length,
              pendingEditSyncError: latestChatError(pendingOperations),
              remoteDeletedChatIds: state.remoteDeletedChatIds.filter((chatId) => chatId !== id),
              remoteDeletedChats: state.remoteDeletedChats.filter((chat) => chat.id !== id),
            };
          });
        },
        retryFailedOperations: () => set((state) => {
          const pendingOperations = retryFailedOperations(state.pendingOperations);
          if (pendingOperations === state.pendingOperations) return {};
          return {
            pendingOperations,
            pendingEditSyncCount: pendingOperations.length,
            pendingEditSyncError: latestChatError(pendingOperations),
          };
        }),
        loadPendingSnapshot: async () => get().loadProjectedChats(),
        loadProjectedRecycleBin: async () => get().loadProjectedDeletedChats(),
        hydrateProjectedState: () => set((state) => ({ chats: projectVisibleChats(state.chats, state.pendingOperations) })),
        resumeSync: () => scheduleChatFlush(flushPendingOperations, 100),
        syncPatch: async (entityId, patch, kind = 'patch') => {
          get().queuePatch(entityId, patch, kind);
        },
        loadProjectedVisibleChats: async () => projectVisibleChats(get().chats, get().pendingOperations),

        addChat: async (chatData) => {
          const chat = applyLocalChatCreate(chatData);
          set((state) => {
            const pendingOperations = shouldSkipCloudSync()
              ? state.pendingOperations
              : mergeChatPatchOperations([
                ...state.pendingOperations,
                createPendingChatOperation({
                  kind: 'create',
                  targetIds: [chat.id],
                  patch: compactChatPatchForCloud({ ...chat, id: chat.id } as Record<string, unknown>),
                }),
              ]);
            return {
              chats: [chat, ...state.chats.filter((item) => item.id !== chat.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
              currentChatId: chat.id,
              pendingOperations,
              pendingEditSyncCount: pendingOperations.length,
              pendingEditSyncError: latestChatError(pendingOperations),
            };
          });
          if (!shouldSkipCloudSync()) {
            scheduleChatFlush(flushPendingOperations, 120);
          }
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
          const deletedAt = Date.now();
          if (shouldSkipCloudSync()) {
            set((state) => ({
              chats: state.chats.map((chat) => chat.id === id ? applyLocalChatDelete(chat) : chat).filter((chat) => chat.deletedAt == null),
              currentChatId: state.currentChatId === id ? null : state.currentChatId,
            }));
            return;
          }
          await get().syncPatch(id, { deletedAt, isActive: false }, 'patch');
          set((state) => ({ currentChatId: state.currentChatId === id ? null : state.currentChatId }));
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
          await Promise.all(normalizedIds.map((chatId) => get().syncPatch(chatId, { deletedAt: null }, 'patch')));
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
      name: getChatStoreStorageName(),
      storage: chatStorage,
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => {
        const migrated = migrateChatStoreState(persistedState as PersistedChatState) as PersistedChatState;
        return {
          ...migrated,
          pendingOperations: recoverInterruptedOperations(migrated.pendingOperations || []),
          fieldConflicts: migrated.fieldConflicts || [],
        };
      },
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
