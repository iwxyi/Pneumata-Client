import type { AICharacter } from '../types/character';
import type { ConversationPhase, GroupChat } from '../types/chat';
import { DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { resolveRuntimeEvolutionConfig } from './runtimeEvolutionConfig';
import { updateCharacterRelationship, summarizeRelationshipShift } from './relationshipEngine';
import { deriveEmotionalState, derivePersonalityDrift } from './personalityDrift';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';
import { accumulateCharacterRuntime } from './characterRuntime';
import { accumulateChatRuntime } from './chatRuntime';

export async function applyAiDirectFeedback(params: {
  chat: GroupChat;
  chats: GroupChat[];
  characters: AICharacter[];
  content: string;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[] }) => Promise<void>;
}) {
  if (params.chat.type !== 'ai_direct' || !params.chat.sourceChatId || params.chat.sourceMemberIds?.length !== 2) return;

  const [starterId, targetId] = params.chat.sourceMemberIds;
  const starter = params.characters.find((item) => item.id === starterId);
  const target = params.characters.find((item) => item.id === targetId);
  if (!starter || !target) return;

  const evolution = resolveRuntimeEvolutionConfig(params.chat.runtimeEvolutionIntensity);
  const updatedStarter = updateCharacterRelationship(starter, targetId, params.content, evolution.relationshipMultiplier);
  const updatedTarget = updateCharacterRelationship(target, starterId, params.content, evolution.reciprocalRelationshipMultiplier);
  const starterDrift = derivePersonalityDrift(starter, params.content, evolution.driftMultiplier);
  const targetDrift = derivePersonalityDrift(target, params.content, evolution.driftMultiplier * 0.85);
  const starterEmotion = deriveEmotionalState(starter, params.content, evolution.emotionMultiplier, evolution.emotionDecayBias);
  const targetEmotion = deriveEmotionalState(target, params.content, evolution.emotionMultiplier * 0.85, evolution.emotionDecayBias);

  await params.updateCharacter(starterId, {
    relationships: updatedStarter.relationships,
    personalityDrift: starterDrift,
    emotionalState: starterEmotion,
    layeredMemories: updateCharacterLayeredMemories({
      character: { ...starter, relationships: updatedStarter.relationships, emotionalState: starterEmotion },
      targetId,
      targetName: target.name,
      content: params.content,
      personalityDrift: starterDrift,
    }),
    runtimeTimeline: accumulateCharacterRuntime(starter, { type: 'relationship', text: `与 ${target.name} 的AI私聊带来了关系变化（${evolution.label}）` }).concat(
      Object.keys(starterDrift).length ? [{ type: 'drift', text: `与 ${target.name} 互动后产生性格漂移`, createdAt: Date.now() }] : []
    ).slice(-Math.max(20, evolution.maxTimeline)),
  });

  await params.updateCharacter(targetId, {
    relationships: updatedTarget.relationships,
    personalityDrift: targetDrift,
    emotionalState: targetEmotion,
    layeredMemories: updateCharacterLayeredMemories({
      character: { ...target, relationships: updatedTarget.relationships, emotionalState: targetEmotion },
      targetId: starterId,
      targetName: starter.name,
      content: params.content,
      personalityDrift: targetDrift,
    }),
    runtimeTimeline: accumulateCharacterRuntime(target, { type: 'relationship', text: `与 ${starter.name} 的AI私聊带来了关系变化（${evolution.label}）` }).concat(
      Object.keys(targetDrift).length ? [{ type: 'drift', text: `与 ${starter.name} 互动后产生性格漂移`, createdAt: Date.now() }] : []
    ).slice(-Math.max(20, evolution.maxTimeline)),
  });

  const starterRelation = updatedStarter.relationships.find((item) => item.characterId === targetId);
  const targetRelation = updatedTarget.relationships.find((item) => item.characterId === starterId);
  const summary = `${starter.name}→${target.name}${summarizeRelationshipShift(starterRelation)}，${target.name}→${starter.name}${summarizeRelationshipShift(targetRelation)}`;

  await params.appendEventMessage(params.chat.sourceChatId, {
    eventType: 'relationship_shift',
    title: `${starter.name} 与 ${target.name} 的AI私聊影响了关系`,
    summary,
    pair: [starter.name, target.name],
    metrics: {
      starterToTarget: starterRelation || null,
      targetToStarter: targetRelation || null,
    },
    visibilityScope: 'derived_public',
  });

  const sourceChat = params.chats.find((item) => item.id === params.chat.sourceChatId);
  if (sourceChat) {
    await params.updateChat(params.chat.sourceChatId, {
      lastMessageAt: Date.now(),
      worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, ...(sourceChat.worldState || {}), recentEvent: `${starter.name} 与 ${target.name} 的AI私聊：${summary}` },
      ...accumulateChatRuntime(sourceChat, { type: 'event', content: `${starter.name} 与 ${target.name} 的AI私聊：${summary}` }),
      runtimeSeed: sourceChat.runtimeSeed,
    });
  }
}

export function buildAiPrivateChatDraft(sourceChat: GroupChat, starter: AICharacter, target: AICharacter) {
  const phase: ConversationPhase = 'warming';
  return {
    type: 'ai_direct' as const,
    mode: 'open_chat' as const,
    name: `${starter.name} × ${target.name}`,
    topic: `${starter.name} 和 ${target.name} 的AI私聊`,
    style: 'free' as const,
    runtimeEvolutionIntensity: sourceChat.runtimeEvolutionIntensity,
    memberIds: [starter.id, target.id],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    sourceChatId: sourceChat.id,
    sourceMemberIds: [starter.id, target.id],
    governance: { ownerCharacterId: starter.id, adminCharacterIds: [], autoModeration: false, allowMute: false, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase, mood: 'private', focus: sourceChat.topic || '', recentEvent: `派生自 ${sourceChat.name}` },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: false, allowForcedReply: true },
  };
}
