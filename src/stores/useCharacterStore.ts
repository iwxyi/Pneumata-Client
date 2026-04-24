import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AICharacter } from '../types/character';
import { normalizeCharacter, normalizeCharacterGroup } from '../types/character';
import { api } from '../services/api';
import { projectEntities, type SyncPatchOperation } from '../services/syncProjector';

interface PendingCharacterOperation extends SyncPatchOperation<Record<string, unknown>> {
  kind: 'patch';
  targetIds: string[];
}

interface PersistedCharacterState {
  characters: AICharacter[];
  lastSyncedAt: number;
  pendingOperations: PendingCharacterOperation[];
}

interface CharacterStore extends PersistedCharacterState {
  isLoading: boolean;
  pendingEditSyncCount: number;
  pendingEditSyncError: string | null;
  loadCharacters: () => Promise<void>;
  flushPendingOperations: () => Promise<void>;
  queuePatch: (entityId: string, patch: Record<string, unknown>, kind?: PendingCharacterOperation['kind']) => void;
  loadProjectedDeletedCharacters: () => Promise<AICharacter[]>;
  loadProjectedCharacters: () => Promise<AICharacter[]>;
  loadProjectedState: () => Promise<void>;
  getPendingOperations: () => PendingCharacterOperation[];
  getPendingEditError: () => string | null;
  getPendingEditCount: () => number;
  clearPendingOperations: () => void;
  loadPendingSnapshot: () => Promise<AICharacter[]>;
  loadProjectedRecycleBin: () => Promise<AICharacter[]>;
  hydrateProjectedState: () => void;
  resumeSync: () => void;
  syncPatch: (entityId: string, patch: Record<string, unknown>, kind?: PendingCharacterOperation['kind']) => Promise<void>;
  loadProjectedVisibleCharacters: () => Promise<AICharacter[]>;
  addCharacter: (char: Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>) => Promise<AICharacter>;
  updateCharacter: (id: string, updates: Partial<AICharacter>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  deleteCharacters: (ids: string[]) => Promise<void>;
  restoreCharacters: (ids: string[]) => Promise<void>;
  purgeCharacters: (ids: string[]) => Promise<void>;
  emptyDeletedCharacters: () => Promise<void>;
  loadDeletedCharacters: () => Promise<AICharacter[]>;
  updateCharactersGroup: (ids: string[], group: string | null) => Promise<void>;
  getCharacter: (id: string) => AICharacter | undefined;
  getPresets: () => AICharacter[];
  getCustom: () => AICharacter[];
  importCharacters: (chars: AICharacter[]) => Promise<void>;
  initializePresets: () => Promise<void>;
}

function getUserId() {
  const userRaw = localStorage.getItem('miragetea-user');
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getCharacterStorageKey() {
  return `mirageTea-characters-${getUserId()}`;
}

function getLegacyCharacterStorageKey() {
  return 'mirageTea-characters';
}

function createCharacterStorage() {
  return {
    getItem: (name: string) => {
      const scopedName = getCharacterStorageKey();
      const legacyName = getLegacyCharacterStorageKey();
      if (name !== legacyName) return localStorage.getItem(name);
      return localStorage.getItem(scopedName) ?? localStorage.getItem(legacyName);
    },
    setItem: (name: string, value: string) => {
      const scopedName = getCharacterStorageKey();
      const legacyName = getLegacyCharacterStorageKey();
      if (name !== legacyName) {
        localStorage.setItem(name, value);
        return;
      }
      localStorage.setItem(scopedName, value);
      localStorage.removeItem(legacyName);
    },
    removeItem: (name: string) => {
      const scopedName = getCharacterStorageKey();
      const legacyName = getLegacyCharacterStorageKey();
      if (name !== legacyName) {
        localStorage.removeItem(name);
        return;
      }
      localStorage.removeItem(scopedName);
      localStorage.removeItem(legacyName);
    },
  };
}

function normalizeCharacters(items: AICharacter[]) {
  return items.map((item) => normalizeCharacter(item));
}

function classifySyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|登录已过期|未登录/i.test(message)) return `auth: ${message}`;
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) return `network: ${message}`;
  if (/500|502|503|504|服务器错误/i.test(message)) return `server_unavailable: ${message}`;
  if (/404|不存在|未删除/i.test(message)) return `conflict_ignored: ${message}`;
  return `validation: ${message}`;
}

function latestCharacterError(queue: PendingCharacterOperation[]) {
  return [...queue].reverse().find((item) => item.lastError)?.lastError || null;
}

function sortCharacters(characters: AICharacter[]) {
  return [...characters].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function mergeCharacters(localCharacters: AICharacter[], remoteCharacters: AICharacter[], pendingOperations: PendingCharacterOperation[] = []) {
  const merged = new Map<string, AICharacter>();
  for (const character of normalizeCharacters(localCharacters)) {
    merged.set(character.id, character);
  }
  for (const remote of normalizeCharacters(remoteCharacters)) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      merged.set(remote.id, remote);
    }
  }
  return sortCharacters(projectEntities(Array.from(merged.values()), pendingOperations));
}

function projectVisibleCharacters(characters: AICharacter[], pendingOperations: PendingCharacterOperation[]) {
  return sortCharacters(projectEntities(characters, pendingOperations).filter((item) => item.deletedAt == null));
}

function projectDeletedCharacters(characters: AICharacter[], pendingOperations: PendingCharacterOperation[]) {
  return sortCharacters(projectEntities(characters, pendingOperations).filter((item) => item.deletedAt != null));
}

function mergeVisibleCharacters(localCharacters: AICharacter[], remoteCharacters: AICharacter[], pendingOperations: PendingCharacterOperation[] = []) {
  return mergeCharacters(localCharacters, remoteCharacters, pendingOperations).filter((item) => item.deletedAt == null);
}

function mergeDeletedCharacters(localCharacters: AICharacter[], remoteCharacters: AICharacter[], pendingOperations: PendingCharacterOperation[] = []) {
  return mergeCharacters(localCharacters, remoteCharacters, pendingOperations).filter((item) => item.deletedAt != null);
}

async function fetchCharacterSnapshot() {
  const result = await api.getCharacters() as unknown as AICharacter[];
  return normalizeCharacters(result);
}

async function fetchDeletedCharacterSnapshot() {
  const result = await api.getDeletedCharacters() as unknown as Record<string, unknown>[];
  return result.map((item) => normalizeCharacter(item as unknown as AICharacter));
}

async function fetchAllCharacterSnapshots() {
  const [active, deleted] = await Promise.all([
    fetchCharacterSnapshot(),
    fetchDeletedCharacterSnapshot(),
  ]);
  return { active, deleted };
}

function createPendingCharacterOperation(kind: PendingCharacterOperation['kind'], targetIds: string[] = [], patch: Record<string, unknown> = {}, timestamp = Date.now()): PendingCharacterOperation {
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

function removePendingCharacterOperation(queue: PendingCharacterOperation[], operationId: string) {
  return queue.filter((item) => item.id !== operationId);
}

function updatePendingCharacterOperation(queue: PendingCharacterOperation[], operationId: string, patch: Partial<PendingCharacterOperation>) {
  return queue.map((item) => item.id === operationId ? { ...item, ...patch } : item);
}

function queueAndProjectCharacters(state: CharacterStore, operations: PendingCharacterOperation[]) {
  const pendingOperations = [...state.pendingOperations, ...operations];
  return {
    pendingOperations,
    characters: projectVisibleCharacters(state.characters, pendingOperations),
    pendingEditSyncCount: pendingOperations.length,
    pendingEditSyncError: latestCharacterError(pendingOperations),
  };
}

let characterSyncTimer: ReturnType<typeof setTimeout> | null = null;
const CHARACTER_SYNC_DELAYS = [1000, 3000, 10000, 30000];

function scheduleCharacterFlush(flush: () => Promise<void>, delay = 0) {
  if (characterSyncTimer) clearTimeout(characterSyncTimer);
  characterSyncTimer = setTimeout(() => { void flush(); }, delay);
}

function canAttemptSync() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

async function executeCharacterOperation(operation: PendingCharacterOperation) {
  return api.syncCharacterPatch(operation.entityId, {
    operationId: operation.id,
    clientTimestamp: operation.clientTimestamp,
    patch: operation.patch,
  });
}

async function applyCharacterRestore(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) {
    await api.restoreCharacter(normalizedIds[0]);
    return;
  }
  await api.bulkRestoreCharacters(normalizedIds);
}

async function applyCharacterPurge(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) {
    await api.purgeCharacter(normalizedIds[0]);
    return;
  }
  await api.bulkPurgeCharacters(normalizedIds);
}

async function applyEmptyDeletedCharacters() {
  await api.emptyDeletedCharacters();
}

async function reloadProjectedCharacterState(pendingOperations: PendingCharacterOperation[]) {
  const { active, deleted } = await fetchAllCharacterSnapshots();
  return {
    visible: mergeVisibleCharacters([], active, pendingOperations),
    deleted: mergeDeletedCharacters([], [...active, ...deleted], pendingOperations),
  };
}

export function clearPersistedCharacterStore() {
  localStorage.removeItem(getCharacterStorageKey());
  localStorage.removeItem(getLegacyCharacterStorageKey());
}

const characterStorage = createCharacterStorage();
let characterSyncLifecycleRegistered = false;

export const useCharacterStore = create<CharacterStore>()(
  persist(
    (set, get) => {
      const flushPendingOperations = async () => {
        const state = get();
        const nextOperation = state.pendingOperations.find((item) => item.status === 'pending');
        if (!nextOperation || !canAttemptSync()) return;

        set((current) => ({
          pendingOperations: updatePendingCharacterOperation(current.pendingOperations, nextOperation.id, { status: 'syncing' }),
        }));

        try {
          await executeCharacterOperation(nextOperation);
          const nextQueue = removePendingCharacterOperation(get().pendingOperations, nextOperation.id);
          const nextState = await reloadProjectedCharacterState(nextQueue);
          set({
            characters: nextState.visible,
            pendingOperations: nextQueue,
            pendingEditSyncCount: nextQueue.length,
            pendingEditSyncError: latestCharacterError(nextQueue),
            lastSyncedAt: Date.now(),
          });
          scheduleCharacterFlush(flushPendingOperations, 50);
        } catch (error) {
          const classified = classifySyncError(error);
          const attemptCount = nextOperation.attemptCount + 1;
          set((current) => ({
            pendingOperations: updatePendingCharacterOperation(current.pendingOperations, nextOperation.id, {
              status: 'pending',
              attemptCount,
              lastError: classified,
            }),
            pendingEditSyncCount: current.pendingOperations.length,
            pendingEditSyncError: classified,
          }));
          scheduleCharacterFlush(flushPendingOperations, CHARACTER_SYNC_DELAYS[Math.min(attemptCount, CHARACTER_SYNC_DELAYS.length - 1)]);
        }
      };

      if (!characterSyncLifecycleRegistered && typeof window !== 'undefined') {
        window.addEventListener('online', () => scheduleCharacterFlush(flushPendingOperations, 300));
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') scheduleCharacterFlush(flushPendingOperations, 300);
        });
        characterSyncLifecycleRegistered = true;
      }

      return {
        characters: [],
        lastSyncedAt: 0,
        pendingOperations: [],
        pendingEditSyncCount: 0,
        pendingEditSyncError: null,
        isLoading: false,

        loadCharacters: async () => {
          set((state) => ({ isLoading: state.characters.length === 0 }));
          try {
            const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
            set({
              characters: projectedState.visible,
              isLoading: false,
              lastSyncedAt: Date.now(),
              pendingEditSyncCount: get().pendingOperations.length,
              pendingEditSyncError: latestCharacterError(get().pendingOperations),
            });
          } catch (error) {
            set({ isLoading: false, pendingEditSyncError: classifySyncError(error) });
          }
        },

        flushPendingOperations,

        queuePatch: (entityId, patch, kind = 'patch') => {
          const operation = createPendingCharacterOperation(kind, entityId ? [entityId] : [], patch);
          set((state) => queueAndProjectCharacters(state, [operation]));
          scheduleCharacterFlush(flushPendingOperations, 50);
        },

        loadProjectedDeletedCharacters: async () => {
          const { deleted } = await reloadProjectedCharacterState(get().pendingOperations);
          return deleted;
        },

        loadProjectedCharacters: async () => {
          const { visible } = await reloadProjectedCharacterState(get().pendingOperations);
          return visible;
        },

        loadProjectedState: async () => { await get().loadCharacters(); },
        getPendingOperations: () => get().pendingOperations,
        getPendingEditError: () => latestCharacterError(get().pendingOperations),
        getPendingEditCount: () => get().pendingOperations.length,
        clearPendingOperations: () => set({ pendingOperations: [], pendingEditSyncCount: 0, pendingEditSyncError: null }),
        loadPendingSnapshot: async () => get().loadProjectedCharacters(),
        loadProjectedRecycleBin: async () => get().loadProjectedDeletedCharacters(),
        hydrateProjectedState: () => set((state) => ({ characters: projectVisibleCharacters(state.characters, state.pendingOperations) })),
        resumeSync: () => scheduleCharacterFlush(flushPendingOperations, 100),
        syncPatch: async (entityId, patch, kind = 'patch') => {
          get().queuePatch(entityId, patch, kind);
        },
        loadProjectedVisibleCharacters: async () => get().loadProjectedCharacters(),

        addCharacter: async (charData) => {
          const result = await api.createCharacter({
            name: charData.name,
            avatar: charData.avatar,
            personality: charData.personality as unknown as Record<string, number>,
            behavior: charData.behavior,
            expertise: charData.expertise,
            speakingStyle: charData.speakingStyle,
            background: charData.background,
            group: normalizeCharacterGroup(charData.group),
            speechProfile: charData.speechProfile,
            relationships: charData.relationships,
            memory: charData.memory,
            layeredMemories: charData.layeredMemories,
            intervention: charData.intervention,
            runtimeTimeline: charData.runtimeTimeline,
            modelProfileId: charData.modelProfileId,
            bubbleStyleId: charData.bubbleStyleId,
          });
          const character = normalizeCharacter(result as unknown as AICharacter);
          set((state) => ({
            characters: mergeCharacters(state.characters, [character, ...state.characters], state.pendingOperations).filter((item) => item.deletedAt == null),
            lastSyncedAt: Date.now(),
          }));
          return character;
        },

        updateCharacter: async (id, updates) => {
          await get().syncPatch(id, updates, 'patch');
        },

        deleteCharacter: async (id) => {
          const normalizedIds = Array.from(new Set([id].filter(Boolean)));
          if (!normalizedIds.length) return;
          await Promise.all(normalizedIds.map((characterId) => api.deleteCharacter(characterId)));
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
        },

        deleteCharacters: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          if (normalizedIds.length === 1) {
            await api.deleteCharacter(normalizedIds[0]);
          } else {
            await api.bulkDeleteCharacters(normalizedIds);
          }
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
        },

        restoreCharacters: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          await applyCharacterRestore(normalizedIds);
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
        },

        purgeCharacters: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          await applyCharacterPurge(normalizedIds);
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
        },

        emptyDeletedCharacters: async () => {
          await applyEmptyDeletedCharacters();
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
        },

        loadDeletedCharacters: async () => get().loadProjectedDeletedCharacters(),

        updateCharactersGroup: async (ids, group) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          const result = await api.bulkUpdateCharacters(normalizedIds, { group: normalizeCharacterGroup(group) });
          const updatedCharacters = Array.isArray(result.characters)
            ? result.characters.map((item) => normalizeCharacter(item as unknown as AICharacter))
            : [];
          set((state) => ({
            characters: updatedCharacters.length ? mergeCharacters(state.characters, updatedCharacters, state.pendingOperations).filter((item) => item.deletedAt == null) : state.characters,
          }));
        },

        getCharacter: (id) => get().characters.find((c) => c.id === id),
        getPresets: () => get().characters.filter((c) => c.isPreset),
        getCustom: () => get().characters.filter((c) => !c.isPreset),

        importCharacters: async (chars) => {
          const created: AICharacter[] = [];
          for (const c of chars) {
            const result = await api.createCharacter({
              name: c.name,
              avatar: c.avatar,
              personality: c.personality as unknown as Record<string, number>,
              behavior: c.behavior,
              expertise: c.expertise,
              speakingStyle: c.speakingStyle,
              background: c.background,
              group: normalizeCharacterGroup(c.group),
              speechProfile: c.speechProfile,
              relationships: c.relationships,
              memory: c.memory,
              layeredMemories: c.layeredMemories,
              intervention: c.intervention,
              runtimeTimeline: c.runtimeTimeline,
              modelProfileId: c.modelProfileId,
              bubbleStyleId: c.bubbleStyleId,
            });
            created.push(result as unknown as AICharacter);
          }
          set((state) => ({
            characters: mergeCharacters(state.characters, [...created, ...state.characters], state.pendingOperations).filter((item) => item.deletedAt == null),
          }));
        },

        initializePresets: async () => {
          await get().loadCharacters();
        },
      };
    },
    {
      name: 'mirageTea-characters',
      storage: characterStorage as never,
      partialize: ((state: CharacterStore) => ({
        characters: state.characters,
        lastSyncedAt: state.lastSyncedAt,
        pendingOperations: state.pendingOperations,
      })) as never,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<PersistedCharacterState>),
        characters: projectVisibleCharacters(
          Array.isArray((persistedState as Partial<PersistedCharacterState>)?.characters)
            ? normalizeCharacters((persistedState as Partial<PersistedCharacterState>).characters || [])
            : [],
          Array.isArray((persistedState as Partial<PersistedCharacterState>)?.pendingOperations)
            ? (persistedState as Partial<PersistedCharacterState>).pendingOperations || []
            : []
        ),
        pendingOperations: Array.isArray((persistedState as Partial<PersistedCharacterState>)?.pendingOperations)
          ? (persistedState as Partial<PersistedCharacterState>).pendingOperations || []
          : [],
      }),
    }
  )
);
