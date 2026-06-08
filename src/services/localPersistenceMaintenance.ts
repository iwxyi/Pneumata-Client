import { scopedStorageKey } from '../constants/brand';
import { getLocalDataUserId } from './authStorageScope';
import { clearPersistenceFailures } from './persistenceHealth';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import {
  flushBufferedPersistenceWrites,
  migrateLocalStorageFallbacksToIndexedDb,
  readIndexedDbStorageDiagnostics,
  type IndexedDbStorageDiagnostics,
  type LocalStorageFallbackMigrationResult,
} from '../stores/storePersistenceScope';

export interface LocalPersistenceMaintenanceResult {
  migratedFallbacks: LocalStorageFallbackMigrationResult;
  diagnostics: IndexedDbStorageDiagnostics;
  retriedStores: string[];
}

function buildMigratedStoreKeys() {
  const userId = getLocalDataUserId();
  return [
    scopedStorageKey(`messages-${userId}`),
    scopedStorageKey(`chats-${userId}`),
    scopedStorageKey(`characters-${userId}`),
    scopedStorageKey(`character-artifacts-${userId}`),
    scopedStorageKey('messages-guest'),
    scopedStorageKey('chats-guest'),
    scopedStorageKey('characters-guest'),
    scopedStorageKey('character-artifacts-guest'),
  ];
}

function retryStorePersistence() {
  useMessageStore.setState((state) => ({
    messageWindowsByChatId: state.messageWindowsByChatId,
    pendingOperations: state.pendingOperations,
  }));
  useChatStore.setState((state) => ({
    chats: state.chats,
    currentChatId: state.currentChatId,
    lastSyncedAt: state.lastSyncedAt,
    pendingOperations: state.pendingOperations,
    fieldConflicts: state.fieldConflicts,
  }));
  useCharacterStore.setState((state) => ({
    characters: state.characters,
    lastSyncedAt: state.lastSyncedAt,
    pendingOperations: state.pendingOperations,
    fieldConflicts: state.fieldConflicts,
  }));
  useCharacterArtifactStore.setState((state) => ({
    items: state.items,
    jobs: state.jobs,
  }));
  flushBufferedPersistenceWrites();
}

export async function runLocalPersistenceMaintenance(): Promise<LocalPersistenceMaintenanceResult> {
  const migratedFallbacks = await migrateLocalStorageFallbacksToIndexedDb(buildMigratedStoreKeys());
  clearPersistenceFailures();
  retryStorePersistence();
  return {
    migratedFallbacks,
    diagnostics: await readIndexedDbStorageDiagnostics(),
    retriedStores: ['messages', 'chats', 'characters', 'character-artifacts'],
  };
}
