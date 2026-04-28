import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { getPreferredAIProfile } from '../types/settings';
import type { InteractionEventPayload } from '../types/runtimeEvent';
import { generateResponse } from './aiClient';
import { buildSystemPromptWithContext, buildChatMessages } from './promptBuilder';
import { buildEngineAwarePrompt } from './promptContextAssembler';
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, selectSpeaker } from './scheduler';
import { deriveSpeakIntentFromContext, describeIntentForPrompt } from './intentEngine';
import { buildHumanizationPrompt, postProcessHumanChat } from './dialogueHumanizer';
import { BASE_COOLDOWN_MS, MAX_HISTORY_FOR_PROMPT } from '../constants/defaults';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';

interface GeneratedRoundMessage extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'> {
  interactionHint?: InteractionEventPayload | null;
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
  onSpeakerSelected: (characterId: string) => void;
  onMessageChunk: (content: string) => void;
  onMessageComplete: (message: GeneratedRoundMessage) => void | Promise<void>;
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

function finalizeResponse(content: string, intent: ReturnType<typeof deriveSpeakIntentFromContext>, speaker: AICharacter, recentMessages: Message[], showRoleActions?: boolean) {
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  const sanitized = showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix;
  const processed = postProcessHumanChat(limitResponseShape(sanitized), intent, speaker, recentMessages);
  if (normalizeForComparison(processed)) return processed;
  return salvageEmptyResponse(content, speaker.name, showRoleActions);
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
    .slice(-3)
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

function toInteractionPayload(hint: { targetId?: string | null; kind?: InteractionEventPayload['kind']; tone?: InteractionEventPayload['tone']; intensity?: number; confidence?: number } | null, speakerId: string, content: string): InteractionEventPayload | null {
  if (!hint?.targetId || !hint.kind || hint.kind === 'side_comment') return null;
  const intensity = Math.max(1, Math.min(5, Number(hint.intensity || 0)));
  const confidence = Math.max(0, Math.min(1, Number(hint.confidence || 0)));
  return {
    actorId: speakerId,
    targetId: hint.targetId,
    kind: hint.kind,
    tone: hint.tone || 'cold',
    intensity,
    confidence,
    evidenceText: content.slice(0, 120),
  };
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

  const lastSpeakTimestamps: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.type === 'ai' && !msg.isDeleted) lastSpeakTimestamps[msg.senderId] = msg.timestamp;
  }

  const candidates = calculateWeights(chatMembers, messages.filter((m) => !m.isDeleted), lastSpeakTimestamps, chat.speed, BASE_COOLDOWN_MS);
  const speakerId = selectSpeaker(candidates);
  if (!speakerId) return;

  const speaker = chatMembers.find((c) => c.id === speakerId);
  if (!speaker) return;

  callbacks.onSpeakerSelected(speakerId);

  const emotion = getEmotion(speakerId);
  const recentTargetId = messages.filter((m) => m.type === 'ai' && !m.isDeleted).at(-1)?.senderId;
  const activeMessages = messages.filter((m) => !m.isDeleted);
  const recentText = activeMessages.at(-1)?.content || '';
  const intent = deriveSpeakIntentFromContext(speaker, recentTargetId, recentText);
  const characterMap = new Map(chatMembers.map((c) => [c.id, c]));
  const systemPrompt = `${buildSpeakerSystemPrompt({ speaker, chat, emotion, activeMessages, characterMap })}${buildHumanizationPrompt(speaker, intent, activeMessages)}

Current speaking intent:
- ${describeIntentForPrompt(intent)}
- Follow the intent shape strictly: fragment means a clipped phrase; question_only means only ask or challenge; single_sentence means one line; two_sentences is the max unless genuinely necessary.
- Respond like a WeChat group message: quick, targeted, partial, reactive, and slightly messy. Do not write a balanced full answer unless the room truly needs it.
- Prefer sounding impulsive, socially situated, colloquial, and slightly incomplete over sounding polished.
- If a human would just say “啊？”, “行吧”, “不是这个意思”, “那你这也太…”, or one sharp follow-up, do that instead of expanding.${buildGenerationConstraints(activeMessages, speakerId)}${buildInlineInteractionContract({ chat, speaker, characters: chatMembers, recentMessages: activeMessages })}`;
  const chatMessages = buildChatMessages(activeMessages, characterMap, MAX_HISTORY_FOR_PROMPT);

  try {
    const resolvedApi = resolveApiConfigForCharacter(speaker, apiConfig, profiles);
    const response = await generateResponse(resolvedApi, systemPrompt, chatMessages);
    const parsedEnvelope = parseInlineInteractionEnvelope(response);
    const rawContent = parsedEnvelope?.content || response;
    const finalResponse = finalizeResponse(rawContent, intent, speaker, activeMessages, chat.showRoleActions);

    if (!normalizeForComparison(finalResponse)) {
      callbacks.onError(new Error('Empty model response'));
      return;
    }

    const msgEmotion = analyzeEmotion(finalResponse);
    setEmotion(speakerId, updateEmotion(emotion, msgEmotion));

    for (const member of chatMembers) {
      if (member.id !== speakerId) {
        const otherEmotion = getEmotion(member.id);
        setEmotion(member.id, updateEmotion(otherEmotion, msgEmotion, 0.85));
      }
    }

    await callbacks.onMessageComplete({
      chatId: chat.id,
      type: 'ai',
      senderId: speakerId,
      senderName: speaker.name,
      content: finalResponse,
      emotion: getEmotion(speakerId),
      interactionHint: toInteractionPayload(parsedEnvelope?.interactionHint || null, speakerId, finalResponse),
    });
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
};
