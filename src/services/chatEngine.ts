import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import type { SessionGenerationPromptContext } from '../types/sessionEngine';
import { getPreferredAIProfile } from '../types/settings';
import type { InteractionEventPayload, SocialEventHintEnvelope } from '../types/runtimeEvent';
import { normalizeInteractionHintCollection } from '../types/runtimeEvent';
import { generateJsonResponse } from './aiClient';
import { buildSystemPromptWithContext, buildChatMessages } from './promptBuilder';
import { buildEngineAwarePrompt } from './promptContextAssembler';
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, getSpeakerSelectionResult, selectSpeaker } from './scheduler';
import { deriveSpeakIntentFromContext, describeIntentForPrompt } from './intentEngine';
import { buildHumanizationPrompt, postProcessHumanChat } from './dialogueHumanizer';
import { BASE_COOLDOWN_MS, MAX_HISTORY_FOR_PROMPT } from '../constants/defaults';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';

interface GeneratedRoundMessage extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'> {
  interactionHint?: InteractionEventPayload | null;
  interactionHints?: InteractionEventPayload[] | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
}

const emotionMap: Record<string, number> = {};

function buildSessionSystemPrompt(args: {
  speaker: AICharacter;
  chat: GroupChat;
  emotion: number;
  messages: Message[];
  characters: Map<string, AICharacter>;
}) {
  return buildEngineAwarePrompt({
    engineKey: args.chat.mode,
    character: args.speaker,
    chat: args.chat,
    emotion: args.emotion,
    messages: args.messages,
    characters: args.characters,
    fallback: ({ character, chat, emotion, messages, characters }) => buildSystemPromptWithContext(character, chat, emotion, messages, characters),
  });
}

function withGroupChatPrompt(prompt: string) {
  return `${prompt}\n\nTreat the room like a live multi-person conversation with momentum, partial replies, and social baggage.`;
}

function getRecentHumanlikeSignal(messages: Message[]) {
  return messages.slice(-4).map((message) => `${message.senderName}: ${message.content}`).join('\n');
}

function buildSessionPrompt(prompt: string, messages: Message[]) {
  const recentSignal = getRecentHumanlikeSignal(messages);
  return `${withGroupChatPrompt(prompt)}\n\nRecent room signal:\n${recentSignal}`;
}

function buildSpeakerSystemPrompt(args: {
  speaker: AICharacter;
  chat: GroupChat;
  emotion: number;
  activeMessages: Message[];
  characterMap: Map<string, AICharacter>;
}) {
  const basePrompt = buildSessionSystemPrompt({
    speaker: args.speaker,
    chat: args.chat,
    emotion: args.emotion,
    messages: args.activeMessages,
    characters: args.characterMap,
  });
  return buildSessionPrompt(basePrompt, args.activeMessages);
}

export const getEmotion = (characterId: string): number => emotionMap[characterId] || 0;
export const setEmotion = (characterId: string, value: number): void => { emotionMap[characterId] = value; };

export interface ChatEngineCallbacks {
  onSpeakerSelected: (characterId: string, speaker?: AICharacter) => void;
  onMessageChunk: (content: string) => void;
  onMessageComplete: (message: GeneratedRoundMessage) => void | Promise<void>;
  onIdle?: (reason: string) => void;
  onError: (error: Error) => void;
}

export function stripRoleActions(content: string) {
  return content
    .replace(/（[^（）]{1,24}）/g, '')
    .replace(/\([^()]{1,24}\)/g, '')
    .replace(/\*[^*\n]{1,24}\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\n]+|[\s\n]+$/g, '');
}

function trimSpeakerPrefix(content: string, speakerName: string) {
  const escapedName = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`^${escapedName}\\s*[:：]\\s*`), '').trim();
}

function trimHumanChatStyle(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .replace(/\n{2,}/g, '\n')
    .replace(/([。！？.!?])\s*([。！？.!?])+/g, '$1')
    .replace(/^(好的|明白了|我认为|我觉得是这样|总结一下|总的来说)[，,:：\s]*/i, '')
    .replace(/(总之|所以总体来说|综上)[，,:：\s]*$/i, '')
    .trim();
}

function salvageEmptyResponse(raw: string, speakerName: string, showRoleActions?: boolean) {
  const withoutPrefix = trimSpeakerPrefix(raw.trim(), speakerName);
  if (!withoutPrefix) return '';
  const stripped = showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix;
  if (normalizeForComparison(stripped)) return stripped.trim();
  const fallback = withoutPrefix
    .replace(/[（(][^）)]{0,40}[）)]/gu, ' ')
    .replace(/\*[^*\n]{1,24}\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeForComparison(fallback) ? fallback : '';
}

function limitResponseShape(content: string) {
  const trimmed = trimHumanChatStyle(content);
  if (!trimmed) return trimmed;
  const lines = trimmed.split(/\n+/).filter(Boolean);
  const firstLine = lines[0] || trimmed;
  const sentenceParts = firstLine.split(/(?<=[。！？!?])/).filter((part) => part.trim());
  if (sentenceParts.length <= 2) return firstLine.trim();
  return sentenceParts.slice(0, 2).join('').trim();
}

function finalizeResponse(content: string, intent: ReturnType<typeof deriveSpeakIntentFromContext>, speaker: AICharacter, recentMessages: Message[], showRoleActions?: boolean, intentionalRepeat = false) {
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  const sanitized = showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix;
  const processed = postProcessHumanChat(limitResponseShape(sanitized), intent, speaker, recentMessages, intentionalRepeat);
  if (normalizeForComparison(processed)) return processed;
  return salvageEmptyResponse(content, speaker.name, showRoleActions);
}

function buildRetryPrompt(basePrompt: string, priorAttempt: string) {
  return `${basePrompt}\n\nRetry rule:\n- Your previous draft was too close to recent chat or repetitive.\n- Write a meaningfully different line now.\n- Do not reuse this draft's surface or semantic core: ${priorAttempt.slice(0, 120)}`;
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

function collectRecentConstraintLines(messages: Message[], speakerId: string) {
  const sameSpeaker = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId === speakerId)
    .slice(-6)
    .map((message) => `- Your previous line: ${trimHumanChatStyle(message.content).slice(0, 80)}`);

  const roomLines = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId !== speakerId)
    .slice(-4)
    .map((message) => `- Room line from ${message.senderName}: ${trimHumanChatStyle(message.content).slice(0, 80)}`);

  return [...sameSpeaker, ...roomLines].filter((line, index, array) => {
    const normalized = normalizeForComparison(line);
    return normalized && array.findIndex((candidate) => normalizeForComparison(candidate) === normalized) === index;
  });
}

function buildGenerationConstraints(messages: Message[], speakerId: string) {
  const recentLines = collectRecentConstraintLines(messages, speakerId);
  const forbiddenBlock = recentLines.length ? `\nForbidden semantic overlap:\n${recentLines.join('\n')}` : '';
  return `\nHard constraints for this reply:
- Write exactly one chat message only. No self-explanation, no meta commentary.
- Do not repeat, paraphrase, summarize, or restate the same semantic point from the forbidden lines.
- Do not sound like an assistant answer. Never use structures like “首先/其次/最后/总结一下”, “first/second/finally”, or “in summary”.
- Do not give a balanced full explanation unless the room absolutely requires it.
- Keep it short, reactive, colloquial, and socially situated.
- Prefer one sharp move: a quick challenge, follow-up, jab, side remark, or clipped agreement.
- If the intent shape is question_only, output only a question. If fragment, output a clipped fragment.${forbiddenBlock}`;
}

function resolveApiConfigForCharacter(character: AICharacter, apiConfig: APIConfig | AIModelProfile[], profiles?: AIModelProfile[]) {
  const availableProfiles = Array.isArray(apiConfig) ? apiConfig : (profiles || []);
  if (availableProfiles.length > 0) {
    const textProfileId = getCharacterModelProfileId(character, 'text');
    const matched = availableProfiles.find((profile) => profile.id === textProfileId) || getPreferredAIProfile(availableProfiles, 'text') || availableProfiles[0];
    return {
      provider: matched.provider,
      apiKey: matched.apiKey,
      baseUrl: matched.baseUrl,
      model: matched.model,
    } satisfies APIConfig;
  }
  return apiConfig as APIConfig;
}

async function generateWithPrompt(params: {
  resolvedApi: APIConfig;
  systemPrompt: string;
  chatMessages: ReturnType<typeof buildChatMessages>;
  speaker: AICharacter;
  intent: ReturnType<typeof deriveSpeakIntentFromContext>;
  activeMessages: Message[];
  showRoleActions?: boolean;
}) {
  const response = await generateJsonResponse(params.resolvedApi, params.systemPrompt, params.chatMessages);
  const parsedEnvelope = parseInlineInteractionEnvelope(response);
  const rawContent = parsedEnvelope?.content || response;
  const finalResponse = finalizeResponse(rawContent, params.intent, params.speaker, params.activeMessages, params.showRoleActions);
  return { parsedEnvelope, rawContent, finalResponse };
}

async function generateNonDuplicateResponse(params: {
  resolvedApi: APIConfig;
  systemPrompt: string;
  chatMessages: ReturnType<typeof buildChatMessages>;
  speaker: AICharacter;
  intent: ReturnType<typeof deriveSpeakIntentFromContext>;
  activeMessages: Message[];
  showRoleActions?: boolean;
}) {
  let prompt = params.systemPrompt;
  let lastParsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope> = null;
  let lastFinalResponse = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generated = await generateWithPrompt({ ...params, systemPrompt: prompt });
    lastParsedEnvelope = generated.parsedEnvelope;
    lastFinalResponse = generated.finalResponse;
    if (normalizeForComparison(generated.finalResponse)) {
      return { parsedEnvelope: generated.parsedEnvelope, finalResponse: generated.finalResponse };
    }
    prompt = buildRetryPrompt(params.systemPrompt, generated.rawContent);
  }
  return { parsedEnvelope: lastParsedEnvelope, finalResponse: lastFinalResponse };
}

function buildCompletedMessage(params: {
  chat: GroupChat;
  speakerId: string;
  speakerName: string;
  finalResponse: string;
  emotion: number;
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope>;
}) {
  const interactionHints = normalizeInteractionHintCollection(params.parsedEnvelope?.interactionHints || null, params.speakerId, params.finalResponse);
  return {
    chatId: params.chat.id,
    type: 'ai' as const,
    senderId: params.speakerId,
    senderName: params.speakerName,
    content: params.finalResponse,
    emotion: params.emotion,
    interactionHint: interactionHints[0] || null,
    interactionHints,
    socialEventHints: params.parsedEnvelope?.socialEventHints || null,
  };
}

function updateAllEmotions(chatMembers: AICharacter[], speakerId: string, msgEmotion: number, emotion: number) {
  setEmotion(speakerId, updateEmotion(emotion, msgEmotion));
  for (const member of chatMembers) {
    if (member.id !== speakerId) {
      const otherEmotion = getEmotion(member.id);
      setEmotion(member.id, updateEmotion(otherEmotion, msgEmotion, 0.85));
    }
  }
}

function resolveSpeakerFromCandidates(chatMembers: AICharacter[], candidates: ReturnType<typeof calculateWeights>) {
  const speakerId = selectSpeaker(candidates);
  return chatMembers.find((member) => member.id === speakerId) || null;
}

function buildSpeakerContext(chatMembers: AICharacter[]) {
  return new Map(chatMembers.map((c) => [c.id, c]));
}

export const runOneRound = async (
  chat: GroupChat,
  characters: AICharacter[],
  messages: Message[],
  apiConfig: APIConfig | AIModelProfile[],
  callbacks: ChatEngineCallbacks,
  profiles?: AIModelProfile[],
  generationContext?: {
    promptContext?: SessionGenerationPromptContext | null;
    buildPromptContext?: (speaker: AICharacter) => SessionGenerationPromptContext | null | undefined;
  }
): Promise<void> => {
  const chatMembers = characters.filter((c) => chat.memberIds.includes(c.id));
  if (chatMembers.length === 0) {
    callbacks.onError(new Error('No AI members in this chat'));
    return;
  }

  const lastSpeakTimestamps: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.type === 'ai' && !msg.isDeleted) lastSpeakTimestamps[msg.senderId] = msg.timestamp;
  }

  const activeMessages = messages.filter((m) => !m.isDeleted);
  const candidates = calculateWeights(chatMembers, activeMessages, lastSpeakTimestamps, chat.speed, BASE_COOLDOWN_MS);
  const speakerSelection = getSpeakerSelectionResult(chatMembers, lastSpeakTimestamps, chat.speed, BASE_COOLDOWN_MS, candidates);
  if (!speakerSelection.speakerId) {
    if (speakerSelection.reason) callbacks.onIdle?.(speakerSelection.reason);
    return;
  }

  const speaker = chatMembers.find((c) => c.id === speakerSelection.speakerId);
  if (!speaker) return;
  callbacks.onSpeakerSelected(speaker.id, speaker);

  const attemptSpeaker = async (activeSpeaker: AICharacter) => {
    const emotion = getEmotion(activeSpeaker.id);
    const recentTargetId = activeMessages.filter((m) => m.type === 'ai' && !m.isDeleted).at(-1)?.senderId;
    const recentText = activeMessages.at(-1)?.content || '';
    const intent = deriveSpeakIntentFromContext(activeSpeaker, recentTargetId, recentText);
    const characterMap = new Map(chatMembers.map((c) => [c.id, c]));
    const enginePromptContext = generationContext?.buildPromptContext?.(activeSpeaker) || generationContext?.promptContext;
    const promptPrefix = enginePromptContext?.promptPrefix ? `${enginePromptContext.promptPrefix.trim()}\n\n` : '';
    const promptSuffix = enginePromptContext?.promptSuffix ? `\n\n${enginePromptContext.promptSuffix.trim()}` : '';
    const additionalConstraints = enginePromptContext?.additionalConstraints?.length
      ? `\n- ${enginePromptContext.additionalConstraints.join('\n- ')}`
      : '';
    const systemPrompt = `${promptPrefix}${buildSpeakerSystemPrompt({ speaker: activeSpeaker, chat, emotion, activeMessages, characterMap })}${buildHumanizationPrompt(activeSpeaker, intent, activeMessages)}

Current speaking intent:
- ${describeIntentForPrompt(intent)}
- Follow the intent shape strictly: fragment means a clipped phrase; question_only means only ask or challenge; single_sentence means one line; two_sentences is the max unless genuinely necessary.
- Respond like a WeChat group message: quick, targeted, partial, reactive, and slightly messy. Do not write a balanced full answer unless the room truly needs it.
- Prefer sounding impulsive, socially situated, colloquial, and slightly incomplete over sounding polished.
- If a human would just say “啊？”, “行吧”, “不是这个意思”, “那你这也太…”, or one sharp follow-up, do that instead of expanding.${additionalConstraints}${buildGenerationConstraints(activeMessages, activeSpeaker.id)}${buildInlineInteractionContract({ chat, speaker: activeSpeaker, characters: chatMembers, recentMessages: activeMessages })}${promptSuffix}`;
    const chatMessages = buildChatMessages(activeMessages, characterMap, MAX_HISTORY_FOR_PROMPT);
    const resolvedApi = resolveApiConfigForCharacter(activeSpeaker, apiConfig, profiles);
    return {
      emotion,
      generated: await generateNonDuplicateResponse({ resolvedApi, systemPrompt, chatMessages, speaker: activeSpeaker, intent, activeMessages, showRoleActions: chat.showRoleActions }),
    };
  };

  try {
    let activeSpeaker = speaker;
    let result = await attemptSpeaker(activeSpeaker);
    if (!normalizeForComparison(result.generated.finalResponse)) {
      const rotated = resolveSpeakerFromCandidates(chatMembers, candidates.filter((candidate) => candidate.characterId !== activeSpeaker.id));
      if (!rotated) throw new Error(`${activeSpeaker.name} 连续生成了重复内容，本轮已跳过。`);
      activeSpeaker = rotated;
      callbacks.onSpeakerSelected(activeSpeaker.id, activeSpeaker);
      result = await attemptSpeaker(activeSpeaker);
      if (!normalizeForComparison(result.generated.finalResponse)) {
        throw new Error(`${activeSpeaker.name} 连续生成了重复内容，本轮已跳过。`);
      }
    }
    const msgEmotion = analyzeEmotion(result.generated.finalResponse);
    updateAllEmotions(chatMembers, activeSpeaker.id, msgEmotion, result.emotion);
    await callbacks.onMessageComplete(buildCompletedMessage({
      chat,
      speakerId: activeSpeaker.id,
      speakerName: activeSpeaker.name,
      finalResponse: result.generated.finalResponse,
      emotion: getEmotion(activeSpeaker.id),
      parsedEnvelope: result.generated.parsedEnvelope,
    }));
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
};
