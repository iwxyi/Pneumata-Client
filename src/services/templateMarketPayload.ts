import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';

function compactString(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function pickCharacterTemplate(character: AICharacter) {
  return {
    name: character.name,
    avatar: character.avatar,
    personality: character.personality,
    coreProfile: character.coreProfile || {},
    visualIdentity: character.visualIdentity || null,
    visualReferenceImages: (character as AICharacter & { visualReferenceImages?: unknown[] }).visualReferenceImages || [],
    voiceConfig: character.voiceConfig || {},
    behavior: character.behavior,
    expertise: character.expertise || [],
    speakingStyle: character.speakingStyle || '',
    background: character.background || '',
    speechProfile: character.speechProfile || {},
    group: character.group || null,
    intervention: character.intervention,
    bubbleStyle: character.bubbleStyle || null,
    bubbleStyleId: character.bubbleStyleId || null,
    generationPreferences: character.generationPreferences,
  };
}

function getPrimaryVisualReferenceImage(character: AICharacter) {
  const visualIdentity = character.visualIdentity || null;
  const images = [
    ...(visualIdentity?.referenceImages || []),
    ...((character as AICharacter & { visualReferenceImages?: Array<{ url?: string; isPrimary?: boolean; id?: string }> }).visualReferenceImages || []),
  ].filter((image) => typeof image?.url === 'string' && image.url);
  return images.find((image) => image.isPrimary || image.id === visualIdentity?.primaryReferenceImageId) || images[0] || null;
}

export function getMarketCoverForCharacter(character: AICharacter) {
  return getPrimaryVisualReferenceImage(character)?.url || character.avatar || null;
}

export function buildCharacterMarketPayload(character: AICharacter) {
  return {
    schemaVersion: 1,
    kind: 'character_template',
    character: pickCharacterTemplate(character),
  };
}

function pickChatConfig(chat: GroupChat, options: { includeMembers: boolean }) {
  return {
    type: chat.type,
    mode: chat.mode,
    sessionKind: chat.sessionKind,
    modeConfig: chat.modeConfig,
    modeState: chat.modeState,
    scenarioState: chat.scenarioState,
    channels: chat.channels,
    layoutState: chat.layoutState,
    scenarioPackage: chat.scenarioPackage,
    judgeAgent: chat.judgeAgent,
    layeredGrowth: chat.layeredGrowth,
    modeStateSummary: chat.modeStateSummary,
    memoryLayerSummary: chat.memoryLayerSummary,
    growthSnapshots: chat.growthSnapshots || [],
    roleMemorySummaries: chat.roleMemorySummaries || [],
    scenarioMemorySummary: chat.scenarioMemorySummary || null,
    topologySummary: chat.topologySummary || null,
    name: chat.name,
    topic: chat.topic,
    style: chat.style,
    runtimeEvolutionIntensity: chat.runtimeEvolutionIntensity,
    memberIds: options.includeMembers ? chat.memberIds : [],
    sourceMemberIds: options.includeMembers ? chat.sourceMemberIds || [] : [],
    speed: chat.speed,
    isActive: false,
    allowIntervention: chat.allowIntervention,
    showRoleActions: chat.showRoleActions,
    topicSeed: chat.topicSeed,
    governance: chat.governance,
    dramaRules: chat.dramaRules,
    worldState: chat.worldState,
    directorControls: chat.directorControls,
    messageBranchState: null,
  };
}

export function buildChatMarketPayload(chat: GroupChat) {
  return {
    schemaVersion: 1,
    kind: 'chat_template',
    chat: pickChatConfig(chat, { includeMembers: false }),
  };
}

function isOnlyKnownIds(ids: unknown, allowedIds: Set<string>) {
  return !Array.isArray(ids) || ids.every((id) => typeof id !== 'string' || allowedIds.has(id) || id === 'user');
}

function filterRelationshipPresets(relationships: CharacterRelationshipPreset[] | undefined, allowedIds: Set<string>) {
  return (relationships || []).filter((item) => allowedIds.has(item.characterId));
}

function filterRuntimeEvents(events: RuntimeEventV2[] | undefined, allowedIds: Set<string>) {
  return (events || []).filter((event) => (
    isOnlyKnownIds(event.actorIds, allowedIds)
    && isOnlyKnownIds(event.targetIds, allowedIds)
    && isOnlyKnownIds((event.payload as { participantIds?: unknown }).participantIds, allowedIds)
    && isOnlyKnownIds((event.payload as { targetIds?: unknown }).targetIds, allowedIds)
    && isOnlyKnownIds((event.payload as { actorIds?: unknown }).actorIds, allowedIds)
  ));
}

export function buildBundleMarketPayload(chat: GroupChat, characters: AICharacter[]) {
  const allowedIds = new Set(chat.memberIds);
  const memberCharacters = characters.filter((character) => allowedIds.has(character.id));
  return {
    schemaVersion: 1,
    kind: 'bundle_template',
    chat: {
      ...pickChatConfig(chat, { includeMembers: true }),
      runtimeSeed: chat.runtimeSeed || { notes: [], artifacts: [] },
      layeredMemories: chat.layeredMemories || [],
      runtimeTimeline: chat.runtimeTimeline || [],
      runtimeEventsV2: filterRuntimeEvents(chat.runtimeEventsV2, allowedIds),
      relationshipLedger: (chat.relationshipLedger || []).filter((entry) => allowedIds.has(entry.actorId) && allowedIds.has(entry.targetId)),
      relationshipStructure: chat.relationshipStructure ? {
        ...chat.relationshipStructure,
        edges: chat.relationshipStructure.edges.filter((edge) => allowedIds.has(edge.fromId) && allowedIds.has(edge.toId)),
      } : null,
    },
    characters: memberCharacters.map((character) => ({
      localId: character.id,
      template: {
        ...pickCharacterTemplate(character),
        relationships: filterRelationshipPresets(character.relationships, allowedIds),
        memory: character.memory || {},
        layeredMemories: character.layeredMemories || [],
        runtimeTimeline: character.runtimeTimeline || [],
      },
    })),
  };
}

export function getMarketTitleForCharacter(character: AICharacter) {
  return compactString(character.name, 80) || '未命名角色';
}

export function getMarketSummaryForCharacter(character: AICharacter) {
  return compactString(character.background || character.speakingStyle || character.expertise?.join('、'), 300);
}

export function getMarketTitleForChat(chat: GroupChat) {
  return compactString(chat.name || chat.topic, 80) || '未命名聊天';
}

export function getMarketSummaryForChat(chat: GroupChat) {
  return compactString(chat.topic || chat.topicSeed || chat.name, 300);
}
