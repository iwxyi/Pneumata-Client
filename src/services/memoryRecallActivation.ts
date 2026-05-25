import type { AICharacter } from '../types/character';
import type { DriverMessageCommitTransition, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { MemoryItem } from './memoryTypes';
import { retrieveRelevantMemories } from './memoryRetrieval';
import { compactMemoryItems } from './memoryLifecycle';
import { accumulateCharacterRuntime } from './characterRuntime';

function latestTargetId(messages: Array<Pick<Message, 'senderId' | 'type' | 'isDeleted'>>, speakerId: string, memberIds: string[]) {
  const members = new Set(memberIds);
  return messages
    .filter((message) => !message.isDeleted && message.senderId !== speakerId && members.has(message.senderId) && message.type !== 'system' && message.type !== 'event')
    .slice()
    .reverse()[0]?.senderId || null;
}

function buildRecallCue(messages: Array<Pick<Message, 'senderName' | 'senderId' | 'content' | 'type' | 'isDeleted'>>, message: Pick<Message, 'senderName' | 'content'>) {
  const recent = messages
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-5)
    .map((item) => `${item.senderName || item.senderId}：${item.content}`)
    .join('\n');
  return [recent, `${message.senderName}：${message.content}`].filter(Boolean).join('\n').slice(-1200);
}

function generatedTextMatchesRecall(item: MemoryItem, generatedText: string) {
  const normalized = generatedText.toLowerCase();
  const tokens = item.recallTokens || [];
  return tokens.some((token) => token.length >= 2 && normalized.includes(token.toLowerCase()));
}

function shouldActivateRecall(item: MemoryItem, generatedText: string) {
  if (!item.archivedAt || !item.recallReason) return false;
  return generatedTextMatchesRecall(item, generatedText) || (item.recallScore || 0) >= 1.2;
}

function recalledFromPromptMetadata(
  layeredMemories: MemoryItem[],
  message: Pick<Message, 'metadata'>,
): MemoryItem[] {
  const recalledArchives = message.metadata?.runtimeDecision?.memoryContext?.recalledArchives || [];
  if (!recalledArchives.length) return [];
  const traceById = new Map(recalledArchives.map((item) => [item.id, item] as const));
  return layeredMemories
    .filter((item) => item.archivedAt && traceById.has(item.id))
    .map((item) => {
      const trace = traceById.get(item.id);
      return {
        ...item,
        recallReason: trace?.recallReason || '旧档被本轮提示词注入',
        recallTokens: trace?.recallTokens,
        recallScore: trace?.recallScore,
      };
    });
}

function activateMemoryItem(item: MemoryItem, now: number): MemoryItem {
  return {
    ...item,
    archivedAt: null,
    lastActivatedAt: now,
    updatedAt: now,
    recency: Math.max(item.recency, 0.72),
    confidence: Math.min(1, item.confidence + 0.03),
    reinforcementCount: item.reinforcementCount + 1,
  };
}

function mergeSpeakerPatch(transition: DriverMessageCommitTransition, characterId: string, patch: Partial<AICharacter>): DriverMessageCommitTransition {
  const existing = transition.characterPatches.find((item) => item.characterId === characterId);
  if (existing) return {
    ...transition,
    characterPatches: transition.characterPatches.map((item) => item.characterId === characterId
      ? { ...item, patch: { ...item.patch, ...patch } }
      : item),
  };
  return {
    ...transition,
    characterPatches: [...transition.characterPatches, { characterId, patch }],
  };
}

export function applyRecalledMemoryActivation(params: {
  chat: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId' | 'senderName' | 'isDeleted' | 'metadata'>;
  recentMessages: Message[];
  transition: DriverMessageCommitTransition;
}) {
  if (params.message.type !== 'ai' || !params.message.content.trim()) return params.transition;
  const speaker = params.characters.find((item) => item.id === params.message.senderId);
  if (!speaker?.layeredMemories?.length) return params.transition;
  const speakerPatch = params.transition.characterPatches.find((item) => item.characterId === speaker.id)?.patch;
  const layeredMemories = Array.isArray(speakerPatch?.layeredMemories)
    ? speakerPatch.layeredMemories as MemoryItem[]
    : speaker.layeredMemories || [];
  if (!layeredMemories.some((item) => item.archivedAt)) return params.transition;

  const cueText = buildRecallCue(params.recentMessages, params.message);
  const promptRecalled = recalledFromPromptMetadata(layeredMemories, params.message);
  const recalled = (promptRecalled.length ? promptRecalled : retrieveRelevantMemories(layeredMemories, {
    speakerId: speaker.id,
    targetId: latestTargetId(params.recentMessages, speaker.id, params.chat.memberIds),
    conversationId: params.chat.id,
    maxItems: 6,
    cueText,
    includeArchivedRecall: true,
    maxArchivedItems: 3,
    preferredLayers: ['long_term', 'episodic', 'working'],
    preferredScopes: ['relationship', 'character_self', 'conversation', 'thread', 'system_runtime'],
  })).filter((item) => shouldActivateRecall(item, params.message.content));
  if (!recalled.length) return params.transition;

  const now = Date.now();
  const recalledIds = new Set(recalled.map((item) => item.id));
  const nextMemories = compactMemoryItems(layeredMemories.map((item) => (
    recalledIds.has(item.id) ? activateMemoryItem(item, now) : item
  )), now);
  const runtimeTimeline = accumulateCharacterRuntime({
    ...speaker,
    ...(speakerPatch || {}),
  } as AICharacter, {
    type: 'memory',
    text: `旧记忆被当前发言重新唤醒：${recalled.slice(0, 2).map((item) => item.summary || item.text).join(' / ')}`,
  }).slice(-80);

  return mergeSpeakerPatch(params.transition, speaker.id, {
    layeredMemories: nextMemories,
    runtimeTimeline,
  });
}
