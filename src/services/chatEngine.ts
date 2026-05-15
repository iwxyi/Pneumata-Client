import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import type { SessionGenerationPromptContext } from '../types/sessionEngine';
import { getPreferredAIProfile } from '../types/settings';
import type { ConflictFocusPayload, InteractionEventPayload, SocialEventHintEnvelope } from '../types/runtimeEvent';
import { normalizeInteractionHintCollection } from '../types/runtimeEvent';
import { generateResponse } from './aiClient';
import { buildSystemPromptWithContext, buildChatMessages } from './promptBuilder';
import { buildEngineAwarePrompt } from './promptContextAssembler';
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, getSpeakerSelectionResult, resolvePendingReplyContext, selectSpeaker } from './scheduler';
import { deriveSpeakIntentFromContext, describeIntentForPrompt } from './intentEngine';
import { buildHumanizationPrompt, postProcessHumanChat } from './dialogueHumanizer';
import { BASE_COOLDOWN_MS, MAX_HISTORY_FOR_PROMPT } from '../constants/defaults';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';
import { resolveCommittedStreamContent } from './streamingMessageLifecycle';

interface GeneratedRoundMessage extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'> {
  interactionHint?: InteractionEventPayload | null;
  interactionHints?: InteractionEventPayload[] | null;
  addressedTargetIds?: string[] | null;
  primaryAddressedTargetId?: string | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
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

function finalizeResponse(content: string, intent: ReturnType<typeof deriveSpeakIntentFromContext>, speaker: AICharacter, recentMessages: Message[], showRoleActions?: boolean, intentionalRepeat = false) {
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  const sanitized = trimHumanChatStyle(showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix);
  const processed = postProcessHumanChat(sanitized, intent, speaker, recentMessages, intentionalRepeat);
  if (normalizeForComparison(processed)) return processed;
  return salvageEmptyResponse(content, speaker.name, showRoleActions);
}

function buildRetryPrompt(basePrompt: string, priorAttempt: string) {
  return `${basePrompt}\n\nRetry rule:\n- Your previous draft was too close to recent chat or repetitive.\n- Write a meaningfully different line now.\n- Do not reuse this draft's surface or semantic core: ${priorAttempt.slice(0, 120)}`;
}

function cleanJsonLikeText(value: string) {
  return value
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function unescapeJsonStringContent(value: string) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function extractPartialJsonStringField(raw: string, fieldName: string) {
  const cleaned = cleanJsonLikeText(raw);
  const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`);
  const fieldMatch = fieldPattern.exec(cleaned);
  if (!fieldMatch) return null;
  let index = fieldMatch.index + fieldMatch[0].length;
  let escaped = false;
  let value = '';
  while (index < cleaned.length) {
    const char = cleaned[index];
    if (escaped) {
      value += `\\${char}`;
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }
    if (char === '"') break;
    value += char;
    index += 1;
  }
  return unescapeJsonStringContent(value);
}

function isPendingJsonEnvelopeChunk(raw: string) {
  const cleaned = cleanJsonLikeText(raw).trimStart();
  if (!cleaned) return false;
  if (cleaned.startsWith('{')) return true;
  if (cleaned.startsWith('"content"')) return true;
  if (cleaned.startsWith('"intentionalRepeat"')) return true;
  if (cleaned.startsWith('"interactionHints"')) return true;
  if (cleaned.startsWith('"socialEventHints"')) return true;
  if (cleaned.startsWith('"conflictFocus"')) return true;
  return false;
}

function buildStreamingDisplayContent(raw: string, speaker: AICharacter, showRoleActions?: boolean) {
  const extractedContent = extractPartialJsonStringField(raw, 'content');
  if (extractedContent === null) {
    if (isPendingJsonEnvelopeChunk(raw)) {
      return null;
    }
  }
  const content = extractedContent ?? raw;
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  return showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix;
}

function createStreamingDisplayBridge(
  speaker: AICharacter,
  showRoleActions: boolean | undefined,
  onChunk?: (content: string) => void,
) {
  let lastContent = '';

  return {
    push(raw: string) {
      if (!onChunk) return;
      const nextContent = buildStreamingDisplayContent(raw, speaker, showRoleActions);
      if (nextContent === null) return;
      if (nextContent === lastContent) return;
      lastContent = nextContent;
      onChunk(nextContent);
    },
    flush(finalContent: string) {
      if (!onChunk) return;
      if (finalContent === lastContent) return;
      lastContent = finalContent;
      onChunk(finalContent);
    },
    getLastContent() {
      return lastContent;
    },
  };
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
  onChunk?: (content: string) => void;
}) {
  const streamBridge = createStreamingDisplayBridge(params.speaker, params.showRoleActions, params.onChunk);
  const jsonPrompt = `${params.systemPrompt}\n\nThe response must be exactly one valid JSON object. Do not wrap it in markdown.`;
  const response = await generateResponse(
    params.resolvedApi,
    jsonPrompt,
    params.chatMessages,
    params.onChunk
      ? (raw) => {
          streamBridge.push(raw);
        }
      : undefined,
  );
  const parsedEnvelope = parseInlineInteractionEnvelope(response);
  const rawContent = parsedEnvelope?.content || response;
  const finalizedResponse = finalizeResponse(rawContent, params.intent, params.speaker, params.activeMessages, params.showRoleActions);
  const finalResponse = resolveCommittedStreamContent(finalizedResponse, streamBridge.getLastContent());
  streamBridge.flush(finalResponse);
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
  onChunk?: (content: string) => void;
}) {
  let prompt = params.systemPrompt;
  let lastParsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope> = null;
  let lastFinalResponse = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generated = await generateWithPrompt({ ...params, systemPrompt: prompt, onChunk: attempt === 0 ? params.onChunk : undefined });
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
    addressedTargetIds: params.parsedEnvelope?.addressedTargets?.targetIds || null,
    primaryAddressedTargetId: params.parsedEnvelope?.addressedTargets?.primaryTargetId || params.parsedEnvelope?.addressedTargets?.targetIds?.[0] || null,
    socialEventHints: params.parsedEnvelope?.socialEventHints || null,
    conflictFocus: params.parsedEnvelope?.conflictFocus || null,
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
  },
  cooldownMap?: Record<string, number>
): Promise<void> => {
  const chatMembers = characters.filter((c) => chat.memberIds.includes(c.id));
  if (chatMembers.length === 0) {
    callbacks.onError(new Error('No AI members in this chat'));
    return;
  }

  const messageSpeakTimestamps: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.type === 'ai' && !msg.isDeleted) messageSpeakTimestamps[msg.senderId] = msg.timestamp;
  }
  const effectiveCooldownMap = {
    ...messageSpeakTimestamps,
    ...(cooldownMap || {}),
  };

  const activeMessages = messages.filter((m) => !m.isDeleted);
  const pendingReplyContext = chat.type === 'group' ? resolvePendingReplyContext(chatMembers, activeMessages) : null;
  const candidates = calculateWeights(chatMembers, activeMessages, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, pendingReplyContext, chat);
  const speakerSelection = getSpeakerSelectionResult(chatMembers, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, candidates);
  if (chat.type === 'group' && !speakerSelection.speakerId) {
    console.info('[group-loop:idle]', {
      chatId: chat.id,
      mode: chat.mode,
      reason: speakerSelection.reason,
      pendingReplyContext,
    });
  }
  if (!speakerSelection.speakerId) {
    console.info('[group-loop:idle]', {
      chatId: chat.id,
      mode: chat.mode,
      reason: speakerSelection.reason,
      pendingReplyContext,
      cooldownMap: effectiveCooldownMap,
      recentAiTail: activeMessages.filter((message) => message.type === 'ai' && !message.isDeleted).slice(-5).map((message) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        timestamp: message.timestamp,
        content: message.content.slice(0, 80),
      })),
    });
  }
  if ((globalThis as { __AICHATGROUP_DEBUG_SCHEDULER__?: boolean }).__AICHATGROUP_DEBUG_SCHEDULER__) {
    const selectionDebug = {
      chatId: chat.id,
      type: chat.type,
      mode: chat.mode,
      activeMessages: activeMessages.slice(-8).map((message) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        type: message.type,
        timestamp: message.timestamp,
        content: message.content.slice(0, 80),
      })),
      messageSpeakTimestamps,
      effectiveCooldownMap,
      candidates: candidates
        .map((candidate) => ({
          ...candidate,
          speakerName: chatMembers.find((member) => member.id === candidate.characterId)?.name || candidate.characterId,
        }))
        .sort((a, b) => b.weight - a.weight),
      pickedSpeakerId: speakerSelection.speakerId,
      pickedSpeakerName: chatMembers.find((member) => member.id === speakerSelection.speakerId)?.name || null,
      idleReason: speakerSelection.reason,
      pendingReplyContext,
    };
    console.log('[group-loop:selection]', selectionDebug);
    console.log('[group-loop:selection:json]', JSON.stringify(selectionDebug));
  }
  if (!speakerSelection.speakerId) {
    if (speakerSelection.reason) callbacks.onIdle?.(speakerSelection.reason);
    return;
  }

  const speaker = chatMembers.find((c) => c.id === speakerSelection.speakerId);
  if (!speaker) return;
  callbacks.onSpeakerSelected(speaker.id, speaker);

  const attemptSpeaker = async (activeSpeaker: AICharacter) => {
    const emotion = getEmotion(activeSpeaker.id);
    const fallbackRecentTargetId = activeMessages.filter((m) => m.type === 'ai' && !m.isDeleted).at(-1)?.senderId;
    const recentTargetId = pendingReplyContext?.targetIds.includes(activeSpeaker.id)
      ? pendingReplyContext.sourceSpeakerId || fallbackRecentTargetId
      : fallbackRecentTargetId;
    const recentText = activeMessages.at(-1)?.content || '';
    const intent = deriveSpeakIntentFromContext(activeSpeaker, recentTargetId, recentText);
    if (pendingReplyContext?.targetIds.includes(activeSpeaker.id) && pendingReplyContext.sourceSpeakerId) {
      intent.target = pendingReplyContext.sourceSpeakerId;
      if (intent.stance === 'deflect') {
        intent.stance = 'support';
      }
      if (intent.delivery === 'group_redirect') {
        intent.delivery = 'short_reply';
      }
      if (intent.messageShape === 'fragment') {
        intent.messageShape = 'single_sentence';
      }
    }
    const characterMap = new Map(chatMembers.map((c) => [c.id, c]));
    const enginePromptContext = generationContext?.buildPromptContext?.(activeSpeaker) || generationContext?.promptContext;
    const promptPrefix = enginePromptContext?.promptPrefix ? `${enginePromptContext.promptPrefix.trim()}\n\n` : '';
    const promptSuffix = enginePromptContext?.promptSuffix ? `\n\n${enginePromptContext.promptSuffix.trim()}` : '';
    const additionalConstraints = enginePromptContext?.additionalConstraints?.length
      ? `\n- ${enginePromptContext.additionalConstraints.join('\n- ')}`
      : '';
    const pendingReplyPrompt = pendingReplyContext?.targetIds.includes(activeSpeaker.id) && pendingReplyContext.sourceSpeakerId
      ? `\nPending reply expectation:\n- You were explicitly addressed by ${characterMap.get(pendingReplyContext.sourceSpeakerId)?.name || pendingReplyContext.sourceSpeakerId}.\n- Reply to that character first instead of pivoting to another member.\n- Acknowledge their question or emotion before expanding to the room.`
      : '';
    const systemPrompt = `${promptPrefix}${buildSpeakerSystemPrompt({ speaker: activeSpeaker, chat, emotion, activeMessages, characterMap })}${buildHumanizationPrompt(activeSpeaker, intent, activeMessages)}${pendingReplyPrompt}

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
      generated: await generateNonDuplicateResponse({
        resolvedApi,
        systemPrompt,
        chatMessages,
        speaker: activeSpeaker,
        intent,
        activeMessages,
        showRoleActions: chat.showRoleActions,
        onChunk: callbacks.onMessageChunk,
      }),
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

export const __chatEngineTestUtils = {
  extractPartialJsonStringField,
  buildStreamingDisplayContent,
  isPendingJsonEnvelopeChunk,
  finalizeResponse,
};
