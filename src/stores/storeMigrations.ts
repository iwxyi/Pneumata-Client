import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import { normalizeCharacter } from '../types/character';
import type { GroupChat } from '../types/chat';

type VersionedPersistedState<T> = T | undefined;

export const CLIENT_STORE_SCHEMA_VERSION = 1;

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

function migrateChat(input: GroupChat): GroupChat {
  return {
    ...input,
    members: Array.isArray(input.members) ? input.members : [],
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
  const developerUI = (persisted.developerUI as { showMemoryDebug?: boolean; showRelationshipEvents?: boolean; showAffectEvents?: boolean; showSpeechStyle?: boolean; showAdvancedRuntimePanels?: boolean; dramaBoost?: boolean } | undefined) || {};
  return {
    ...persisted,
    developerUI: {
      showMemoryDebug: Boolean(developerUI.showMemoryDebug),
      showRelationshipEvents: Boolean(developerUI.showRelationshipEvents),
      showAffectEvents: Boolean(developerUI.showAffectEvents),
      showSpeechStyle: Boolean(developerUI.showSpeechStyle),
      showAdvancedRuntimePanels: Boolean(developerUI.showAdvancedRuntimePanels),
      dramaBoost: Boolean(developerUI.dramaBoost),
    },
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
    rightPanelTab: persisted.rightPanelTab === 'world' || persisted.rightPanelTab === 'actions' ? persisted.rightPanelTab : 'members',
  } as T;
}

export const CLIENT_STORE_MIGRATION_NOTES = {
  1: 'Normalize persisted relationships, governance, developer UI, and message payload shapes.',
} as const;
