import type { AICharacter } from '../types/character';
import type { DriverMessageCommitTransition, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { MemoryItem } from './memoryTypes';
import { retrieveRelevantMemories } from './memoryRetrieval';
import { compactMemoryItems } from './memoryLifecycle';
import { accumulateCharacterRuntime } from './characterRuntime';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';

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
  return matchedRecallTokens(item, generatedText).length > 0;
}

function buildRecallMatchTokens(item: MemoryItem) {
  const source = [
    ...(item.recallTokens || []),
    item.summary,
    item.text,
    item.evidenceText,
  ].filter(Boolean).join('\n').toLowerCase();
  const tokens = [...(source.match(/[a-z0-9_]{3,}|[\u4e00-\u9fff]{2,}/g) || [])];
  const cjk = source.replace(/[^\u4e00-\u9fff]/g, '');
  const stopTokens = new Set(['记得', '关系', '正在', '变化', '当前', '发言', '这次', '那次', '以前', '曾在']);
  for (let index = 0; index < Math.min(cjk.length - 1, 40); index += 1) {
    tokens.push(cjk.slice(index, index + 2));
  }
  return Array.from(new Set(tokens.map((item) => item.trim()).filter((item) => item.length >= 2 && !stopTokens.has(item)))).slice(0, 28);
}

function matchedRecallTokens(item: MemoryItem, generatedText: string) {
  const normalized = generatedText.toLowerCase();
  return buildRecallMatchTokens(item)
    .filter((token) => token.length >= 2 && normalized.includes(token.toLowerCase()))
    .slice(0, 6);
}

function shouldActivateRecall(item: MemoryItem, generatedText: string) {
  if (!item.archivedAt || !item.recallReason) return false;
  return generatedTextMatchesRecall(item, generatedText);
}

function mergeRecallTokens(item: MemoryItem, tokens: string[] | undefined) {
  const merged = Array.from(new Set([...(tokens || []), ...(item.recallTokens || [])].filter(Boolean)));
  return merged.length ? merged : undefined;
}

function buildDisplayMembers(characters: AICharacter[]): DisplayTextMember[] {
  return characters.map((character) => ({ id: character.id, name: character.name || '成员' }));
}

function cleanRecallText(text: string | undefined | null, members: DisplayTextMember[], fallback = '') {
  return sanitizeUserFacingText(text, members) || fallback;
}

function cleanRecallTokens(tokens: string[], members: DisplayTextMember[]) {
  return Array.from(new Set(tokens
    .map((token) => cleanRecallText(token, members))
    .filter((token) => token && token !== '成员')))
    .slice(0, 8);
}

function buildMemoryReactivationEvent(params: {
  speaker: AICharacter;
  recalled: Array<{ item: MemoryItem; matchedTokens: string[] }>;
  members: DisplayTextMember[];
  createdAt: number;
}) {
  const summaries = params.recalled
    .slice(0, 2)
    .map(({ item }) => cleanRecallText(item.summary || item.text, params.members))
    .filter(Boolean);
  const matchedTokens = cleanRecallTokens(params.recalled.flatMap(({ matchedTokens }) => matchedTokens), params.members);
  return {
    eventType: 'memory_reactivation',
    title: '旧记忆回温',
    summary: `${params.speaker.name} 的旧记忆被当前发言重新唤醒：${summaries.join(' / ') || '一些旧事'}`,
    createdAt: params.createdAt,
    timelineType: 'note' as const,
    metrics: {
      characterId: params.speaker.id,
      characterName: params.speaker.name,
      matchedTokens,
      recalledMemories: params.recalled.slice(0, 4).map(({ item, matchedTokens: itemTokens }) => ({
        id: item.id,
        summary: cleanRecallText(item.summary || item.text, params.members, '旧记忆'),
        scope: item.scope,
        kind: item.kind,
        layer: item.layer,
        recallReason: item.recallReason ? cleanRecallText(item.recallReason, params.members) : undefined,
        recallScore: item.recallScore,
        matchedTokens: cleanRecallTokens(itemTokens, params.members),
      })),
    },
  };
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
        recallTokens: mergeRecallTokens(item, trace?.recallTokens),
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
  now?: number;
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
  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? Math.round(params.now) : Date.now();
  const recalled = (promptRecalled.length ? promptRecalled : retrieveRelevantMemories(layeredMemories, {
    speakerId: speaker.id,
    targetId: latestTargetId(params.recentMessages, speaker.id, params.chat.memberIds),
    conversationId: params.chat.id,
    maxItems: 6,
    now,
    cueText,
    includeArchivedRecall: true,
    maxArchivedItems: 3,
    preferredLayers: ['long_term', 'episodic', 'working'],
    preferredScopes: ['relationship', 'character_self', 'conversation', 'thread', 'system_runtime'],
  }))
    .filter((item) => shouldActivateRecall(item, params.message.content))
    .map((item) => ({ item, matchedTokens: matchedRecallTokens(item, params.message.content) }))
    .filter((item) => item.matchedTokens.length > 0);
  if (!recalled.length) return params.transition;

  const members = buildDisplayMembers(params.characters);
  const recalledIds = new Set(recalled.map(({ item }) => item.id));
  const nextMemories = compactMemoryItems(layeredMemories.map((item) => (
    recalledIds.has(item.id) ? activateMemoryItem(item, now) : item
  )), now);
  const recalledSummary = recalled.slice(0, 2)
    .map(({ item }) => cleanRecallText(item.summary || item.text, members))
    .filter(Boolean)
    .join(' / ') || '一些旧事';
  const runtimeTimeline = accumulateCharacterRuntime({
    ...speaker,
    ...(speakerPatch || {}),
  } as AICharacter, {
    type: 'memory',
    text: `旧记忆被当前发言重新唤醒：${recalledSummary}`,
    createdAt: now,
  }, { now }).slice(-80);

  const transitionWithCharacterPatch = mergeSpeakerPatch(params.transition, speaker.id, {
    layeredMemories: nextMemories,
    runtimeTimeline,
  });
  return {
    ...transitionWithCharacterPatch,
    runtimeEvents: [
      ...transitionWithCharacterPatch.runtimeEvents,
      buildMemoryReactivationEvent({ speaker, recalled, members, createdAt: now }),
    ],
  };
}
