import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AICharacter } from '../types/character';
import type { AIModelProfile } from '../types/settings';
import { getPreferredAIProfile } from '../types/settings';
import { createScopedBufferedJsonStorage, createScopedStorage } from './storePersistenceScope';
import { CLIENT_STORE_SCHEMA_VERSION } from './storeMigrations';
import { buildCharacterBirthLetterContext, buildCharacterDailyDiaryContext, buildCharacterExperienceArtifactContext, buildCharacterFinalLetterContext, buildLocalCharacterExperienceArtifact, generateCharacterDailyDiaryArtifact, generateCharacterExperienceArtifact } from '../services/characterExperienceArtifacts';
import { useSettingsStore } from './useSettingsStore';
import { scopedStorageKey, storageKey } from '../constants/brand';

export type CharacterArtifactKind = 'birth_letter' | 'diary' | 'final_letter';
export type CharacterArtifactJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

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
  resumeProcessing: () => Promise<void>;
}

function getArtifactStorageKey() {
  const userRaw = localStorage.getItem(storageKey('user'));
  const userId = userRaw ? JSON.parse(userRaw).id : 'guest';
  return scopedStorageKey(`character-artifacts-${userId}`);
}

function createArtifactStorage() {
  return createScopedStorage({
    getScopedKey: getArtifactStorageKey,
    storageName: scopedStorageKey('character-artifacts'),
  });
}

const artifactStorage = createScopedBufferedJsonStorage<ArtifactSnapshot>({
  getScopedKey: getArtifactStorageKey,
  storageName: scopedStorageKey('character-artifacts'),
  flushDelayMs: 96,
});

function now() {
  return Date.now();
}

function dateKeyOf(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function startOfDayKey(value: number) {
  return `${dateKeyOf(value)}T00:00:00`;
}

function getTextProfile(aiProfiles: AIModelProfile[]) {
  return getPreferredAIProfile(aiProfiles, 'text') || aiProfiles[0] || null;
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
  return items.filter((item) => (isFinalLetterEntry(item) || isBirthLetterEntry(item)) && item.unread).length;
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
  if (!modelProfile?.apiKey || !modelProfile?.model) {
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
    jobs: Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt),
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
  if (!modelProfile?.apiKey || !modelProfile?.model) {
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
      const enqueueJobs = (jobs: CharacterArtifactJob[]) => {
        if (!jobs.length) return;
        set((state) => {
          const next = queueSnapshotJobs(state, jobs);
          return {
            ...next,
            unreadLetterCount: computeUnreadLetterCount(next.items),
          };
        });
        void get().resumeProcessing();
      };

      const processNext = async () => {
        if (get().isProcessing) return;
        const nextJob = get().jobs.find((job) => job.status === 'pending');
        if (!nextJob) return;

        set((state) => ({
          jobs: state.jobs.map((job) => job.id === nextJob.id ? { ...job, status: 'running', updatedAt: now() } : job),
          isProcessing: true,
        }));

        const modelProfile = getTextProfile(useSettingsStore.getState().aiProfiles);
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
            source: modelProfile?.apiKey && modelProfile?.model ? 'ai' : 'local',
            unread: nextJob.kind === 'final_letter' || nextJob.kind === 'birth_letter',
          });

          set((state) => {
            const remainingJobs = state.jobs.map((job) => job.id === nextJob.id ? { ...job, status: 'succeeded' as const, updatedAt: now() } : job);
            return {
              items: [entry, ...state.items].sort((a, b) => b.createdAt - a.createdAt),
              jobs: removeCompletedJobs(remainingJobs),
              unreadLetterCount: computeUnreadLetterCount([entry, ...state.items]),
            };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set((state) => ({
            jobs: state.jobs.map((job) => job.id === nextJob.id ? { ...job, status: 'failed' as const, error: message, attempts: job.attempts + 1, updatedAt: now() } : job),
          }));
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
          const diaryJobs: CharacterArtifactJob[] = [];
          const existingDiaryKeys = new Set(get().items.filter(isDiaryEntry).map((item) => `${item.characterId}:${item.dateKey}`));
          const existingJobKeys = new Set(get().jobs.map((job) => job.key));

          characters
            .filter((character) => character.deletedAt == null)
            .forEach((character) => {
              const sourceDates = collectCharacterSourceDateKeys(character)
                .filter((dateKey) => dateKey < todayKey);
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

          if (diaryJobs.length) enqueueJobs(diaryJobs);
          void get().resumeProcessing();
        },
        enqueueLetterArtifact: ({ kind, character, relatedCharacters, sourceKey = '' }) => {
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
          return { items, unreadLetterCount: computeUnreadLetterCount(items) };
        }),
        getDiaryEntries: (characterId) => get().items.filter((item) => item.kind === 'diary' && item.characterId === characterId).sort((a, b) => b.createdAt - a.createdAt),
        getLetterEntries: () => get().items.filter((item) => item.kind === 'birth_letter' || item.kind === 'final_letter').sort((a, b) => b.createdAt - a.createdAt),
        resumeProcessing: async () => {
          set((state) => ({
            jobs: state.jobs.map((job) => {
              if (job.status === 'running') return { ...job, status: 'pending' as const, updatedAt: now() };
              if (job.status === 'failed' && job.attempts < 3) return { ...job, status: 'pending' as const, error: null, updatedAt: now() };
              return job;
            }),
            unreadLetterCount: computeUnreadLetterCount(state.items),
          }));
          await processNext();
        },
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
