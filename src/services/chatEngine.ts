import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { generateResponse } from './aiClient';
import { buildSystemPrompt, buildChatMessages } from './promptBuilder';
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, selectSpeaker } from './scheduler';
import { BASE_COOLDOWN_MS, MAX_HISTORY_FOR_PROMPT } from '../constants/defaults';

// Emotion state for each AI character
const emotionMap: Record<string, number> = {};

export const getEmotion = (characterId: string): number => {
  return emotionMap[characterId] || 0;
};

export const setEmotion = (characterId: string, value: number): void => {
  emotionMap[characterId] = value;
};

export interface ChatEngineCallbacks {
  onSpeakerSelected: (characterId: string) => void;
  onMessageChunk: (content: string) => void;
  onMessageComplete: (message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) => void;
  onError: (error: Error) => void;
}

function stripRoleActions(content: string) {
  return content
    .replace(/（[^（）]{1,24}）/g, '')
    .replace(/\([^()]{1,24}\)/g, '')
    .replace(/\*[^*\n]{1,24}\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\n]+|[\s\n]+$/g, '');
}

function normalizeForComparison(content: string) {
  return content
    .replace(/（[^（）]{1,24}）/g, '')
    .replace(/\([^()]{1,24}\)/g, '')
    .replace(/\*[^*\n]{1,24}\*/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function jaccardSimilarity(a: string, b: string) {
  const aSet = new Set(a.split(' ').filter(Boolean));
  const bSet = new Set(b.split(' ').filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function isTooSimilarToRecentSameSpeaker(messages: Message[], speakerId: string, content: string) {
  const normalized = normalizeForComparison(content);
  if (!normalized) return false;

  const recentSameSpeaker = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId === speakerId)
    .slice(-4);

  return recentSameSpeaker.some((message) => {
    const previous = normalizeForComparison(message.content);
    if (!previous) return false;
    return previous === normalized
      || previous.includes(normalized)
      || normalized.includes(previous)
      || jaccardSimilarity(previous, normalized) >= 0.72;
  });
}

function isTooSimilarToRecentConversation(messages: Message[], speakerId: string, content: string) {
  const normalized = normalizeForComparison(content);
  if (!normalized) return false;

  const recentAiMessages = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted)
    .slice(-6);

  return recentAiMessages.some((message) => {
    if (message.senderId === speakerId) return false;
    const previous = normalizeForComparison(message.content);
    if (!previous) return false;
    return jaccardSimilarity(previous, normalized) >= 0.82;
  });
}

function isWeakContent(content: string) {
  const normalized = normalizeForComparison(content);
  const words = normalized.split(' ').filter(Boolean);
  return words.length < 4 || normalized.length < 12;
}

function needsRetry(messages: Message[], speakerId: string, content: string) {
  return isWeakContent(content)
    || isTooSimilarToRecentSameSpeaker(messages, speakerId, content)
    || isTooSimilarToRecentConversation(messages, speakerId, content);
}

function buildRetryPrompt(response: string) {
  return `${response}\n\n请不要重复你刚才已经表达过的内容。换一个新的角度，推进讨论，保持简洁具体。\nDo not repeat the previous wording or the same point. Add a new point and move the conversation forward.`;
}

function resolveApiConfigForCharacter(character: AICharacter, apiConfig: APIConfig | AIModelProfile[], profiles?: AIModelProfile[]) {
  const availableProfiles = Array.isArray(apiConfig) ? apiConfig : (profiles || []);
  if (availableProfiles.length > 0) {
    const matched = availableProfiles.find((profile) => profile.id === character.modelProfileId) || availableProfiles[0];
    return {
      provider: matched.provider,
      apiKey: matched.apiKey,
      baseUrl: matched.baseUrl,
      model: matched.model,
    } satisfies APIConfig;
  }
  return apiConfig as APIConfig;
}

export const runOneRound = async (
  chat: GroupChat,
  characters: AICharacter[],
  messages: Message[],
  apiConfig: APIConfig | AIModelProfile[],
  callbacks: ChatEngineCallbacks,
  profiles?: AIModelProfile[]
): Promise<void> => {
  const chatMembers = characters.filter((c) => chat.memberIds.includes(c.id));

  if (chatMembers.length === 0) {
    callbacks.onError(new Error('No AI members in this chat'));
    return;
  }

  // Calculate weights and select speaker
  const lastSpeakTimestamps: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.type === 'ai' && !msg.isDeleted) {
      lastSpeakTimestamps[msg.senderId] = msg.timestamp;
    }
  }

  const candidates = calculateWeights(
    chatMembers,
    messages.filter((m) => !m.isDeleted),
    lastSpeakTimestamps,
    chat.speed,
    BASE_COOLDOWN_MS
  );

  const speakerId = selectSpeaker(candidates);
  if (!speakerId) {
    return;
  }

  const speaker = chatMembers.find((c) => c.id === speakerId);
  if (!speaker) return;

  callbacks.onSpeakerSelected(speakerId);

  // Build prompt
  const emotion = getEmotion(speakerId);
  const systemPrompt = buildSystemPrompt(speaker, chat, emotion);
  const characterMap = new Map(chatMembers.map((c) => [c.id, c]));
  const chatMessages = buildChatMessages(messages.filter((m) => !m.isDeleted), characterMap, MAX_HISTORY_FOR_PROMPT);

  try {
    const resolvedApi = resolveApiConfigForCharacter(speaker, apiConfig, profiles);

    // Generate response with streaming
    let response = await generateResponse(
      resolvedApi,
      systemPrompt,
      chatMessages,
      callbacks.onMessageChunk
    );
    let finalResponse = chat.showRoleActions === false ? stripRoleActions(response) : response;

    if (needsRetry(messages, speakerId, finalResponse)) {
      response = await generateResponse(
        resolvedApi,
        `${systemPrompt}\n\n${buildRetryPrompt(finalResponse)}`,
        chatMessages,
        callbacks.onMessageChunk
      );
      finalResponse = chat.showRoleActions === false ? stripRoleActions(response) : response;

      if (needsRetry(messages, speakerId, finalResponse)) {
        callbacks.onError(new Error('Generated duplicate or weak response'));
        return;
      }
    }

    // Update emotion
    const msgEmotion = analyzeEmotion(finalResponse);
    setEmotion(speakerId, updateEmotion(emotion, msgEmotion));

    // Update emotions of other characters based on this message
    for (const member of chatMembers) {
      if (member.id !== speakerId) {
        const otherEmotion = getEmotion(member.id);
        // Others are slightly influenced by the message
        setEmotion(member.id, updateEmotion(otherEmotion, msgEmotion, 0.85));
      }
    }

    callbacks.onMessageComplete({
      chatId: chat.id,
      type: 'ai',
      senderId: speakerId,
      senderName: speaker.name,
      content: finalResponse,
      emotion: getEmotion(speakerId),
    });
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
};
