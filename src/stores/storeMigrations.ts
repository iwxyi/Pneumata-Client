import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import { normalizeCharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { toRelationshipLedgerRecentEvent } from '../types/runtimeEvent';
import { DEFAULT_ARTIFACT_APPEARANCE_SETTINGS, PAPER_SURFACE_VARIANTS } from '../types/artifactAppearance';

type VersionedPersistedState<T> = T | undefined;

export const CLIENT_STORE_SCHEMA_VERSION = 3;

function clampRelationshipMetric(value: unknown, min: number, max: number) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, safeValue));
}

function migrateRelationshipPreset(input: CharacterRelationshipPreset): CharacterRelationshipPreset {
  return {
    ...input,
    warmth: clampRelationshipMetric(input.warmth, -100, 100),
    competence: clampRelationshipMetric(input.competence, -100, 100),
    trust: clampRelationshipMetric(input.trust, -100, 100),
    threat: clampRelationshipMetric(input.threat, 0, 100),
  };
}

function migrateCharacter(input: AICharacter): AICharacter {
  return normalizeCharacter({
    ...input,
    relationships: (input.relationships || []).map(migrateRelationshipPreset),
  });
}

function migrateRoomCohesion(input: unknown) {
  const value = typeof input === 'number' && Number.isFinite(input) ? input : 0;
  return Math.max(-100, Math.min(100, value - 50));
}

function migrateChat(input: GroupChat): GroupChat {
  const structuredRoomState = input.worldState?.structuredRoomState
    ? {
        ...input.worldState.structuredRoomState,
        cohesion: migrateRoomCohesion(input.worldState.structuredRoomState.cohesion),
      }
    : input.worldState?.structuredRoomState;
  return {
    ...input,
    memberIds: Array.isArray(input.memberIds) ? input.memberIds : [],
    governance: {
      ownerCharacterId: input.governance?.ownerCharacterId || null,
      adminCharacterIds: Array.isArray(input.governance?.adminCharacterIds) ? input.governance.adminCharacterIds : [],
      autoModeration: Boolean(input.governance?.autoModeration),
      allowMute: input.governance?.allowMute ?? true,
      allowPrivateThreads: input.governance?.allowPrivateThreads ?? true,
    },
    dramaRules: {
      allowCliques: Boolean(input.dramaRules?.allowCliques),
      allowMockery: Boolean(input.dramaRules?.allowMockery),
      allowAlliances: input.dramaRules?.allowAlliances ?? true,
      allowContempt: input.dramaRules?.allowContempt ?? false,
    },
    relationshipLedger: (input.relationshipLedger || []).map((entry) => ({
      ...entry,
      recentEvents: (entry.recentEvents || []).map((event) => toRelationshipLedgerRecentEvent({
        id: typeof event?.id === 'string' ? event.id : '',
        kind: event?.kind,
        createdAt: typeof event?.createdAt === 'number' ? event.createdAt : 0,
        summary: typeof event?.summary === 'string' ? event.summary : '',
        actorIds: Array.isArray(event?.actorIds) ? event.actorIds.filter((id): id is string => typeof id === 'string') : undefined,
        targetIds: Array.isArray(event?.targetIds) ? event.targetIds.filter((id): id is string => typeof id === 'string') : undefined,
      })),
    })),
    worldState: {
      ...input.worldState,
      structuredRoomState,
    },
  };
}

export function migrateCharacterStoreState<T extends { characters?: AICharacter[] }>(persisted: VersionedPersistedState<T>): VersionedPersistedState<T> {
  if (!persisted) return persisted;
  return {
    ...persisted,
    characters: (persisted.characters || []).map(migrateCharacter),
  };
}

export function migrateChatStoreState<T extends { chats?: GroupChat[] }>(persisted: VersionedPersistedState<T>): VersionedPersistedState<T> {
  if (!persisted) return persisted;
  return {
    ...persisted,
    chats: (persisted.chats || []).map(migrateChat),
  };
}

export function migrateMessageStoreState<T extends { messages?: Array<Record<string, unknown>>; messageWindowsByChatId?: Record<string, { messages?: Array<Record<string, unknown>> }> }>(persisted: VersionedPersistedState<T>): VersionedPersistedState<T> {
  if (!persisted) return persisted;
  return {
    ...persisted,
    messages: (persisted.messages || []).map((message) => ({
      ...message,
      emotion: typeof message.emotion === 'number' && Number.isFinite(message.emotion) ? message.emotion : 0,
      isDeleted: Boolean(message.isDeleted),
    })),
    messageWindowsByChatId: Object.fromEntries(
      Object.entries(persisted.messageWindowsByChatId || {}).map(([chatId, window]) => [chatId, {
        ...window,
        messages: (window?.messages || []).map((message) => ({
          ...message,
          emotion: typeof message.emotion === 'number' && Number.isFinite(message.emotion) ? message.emotion : 0,
          isDeleted: Boolean(message.isDeleted),
        })),
      }])
    ),
  };
}

export function migrateSettingsStoreState<T extends Record<string, unknown>>(persisted: VersionedPersistedState<T>): VersionedPersistedState<T> {
  if (!persisted) return persisted;
  const developerUI = (persisted.developerUI as { showMemoryDebug?: boolean; showRelationshipEvents?: boolean; showAffectEvents?: boolean; showConflictEvents?: boolean; showStateEvents?: boolean; showMemoryDistillationEvents?: boolean; showCalendarEvents?: boolean; showLocalInterceptionHints?: boolean; showSpeechStyle?: boolean; showAdvancedRuntimePanels?: boolean; showCompanionshipDebug?: boolean; showMomentDebug?: boolean; showWithdrawnMessageContent?: boolean; dramaBoost?: boolean } | undefined) || {};
  const artifactAppearance = (persisted.artifactAppearance as { paperVariant?: string } | undefined) || {};
  return {
    ...persisted,
    developerUI: {
      showMemoryDebug: Boolean(developerUI.showMemoryDebug),
      showRelationshipEvents: Boolean(developerUI.showRelationshipEvents),
      showAffectEvents: Boolean(developerUI.showAffectEvents),
      showConflictEvents: Boolean(developerUI.showConflictEvents),
      showStateEvents: Boolean(developerUI.showStateEvents),
      showMemoryDistillationEvents: Boolean(developerUI.showMemoryDistillationEvents),
      showCalendarEvents: Boolean(developerUI.showCalendarEvents),
      showLocalInterceptionHints: Boolean(developerUI.showLocalInterceptionHints),
      showSpeechStyle: Boolean(developerUI.showSpeechStyle),
      showAdvancedRuntimePanels: Boolean(developerUI.showAdvancedRuntimePanels),
      showCompanionshipDebug: Boolean(developerUI.showCompanionshipDebug),
      showMomentDebug: Boolean(developerUI.showMomentDebug),
      showWithdrawnMessageContent: Boolean(developerUI.showWithdrawnMessageContent),
      dramaBoost: Boolean(developerUI.dramaBoost),
    },
    artifactAppearance: {
      ...DEFAULT_ARTIFACT_APPEARANCE_SETTINGS,
      paperVariant: PAPER_SURFACE_VARIANTS.includes(artifactAppearance.paperVariant as never)
        ? artifactAppearance.paperVariant
        : DEFAULT_ARTIFACT_APPEARANCE_SETTINGS.paperVariant,
    },
    userBubbleStyleId: typeof persisted.userBubbleStyleId === 'string' ? persisted.userBubbleStyleId : null,
    userBubbleStyle: persisted.userBubbleStyle && typeof persisted.userBubbleStyle === 'object' ? persisted.userBubbleStyle : null,
  } as T;
}

export function migrateUiStoreState<T extends Record<string, unknown>>(persisted: VersionedPersistedState<T>): VersionedPersistedState<T> {
  if (!persisted) return persisted;
  return {
    ...persisted,
    sidebarOpen: Boolean(persisted.sidebarOpen),
    rightPanelOpen: Boolean(persisted.rightPanelOpen),
    godModeActive: Boolean(persisted.godModeActive),
    topicGuideOpen: Boolean(persisted.topicGuideOpen),
    speakAsCharacterId: typeof persisted.speakAsCharacterId === 'string' ? persisted.speakAsCharacterId : null,
    rightPanelTab: persisted.rightPanelTab === 'world' || persisted.rightPanelTab === 'actions' || persisted.rightPanelTab === 'narrative' ? persisted.rightPanelTab : 'members',
  } as T;
}

export const CLIENT_STORE_MIGRATION_NOTES = {
  1: 'Normalize persisted relationships, governance, developer UI, and message payload shapes.',
  2: 'Slim relationship ledger recent events down to lightweight snapshots.',
  3: 'Shift room cohesion to a signed zero-centered scale.',
} as const;
