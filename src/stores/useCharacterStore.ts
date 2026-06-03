import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AICharacter } from '../types/character';
import { normalizeCharacter, normalizeCharacterGroup } from '../types/character';
import { api } from '../services/api';
import { reportRecoverableError } from '../services/diagnostics';
import { projectEntities, type SyncPatchOperation } from '../services/syncProjector';
import { buildWarmState } from './storeWarmHelpers';
import { createScopedBufferedJsonStorage } from './storePersistenceScope';
import { createSyncScheduler } from './storeSyncScheduler';
import { createGuestUploadFlag } from './storeGuestUpload';
import { CLIENT_STORE_SCHEMA_VERSION, migrateCharacterStoreState } from './storeMigrations';
import { useCharacterArtifactStore } from './useCharacterArtifactStore';
import { scopedStorageKey, storageKey } from '../constants/brand';
import {
  canAttemptOnlineSync,
  classifySyncError,
  createPendingOperation,
  latestSyncError,
  recoverInterruptedOperations,
  removePendingOperation,
  shouldSkipCloudSync,
  updatePendingOperation,
} from './storeSyncHelpers';

function createLocalCharacterId() {
  return `local-character-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyLocalCharacterCreate(charData: Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>) {
  const now = Date.now();
  return normalizeCharacter({
    ...charData,
    id: createLocalCharacterId(),
    isPreset: false,
    createdAt: now,
    updatedAt: now,
  } as AICharacter);
}

function applyLocalCharacterUpdate(character: AICharacter, updates: Partial<AICharacter>) {
  return normalizeCharacter({
    ...character,
    ...updates,
    updatedAt: Date.now(),
  });
}

function applyLocalCharacterDelete(character: AICharacter) {
  return normalizeCharacter({
    ...character,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

function applyLocalCharacterRestore(character: AICharacter) {
  return normalizeCharacter({
    ...character,
    deletedAt: null,
    updatedAt: Date.now(),
  });
}

function applyLocalCharacterPurge(characters: AICharacter[], ids: string[]) {
  const normalizedIds = new Set(ids);
  return characters.filter((character) => !normalizedIds.has(character.id));
}

function applyLocalEmptyDeletedCharacters(characters: AICharacter[]) {
  return characters.filter((character) => character.deletedAt == null);
}

async function createCharacterRemote(charData: Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>) {
  const result = await api.createCharacter({
    name: charData.name,
    avatar: charData.avatar,
    personality: charData.personality as unknown as Record<string, number>,
    behavior: charData.behavior,
    expertise: charData.expertise,
    speakingStyle: charData.speakingStyle,
    background: charData.background,
    group: normalizeCharacterGroup(charData.group),
    personalityDrift: charData.personalityDrift,
    emotionalState: charData.emotionalState,
    soulState: charData.soulState,
    coreProfile: charData.coreProfile,
    visualIdentity: charData.visualIdentity,
    speechProfile: charData.speechProfile,
    voiceConfig: charData.voiceConfig,
    relationships: charData.relationships,
    memory: charData.memory,
    layeredMemories: charData.layeredMemories,
    intervention: charData.intervention,
    runtimeTimeline: charData.runtimeTimeline,
    modelProfileId: charData.modelProfileId,
    modelProfileIds: charData.modelProfileIds,
    generationPreferences: charData.generationPreferences,
    bubbleStyle: charData.bubbleStyle,
    bubbleStyleId: charData.bubbleStyleId,
  });
  return normalizeCharacter(result as unknown as AICharacter);
}

const guestCharacterUploadFlag = createGuestUploadFlag<AICharacter>(
  scopedStorageKey('characters-guest'),
);

async function uploadGuestCharactersToCloud() {
  if (shouldSkipCloudSync()) return;
  const guestCharacters = guestCharacterUploadFlag.read().filter((character) => !character.deletedAt && !character.isPreset);
  if (!guestCharacters.length) return;
  try {
    for (const character of guestCharacters) {
      await createCharacterRemote(character);
    }
    guestCharacterUploadFlag.clear();
  } catch {
    // ignore malformed guest cache
  }
}

function buildLocalImportedCharacters(chars: AICharacter[]) {
  return chars.map((character) => applyLocalCharacterCreate({
    name: character.name,
    avatar: character.avatar,
    personality: character.personality,
    behavior: character.behavior,
    expertise: character.expertise,
    speakingStyle: character.speakingStyle,
    background: character.background,
    group: character.group,
    coreProfile: character.coreProfile,
    visualIdentity: character.visualIdentity,
    speechProfile: character.speechProfile,
    voiceConfig: character.voiceConfig,
    relationships: character.relationships,
    memory: character.memory,
    layeredMemories: character.layeredMemories,
    intervention: character.intervention,
    runtimeTimeline: character.runtimeTimeline,
    modelProfileId: character.modelProfileId,
    modelProfileIds: character.modelProfileIds,
    generationPreferences: character.generationPreferences,
    bubbleStyle: character.bubbleStyle,
    bubbleStyleId: character.bubbleStyleId,
    fieldVersions: character.fieldVersions,
    deletedAt: character.deletedAt,
  }));
}

let artifactHydrationPromise: Promise<void> | null = null;
let artifactSyncScheduled = false;
let pendingArtifactSyncCharacters: AICharacter[] | null = null;

function ensureCharacterArtifactStoreHydrated() {
  if (useCharacterArtifactStore.persist.hasHydrated()) return Promise.resolve();
  artifactHydrationPromise ??= Promise.resolve(useCharacterArtifactStore.persist.rehydrate()).finally(() => {
    artifactHydrationPromise = null;
  });
  return artifactHydrationPromise;
}

function syncCharacterArtifacts(characters: AICharacter[]) {
  pendingArtifactSyncCharacters = characters;
  if (artifactSyncScheduled) return;
  artifactSyncScheduled = true;
  queueMicrotask(() => {
    artifactSyncScheduled = false;
    const nextCharacters = pendingArtifactSyncCharacters;
    pendingArtifactSyncCharacters = null;
    if (!nextCharacters) return;
    void ensureCharacterArtifactStoreHydrated().then(() => {
      useCharacterArtifactStore.getState().syncCharacters(nextCharacters);
    });
  });
}

function enqueueFinalLettersForDeletion(characters: AICharacter[], ids: string[]) {
  const normalizedIds = new Set(ids);
  const deleted = characters.filter((character) => normalizedIds.has(character.id) && !character.isPreset);
  if (!deleted.length) return;
    void ensureCharacterArtifactStoreHydrated().then(() => {
      deleted.forEach((character) => {
        useCharacterArtifactStore.getState().enqueueLetterArtifact({
          kind: 'final_letter',
          character,
          relatedCharacters: characters.filter((item) => item.id !== character.id).map((item) => ({ id: item.id, name: item.name })),
          sourceKey: character.deletedAt ? `${character.deletedAt}` : `${Date.now()}`,
        });
      });
    });
}

function enqueueBirthLettersForCreation(createdCharacters: AICharacter[], characters: AICharacter[]) {
  const created = createdCharacters.filter((character) => !character.isPreset && character.deletedAt == null);
  if (!created.length) return;
    void ensureCharacterArtifactStoreHydrated().then(() => {
      created.forEach((character) => {
        useCharacterArtifactStore.getState().enqueueLetterArtifact({
          kind: 'birth_letter',
          character,
          relatedCharacters: characters.filter((item) => item.id !== character.id).map((item) => ({ id: item.id, name: item.name })),
          sourceKey: `${character.createdAt || Date.now()}`,
        });
      });
    });
}

function normalizeCharacters(items: AICharacter[]) {
  return items.map((item) => normalizeCharacter(item));
}

function sortCharacters(characters: AICharacter[]) {
  return [...characters].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function normalizeCharacterNameKey(name: string | null | undefined) {
  return (name || '').trim().toLowerCase();
}

function assertUniqueCharacterNames(characters: AICharacter[], names: string[], excludedIds: string[] = []) {
  const excluded = new Set(excludedIds);
  const existing = new Set(
    characters
      .filter((character) => !excluded.has(character.id) && character.deletedAt == null)
      .map((character) => normalizeCharacterNameKey(character.name))
      .filter(Boolean)
  );
  const seen = new Set<string>();
  for (const name of names) {
    const key = normalizeCharacterNameKey(name);
    if (!key) continue;
    if (existing.has(key) || seen.has(key)) {
      throw new Error('DUPLICATE_CHARACTER_NAME');
    }
    seen.add(key);
  }
}

function assertUniqueCharacterNameUpdate(characters: AICharacter[], id: string, updates: Partial<AICharacter>) {
  if (typeof updates.name !== 'string') return;
  const nextName = normalizeCharacterNameKey(updates.name);
  if (!nextName) return;
  assertUniqueCharacterNames(characters, [updates.name], [id]);
}

function assertUniqueCharacterNameBatch(characters: AICharacter[], charsData: Array<Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>>) {
  assertUniqueCharacterNames(characters, charsData.map((item) => item.name));
}

function mergeCharacterRecord(local: AICharacter | undefined, remote: AICharacter) {
  if (!local || remote.characterDetailLoaded !== false || local.characterDetailLoaded === false) {
    return remote;
  }
  return {
    ...remote,
    characterDetailLoaded: true,
    personalityDrift: local.personalityDrift,
    emotionalState: local.emotionalState,
    soulState: local.soulState,
    coreProfile: local.coreProfile,
    visualIdentity: local.visualIdentity,
    speechProfile: local.speechProfile,
    voiceConfig: local.voiceConfig,
    behavior: local.behavior,
    speakingStyle: local.speakingStyle,
    background: local.background,
    relationships: local.relationships,
    memory: local.memory,
    layeredMemories: local.layeredMemories,
    intervention: local.intervention,
    runtimeTimeline: local.runtimeTimeline,
    modelProfileId: local.modelProfileId,
    modelProfileIds: local.modelProfileIds,
    generationPreferences: local.generationPreferences,
    bubbleStyle: local.bubbleStyle,
  };
}

function mergeCharacters(localCharacters: AICharacter[], remoteCharacters: AICharacter[], pendingOperations: PendingCharacterOperation[] = []) {
  const merged = new Map<string, AICharacter>();
  for (const character of normalizeCharacters(localCharacters)) merged.set(character.id, character);
  for (const remote of normalizeCharacters(remoteCharacters)) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) merged.set(remote.id, normalizeCharacter(mergeCharacterRecord(local, remote)));
  }
  return sortCharacters(projectEntities(Array.from(merged.values()), pendingOperations));
}

function projectVisibleCharacters(characters: AICharacter[], pendingOperations: PendingCharacterOperation[]) {
  return sortCharacters(projectEntities(characters, pendingOperations).filter((item) => item.deletedAt == null));
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

async function fetchCharacterDetail(id: string) {
  const result = await api.getCharacter(id);
  return normalizeCharacter(result as unknown as AICharacter);
}

async function fetchDeletedCharacterSnapshot() {
  const result = await api.getDeletedCharacters() as unknown as Record<string, unknown>[];
  return result.map((item) => normalizeCharacter(item as unknown as AICharacter));
}

async function fetchAllCharacterSnapshots() {
  const [active, deleted] = await Promise.all([fetchCharacterSnapshot(), fetchDeletedCharacterSnapshot()]);
  return { active, deleted };
}

interface PendingCharacterOperation extends SyncPatchOperation<Record<string, unknown>> {
  kind: 'patch';
  targetIds: string[];
}

interface PersistedCharacterState {
  characters: AICharacter[];
  lastSyncedAt: number;
  pendingOperations: PendingCharacterOperation[];
}

const CHARACTER_RUNTIME_PERSIST_LIMITS = {
  layeredMemories: 80,
  runtimeTimeline: 80,
};

function takeRecentItems<T>(items: T[] | undefined, limit: number): T[] {
  if (!Array.isArray(items)) return [];
  return items.length > limit ? items.slice(-limit) : items;
}

function compactCharacterRuntimeFieldsForPersistence<T extends Partial<AICharacter>>(character: T): T {
  return {
    ...character,
    ...(character.layeredMemories !== undefined ? {
      layeredMemories: takeRecentItems(character.layeredMemories, CHARACTER_RUNTIME_PERSIST_LIMITS.layeredMemories),
    } : {}),
    ...(character.runtimeTimeline !== undefined ? {
      runtimeTimeline: takeRecentItems(character.runtimeTimeline, CHARACTER_RUNTIME_PERSIST_LIMITS.runtimeTimeline),
    } : {}),
  };
}

function persistCharacterAvatarForCloud(avatar: string) {
  return /^data:/i.test(avatar) ? '' : avatar;
}

function compactCharacterPatchForCloud(patch: PendingCharacterOperation['patch']) {
  if (!patch || typeof patch !== 'object') return {};
  const nextPatch = compactCharacterRuntimeFieldsForPersistence({ ...patch } as Partial<AICharacter>) as Record<string, unknown>;
  delete nextPatch.updatedAt;
  return nextPatch;
}

function buildPersistedCharacterState(state: PersistedCharacterState): PersistedCharacterState {
  if (shouldSkipCloudSync()) return state;
  return {
    characters: state.characters.map((character) => normalizeCharacter({
      id: character.id,
      name: character.name,
      avatar: persistCharacterAvatarForCloud(character.avatar),
      group: character.group,
      visualIdentity: character.visualIdentity,
      bubbleStyle: character.bubbleStyle || null,
      bubbleStyleId: character.bubbleStyleId || null,
      modelProfileId: character.modelProfileId || null,
      modelProfileIds: character.modelProfileIds,
      generationPreferences: character.generationPreferences,
      personality: character.personality,
      personalityDrift: character.personalityDrift,
      emotionalState: character.emotionalState,
      soulState: character.soulState,
      coreProfile: character.coreProfile,
      speechProfile: character.speechProfile,
      voiceConfig: character.voiceConfig,
      behavior: character.behavior,
      expertise: character.expertise,
      speakingStyle: character.speakingStyle,
      background: character.background,
      relationships: character.relationships,
      memory: character.memory,
      layeredMemories: takeRecentItems(character.layeredMemories, CHARACTER_RUNTIME_PERSIST_LIMITS.layeredMemories),
      intervention: character.intervention,
      runtimeTimeline: takeRecentItems(character.runtimeTimeline, CHARACTER_RUNTIME_PERSIST_LIMITS.runtimeTimeline),
      isPreset: character.isPreset,
      deletedAt: character.deletedAt ?? null,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    } as AICharacter)),
    lastSyncedAt: state.lastSyncedAt,
    pendingOperations: recoverInterruptedOperations(state.pendingOperations)
      .map((operation) => ({
        ...operation,
        patch: compactCharacterPatchForCloud(operation.patch),
      }))
      .filter((operation) => Object.keys(operation.patch || {}).length > 0),
  };
}

interface CharacterStore extends PersistedCharacterState {
  isLoading: boolean;
  pendingEditSyncCount: number;
  pendingEditSyncError: string | null;
  loadCharacters: () => Promise<void>;
  loadCharacter: (id: string) => Promise<AICharacter | null>;
  prefetchCharacters: () => Promise<void>;
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
  addCharacters: (chars: Array<Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>>) => Promise<AICharacter[]>;
  updateCharacter: (id: string, updates: Partial<AICharacter>) => Promise<void>;
  updateCharacters: (patches: Array<{ id: string; updates: Partial<AICharacter> }>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  deleteCharacters: (ids: string[]) => Promise<void>;
  restoreCharacters: (ids: string[]) => Promise<void>;
  purgeCharacters: (ids: string[]) => Promise<void>;
  emptyDeletedCharacters: () => Promise<void>;
  loadDeletedCharacters: () => Promise<AICharacter[]>;
  updateCharactersGroup: (ids: string[], group: string | null) => Promise<void>;
  getCharacter: (id: string) => AICharacter | undefined;
  hasCharacterLoaded: (id: string) => boolean;
  getCharactersLoadedAt: () => number;
  markCharactersWarm: () => void;
  getPresets: () => AICharacter[];
  getCustom: () => AICharacter[];
  importCharacters: (chars: AICharacter[]) => Promise<void>;
  initializePresets: () => Promise<void>;
}

function getUserId() {
  const userRaw = localStorage.getItem(storageKey('user'));
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getCharacterStorageKey() {
  return scopedStorageKey(`characters-${getUserId()}`);
}

function getCharacterStoreStorageName() {
  return scopedStorageKey('characters');
}

const latestCharacterError = latestSyncError;
const createPendingCharacterOperation = createPendingOperation<Record<string, unknown>, PendingCharacterOperation>;
const removePendingCharacterOperation = removePendingOperation;
const updatePendingCharacterOperation = updatePendingOperation;
const canAttemptSync = canAttemptOnlineSync;
const CHARACTER_SYNC_DELAYS = [1000, 3000, 10000, 30000];
const CHARACTER_REFRESH_TTL_MS = 30_000;
const characterSyncScheduler = createSyncScheduler();
let characterListLoadPromise: Promise<void> | null = null;
const characterDetailLoadPromises = new Map<string, Promise<AICharacter | null>>();

function scheduleCharacterFlush(flush: () => Promise<void>, delay = 0) {
  characterSyncScheduler.schedule(flush, delay);
}

function mergeCharacterPatchOperations(operations: PendingCharacterOperation[]) {
  const merged = new Map<string, PendingCharacterOperation>();
  for (const operation of operations) {
    const cloudPatch = compactCharacterPatchForCloud(operation.patch);
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

function visibleCharactersFromState(state: CharacterStore) {
  return projectVisibleCharacters(state.characters, state.pendingOperations);
}

function queueAndProjectCharacters(state: CharacterStore, operations: PendingCharacterOperation[]) {
  const pendingOperations = mergeCharacterPatchOperations([...state.pendingOperations, ...operations]);
  return {
    pendingOperations,
    characters: projectVisibleCharacters(state.characters, pendingOperations),
    pendingEditSyncCount: pendingOperations.length,
    pendingEditSyncError: latestCharacterError(pendingOperations),
  };
}

function createCharacterLocally(state: CharacterStore, charData: Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>) {
  const character = applyLocalCharacterCreate(charData);
  return {
    character,
    characters: sortCharacters([...state.characters.filter((item) => item.id !== character.id), character]),
  };
}

function deleteCharactersLocally(state: CharacterStore, ids: string[]) {
  const normalizedIds = new Set(ids);
  return sortCharacters(state.characters.map((character) => normalizedIds.has(character.id) ? applyLocalCharacterDelete(character) : character).filter((character) => character.deletedAt == null));
}

function restoreCharactersLocally(state: CharacterStore, ids: string[]) {
  const normalizedIds = new Set(ids);
  return sortCharacters(state.characters.map((character) => normalizedIds.has(character.id) ? applyLocalCharacterRestore(character) : character).filter((character) => character.deletedAt == null));
}

function updateCharacterLocally(state: CharacterStore, id: string, updates: Partial<AICharacter>) {
  return sortCharacters(state.characters.map((character) => character.id === id ? applyLocalCharacterUpdate(character, updates) : character));
}

function importCharactersBatchLocally(state: CharacterStore, chars: AICharacter[]) {
  return sortCharacters(mergeCharacters(state.characters, buildLocalImportedCharacters(chars), []));
}

async function executeCharacterOperation(operation: PendingCharacterOperation) {
  const character = useCharacterStore.getState().characters.find((item) => item.id === operation.entityId);
  if (character?.isPreset) {
    return { success: true, character: null };
  }
  return api.syncCharacterPatch(operation.entityId, {
    operationId: operation.id,
    clientTimestamp: operation.clientTimestamp,
    patch: operation.patch,
  });
}

async function applyCharacterRestore(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) return api.restoreCharacter(normalizedIds[0]);
  await api.bulkRestoreCharacters(normalizedIds);
}

async function applyCharacterPurge(ids: string[]) {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (!normalizedIds.length) return;
  if (normalizedIds.length === 1) return api.purgeCharacter(normalizedIds[0]);
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

async function reloadVisibleCharacterState(pendingOperations: PendingCharacterOperation[]) {
  const active = await fetchCharacterSnapshot();
  return mergeVisibleCharacters([], active, pendingOperations);
}

export function clearPersistedCharacterStore() {
  localStorage.removeItem(getCharacterStorageKey());
  localStorage.removeItem(getCharacterStoreStorageName());
}

const characterStorage = createScopedBufferedJsonStorage<PersistedCharacterState>({
  getScopedKey: getCharacterStorageKey,
  storageName: getCharacterStoreStorageName(),
  flushDelayMs: 96,
});

let characterSyncLifecycleRegistered = false;
let characterHydrationPromise: Promise<void> | null = null;

function ensureCharacterStoreHydrated() {
  if (useCharacterStore.persist.hasHydrated()) return Promise.resolve();
  characterHydrationPromise ??= Promise.resolve(useCharacterStore.persist.rehydrate()).finally(() => {
    characterHydrationPromise = null;
  });
  return characterHydrationPromise;
}

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
          set((current) => ({
            characters: projectVisibleCharacters(current.characters, nextQueue),
            pendingOperations: nextQueue,
            pendingEditSyncCount: nextQueue.length,
            pendingEditSyncError: latestCharacterError(nextQueue),
            lastSyncedAt: Date.now(),
          }));
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

      if (!characterSyncLifecycleRegistered) {
        characterSyncScheduler.registerLifecycle(flushPendingOperations, 300);
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
          await ensureCharacterStoreHydrated();
          set((state) => ({
            ...buildWarmState({
              items: state.characters,
              projectVisible: () => visibleCharactersFromState(state),
              pendingEditSyncCount: state.pendingOperations.length,
              pendingEditSyncError: latestCharacterError(state.pendingOperations),
              isLoading: state.characters.length === 0,
            }),
            characters: visibleCharactersFromState(state),
          }));
          if (shouldSkipCloudSync()) {
            set({ isLoading: false });
            return;
          }
          if (get().characters.length > 0 && Date.now() - get().lastSyncedAt < CHARACTER_REFRESH_TTL_MS) {
            set({ isLoading: false });
            return;
          }
          if (characterListLoadPromise) return characterListLoadPromise;
          characterListLoadPromise = (async () => {
            try {
              await uploadGuestCharactersToCloud();
              const visible = await reloadVisibleCharacterState(get().pendingOperations);
              set((state) => ({
                characters: mergeVisibleCharacters(state.characters, visible, state.pendingOperations),
                isLoading: false,
                lastSyncedAt: Date.now(),
                pendingEditSyncCount: get().pendingOperations.length,
                pendingEditSyncError: latestCharacterError(get().pendingOperations),
              }));
            } catch (error) {
              reportRecoverableError({
                location: 'cloud-sync:characters-load',
                error,
                userMessage: '角色云同步失败，请检查网络后重试。',
              });
              set({ isLoading: false, pendingEditSyncError: classifySyncError(error) });
            } finally {
              characterListLoadPromise = null;
            }
          })();
          return characterListLoadPromise;
        },

        loadCharacter: async (id) => {
          if (!id) return null;
          await ensureCharacterStoreHydrated();
          const cached = get().characters.find((character) => character.id === id);
          if (cached?.characterDetailLoaded) return cached;
          if (shouldSkipCloudSync()) return cached || null;
          const existing = characterDetailLoadPromises.get(id);
          if (existing) return existing;
          const promise = (async () => {
            try {
              const detail = await fetchCharacterDetail(id);
              set((state) => ({
                characters: mergeVisibleCharacters(state.characters, [detail], state.pendingOperations),
                lastSyncedAt: state.lastSyncedAt || Date.now(),
                pendingEditSyncCount: state.pendingOperations.length,
                pendingEditSyncError: latestCharacterError(state.pendingOperations),
              }));
              return detail;
            } catch (error) {
              reportRecoverableError({
                location: 'cloud-sync:character-detail-load',
                error,
                userMessage: '角色详情同步失败，请检查网络后重试。',
              });
              return get().characters.find((character) => character.id === id) || null;
            } finally {
              characterDetailLoadPromises.delete(id);
            }
          })();
          characterDetailLoadPromises.set(id, promise);
          return promise;
        },

        prefetchCharacters: async () => {
          const state = get();
          if (state.characters.length > 0 && Date.now() - state.lastSyncedAt < CHARACTER_REFRESH_TTL_MS) return;
          void get().loadCharacters();
        },

        flushPendingOperations,

        queuePatch: (entityId, patch, kind = 'patch') => {
          const character = get().characters.find((item) => item.id === entityId);
          if (character?.isPreset) {
            set((state) => {
              const characters = updateCharacterLocally(state, entityId, patch as Partial<AICharacter>);
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          const cloudPatch = compactCharacterPatchForCloud(patch);
          const operation = Object.keys(cloudPatch).length > 0
            ? createPendingCharacterOperation({ kind, targetIds: entityId ? [entityId] : [], patch: cloudPatch })
            : null;
          set((state) => {
            const queued = operation ? queueAndProjectCharacters(state, [operation]) : queueAndProjectCharacters(state, []);
            const nextCharacters = updateCharacterLocally({
              ...state,
              pendingOperations: queued.pendingOperations,
              characters: queued.characters,
            } as CharacterStore, entityId, patch as Partial<AICharacter>);
            syncCharacterArtifacts(nextCharacters);
            return {
              ...queued,
              characters: nextCharacters,
            };
          });
          if (operation) scheduleCharacterFlush(flushPendingOperations, 120);
        },

        loadProjectedDeletedCharacters: async () => {
          const { deleted } = await reloadProjectedCharacterState(get().pendingOperations);
          return deleted;
        },

        loadProjectedCharacters: async () => {
          return reloadVisibleCharacterState(get().pendingOperations);
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
          const [character] = await get().addCharacters([charData]);
          return character;
        },

        addCharacters: async (charsData) => {
          if (!charsData.length) return [];
          assertUniqueCharacterNameBatch(get().characters, charsData);
          if (shouldSkipCloudSync()) {
            const createdCharacters: AICharacter[] = [];
            set((state) => {
              let nextCharacters = state.characters;
              for (const charData of charsData) {
                const local = createCharacterLocally({ ...state, characters: nextCharacters }, charData);
                createdCharacters.push(local.character);
                nextCharacters = local.characters;
              }
              return { characters: nextCharacters };
            });
            enqueueBirthLettersForCreation(createdCharacters, get().characters);
            return createdCharacters;
          }
          const createdCharacters = await Promise.all(charsData.map((charData) => createCharacterRemote(charData)));
          set((state) => ({
            characters: mergeCharacters(state.characters, [...createdCharacters, ...state.characters], state.pendingOperations).filter((item) => item.deletedAt == null),
            lastSyncedAt: Date.now(),
          }));
          enqueueBirthLettersForCreation(createdCharacters, get().characters);
          return createdCharacters;
        },

        updateCharacter: async (id, updates) => {
          assertUniqueCharacterNameUpdate(get().characters, id, updates);
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = updateCharacterLocally(state, id, updates);
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          await get().syncPatch(id, updates, 'patch');
        },

        updateCharacters: async (patches) => {
          const normalizedPatches = patches.filter((patch) => patch.id);
          if (!normalizedPatches.length) return;
          normalizedPatches.forEach((patch) => assertUniqueCharacterNameUpdate(get().characters, patch.id, patch.updates));
          if (shouldSkipCloudSync()) {
            set((state) => {
              let nextCharacters = state.characters;
              for (const patch of normalizedPatches) {
                nextCharacters = updateCharacterLocally({ ...state, characters: nextCharacters } as CharacterStore, patch.id, patch.updates);
              }
              syncCharacterArtifacts(nextCharacters);
              return { characters: nextCharacters };
            });
            return;
          }
          const operations = normalizedPatches
            .map((patch) => {
              const character = get().characters.find((item) => item.id === patch.id);
              if (character?.isPreset) return null;
              const cloudPatch = compactCharacterPatchForCloud(patch.updates as Record<string, unknown>);
              if (Object.keys(cloudPatch).length === 0) return null;
              return createPendingCharacterOperation({ kind: 'patch', targetIds: [patch.id], patch: cloudPatch });
            })
            .filter(Boolean) as PendingCharacterOperation[];
          set((state) => {
            const queued = queueAndProjectCharacters(state, operations);
            let nextCharacters = queued.characters;
            for (const patch of normalizedPatches) {
              nextCharacters = updateCharacterLocally({
                ...state,
                pendingOperations: queued.pendingOperations,
                characters: nextCharacters,
              } as CharacterStore, patch.id, patch.updates);
            }
            return {
              ...queued,
              characters: nextCharacters,
            };
          });
          if (operations.length) scheduleCharacterFlush(flushPendingOperations, 120);
        },

        deleteCharacter: async (id) => {
          const normalizedIds = Array.from(new Set([id].filter(Boolean)));
          if (!normalizedIds.length) return;
          enqueueFinalLettersForDeletion(get().characters, normalizedIds);
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = deleteCharactersLocally(state, normalizedIds);
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          await Promise.all(normalizedIds.map((characterId) => api.deleteCharacter(characterId)));
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
          syncCharacterArtifacts(projectedState.visible);
        },

        deleteCharacters: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          enqueueFinalLettersForDeletion(get().characters, normalizedIds);
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = deleteCharactersLocally(state, normalizedIds);
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
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
          syncCharacterArtifacts(projectedState.visible);
        },

        restoreCharacters: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = restoreCharactersLocally(state, normalizedIds);
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          await applyCharacterRestore(normalizedIds);
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
          syncCharacterArtifacts(projectedState.visible);
        },

        purgeCharacters: async (ids) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          if (!normalizedIds.length) return;
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = sortCharacters(applyLocalCharacterPurge(state.characters, normalizedIds));
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          await applyCharacterPurge(normalizedIds);
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
          syncCharacterArtifacts(projectedState.visible);
        },

        emptyDeletedCharacters: async () => {
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = sortCharacters(applyLocalEmptyDeletedCharacters(state.characters));
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          await applyEmptyDeletedCharacters();
          const projectedState = await reloadProjectedCharacterState(get().pendingOperations);
          set({
            characters: projectedState.visible,
            lastSyncedAt: Date.now(),
            pendingEditSyncCount: get().pendingOperations.length,
            pendingEditSyncError: latestCharacterError(get().pendingOperations),
          });
          syncCharacterArtifacts(projectedState.visible);
        },

        loadDeletedCharacters: async () => {
          const { deleted } = await reloadProjectedCharacterState(get().pendingOperations);
          return deleted;
        },

        updateCharactersGroup: async (ids, group) => {
          const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
          const normalizedGroup = normalizeCharacterGroup(group);
          if (!normalizedIds.length) return;
          if (shouldSkipCloudSync()) {
            set((state) => ({
              characters: (() => {
                const characters = sortCharacters(state.characters.map((character) => normalizedIds.includes(character.id)
                  ? applyLocalCharacterUpdate(character, { group: normalizedGroup })
                  : character));
                syncCharacterArtifacts(characters);
                return characters;
              })(),
            }));
            return;
          }
          await Promise.all(normalizedIds.map((id) => get().syncPatch(id, { group: normalizedGroup }, 'patch')));
        },

        getCharacter: (id) => get().characters.find((c) => c.id === id),
        hasCharacterLoaded: (id) => Boolean(get().characters.find((c) => c.id === id)),
        getCharactersLoadedAt: () => get().lastSyncedAt,
        markCharactersWarm: () => set((state) => ({
          ...buildWarmState({
            items: state.characters,
            projectVisible: () => visibleCharactersFromState(state),
            pendingEditSyncCount: state.pendingOperations.length,
            pendingEditSyncError: latestCharacterError(state.pendingOperations),
            isLoading: state.isLoading,
          }),
          characters: visibleCharactersFromState(state),
        })),
        getPresets: () => get().characters.filter((c) => c.isPreset),
        getCustom: () => get().characters.filter((c) => !c.isPreset),

        importCharacters: async (chars) => {
          assertUniqueCharacterNameBatch(get().characters, chars);
          if (shouldSkipCloudSync()) {
            set((state) => {
              const characters = importCharactersBatchLocally(state, chars);
              syncCharacterArtifacts(characters);
              return { characters };
            });
            return;
          }
          const created = await Promise.all(chars.map((c) => createCharacterRemote(c)));
          set((state) => ({
            characters: mergeCharacters(state.characters, [...created, ...state.characters], state.pendingOperations).filter((item) => item.deletedAt == null),
          }));
          syncCharacterArtifacts(get().characters);
        },

        initializePresets: async () => {
          await get().loadCharacters();
        },
      };
    },
    {
      name: getCharacterStoreStorageName(),
      storage: characterStorage,
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => {
        const migrated = migrateCharacterStoreState(persistedState as PersistedCharacterState) as PersistedCharacterState;
        return {
          ...migrated,
          pendingOperations: recoverInterruptedOperations(migrated.pendingOperations || []),
        };
      },
      partialize: (state) => buildPersistedCharacterState({
        characters: state.characters,
        lastSyncedAt: state.lastSyncedAt,
        pendingOperations: state.pendingOperations,
      }),
      skipHydration: true,
    }
  )
);

export const __characterRuntimePersistenceForTests = {
  compactCharacterPatchForCloud,
  buildPersistedCharacterState,
  limits: CHARACTER_RUNTIME_PERSIST_LIMITS,
};
