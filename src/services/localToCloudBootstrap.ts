import { api } from './api';
import { reportRecoverableError } from './diagnostics';
import { normalizeCharacter, type AICharacter } from '../types/character';
import { normalizeConversation, type GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import { buildSettingsPayload, useSettingsStore } from '../stores/useSettingsStore';
import { DEFAULT_SETTINGS } from '../types/settings';
import {
  BOOTSTRAP_STATUS_CONFLICT_DETAIL_LIMIT,
  readCloudSyncBootstrapStatus,
  writeCloudSyncBootstrapStatus,
  type CloudSyncBootstrapStatus,
} from './cloudSyncBootstrapStatus';

type MessageWindowSnapshot = Record<string, { messages: Message[]; lastSyncedAt?: number; updatedAt?: number }>;

interface BootstrapPendingEntityOperation {
  id: string;
  kind: string;
  entityId: string;
  targetIds?: string[];
  status: 'pending' | 'syncing' | 'failed';
}

interface BootstrapPendingMessageOperation {
  id: string;
  kind: string;
  chatId: string;
  localMessageId?: string;
  messageId?: string;
  status: 'pending' | 'syncing' | 'failed';
}

export interface LocalCloudBootstrapSnapshot {
  characters: AICharacter[];
  chats: GroupChat[];
  messageWindowsByChatId: MessageWindowSnapshot;
  settingsShouldUpload: boolean;
  pendingCharacterOperations?: BootstrapPendingEntityOperation[];
  pendingChatOperations?: BootstrapPendingEntityOperation[];
  pendingMessageOperations?: BootstrapPendingMessageOperation[];
}

interface BootstrapRemoteSummary {
  characters: Array<Pick<AICharacter, 'id' | 'name' | 'deletedAt' | 'isPreset'>>;
  chats: Array<Pick<GroupChat, 'id' | 'name' | 'deletedAt'>>;
}

export interface BootstrapReconcilePlan {
  remote: BootstrapRemoteSummary;
  charactersToCreate: AICharacter[];
  charactersAlreadyRemote: AICharacter[];
  characterNameConflicts: Array<{ localId: string; localName: string; remoteId: string; remoteName: string }>;
  chatsToCreate: GroupChat[];
  chatsAlreadyRemote: GroupChat[];
  pendingCharacterCreates: BootstrapPendingEntityOperation[];
  pendingChatCreates: BootstrapPendingEntityOperation[];
  pendingMessageCreates: BootstrapPendingMessageOperation[];
  settingsShouldUpload: boolean;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function ensureLocalStoresHydrated() {
  await Promise.all([
    useCharacterStore.persist.hasHydrated() ? Promise.resolve() : useCharacterStore.persist.rehydrate(),
    useChatStore.persist.hasHydrated() ? Promise.resolve() : useChatStore.persist.rehydrate(),
    useMessageStore.persist.hasHydrated() ? Promise.resolve() : useMessageStore.persist.rehydrate(),
    useSettingsStore.persist.hasHydrated() ? Promise.resolve() : useSettingsStore.persist.rehydrate(),
  ]);
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

export function shouldUploadSettingsDuringBootstrap(settings: ReturnType<typeof useSettingsStore.getState>) {
  return stableJson(buildSettingsPayload(settings)) !== stableJson(buildSettingsPayload(DEFAULT_SETTINGS));
}

export async function captureLocalCloudBootstrapSnapshot(): Promise<LocalCloudBootstrapSnapshot> {
  await ensureLocalStoresHydrated();
  const characterState = useCharacterStore.getState();
  const chatState = useChatStore.getState();
  const messageState = useMessageStore.getState();
  const settingsState = useSettingsStore.getState();
  return {
    characters: cloneJson(characterState.characters || []),
    chats: cloneJson(chatState.chats || []),
    messageWindowsByChatId: cloneJson(messageState.messageWindowsByChatId || {}),
    settingsShouldUpload: shouldUploadSettingsDuringBootstrap(settingsState),
    pendingCharacterOperations: cloneJson(characterState.getPendingOperations?.() || characterState.pendingOperations || []),
    pendingChatOperations: cloneJson(chatState.getPendingOperations?.() || chatState.pendingOperations || []),
    pendingMessageOperations: cloneJson(messageState.pendingOperations || []),
  };
}

function isLocalId(id: string | null | undefined) {
  return Boolean(id && /^local[-_]/i.test(id));
}

function isUserLikeSender(id: string | null | undefined) {
  return id === 'user' || id === 'system' || id === 'god';
}

function hasBootstrapData(snapshot: LocalCloudBootstrapSnapshot) {
  return snapshot.settingsShouldUpload || hasBootstrapEntityData(snapshot);
}

function hasBootstrapEntityData(snapshot: LocalCloudBootstrapSnapshot) {
  const hasCharacters = snapshot.characters.some((character) => !character.isPreset && character.deletedAt == null);
  const hasChats = snapshot.chats.some((chat) => chat.deletedAt == null);
  const hasMessages = Object.values(snapshot.messageWindowsByChatId).some((window) =>
    (window.messages || []).some((message) => !message.isDeleted && message.type !== 'event'),
  );
  const hasPendingCreates = Boolean(
    snapshot.pendingCharacterOperations?.some((operation) => operation.kind === 'create')
    || snapshot.pendingChatOperations?.some((operation) => operation.kind === 'create')
    || snapshot.pendingMessageOperations?.some((operation) => operation.kind === 'create'),
  );
  return hasCharacters || hasChats || hasMessages || hasPendingCreates;
}

function normalizeNameKey(name: string | null | undefined) {
  return (name || '').trim().toLowerCase();
}

function activeRemoteIds<T extends { id: string; deletedAt?: number | null }>(items: T[]) {
  return new Set(items.filter((item) => item.deletedAt == null).map((item) => item.id));
}

function activeRemoteNameMap<T extends { id: string; name: string; deletedAt?: number | null }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    if (item.deletedAt != null) continue;
    const key = normalizeNameKey(item.name);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return map;
}

export function createBootstrapReconcilePlan(
  snapshot: LocalCloudBootstrapSnapshot,
  remote: BootstrapRemoteSummary,
): BootstrapReconcilePlan {
  const remoteCharacterIds = activeRemoteIds(remote.characters);
  const remoteChatIds = activeRemoteIds(remote.chats);
  const remoteCharacterNames = activeRemoteNameMap(remote.characters);
  const localCharacters = snapshot.characters.filter((character) => !character.isPreset && character.deletedAt == null);
  const localChats = snapshot.chats.filter((chat) => chat.deletedAt == null);
  const charactersToCreate = localCharacters.filter((character) => !remoteCharacterIds.has(character.id));
  const pendingCharacterCreates = (snapshot.pendingCharacterOperations || []).filter((operation) => operation.kind === 'create');
  const pendingChatCreates = (snapshot.pendingChatOperations || []).filter((operation) => operation.kind === 'create');
  const pendingMessageCreates = (snapshot.pendingMessageOperations || []).filter((operation) => operation.kind === 'create');

  return {
    remote,
    charactersToCreate,
    charactersAlreadyRemote: localCharacters.filter((character) => remoteCharacterIds.has(character.id)),
    characterNameConflicts: charactersToCreate
      .map((character) => {
        const remoteCharacter = remoteCharacterNames.get(normalizeNameKey(character.name));
        return remoteCharacter
          ? {
              localId: character.id,
              localName: character.name,
              remoteId: remoteCharacter.id,
              remoteName: remoteCharacter.name,
            }
          : null;
      })
      .filter((item): item is { localId: string; localName: string; remoteId: string; remoteName: string } => Boolean(item)),
    chatsToCreate: localChats.filter((chat) => !remoteChatIds.has(chat.id)),
    chatsAlreadyRemote: localChats.filter((chat) => remoteChatIds.has(chat.id)),
    pendingCharacterCreates,
    pendingChatCreates,
    pendingMessageCreates,
    settingsShouldUpload: snapshot.settingsShouldUpload,
  };
}

function buildBootstrapStatus(
  state: CloudSyncBootstrapStatus['state'],
  plan: BootstrapReconcilePlan,
  lastError: string | null = null,
): CloudSyncBootstrapStatus {
  const detailOverflow = Math.max(0, plan.characterNameConflicts.length - BOOTSTRAP_STATUS_CONFLICT_DETAIL_LIMIT);
  return {
    updatedAt: Date.now(),
    state,
    charactersToCreate: plan.charactersToCreate.length,
    charactersAlreadyRemote: plan.charactersAlreadyRemote.length,
    characterNameConflicts: plan.characterNameConflicts.length,
    chatsToCreate: plan.chatsToCreate.length,
    chatsAlreadyRemote: plan.chatsAlreadyRemote.length,
    pendingCharacterCreates: plan.pendingCharacterCreates.length,
    pendingChatCreates: plan.pendingChatCreates.length,
    pendingMessageCreates: plan.pendingMessageCreates.length,
    characterNameConflictDetails: plan.characterNameConflicts.slice(0, BOOTSTRAP_STATUS_CONFLICT_DETAIL_LIMIT),
    characterNameConflictDetailOverflow: detailOverflow,
    lastError,
  };
}

function failedBootstrapStatusFromPrevious(error: unknown): CloudSyncBootstrapStatus {
  const previousStatus = readCloudSyncBootstrapStatus();
  return {
    updatedAt: Date.now(),
    state: 'failed',
    charactersToCreate: Number(previousStatus?.charactersToCreate || 0),
    charactersAlreadyRemote: Number(previousStatus?.charactersAlreadyRemote || 0),
    characterNameConflicts: Number(previousStatus?.characterNameConflicts || 0),
    chatsToCreate: Number(previousStatus?.chatsToCreate || 0),
    chatsAlreadyRemote: Number(previousStatus?.chatsAlreadyRemote || 0),
    pendingCharacterCreates: Number(previousStatus?.pendingCharacterCreates || 0),
    pendingChatCreates: Number(previousStatus?.pendingChatCreates || 0),
    pendingMessageCreates: Number(previousStatus?.pendingMessageCreates || 0),
    characterNameConflictDetails: previousStatus?.characterNameConflictDetails || [],
    characterNameConflictDetailOverflow: Number(previousStatus?.characterNameConflictDetailOverflow || 0),
    lastError: error instanceof Error ? error.message : String(error),
  };
}

function summaryEntriesFromChanges<T>(changes: Array<Record<string, unknown>> | undefined, entity: string, normalize: (value: unknown) => T) {
  const entries: T[] = [];
  for (const change of changes || []) {
    if (change.entity !== entity || typeof change.patch !== 'object' || !change.patch) continue;
    entries.push(normalize(change.patch));
  }
  return entries;
}

async function fetchRemoteBootstrapSummary(): Promise<BootstrapRemoteSummary> {
  const [characterChanges, chatChanges] = await Promise.allSettled([
    api.getSyncChanges({ scope: 'characters.summary' }),
    api.getSyncChanges({ scope: 'chats.summary' }),
  ]);

  const characters = characterChanges.status === 'fulfilled'
    ? summaryEntriesFromChanges(characterChanges.value.changes, 'character_summary', (value) => normalizeCharacter(value as AICharacter))
    : (await api.getCharacters() as unknown as AICharacter[]).map((character) => normalizeCharacter(character));
  const chats = chatChanges.status === 'fulfilled'
    ? summaryEntriesFromChanges(chatChanges.value.changes, 'chat_summary', (value) => normalizeConversation(value as GroupChat))
    : (await api.getChats() as unknown as GroupChat[]).map((chat) => normalizeConversation(chat));

  return { characters, chats };
}

export async function buildBootstrapReconcilePlan(snapshot: LocalCloudBootstrapSnapshot) {
  return createBootstrapReconcilePlan(snapshot, await fetchRemoteBootstrapSummary());
}

function buildUniqueName(baseName: string, usedNames: Set<string>) {
  const normalizedBase = (baseName || '未命名角色').trim() || '未命名角色';
  let candidate = normalizedBase;
  let suffix = 0;
  while (usedNames.has(candidate.trim().toLowerCase())) {
    suffix += 1;
    candidate = suffix === 1 ? `${normalizedBase}（本地）` : `${normalizedBase}（本地 ${suffix}）`;
  }
  usedNames.add(candidate.trim().toLowerCase());
  return candidate;
}

async function uploadSettings() {
  await useSettingsStore.getState().syncCurrentSettingsToServer();
}

function pendingCreateOperationIdByEntity(operations: BootstrapPendingEntityOperation[]) {
  return new Map(operations
    .filter((operation) => operation.kind === 'create' && operation.entityId && operation.id)
    .map((operation) => [operation.entityId, operation.id]));
}

async function uploadCharacters(plan: BootstrapReconcilePlan) {
  const usedNames = new Set(
    plan.remote.characters
      .filter((character) => !character.isPreset && character.deletedAt == null)
      .map((character) => character.name.trim().toLowerCase())
      .filter(Boolean),
  );
  const idMap = new Map<string, string>();
  for (const character of plan.charactersAlreadyRemote) {
    idMap.set(character.id, character.id);
  }
  const pendingOperationIds = pendingCreateOperationIdByEntity(plan.pendingCharacterCreates);

  for (const character of plan.charactersToCreate) {
    const name = buildUniqueName(character.name, usedNames);
    const created = normalizeCharacter(await api.createCharacter({
      id: character.id,
      operationId: pendingOperationIds.get(character.id),
      name,
      avatar: character.avatar,
      personality: character.personality as unknown as Record<string, number>,
      behavior: character.behavior,
      expertise: character.expertise,
      speakingStyle: character.speakingStyle,
      background: character.background,
      group: character.group,
      personalityDrift: character.personalityDrift,
      emotionalState: character.emotionalState,
      soulState: character.soulState,
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
      bubbleStyle: character.bubbleStyle,
      bubbleStyleId: character.bubbleStyleId,
    } as Parameters<typeof api.createCharacter>[0]) as unknown as AICharacter);
    idMap.set(character.id, created.id);
  }

  return idMap;
}

function mapCharacterId(id: string, characterIdMap: Map<string, string>) {
  return characterIdMap.get(id) || id;
}

function mapCharacterIds(ids: string[] | undefined, characterIdMap: Map<string, string>) {
  return (ids || []).map((id) => mapCharacterId(id, characterIdMap));
}

function mapJsonReferences<T>(value: T, characterIdMap: Map<string, string>): T {
  if (!value || characterIdMap.size === 0) return value;
  try {
    let text = JSON.stringify(value);
    for (const [localId, cloudId] of characterIdMap.entries()) {
      text = text.split(localId).join(cloudId);
    }
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn('[cloud-sync] failed to remap structured local references', { error, value });
    return value;
  }
}

async function uploadChats(plan: BootstrapReconcilePlan, characterIdMap: Map<string, string>) {
  const chatIdMap = new Map<string, string>();
  for (const chat of plan.chatsAlreadyRemote) {
    chatIdMap.set(chat.id, chat.id);
  }
  const pendingOperationIds = pendingCreateOperationIdByEntity(plan.pendingChatCreates);

  for (const chat of plan.chatsToCreate) {
    const created = normalizeConversation(await api.createChat({
      id: chat.id,
      operationId: pendingOperationIds.get(chat.id),
      type: chat.type,
      mode: chat.mode,
      modeConfig: mapJsonReferences(chat.modeConfig, characterIdMap),
      modeState: mapJsonReferences(chat.modeState, characterIdMap),
      name: chat.name,
      topic: chat.topic,
      style: chat.style,
      runtimeEvolutionIntensity: chat.runtimeEvolutionIntensity,
      memberIds: mapCharacterIds(chat.memberIds, characterIdMap),
      speed: chat.speed,
      isActive: chat.isActive,
      allowIntervention: chat.allowIntervention,
      showRoleActions: chat.showRoleActions,
      topicSeed: chat.topicSeed,
      sourceChatId: chat.sourceChatId && chatIdMap.has(chat.sourceChatId) ? chatIdMap.get(chat.sourceChatId)! : null,
      sourceMemberIds: mapCharacterIds(chat.sourceMemberIds, characterIdMap),
      runtimeSeed: mapJsonReferences(chat.runtimeSeed, characterIdMap),
      layeredMemories: mapJsonReferences(chat.layeredMemories, characterIdMap),
      runtimeTimeline: mapJsonReferences(chat.runtimeTimeline, characterIdMap),
      runtimeEventsV2: mapJsonReferences(chat.runtimeEventsV2, characterIdMap),
      relationshipLedger: mapJsonReferences(chat.relationshipLedger, characterIdMap),
      governance: mapJsonReferences(chat.governance, characterIdMap),
      dramaRules: mapJsonReferences(chat.dramaRules, characterIdMap),
      worldState: mapJsonReferences(chat.worldState, characterIdMap),
      directorControls: mapJsonReferences(chat.directorControls, characterIdMap),
    } as Parameters<typeof api.createChat>[0]) as unknown as GroupChat);
    chatIdMap.set(chat.id, created.id);
  }

  return chatIdMap;
}

function confirmBootstrapCreateOperations(plan: BootstrapReconcilePlan, characterIdMap: Map<string, string>, chatIdMap: Map<string, string>) {
  const syncedCharacterIds = plan.pendingCharacterCreates
    .map((operation) => operation.entityId)
    .filter((id) => characterIdMap.has(id));
  const syncedChatIds = plan.pendingChatCreates
    .map((operation) => operation.entityId)
    .filter((id) => chatIdMap.has(id));
  if (syncedCharacterIds.length) {
    useCharacterStore.getState().confirmCreateOperationsSynced?.(syncedCharacterIds);
  }
  if (syncedChatIds.length) {
    useChatStore.getState().confirmCreateOperationsSynced?.(syncedChatIds);
  }
}

function collectMessagesForUpload(snapshot: LocalCloudBootstrapSnapshot, chatIdMap: Map<string, string>, plan: BootstrapReconcilePlan) {
  const messages: Message[] = [];
  const seen = new Set<string>();
  const pendingMessageIds = new Set(
    plan.pendingMessageCreates
      .map((operation) => operation.localMessageId || operation.messageId)
      .filter(Boolean),
  );
  for (const [localChatId, window] of Object.entries(snapshot.messageWindowsByChatId)) {
    if (!chatIdMap.has(localChatId)) continue;
    for (const message of window.messages || []) {
      if (message.isDeleted || message.type === 'event') continue;
      if (pendingMessageIds.has(message.id) || (message.clientKey && pendingMessageIds.has(message.clientKey))) continue;
      const key = `${message.id}:${message.chatId}:${message.timestamp}:${message.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push(message);
    }
  }
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

async function uploadMessages(
  snapshot: LocalCloudBootstrapSnapshot,
  chatIdMap: Map<string, string>,
  characterIdMap: Map<string, string>,
  plan: BootstrapReconcilePlan,
) {
  const messages = collectMessagesForUpload(snapshot, chatIdMap, plan);
  for (const message of messages) {
    const cloudChatId = chatIdMap.get(message.chatId);
    if (!cloudChatId) continue;
    const senderId = isUserLikeSender(message.senderId) ? message.senderId : mapCharacterId(message.senderId, characterIdMap);
    if (isLocalId(senderId)) {
      console.warn('[cloud-sync] skip local message with unresolved sender', {
        localMessageId: message.id,
        localChatId: message.chatId,
        senderId: message.senderId,
      });
      continue;
    }
    await api.createMessage(cloudChatId, {
      type: message.type,
      senderId,
      senderName: message.senderName,
      content: message.content,
      metadata: mapJsonReferences(message.metadata, characterIdMap),
      emotion: message.emotion,
      timestamp: message.timestamp,
    });
  }
}

export async function bootstrapLocalDataToCloud(snapshot: LocalCloudBootstrapSnapshot) {
  if (!hasBootstrapData(snapshot)) return;
  console.info('[cloud-sync] bootstrap local data to cloud started', {
    characters: snapshot.characters.length,
    chats: snapshot.chats.length,
    messageWindows: Object.keys(snapshot.messageWindowsByChatId).length,
  });
  try {
    const plan = hasBootstrapEntityData(snapshot)
      ? await buildBootstrapReconcilePlan(snapshot)
      : createBootstrapReconcilePlan(snapshot, { characters: [], chats: [] });
    writeCloudSyncBootstrapStatus(buildBootstrapStatus('planned', plan));
    console.info('[cloud-sync] bootstrap reconcile plan prepared', {
      charactersToCreate: plan.charactersToCreate.length,
      charactersAlreadyRemote: plan.charactersAlreadyRemote.length,
      characterNameConflicts: plan.characterNameConflicts.length,
      chatsToCreate: plan.chatsToCreate.length,
      chatsAlreadyRemote: plan.chatsAlreadyRemote.length,
      pendingCharacterCreates: plan.pendingCharacterCreates.length,
      pendingChatCreates: plan.pendingChatCreates.length,
      pendingMessageCreates: plan.pendingMessageCreates.length,
    });
    writeCloudSyncBootstrapStatus(buildBootstrapStatus('running', plan));
    if (plan.settingsShouldUpload) {
      await uploadSettings();
    }
    const characterIdMap = await uploadCharacters(plan);
    const chatIdMap = await uploadChats(plan, characterIdMap);
    await uploadMessages(snapshot, chatIdMap, characterIdMap, plan);
    confirmBootstrapCreateOperations(plan, characterIdMap, chatIdMap);
    writeCloudSyncBootstrapStatus(buildBootstrapStatus('succeeded', plan));
    console.info('[cloud-sync] bootstrap local data to cloud finished', {
      charactersUploaded: characterIdMap.size,
      chatsUploaded: chatIdMap.size,
    });
  } catch (error) {
    writeCloudSyncBootstrapStatus(failedBootstrapStatusFromPrevious(error));
    reportRecoverableError({
      location: 'cloud-sync:bootstrap-local-data',
      error,
      userMessage: '本地数据同步到云端失败，请稍后重试。',
      extra: {
        characters: snapshot.characters.length,
        chats: snapshot.chats.length,
        messageWindows: Object.keys(snapshot.messageWindowsByChatId).length,
      },
    });
    throw error;
  }
}
