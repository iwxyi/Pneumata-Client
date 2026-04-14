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
    // All on cooldown, wait a bit
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
    // Generate response with streaming
    const response = await generateResponse(
      resolveApiConfigForCharacter(speaker, apiConfig, profiles),
      systemPrompt,
      chatMessages,
      callbacks.onMessageChunk
    );

    // Update emotion
    const msgEmotion = analyzeEmotion(response);
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
      content: response,
      emotion: getEmotion(speakerId),
    });
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
};
