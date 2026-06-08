import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AICharacter } from '../types/character';
import type { AIModelProfile } from '../types/settings';
import { getUsableDefaultTextAIProfile, hasUsableDefaultTextAI, isAIProfileUsable } from '../types/settings';
import { createScopedIndexedDbBufferedJsonStorage, createScopedIndexedDbStorage } from './storePersistenceScope';
import { createSyncScopeMetadata, type SyncScopeSnapshot } from './syncScopeMetadata';
import { CLIENT_STORE_SCHEMA_VERSION } from './storeMigrations';
import { buildCharacterBirthLetterContext, buildCharacterDailyDiaryContext, buildCharacterExperienceArtifactContext, buildCharacterFinalLetterContext, buildLocalCharacterExperienceArtifact, generateCharacterDailyDiaryArtifact, generateCharacterExperienceArtifact, looksLikeRawArtifactContext } from '../services/characterExperienceArtifacts';
import { useSettingsStore } from './useSettingsStore';
import { isCharacterFeatureEnabled } from '../services/characterGenerationPolicy';
import { scopedStorageKey, storageKey } from '../constants/brand';
import { api, type CharacterArtifactQuery, type CharacterArtifactSummaryEntry, type CharacterArtifactSyncEntry, type SyncChangeScope } from '../services/api';
import { getLocalDataUserId } from '../services/authStorageScope';
import { isCloudSyncEnabled } from '../services/cloudSyncPreference';
import { isCloudSyncBootstrapLocked } from '../services/cloudSyncBootstrapLock';
import { createSyncScheduler } from './storeSyncScheduler';
import { markLocalOutboxWorkerOperation, mirrorLocalOutboxWorkerQueue, removeLocalOutboxWorkerOperation } from '../services/localOutboxWorkerBridge';

export type CharacterArtifactKind = 'birth_letter' | 'diary' | 'final_letter';
export type CharacterArtifactJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface CharacterArtifactGenerationSnapshot {
  promptVersion: 'character-experience-artifacts-v2';
  character: Partial<AICharacter>;
  relatedCharacters: Array<{ id: string; name: string }>;
  generatedAt: number;
}

export interface CharacterArtifactEntry {
  id: string;
  kind: CharacterArtifactKind;
  characterId: string;
  characterName: string;
  dateKey?: string | null;
  sourceKey?: string | null;
  title: string;
  text: string;
  source: 'ai' | 'local';
  unread: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  revision?: number;
  generationSnapshot?: CharacterArtifactGenerationSnapshot;
}

interface CharacterArtifactJob {
  id: string;
  key: string;
  kind: CharacterArtifactKind;
  characterId: string;
  dateKey?: string | null;
  sourceKey?: string | null;
  snapshot: Partial<AICharacter>;
  relatedCharacters: Array<{ id: string; name: string }>;
  status: CharacterArtifactJobStatus;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

interface ArtifactSnapshot {
  items: CharacterArtifactEntry[];
  jobs: CharacterArtifactJob[];
}

interface CharacterArtifactStore extends ArtifactSnapshot {
  isProcessing: boolean;
  unreadLetterCount: number;
  syncCharacters: (characters: AICharacter[]) => void;
  enqueueLetterArtifact: (params: {
    kind: Extract<CharacterArtifactKind, 'birth_letter' | 'final_letter'>;
    character: AICharacter;
    relatedCharacters: Array<{ id: string; name: string }>;
    sourceKey?: string;
  }) => void;
  enqueueBirthLetter: (character: AICharacter, relatedCharacters: Array<{ id: string; name: string }>) => void;
  enqueueFinalLetter: (character: AICharacter, relatedCharacters: Array<{ id: string; name: string }>) => void;
  markLettersRead: () => void;
  getDiaryEntries: (characterId: string) => CharacterArtifactEntry[];
  getLetterEntries: () => CharacterArtifactEntry[];
  regenerateArtifact: (params: {
    itemId: string;
    character?: Partial<AICharacter> | null;
    relatedCharacters?: Array<{ id: string; name: string }>;
  }) => Promise<CharacterArtifactEntry>;
  syncCloud: (query?: CharacterArtifactQuery) => Promise<void>;
  getSyncScopeStates: () => SyncScopeSnapshot[];
  resumeProcessing: () => Promise<void>;
  discardFailedJob: (jobId: string) => void;
}

function getArtifactStorageKey() {
  return scopedStorageKey(`character-artifacts-${getLocalDataUserId()}`);
}

function getGuestArtifactStorageKey() {
  return scopedStorageKey('character-artifacts-guest');
}

function isCloudMode() {
  return isCloudSyncEnabled()
    && !isCloudSyncBootstrapLocked()
    && Boolean(localStorage.getItem(storageKey('token')))
    && localStorage.getItem(storageKey('auth-mode')) !== 'local';
}

async function readPersistedItemsFromKey(key: string) {
  try {
    const storage = createScopedIndexedDbStorage({
      getScopedKey: () => key,
      storageName: scopedStorageKey('character-artifacts'),
    });
    const raw = await storage.getItem(scopedStorageKey('character-artifacts'));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { items?: CharacterArtifactEntry[] } };
    return Array.isArray(parsed.state?.items) ? parsed.state.items : [];
  } catch {
    return [];
  }
}

function createArtifactStorage() {
  return createScopedIndexedDbStorage({
    getScopedKey: getArtifactStorageKey,
    storageName: scopedStorageKey('character-artifacts'),
  });
}

const artifactStorage = createScopedIndexedDbBufferedJsonStorage<ArtifactSnapshot>({
  getScopedKey: getArtifactStorageKey,
  storageName: scopedStorageKey('character-artifacts'),
  flushDelayMs: 96,
});

function now() {
  return Date.now();
}

const DIARY_BACKFILL_WINDOW_DAYS = 7;
const ARTIFACT_SYNC_TTL_MS = 30_000;
const ARTIFACT_SUMMARY_SCOPE: SyncChangeScope = 'artifacts.summary';
const artifactScopeSyncScheduler = createSyncScheduler('artifact.scope-refresh', { priority: 15 });
const artifactSyncScopes = createSyncScopeMetadata(ARTIFACT_SYNC_TTL_MS, {
  getStorageKey: () => scopedStorageKey(`artifact-sync-scopes-${getLocalDataUserId()}`),
});
let artifactSyncLifecycleRegistered = false;

export function clearPersistedCharacterArtifactStore() {
  void useCharacterArtifactStore.persist.clearStorage();
  localStorage.removeItem(getArtifactStorageKey());
  localStorage.removeItem(scopedStorageKey('character-artifacts'));
  artifactSyncScopes.clear();
}

export function resetCharacterArtifactStoreForAccountBoundary() {
  clearPersistedCharacterArtifactStore();
  useCharacterArtifactStore.setState({
    items: [],
    jobs: [],
    isProcessing: false,
    unreadLetterCount: 0,
  });
}

function artifactSyncScope(query: CharacterArtifactQuery = {}) {
  const parts = [
    query.kind ? `kind:${query.kind}` : '',
    query.characterId ? `character:${query.characterId}` : '',
    query.dateFrom ? `from:${query.dateFrom}` : '',
    query.dateTo ? `to:${query.dateTo}` : '',
  ].filter(Boolean);
  return `artifacts.summary${parts.length ? `:${parts.join('|')}` : ''}`;
}

async function probeArtifactSummaryChanges(scope: SyncChangeScope, options: { forceFull?: boolean } = {}) {
  const scopeState = artifactSyncScopes.getState(scope);
  const since = options.forceFull ? null : scopeState.cursor ?? scopeState.revision ?? null;
  try {
    return await api.getSyncChanges({ scope, since });
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeArtifactSummaryChange(change: Record<string, unknown>): CharacterArtifactSummaryEntry | null {
  if (change.entity !== 'artifact_summary' || typeof change.id !== 'string') return null;
  const patch = isRecord(change.patch) ? change.patch : {};
  if (typeof patch.kind !== 'string' || typeof patch.characterId !== 'string') return null;
  return {
    id: change.id,
    kind: patch.kind as CharacterArtifactKind,
    characterId: patch.characterId,
    characterName: typeof patch.characterName === 'string' ? patch.characterName : '',
    dateKey: typeof patch.dateKey === 'string' ? patch.dateKey : null,
    sourceKey: typeof patch.sourceKey === 'string' ? patch.sourceKey : null,
    title: typeof patch.title === 'string' ? patch.title : '',
    source: patch.source === 'ai' ? 'ai' : 'local',
    unread: Boolean(patch.unread),
    createdAt: Number(patch.createdAt || 0),
    updatedAt: Number(patch.updatedAt || 0),
    deletedAt: patch.deletedAt == null ? null : Number(patch.deletedAt),
    revision: Number(patch.revision || change.revision || 1),
  };
}

function artifactSummariesFromChanges(changes: Array<Record<string, unknown>> | undefined) {
  if (!changes?.length) return null;
  const summaries: CharacterArtifactSummaryEntry[] = [];
  for (const change of changes) {
    const summary = normalizeArtifactSummaryChange(change);
    if (!summary) return null;
    summaries.push(summary);
  }
  return {
    items: summaries,
    updatedAt: summaries.reduce((max, item) => Math.max(max, item.updatedAt || 0), 0),
  };
}

function dateKeyOf(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function parseDateKey(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function shiftDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  date.setDate(date.getDate() + days);
  return dateKeyOf(date.getTime());
}

function startOfDayKey(value: number) {
  return `${dateKeyOf(value)}T00:00:00`;
}

function isLetterKind(kind: CharacterArtifactKind) {
  return kind === 'birth_letter' || kind === 'final_letter';
}

function normalizeString(value?: string | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniquePush(list: string[], value: string) {
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

function buildRelatedCharacters(character: Partial<AICharacter>, characters: AICharacter[]) {
  return (character.relationships || [])
    .map((relation) => characters.find((item) => item.id === relation.characterId))
    .filter((item): item is AICharacter => Boolean(item))
    .map((item) => ({ id: item.id, name: item.name }));
}

function collectCharacterSourceDateKeys(character: Partial<AICharacter>) {
  const keys = new Set<string>();
  (character.layeredMemories || []).forEach((item) => {
    if (item.createdAt) keys.add(dateKeyOf(item.createdAt));
    if (item.updatedAt) keys.add(dateKeyOf(item.updatedAt));
  });
  (character.relationships || []).forEach((relation) => {
    if (relation.updatedAt) keys.add(dateKeyOf(relation.updatedAt));
  });
  (character.runtimeTimeline || []).forEach((item) => {
    if (item.createdAt) keys.add(dateKeyOf(item.createdAt));
  });
  return Array.from(keys).sort();
}

function buildDiaryJobKey(characterId: string, dateKey: string) {
  return `diary:${characterId}:${dateKey}`;
}

function buildLetterJobKey(kind: Extract<CharacterArtifactKind, 'birth_letter' | 'final_letter'>, characterId: string, sourceKey = '') {
  return `${kind}:${characterId}:${sourceKey || 'default'}`;
}

function isDiaryEntry(item: CharacterArtifactEntry) {
  return item.kind === 'diary';
}

function isFinalLetterEntry(item: CharacterArtifactEntry) {
  return item.kind === 'final_letter';
}

function isBirthLetterEntry(item: CharacterArtifactEntry) {
  return item.kind === 'birth_letter';
}

function computeUnreadLetterCount(items: CharacterArtifactEntry[]) {
  return items.filter((item) => item.deletedAt == null && (isFinalLetterEntry(item) || isBirthLetterEntry(item)) && item.unread).length;
}

function buildArtifactLogicalKey(item: CharacterArtifactEntry) {
  if (item.kind === 'diary') return `diary:${item.characterId}:${item.dateKey || ''}`;
  if (item.kind === 'birth_letter') return `birth_letter:${item.characterId}:${item.sourceKey || ''}`;
  return `${item.kind}:${item.characterId}:${item.sourceKey || item.id}`;
}

function chooseBetterArtifactEntry(a: CharacterArtifactEntry, b: CharacterArtifactEntry) {
  if ((a.deletedAt || 0) !== (b.deletedAt || 0)) {
    return (b.deletedAt || 0) > (a.deletedAt || 0) ? b : a;
  }
  const aRaw = looksLikeRawArtifactContext(a.text);
  const bRaw = looksLikeRawArtifactContext(b.text);
  if (aRaw !== bRaw) return aRaw ? b : a;
  return (b.updatedAt || b.createdAt || 0) > (a.updatedAt || a.createdAt || 0) ? b : a;
}

function mergeArtifactItems(...sources: CharacterArtifactEntry[][]) {
  const byId = new Map<string, CharacterArtifactEntry>();
  sources.flat().forEach((item) => {
    if (!item?.id || !item.kind || !item.characterId) return;
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? chooseBetterArtifactEntry(existing, item) : item);
  });

  const byLogicalKey = new Map<string, CharacterArtifactEntry>();
  Array.from(byId.values()).forEach((item) => {
    const key = buildArtifactLogicalKey(item);
    const existing = byLogicalKey.get(key);
    byLogicalKey.set(key, existing ? chooseBetterArtifactEntry(existing, item) : item);
  });

  return Array.from(byLogicalKey.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function buildItemsSignature(items: CharacterArtifactEntry[]) {
  return items
    .map((item) => `${item.id}:${item.updatedAt}:${item.deletedAt || 0}:${item.unread ? 1 : 0}:${item.text.length}`)
    .sort()
    .join('|');
}

function hasArtifactText(item: CharacterArtifactEntry | undefined) {
  return Boolean(item && typeof item.text === 'string' && item.text.length > 0);
}

function shouldFetchArtifactDetail(summary: CharacterArtifactSummaryEntry, local: CharacterArtifactEntry | undefined) {
  if (summary.deletedAt != null) return false;
  if (!local) return true;
  if (!hasArtifactText(local)) return true;
  return (summary.updatedAt || 0) > (local.updatedAt || 0);
}

function shouldUploadArtifactItem(local: CharacterArtifactEntry, summary: CharacterArtifactSummaryEntry | undefined) {
  if (local.deletedAt != null || summary?.deletedAt != null) return false;
  if (!summary) return true;
  return (local.updatedAt || 0) > (summary.updatedAt || 0);
}

function shouldDeleteArtifactItem(local: CharacterArtifactEntry, summary: CharacterArtifactSummaryEntry | undefined) {
  if (local.deletedAt == null) return false;
  const localDeletedAt = local.deletedAt || local.updatedAt || local.createdAt || 0;
  if (!summary) return true;
  const remoteDeletedAt = summary.deletedAt || 0;
  const remoteUpdatedAt = summary.updatedAt || 0;
  if (remoteDeletedAt >= localDeletedAt) return false;
  return localDeletedAt > remoteUpdatedAt;
}

function buildArtifactUploadOperationId(item: CharacterArtifactEntry) {
  return `artifact-upsert:${item.id}:${item.updatedAt || item.createdAt || 0}`;
}

function buildArtifactDeleteOperationId(item: CharacterArtifactEntry) {
  return `artifact-delete:${item.id}:${item.deletedAt || item.updatedAt || item.createdAt || 0}`;
}

function compactString(value: string | undefined | null, max: number) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

function compactArtifactCharacterSnapshot(character: Partial<AICharacter> | undefined): Partial<AICharacter> | undefined {
  if (!character) return undefined;
  return {
    id: character.id,
    name: character.name,
    background: compactString(character.background, 2000),
    speakingStyle: compactString(character.speakingStyle, 1000),
    expertise: (character.expertise || []).slice(0, 12),
    group: character.group,
    relationships: (character.relationships || []).slice(-24),
    memory: character.memory ? {
      shortTermSummary: compactString(character.memory.shortTermSummary, 1200),
      longTerm: (character.memory.longTerm || []).slice(-24),
      secrets: (character.memory.secrets || []).slice(-12),
      obsessions: (character.memory.obsessions || []).slice(-12),
      tabooTopics: (character.memory.tabooTopics || []).slice(-12),
      userMemories: (character.memory.userMemories || []).slice(-24),
    } : undefined,
    layeredMemories: (character.layeredMemories || []).slice(-40).map((memory) => ({
      ...memory,
      text: compactString(memory.text, 600),
      evidenceText: compactString(memory.evidenceText, 600),
      evidenceTrail: (memory.evidenceTrail || []).slice(-3).map((trail) => ({
        ...trail,
        text: compactString(trail.text, 400),
        memoryText: compactString(trail.memoryText, 400),
        sourceEventIds: (trail.sourceEventIds || []).slice(-8),
      })),
      sourceEventIds: (memory.sourceEventIds || []).slice(-12),
    })),
    emotionalState: character.emotionalState,
    soulState: character.soulState,
    coreProfile: character.coreProfile,
    visualIdentity: character.visualIdentity ? {
      description: compactString(character.visualIdentity.description, 1000),
      styleHint: compactString(character.visualIdentity.styleHint, 500),
      negativePrompt: compactString(character.visualIdentity.negativePrompt, 500),
      seed: character.visualIdentity.seed,
      primaryReferenceImageId: character.visualIdentity.primaryReferenceImageId,
      defaults: character.visualIdentity.defaults,
      referenceImages: (character.visualIdentity.referenceImages || []).slice(0, 6).map((image) => ({
        id: image.id,
        assetId: image.assetId,
        url: '',
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        checksum: image.checksum,
        label: image.label,
        source: image.source,
        isPrimary: image.isPrimary,
        createdAt: image.createdAt,
      })),
    } : undefined,
    runtimeTimeline: (character.runtimeTimeline || []).slice(-24).map((entry) => ({
      ...entry,
      text: compactString(entry.text, 500),
    })),
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  };
}

function projectArtifactItemForCloudUpload(item: CharacterArtifactEntry): CharacterArtifactSyncEntry {
  return {
    ...item,
    characterName: compactString(item.characterName, 200),
    sourceKey: item.sourceKey ? compactString(item.sourceKey, 160) : null,
    title: compactString(item.title, 300),
    revision: item.revision,
    generationSnapshot: item.generationSnapshot ? {
      promptVersion: item.generationSnapshot.promptVersion,
      character: compactArtifactCharacterSnapshot(item.generationSnapshot.character) || {},
      relatedCharacters: (item.generationSnapshot.relatedCharacters || []).slice(0, 32).map((character) => ({
        id: compactString(character.id, 191),
        name: compactString(character.name, 120),
      })),
      generatedAt: item.generationSnapshot.generatedAt,
    } : undefined,
  };
}

function buildArtifactUploadDebug(item: CharacterArtifactEntry) {
  const projected = projectArtifactItemForCloudUpload(item);
  return {
    id: item.id,
    kind: item.kind,
    characterId: item.characterId,
    lengths: {
      id: item.id.length,
      characterId: item.characterId.length,
      characterName: item.characterName.length,
      sourceKey: item.sourceKey?.length || 0,
      title: item.title.length,
      text: item.text.length,
      generationSnapshot: projected.generationSnapshot ? JSON.stringify(projected.generationSnapshot).length : 0,
      rawGenerationSnapshot: item.generationSnapshot ? JSON.stringify(item.generationSnapshot).length : 0,
    },
  };
}

function artifactMatchesQuery(item: CharacterArtifactEntry, query: CharacterArtifactQuery) {
  if (query.kind && item.kind !== query.kind) return false;
  if (query.characterId && item.characterId !== query.characterId) return false;
  if (query.dateFrom && (!item.dateKey || item.dateKey < query.dateFrom)) return false;
  if (query.dateTo && (!item.dateKey || item.dateKey > query.dateTo)) return false;
  return true;
}

function applyRemoteDeletedArtifactSummaries(items: CharacterArtifactEntry[], summaries: CharacterArtifactSummaryEntry[]) {
  if (!summaries.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  summaries.forEach((summary) => {
    if (summary.deletedAt == null) return;
    const existing = byId.get(summary.id);
    const deletedAt = summary.deletedAt;
    if (!existing) {
      byId.set(summary.id, {
        id: summary.id,
        kind: summary.kind,
        characterId: summary.characterId,
        characterName: summary.characterName,
        dateKey: summary.dateKey ?? null,
        sourceKey: summary.sourceKey ?? null,
        title: summary.title,
        text: '',
        source: summary.source,
        unread: false,
        createdAt: summary.createdAt,
        updatedAt: Math.max(summary.updatedAt || 0, deletedAt),
        deletedAt,
        revision: summary.revision,
      });
      return;
    }
    if ((existing.deletedAt || 0) >= deletedAt) return;
    if ((existing.updatedAt || 0) >= deletedAt) return;
    byId.set(summary.id, {
      ...existing,
      characterName: summary.characterName || existing.characterName,
      title: summary.title || existing.title,
      unread: false,
      updatedAt: Math.max(existing.updatedAt || 0, summary.updatedAt || 0, deletedAt),
      deletedAt,
      revision: Math.max(existing.revision || 0, summary.revision || 0) || undefined,
    });
  });
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function createArtifactEntry(params: {
  kind: CharacterArtifactKind;
  characterId: string;
  characterName: string;
  title: string;
  text: string;
  dateKey?: string | null;
  sourceKey?: string | null;
  source: 'ai' | 'local';
  unread?: boolean;
  generationSnapshot?: CharacterArtifactGenerationSnapshot;
}) {
  const createdAt = now();
  return {
    id: `${params.kind}-${params.characterId}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind: params.kind,
    characterId: params.characterId,
    characterName: params.characterName,
    dateKey: params.dateKey || null,
    sourceKey: params.sourceKey || null,
    title: params.title,
    text: params.text,
    source: params.source,
    unread: params.unread ?? false,
    createdAt,
    updatedAt: createdAt,
    generationSnapshot: params.generationSnapshot,
  } satisfies CharacterArtifactEntry;
}

function buildDiaryTitle(characterName: string, dateKey: string) {
  return `${characterName} · ${dateKey}`;
}

function buildBirthLetterTitle(characterName: string) {
  return `${characterName} 的诞生信`;
}

function buildFinalLetterTitle(characterName: string) {
  return `${characterName} 的信`;
}

function buildLetterTitle(kind: CharacterArtifactKind, characterName: string) {
  if (kind === 'birth_letter') return buildBirthLetterTitle(characterName);
  if (kind === 'final_letter') return buildFinalLetterTitle(characterName);
  return buildFinalLetterTitle(characterName);
}

function buildGenerationSnapshot(
  character: Partial<AICharacter>,
  relatedCharacters: Array<{ id: string; name: string }>,
): CharacterArtifactGenerationSnapshot {
  return {
    promptVersion: 'character-experience-artifacts-v2',
    character: {
      id: character.id,
      name: character.name,
      background: character.background,
      speakingStyle: character.speakingStyle,
      expertise: character.expertise,
      group: character.group,
      relationships: character.relationships,
      memory: character.memory,
      layeredMemories: character.layeredMemories,
      emotionalState: character.emotionalState,
      soulState: character.soulState,
      coreProfile: character.coreProfile,
      visualIdentity: character.visualIdentity ? {
        description: character.visualIdentity.description,
        styleHint: character.visualIdentity.styleHint,
        negativePrompt: character.visualIdentity.negativePrompt,
        seed: character.visualIdentity.seed,
        primaryReferenceImageId: character.visualIdentity.primaryReferenceImageId,
        defaults: character.visualIdentity.defaults,
        referenceImages: character.visualIdentity.referenceImages?.map((image) => ({
          id: image.id,
          assetId: image.assetId,
          url: '',
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          checksum: image.checksum,
          label: image.label,
          source: image.source,
          isPrimary: image.isPrimary,
          createdAt: image.createdAt,
        })),
      } : undefined,
      runtimeTimeline: character.runtimeTimeline,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    },
    relatedCharacters,
    generatedAt: now(),
  };
}

function hasMeaningfulBirthSignals(character: Partial<AICharacter>) {
  const hasBackground = Boolean(normalizeString(character.background));
  const hasSpeakingStyle = Boolean(normalizeString(character.speakingStyle));
  const hasExpertise = (character.expertise || []).some((item) => Boolean(normalizeString(item)));
  const hasCoreProfile = Boolean(character.coreProfile?.coreDesire || character.coreProfile?.coreFear);
  const hasVisualIdentity = Boolean(character.visualIdentity?.description || character.visualIdentity?.referenceImages?.length);
  const hasMemorySeed = Boolean(character.memory?.shortTermSummary || character.memory?.longTerm?.length || character.layeredMemories?.length);
  const score = [
    hasBackground ? 1 : 0,
    hasSpeakingStyle ? 1 : 0,
    hasExpertise ? 1 : 0,
    hasCoreProfile ? 1 : 0,
    hasVisualIdentity ? 1 : 0,
    hasMemorySeed ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  return Boolean(normalizeString(character.name)) && score >= 3;
}

function deriveDiaryText(character: Partial<AICharacter>, relatedCharacters: Array<{ id: string; name: string }>, dateKey: string, recentDiaryTexts: string[] = []) {
  return buildLocalCharacterExperienceArtifact('diary', buildCharacterDailyDiaryContext(character, relatedCharacters, dateKey, recentDiaryTexts));
}

function deriveBirthLetterText(character: Partial<AICharacter>, relatedCharacters: Array<{ id: string; name: string }>) {
  return buildLocalCharacterExperienceArtifact('birth_letter', buildCharacterBirthLetterContext(character, relatedCharacters));
}

function deriveFinalLetterText(character: Partial<AICharacter>, relatedCharacters: Array<{ id: string; name: string }>) {
  return buildLocalCharacterExperienceArtifact('final_letter', buildCharacterFinalLetterContext(character, relatedCharacters));
}

async function generateLetterArtifactText(
  kind: Extract<CharacterArtifactKind, 'birth_letter' | 'final_letter'>,
  character: Partial<AICharacter>,
  relatedCharacters: Array<{ id: string; name: string }>,
  modelProfile: AIModelProfile | null,
) {
  if (!isAIProfileUsable(modelProfile)) {
    return kind === 'birth_letter'
      ? deriveBirthLetterText(character, relatedCharacters)
      : deriveFinalLetterText(character, relatedCharacters);
  }

  return generateCharacterExperienceArtifact({
    config: modelProfile,
    kind,
    character,
    relatedCharacters,
    language: useSettingsStore.getState().language === 'zh' ? 'zh' : 'en',
  });
}

function mergeJob(existing: CharacterArtifactJob | undefined, next: CharacterArtifactJob) {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    attempts: Math.max(existing.attempts, next.attempts),
    status: existing.status === 'running' ? 'pending' : next.status,
    updatedAt: next.updatedAt,
  };
}

function compareDiaryJobs(a: CharacterArtifactJob, b: CharacterArtifactJob) {
  const dateCompare = (a.dateKey || '').localeCompare(b.dateKey || '');
  if (dateCompare !== 0) return dateCompare;
  const nameCompare = normalizeString(a.snapshot.name).localeCompare(normalizeString(b.snapshot.name), 'zh-Hans-CN');
  if (nameCompare !== 0) return nameCompare;
  return a.characterId.localeCompare(b.characterId);
}

function compareArtifactJobs(a: CharacterArtifactJob, b: CharacterArtifactJob) {
  if (a.kind === 'diary' && b.kind === 'diary') return compareDiaryJobs(a, b);
  return a.createdAt - b.createdAt;
}

function removeCompletedJobs(jobs: CharacterArtifactJob[]) {
  return jobs.filter((job) => job.status !== 'succeeded');
}

function queueSnapshotJobs(snapshot: ArtifactSnapshot, jobs: CharacterArtifactJob[]) {
  const merged = new Map<string, CharacterArtifactJob>();
  [...snapshot.jobs, ...jobs].forEach((job) => {
    merged.set(job.key, mergeJob(merged.get(job.key), job));
  });
  return {
    items: snapshot.items,
    jobs: Array.from(merged.values()).sort(compareArtifactJobs),
  };
}

async function generateArtifactText(
  kind: CharacterArtifactKind,
  character: Partial<AICharacter>,
  relatedCharacters: Array<{ id: string; name: string }>,
  dateKey: string | null,
  modelProfile: AIModelProfile | null,
  recentDiaryTexts: string[] = [],
) {
  if (kind === 'birth_letter' || kind === 'final_letter') {
    return generateLetterArtifactText(kind, character, relatedCharacters, modelProfile);
  }
  if (!isAIProfileUsable(modelProfile)) {
    return deriveDiaryText(character, relatedCharacters, dateKey || dateKeyOf(now() - 24 * 60 * 60 * 1000), recentDiaryTexts);
  }
  if (kind === 'diary') {
    return generateCharacterDailyDiaryArtifact({
      config: modelProfile,
      character,
      relatedCharacters,
      dateKey: dateKey || dateKeyOf(now() - 24 * 60 * 60 * 1000),
      recentDiaryTexts,
      language: useSettingsStore.getState().language === 'zh' ? 'zh' : 'en',
    });
  }

  return generateCharacterExperienceArtifact({
    config: modelProfile,
    kind: 'final_letter',
    character,
    relatedCharacters,
    language: useSettingsStore.getState().language === 'zh' ? 'zh' : 'en',
  });
}

export const useCharacterArtifactStore = create<CharacterArtifactStore>()(
  persist(
    (set, get) => {
      let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
      let cloudSyncRunning = false;
      let cloudSyncPending = false;
      let cloudSyncPendingQuery: CharacterArtifactQuery | undefined;
      let cloudSyncDirty = false;

      const scheduleCloudSync = () => {
        if (!isCloudMode()) return;
        cloudSyncDirty = true;
        if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
        cloudSyncTimer = setTimeout(() => {
          cloudSyncTimer = null;
          void get().syncCloud();
        }, 700);
      };
      const refreshArtifactSummaryScope = async () => {
        if (!get().items.length && artifactSyncScopes.listStates().length === 0) return;
        await get().syncCloud();
      };

      if (!artifactSyncLifecycleRegistered) {
        artifactScopeSyncScheduler.registerLifecycle(refreshArtifactSummaryScope, 750);
        artifactSyncLifecycleRegistered = true;
      }

      const enqueueJobs = (jobs: CharacterArtifactJob[]) => {
        if (!jobs.length) return;
        set((state) => {
          const next = queueSnapshotJobs(state, jobs);
          return {
            ...next,
            unreadLetterCount: computeUnreadLetterCount(next.items),
          };
        });
        void mirrorLocalOutboxWorkerQueue('artifact', get().jobs);
        void get().resumeProcessing();
      };

      const processNext = async () => {
        if (get().isProcessing) return;
        await mirrorLocalOutboxWorkerQueue('artifact', get().jobs);
        const nextJob = get().jobs.find((job) => job.status === 'pending');
        if (!nextJob) return;

        set((state) => ({
          jobs: state.jobs.map((job) => job.id === nextJob.id ? { ...job, status: 'running', updatedAt: now() } : job),
          isProcessing: true,
        }));
        markLocalOutboxWorkerOperation({ id: nextJob.id, status: 'syncing', attemptCount: nextJob.attempts });

        const modelProfile = getUsableDefaultTextAIProfile(useSettingsStore.getState().aiProfiles);
        if (isLetterKind(nextJob.kind) && !modelProfile) {
          set((state) => ({
            jobs: state.jobs.filter((job) => job.id !== nextJob.id),
            isProcessing: false,
          }));
          removeLocalOutboxWorkerOperation(nextJob.id);
          void processNext();
          return;
        }
        try {
          const recentDiaryTexts = nextJob.kind === 'diary'
            ? get().items
                .filter((item) => item.kind === 'diary' && item.characterId === nextJob.characterId && item.dateKey !== nextJob.dateKey)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 5)
                .map((item) => item.text)
            : [];
          const text = (await generateArtifactText(nextJob.kind, nextJob.snapshot, nextJob.relatedCharacters, nextJob.dateKey || null, modelProfile, recentDiaryTexts)).trim();
          const characterName = normalizeString(nextJob.snapshot.name) || '角色';
          const entry = createArtifactEntry({
            kind: nextJob.kind,
            characterId: nextJob.characterId,
            characterName,
            dateKey: nextJob.dateKey,
            sourceKey: nextJob.sourceKey,
            title: nextJob.kind === 'birth_letter'
              ? buildBirthLetterTitle(characterName)
              : nextJob.kind === 'diary'
                ? buildDiaryTitle(characterName, nextJob.dateKey || dateKeyOf(now()))
                : buildFinalLetterTitle(characterName),
            text,
            source: isAIProfileUsable(modelProfile) ? 'ai' : 'local',
            unread: nextJob.kind === 'final_letter' || nextJob.kind === 'birth_letter',
            generationSnapshot: buildGenerationSnapshot(nextJob.snapshot, nextJob.relatedCharacters),
          });

          set((state) => {
            const remainingJobs = state.jobs.map((job) => job.id === nextJob.id ? { ...job, status: 'succeeded' as const, updatedAt: now() } : job);
            const staleRawItems = state.items.filter((item) => (
              item.kind === entry.kind
              && item.characterId === entry.characterId
              && (item.dateKey || null) === (entry.dateKey || null)
              && looksLikeRawArtifactContext(item.text)
            ));
            const preservedItems = staleRawItems.length
              ? state.items.filter((item) => !staleRawItems.some((stale) => stale.id === item.id))
              : state.items;
            return {
              items: [entry, ...preservedItems].sort((a, b) => b.createdAt - a.createdAt),
              jobs: removeCompletedJobs(remainingJobs),
              unreadLetterCount: computeUnreadLetterCount([entry, ...preservedItems]),
            };
          });
          removeLocalOutboxWorkerOperation(nextJob.id);
          scheduleCloudSync();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set((state) => ({
            jobs: state.jobs.map((job) => job.id === nextJob.id ? { ...job, status: 'failed' as const, error: message, attempts: job.attempts + 1, updatedAt: now() } : job),
          }));
          markLocalOutboxWorkerOperation({
            id: nextJob.id,
            status: 'failed',
            attemptCount: nextJob.attempts + 1,
            lastError: message,
          });
        } finally {
          set({ isProcessing: false });
          void processNext();
        }
      };

      return {
        items: [],
        jobs: [],
        isProcessing: false,
        unreadLetterCount: 0,
        syncCharacters: (characters) => {
          const todayKey = dateKeyOf(now());
          const backfillWindowStartKey = shiftDateKey(todayKey, -DIARY_BACKFILL_WINDOW_DAYS);
          const diaryJobs: CharacterArtifactJob[] = [];
          const existingDiaryKeys = new Set(get().items
            .filter((item) => isDiaryEntry(item) && !looksLikeRawArtifactContext(item.text))
            .map((item) => `${item.characterId}:${item.dateKey}`));
          const existingJobKeys = new Set(get().jobs.map((job) => job.key));

          characters
            .filter((character) => character.deletedAt == null)
            .filter((character) => isCharacterFeatureEnabled(character, 'diaries'))
            .forEach((character) => {
              const allSourceDates = collectCharacterSourceDateKeys(character)
                .filter((dateKey) => dateKey < todayKey);
              const previousAvailableDateKey = allSourceDates.at(-1);
              const sourceDates = allSourceDates.filter((dateKey) => (
                dateKey >= backfillWindowStartKey || dateKey === previousAvailableDateKey
              ));
              const relatedCharacters = buildRelatedCharacters(character, characters);
              sourceDates.forEach((dateKey) => {
                const key = buildDiaryJobKey(character.id, dateKey);
                if (existingDiaryKeys.has(`${character.id}:${dateKey}`) || existingJobKeys.has(key)) return;
                diaryJobs.push({
                  id: `${key}-${now()}-${Math.random().toString(36).slice(2, 8)}`,
                  key,
                  kind: 'diary',
                  characterId: character.id,
                  dateKey,
                  snapshot: character,
                  relatedCharacters,
                  status: 'pending',
                  error: null,
                  attempts: 0,
                  createdAt: now(),
                  updatedAt: now(),
                });
              });
            });

          if (diaryJobs.length) enqueueJobs(diaryJobs.sort(compareDiaryJobs));
          void get().resumeProcessing();
        },
        enqueueLetterArtifact: ({ kind, character, relatedCharacters, sourceKey = '' }) => {
          if (!hasUsableDefaultTextAI(useSettingsStore.getState().aiProfiles)) return;
          const key = buildLetterJobKey(kind, character.id, sourceKey);
          const hasEntry = get().items.some((item) => item.kind === kind && item.characterId === character.id && (item.sourceKey || '') === sourceKey);
          if (get().jobs.some((job) => job.key === key) || hasEntry) return;
          enqueueJobs([{
            id: `${key}-${now()}-${Math.random().toString(36).slice(2, 8)}`,
            key,
            kind,
            characterId: character.id,
            sourceKey,
            snapshot: character,
            relatedCharacters,
            status: 'pending',
            error: null,
            attempts: 0,
            createdAt: now(),
            updatedAt: now(),
          }]);
        },
        enqueueBirthLetter: (character, relatedCharacters) => {
          if (!hasMeaningfulBirthSignals(character)) return;
          get().enqueueLetterArtifact({
            kind: 'birth_letter',
            character,
            relatedCharacters,
            sourceKey: `${character.createdAt || now()}`,
          });
        },
        enqueueFinalLetter: (character, relatedCharacters) => {
          get().enqueueLetterArtifact({
            kind: 'final_letter',
            character,
            relatedCharacters,
            sourceKey: character.deletedAt ? `${character.deletedAt}` : `${now()}`,
          });
        },
        markLettersRead: () => set((state) => {
          const items = state.items.map((item) => (item.kind === 'final_letter' || item.kind === 'birth_letter') ? { ...item, unread: false, updatedAt: now() } : item);
          queueMicrotask(scheduleCloudSync);
          return { items, unreadLetterCount: computeUnreadLetterCount(items) };
        }),
        getDiaryEntries: (characterId) => get().items.filter((item) => item.deletedAt == null && item.kind === 'diary' && item.characterId === characterId).sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || '') || a.createdAt - b.createdAt),
        getLetterEntries: () => get().items.filter((item) => item.deletedAt == null && (item.kind === 'birth_letter' || item.kind === 'final_letter')).sort((a, b) => b.createdAt - a.createdAt),
        regenerateArtifact: async ({ itemId, character, relatedCharacters }) => {
          const item = get().items.find((entry) => entry.id === itemId);
          if (!item) throw new Error('Artifact not found');
          const snapshot = item.generationSnapshot;
          const sourceCharacter = snapshot?.character || character;
          if (!sourceCharacter?.id) throw new Error('Missing artifact generation snapshot');
          const sourceRelatedCharacters = snapshot?.relatedCharacters || relatedCharacters || [];
          const modelProfile = getUsableDefaultTextAIProfile(useSettingsStore.getState().aiProfiles);
          const recentDiaryTexts = item.kind === 'diary'
            ? get().items
                .filter((entry) => entry.kind === 'diary' && entry.characterId === item.characterId && entry.id !== item.id && entry.dateKey !== item.dateKey)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 5)
                .map((entry) => entry.text)
            : [];
          const text = (await generateArtifactText(item.kind, sourceCharacter, sourceRelatedCharacters, item.dateKey || null, modelProfile, recentDiaryTexts)).trim();
          const regeneratedAt = now();
          const source = isAIProfileUsable(modelProfile) ? 'ai' : 'local';
          const generationSnapshot = buildGenerationSnapshot(sourceCharacter, sourceRelatedCharacters);
          let nextEntry: CharacterArtifactEntry | null = null;
          set((state) => {
            const items = state.items.map((entry) => {
              if (entry.id !== item.id) return entry;
              nextEntry = {
                ...entry,
                text,
                source,
                updatedAt: regeneratedAt,
                generationSnapshot,
              };
              return nextEntry;
            });
            return {
              items,
              unreadLetterCount: computeUnreadLetterCount(items),
            };
          });
          scheduleCloudSync();
          if (!nextEntry) throw new Error('Artifact regeneration failed');
          return nextEntry;
        },
        syncCloud: async (query = {}) => {
          if (!isCloudMode()) return;
          const scope = artifactSyncScope(query);
          const forceSync = cloudSyncDirty;
          if (!forceSync && artifactSyncScopes.isFresh(scope)) return;
          if (cloudSyncRunning) {
            cloudSyncPending = true;
            cloudSyncPendingQuery = query;
            return;
          }
          cloudSyncRunning = true;
          cloudSyncDirty = false;
          try {
            const syncScope = scope as SyncChangeScope;
            const changeProbe = !forceSync ? await probeArtifactSummaryChanges(syncScope, { forceFull: get().items.length === 0 }) : null;
            if (changeProbe?.status === 'not_modified') {
              artifactSyncScopes.markChecked(scope, {
                cursor: changeProbe.cursor,
                  revision: changeProbe?.revision,
                  fresh: !changeProbe?.hasMore,
                applied: false,
              });
              return;
            }
            const remote = artifactSummariesFromChanges(changeProbe?.changes)
              || await api.getCharacterArtifactSummaries({ ...query, includeDeleted: true });
            const currentKey = getArtifactStorageKey();
            const guestKey = getGuestArtifactStorageKey();
            const persistedCurrentItems = await readPersistedItemsFromKey(currentKey);
            const guestItems = currentKey === guestKey ? [] : await readPersistedItemsFromKey(guestKey);
            const localItems = mergeArtifactItems(persistedCurrentItems, guestItems, get().items);
            const localById = new Map(localItems.map((item) => [item.id, item]));
            const remoteSummaryById = new Map((remote.items || []).map((item) => [item.id, item]));
            const remoteDeletedSummaries = (remote.items || []).filter((summary) => summary.deletedAt != null);
            const shouldFetchDetails = Boolean(query.kind || query.characterId || query.dateFrom || query.dateTo);
            const remoteDetails = shouldFetchDetails
              ? await Promise.all((remote.items || [])
                  .filter((summary) => summary.deletedAt == null)
                  .filter((summary) => shouldFetchArtifactDetail(summary, localById.get(summary.id)))
                  .map(async (summary) => {
                    try {
                      return (await api.getCharacterArtifactItem(summary.id)).item;
                    } catch (error) {
                      console.error('Failed to fetch character artifact item:', { id: summary.id, error });
                      return null;
                    }
                  }))
              : [];
            const mergedItems = mergeArtifactItems(
              localItems,
              remoteDetails.filter((item): item is CharacterArtifactEntry => Boolean(item)),
            );
            const projectedItems = applyRemoteDeletedArtifactSummaries(mergedItems, remoteDeletedSummaries);
            const localSignature = buildItemsSignature(get().items);
            const mergedSignature = buildItemsSignature(projectedItems);
            if (mergedSignature !== localSignature) {
              set({
                items: projectedItems,
                unreadLetterCount: computeUnreadLetterCount(projectedItems),
              });
            }
            const uploads = projectedItems.filter((item) => artifactMatchesQuery(item, query) && shouldUploadArtifactItem(item, remoteSummaryById.get(item.id)));
            const deletes = projectedItems.filter((item) => artifactMatchesQuery(item, query) && shouldDeleteArtifactItem(item, remoteSummaryById.get(item.id)));
            if (uploads.length) {
              for (const item of uploads) {
                try {
                  const response = await api.upsertCharacterArtifactItem({
                    ...projectArtifactItemForCloudUpload(item),
                    operationId: buildArtifactUploadOperationId(item),
                    baseRevision: item.revision || 0,
                    clientTimestamp: item.updatedAt || item.createdAt || Date.now(),
                  });
                  if (response.status === 'rejected' || response.accepted === false) {
                    console.warn('Skipped stale character artifact upload:', {
                      item: buildArtifactUploadDebug(item),
                      reason: response.reason,
                      revision: response.revision,
                      updatedAt: response.updatedAt,
                    });
                  }
                } catch (error) {
                  console.error('Failed to upload character artifact item:', { item: buildArtifactUploadDebug(item), error });
                  throw error;
                }
              }
            }
            if (deletes.length) {
              for (const item of deletes) {
                try {
                  const response = await api.deleteCharacterArtifactItem(item.id, {
                    operationId: buildArtifactDeleteOperationId(item),
                    baseRevision: item.revision || 0,
                    deletedAt: item.deletedAt || item.updatedAt || item.createdAt || Date.now(),
                  });
                  if (response.status === 'rejected' || response.accepted === false) {
                    console.warn('Skipped stale character artifact tombstone:', {
                      item: buildArtifactUploadDebug(item),
                      reason: response.reason,
                      revision: response.revision,
                      deletedAt: response.deletedAt,
                    });
                  }
                } catch (error) {
                  console.error('Failed to delete character artifact item:', { item: buildArtifactUploadDebug(item), error });
                  throw error;
                }
              }
            }
            artifactSyncScopes.markChecked(scope, {
              cursor: changeProbe?.cursor,
                  revision: changeProbe?.revision,
                  fresh: !changeProbe?.hasMore,
              applied: mergedSignature !== localSignature || uploads.length > 0 || deletes.length > 0,
            });
            if (scope === ARTIFACT_SUMMARY_SCOPE) {
              artifactSyncScopes.markChecked(ARTIFACT_SUMMARY_SCOPE, {
                cursor: changeProbe?.cursor,
                  revision: changeProbe?.revision,
                  fresh: !changeProbe?.hasMore,
                applied: mergedSignature !== localSignature || uploads.length > 0 || deletes.length > 0,
              });
            }
          } catch (error) {
            console.error('Failed to sync character artifacts:', error);
            artifactSyncScopes.markError(scope, error);
            if (forceSync) cloudSyncDirty = true;
          } finally {
            cloudSyncRunning = false;
            if (cloudSyncPending) {
              const nextQuery = cloudSyncPendingQuery;
              cloudSyncPending = false;
              cloudSyncPendingQuery = undefined;
              void get().syncCloud(nextQuery);
            }
          }
        },
        getSyncScopeStates: () => artifactSyncScopes.listStates(),
        resumeProcessing: async () => {
          set((state) => ({
            jobs: state.jobs.map((job) => {
              if (job.status === 'running') return { ...job, status: 'pending' as const, updatedAt: now() };
              if (job.status === 'failed' && job.attempts < 3) return { ...job, status: 'pending' as const, error: null, updatedAt: now() };
              return job;
            }),
            unreadLetterCount: computeUnreadLetterCount(state.items),
          }));
          await mirrorLocalOutboxWorkerQueue('artifact', get().jobs);
          void get().syncCloud();
          await processNext();
        },
        discardFailedJob: (jobId) => set((state) => {
          const job = state.jobs.find((item) => item.id === jobId);
          if (job?.status !== 'failed') return {};
          removeLocalOutboxWorkerOperation(jobId);
          return { jobs: state.jobs.filter((item) => item.id !== jobId) };
        }),
      };
    },
    {
      name: scopedStorageKey('character-artifacts'),
      storage: artifactStorage,
      version: CLIENT_STORE_SCHEMA_VERSION,
      partialize: (state) => ({
        items: state.items,
        jobs: state.jobs,
      }),
      skipHydration: true,
    }
  )
);
