import { api } from './api';
import { reportRecoverableError } from './diagnostics';
import { normalizeCharacter, type AICharacter } from '../types/character';
import { normalizeConversation, type GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSettingsStore } from '../stores/useSettingsStore';

type MessageWindowSnapshot = Record<string, { messages: Message[]; lastSyncedAt?: number; updatedAt?: number }>;

export interface LocalCloudBootstrapSnapshot {
  characters: AICharacter[];
  chats: GroupChat[];
  messageWindowsByChatId: MessageWindowSnapshot;
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
  ]);
}

export async function captureLocalCloudBootstrapSnapshot(): Promise<LocalCloudBootstrapSnapshot> {
  await ensureLocalStoresHydrated();
  const characterState = useCharacterStore.getState();
  const chatState = useChatStore.getState();
  const messageState = useMessageStore.getState();
  return {
    characters: cloneJson(characterState.characters || []),
    chats: cloneJson(chatState.chats || []),
    messageWindowsByChatId: cloneJson(messageState.messageWindowsByChatId || {}),
    settingsShouldUpload: true,
  };
}

function isLocalId(id: string | null | undefined) {
  return Boolean(id && /^local[-_]/i.test(id));
}

function isUserLikeSender(id: string | null | undefined) {
  return id === 'user' || id === 'system' || id === 'god';
}

function hasBootstrapData(snapshot: LocalCloudBootstrapSnapshot) {
  const hasCharacters = snapshot.characters.some((character) => !character.isPreset && character.deletedAt == null);
  const hasChats = snapshot.chats.some((chat) => chat.deletedAt == null);
  const hasMessages = Object.values(snapshot.messageWindowsByChatId).some((window) =>
    (window.messages || []).some((message) => !message.isDeleted && message.type !== 'event'),
  );
  return snapshot.settingsShouldUpload || hasCharacters || hasChats || hasMessages;
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

async function uploadCharacters(snapshot: LocalCloudBootstrapSnapshot) {
  const remoteCharacters = (await api.getCharacters() as unknown as AICharacter[]).map((character) => normalizeCharacter(character));
  const usedNames = new Set(
    remoteCharacters
      .filter((character) => !character.isPreset && character.deletedAt == null)
      .map((character) => character.name.trim().toLowerCase())
      .filter(Boolean),
  );
  const idMap = new Map<string, string>();
  const localCharacters = snapshot.characters.filter((character) => !character.isPreset && character.deletedAt == null);

  for (const character of localCharacters) {
    const name = buildUniqueName(character.name, usedNames);
    const created = normalizeCharacter(await api.createCharacter({
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

async function uploadChats(snapshot: LocalCloudBootstrapSnapshot, characterIdMap: Map<string, string>) {
  const chatIdMap = new Map<string, string>();
  const localChats = snapshot.chats.filter((chat) => chat.deletedAt == null);

  for (const chat of localChats) {
    const created = normalizeConversation(await api.createChat({
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

function collectMessagesForUpload(snapshot: LocalCloudBootstrapSnapshot, chatIdMap: Map<string, string>) {
  const messages: Message[] = [];
  const seen = new Set<string>();
  for (const [localChatId, window] of Object.entries(snapshot.messageWindowsByChatId)) {
    if (!chatIdMap.has(localChatId)) continue;
    for (const message of window.messages || []) {
      if (message.isDeleted || message.type === 'event') continue;
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
) {
  const messages = collectMessagesForUpload(snapshot, chatIdMap);
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
    await uploadSettings();
    const characterIdMap = await uploadCharacters(snapshot);
    const chatIdMap = await uploadChats(snapshot, characterIdMap);
    await uploadMessages(snapshot, chatIdMap, characterIdMap);
    console.info('[cloud-sync] bootstrap local data to cloud finished', {
      charactersUploaded: characterIdMap.size,
      chatsUploaded: chatIdMap.size,
    });
  } catch (error) {
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
