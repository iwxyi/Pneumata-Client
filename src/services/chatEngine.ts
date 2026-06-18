import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import { resolveShowRoleActions, type GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import type { MediaGenerationDecision, MessageAttachment, MessageMetadata } from '../types/message';
import type { SessionGenerationPromptContext } from '../types/sessionEngine';
import type { MemoryItem } from './memoryTypes';
import { getPreferredAIProfile } from '../types/settings';
import type { ConflictFocusPayload, InteractionEventPayload, SocialEventHintEnvelope } from '../types/runtimeEvent';
import { normalizeInteractionHintCollection } from '../types/runtimeEvent';
import { generateResponse } from './aiClient';
import { buildSystemPromptWithContext, buildChatMessages, buildPromptMemoryTrace, type PromptMemoryTrace } from './promptBuilder';
import { buildCompanionshipRuntimeTrace } from './companionshipProjection';
import { buildEngineAwarePrompt } from './promptContextAssembler';
import { resolveSessionDefinition } from '../types/sessionEngine';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { getStyleProfile, resolveDefaultStyleProfile } from './styleProfileRegistry';
import { getChannelSemantics } from './channelSemanticsRegistry';

function getSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionEngine(chat);
}
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, getSpeakerSelectionResult, resolvePendingReplyContext, selectSpeaker } from './scheduler';
import { deriveSpeakIntentFromContext, describeIntentForPrompt, type SpeakIntent } from './intentEngine';
import { describeDirectorIntent, type DirectorIntent } from './directorIntent';
import type { NarrativeLineProjection } from './narrativeProjection';
import { projectRuntimePressure, resolveLatestActiveUserGuidance } from './runtimeDecision';
import type { SpeakerScoreBreakdown } from './speakerScoring';
import { buildHumanizationPrompt, postProcessHumanChat } from './dialogueHumanizer';
import { buildInnerLifeMetadata, buildInnerLifePromptBlock, projectInnerLife, type InnerLifeProjection } from './innerLifeEngine';
import { maybeAutoWithdrawMessage } from './messageWithdrawal';
import { BASE_COOLDOWN_MS, MAX_HISTORY_FOR_PROMPT } from '../constants/defaults';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';
import { resolveCommittedStreamContent } from './streamingMessageLifecycle';
import { getExpressionFeedbackCategoryLabel, summarizeExpressionFeedbackInfluence } from './expressionFeedbackInfluence';
import type { UserGuidanceIntent } from './userGuidanceIntent';
import { evaluateGuidanceGeneratedContent, type GuidanceExecutionReason, type GuidanceRejectionReason } from './guidanceExecution';
import { projectWorldAttentionStates, projectWorldCalendar, projectWorldMoments } from './worldRuntimeProjection';
import { buildTurnPlanPrompt, deriveTurnPlan, type TurnPlan } from './turnPlanner';
import { resolvePersonaActivation, type PersonaActivation } from './personaActivation';
import { buildGenerationRuntimeBundle } from './generationRuntime';
import { normalizeStoryChoiceSuggestions } from './storyChoices';

export interface GeneratedRoundMessage extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'> {
  extraMessages?: string[] | null;
  interactionHint?: InteractionEventPayload | null;
  interactionHints?: InteractionEventPayload[] | null;
  addressedTargetIds?: string[] | null;
  primaryAddressedTargetId?: string | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
}

export type LocalInterceptionKind =
  | 'guidance_retry'
  | 'surface_echo_retry'
  | 'surface_echo_skip'
  | 'empty_generation_skip'
  | 'auto_withdraw';

export interface LocalInterceptionEvent {
  kind: LocalInterceptionKind;
  speakerId: string;
  speakerName: string;
  draft?: string;
  reason: string;
  attempt?: number;
  generationRuntime?: import('../types/sessionEngine').SessionGenerationRuntimeBundle | null;
}

type ResponseSurfaceKind = 'chat' | 'professional' | 'creative' | 'longform';

interface ResponseSurface {
  kind: ResponseSurfaceKind;
  allowMarkdown: boolean;
  preserveParagraphs: boolean;
  roleFit: 'limited' | 'ordinary' | 'capable';
  basis: string[];
}

type ExpressionFeedbackTrace = NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['expressionFeedback']>;
type GuidanceExecutionTrace = NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['guidanceExecution']>;
type GenerationWithGuidanceTrace = {
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope>;
  finalResponse: string;
  fullResponse: string;
  extraMessages?: string[] | null;
  guidanceExecution?: GuidanceExecutionTrace;
};

const MAX_EXTRA_MESSAGES = 4;
const emotionMap: Record<string, number> = {};

class EmptyGeneratedResponseError extends Error {
  localInterceptionReported: boolean;

  constructor(speakerName: string, options?: { localInterceptionReported?: boolean }) {
    super(`${speakerName} 连续生成了重复内容，本轮已跳过。`);
    this.name = 'EmptyGeneratedResponseError';
    this.localInterceptionReported = Boolean(options?.localInterceptionReported);
  }
}

function isSchedulerDebugEnabled() {
  return Boolean((globalThis as { __AICHATGROUP_DEBUG_SCHEDULER__?: boolean }).__AICHATGROUP_DEBUG_SCHEDULER__);
}

function buildSessionSystemPrompt(args: {
  speaker: AICharacter;
  chat: GroupChat;
  emotion: number;
  messages: Message[];
  characters: Map<string, AICharacter>;
  preferEnginePromptAdapter?: boolean;
}) {
  if (!args.preferEnginePromptAdapter) {
    return buildSystemPromptWithContext(args.speaker, args.chat, args.emotion, args.messages, args.characters);
  }
  const session = resolveSessionDefinition(args.chat);
  return buildEngineAwarePrompt({
    engineKey: session.kind.scenarioId,
    character: args.speaker,
    chat: args.chat,
    emotion: args.emotion,
    messages: args.messages,
    characters: args.characters,
    fallback: ({ character, chat, emotion, messages, characters }) => buildSystemPromptWithContext(character, chat, emotion, messages, characters),
  });
}

function mergePromptContexts(base: SessionGenerationPromptContext | null | undefined, extra: SessionGenerationPromptContext | null | undefined) {
  if (!extra) return base || null;
  if (!base) return extra;
  return {
    ...base,
    ...extra,
    promptPrefix: [base.promptPrefix, extra.promptPrefix].filter(Boolean).join('\n\n') || undefined,
    promptSuffix: [base.promptSuffix, extra.promptSuffix].filter(Boolean).join('\n\n') || undefined,
    additionalConstraints: [...(base.additionalConstraints || []), ...(extra.additionalConstraints || [])],
    responseStyle: extra.responseStyle || base.responseStyle,
    allowMarkdown: extra.allowMarkdown ?? base.allowMarkdown,
  };
}

function resolveStyleProfilePromptContext(chat: GroupChat) {
  const session = resolveSessionDefinition(chat);
  const styleProfileKey = resolveDefaultStyleProfile({
    scenarioId: chat.sessionKind?.scenarioId || session.kind.scenarioId,
    family: chat.sessionKind?.family || session.kind.family,
  });
  return getStyleProfile(styleProfileKey)?.promptContext || null;
}

function buildChannelSemanticPrefix(chat: GroupChat) {
  return getChannelSemantics(chat).promptPrefix;
}

function buildSessionPrompt(prompt: string, messages: Message[], chat: GroupChat) {
  const semanticPrefix = buildChannelSemanticPrefix(chat);
  const transcriptInstruction = getChannelSemantics(chat).transcriptInstruction;
  return `${semanticPrefix}\n\n${prompt}\n\nRecent context signals:\n- ${transcriptInstruction}\n${buildRecentContextSignalSummary(messages)}`;
}

function buildSpeakerSystemPrompt(args: {
  speaker: AICharacter;
  chat: GroupChat;
  emotion: number;
  activeMessages: Message[];
  characterMap: Map<string, AICharacter>;
  preferEnginePromptAdapter?: boolean;
}) {
  const basePrompt = buildSessionSystemPrompt({
    speaker: args.speaker,
    chat: args.chat,
    emotion: args.emotion,
    messages: args.activeMessages,
    characters: args.characterMap,
    preferEnginePromptAdapter: args.preferEnginePromptAdapter,
  });
  return buildSessionPrompt(basePrompt, args.activeMessages, args.chat);
}

function getSessionMessageSpeakerName(message: Message) {
  if (message.type === 'user' || message.type === 'god') return 'User';
  if (message.type === 'system') return 'System';
  if (message.type === 'event') return 'Event';
  return message.senderName || 'Unknown';
}

function buildRecentContextSignalSummary(messages: Message[]) {
  const recent = messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .slice(-8);
  if (!recent.length) return '- No visible recent turns yet.';
  const latest = recent.at(-1);
  const humanCount = recent.filter((message) => message.type === 'user' || message.type === 'god').length;
  const aiCount = recent.filter((message) => message.type === 'ai').length;
  const speakers = Array.from(new Set(recent.map(getSessionMessageSpeakerName))).slice(-6);
  return [
    `- Complete recent transcript is supplied as separate chat messages and is not repeated here.`,
    `- Recent window: ${recent.length} turns (${humanCount} human / ${aiCount} AI).`,
    `- Latest turn: ${latest ? `${latest.type === 'ai' ? 'AI' : 'human'} from ${getSessionMessageSpeakerName(latest)}` : 'none'}.`,
    `- Active speakers: ${speakers.join(', ') || 'none'}.`,
  ].join('\n');
}


export const getEmotion = (characterId: string): number => emotionMap[characterId] || 0;
export const setEmotion = (characterId: string, value: number): void => { emotionMap[characterId] = value; };

export interface ChatEngineCallbacks {
  onSpeakerSelected: (characterId: string, speaker?: AICharacter) => void;
  ensureSpeakerDetail?: (characterId: string, speaker?: AICharacter) => Promise<AICharacter | null | undefined>;
  onMessageChunk: (content: string) => void;
  onMessageComplete: (message: GeneratedRoundMessage) => void | Promise<void>;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  onIdle?: (reason: string) => void;
  onError: (error: Error) => void;
}

function isTestRuntime() {
  return Boolean((globalThis as { __vitest_worker__?: unknown; __VITEST__?: unknown }).__vitest_worker__ || (globalThis as { __VITEST__?: unknown }).__VITEST__);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function resolveInnerLifeTypingDelayMs(projection: InnerLifeProjection, chat: GroupChat) {
  const baseDelay = projection.expressionPlan.delayMs || 0;
  const impulseExtra: Record<string, number> = {
    repair: 520,
    defend_face: 420,
    mock: 220,
    avoid: 360,
    seek_attention: 180,
    withdraw: 620,
  };
  const residueExtra = (projection.expressionPlan.allowWithdraw ? 360 : 0)
    + Math.max(0, (projection.state.repression || 0) - 56) * 8
    + Math.max(0, (projection.state.shame || 0) - 56) * 7;
  const speed = Math.max(0.5, Math.min(3, chat.speed || 1));
  return Math.round(Math.max(250, Math.min(2600, (baseDelay + (impulseExtra[projection.impulse] || 0) + residueExtra) / speed)));
}

async function waitForInnerLifeTypingDelay(projection: InnerLifeProjection, chat: GroupChat, delay?: (ms: number) => Promise<void>) {
  const ms = resolveInnerLifeTypingDelayMs(projection, chat);
  if (isTestRuntime() || ms <= 0) return ms;
  await (delay || sleep)(ms);
  return ms;
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

function trimHumanChatStyle(content: string, preserveParagraphs = false) {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  void preserveParagraphs;
  return trimmed.replace(/\n{3,}/g, '\n\n');
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

function finalizeResponse(content: string, intent: ReturnType<typeof deriveSpeakIntentFromContext>, speaker: AICharacter, recentMessages: Message[], showRoleActions?: boolean, intentionalRepeat = false, surface?: ResponseSurface) {
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  const sanitized = trimHumanChatStyle(showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix, surface?.preserveParagraphs);
  if (surface?.kind !== 'chat' && normalizeForComparison(sanitized)) return sanitized;
  const processed = postProcessHumanChat(sanitized, intent, speaker, recentMessages, intentionalRepeat);
  if (normalizeForComparison(processed)) return processed;
  return salvageEmptyResponse(content, speaker.name, showRoleActions);
}

function normalizeExtraMessages(params: {
  content: string;
  extraMessages: unknown;
  intent: ReturnType<typeof deriveSpeakIntentFromContext>;
  speaker: AICharacter;
  recentMessages: Message[];
  showRoleActions?: boolean;
  surface?: ResponseSurface;
  turnPlan?: TurnPlan | null;
}) {
  if (!Array.isArray(params.extraMessages)) return null;
  const maxExtraMessages = MAX_EXTRA_MESSAGES;
  const normalizedContent = normalizeForComparison(params.content);
  const seen = new Set<string>(normalizedContent ? [normalizedContent] : []);
  const cleaned = params.extraMessages
    .slice(0, maxExtraMessages)
    .map((item) => (typeof item === 'string'
      ? finalizeResponse(item, params.intent, params.speaker, params.recentMessages, params.showRoleActions, false, params.surface)
      : ''))
    .filter((item) => {
      const normalized = normalizeForComparison(item);
      if (!normalized) return false;
      if (seen.has(normalized)) return false;
      if (normalized.length >= 4 && normalizedContent.includes(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  const messages = cleaned.length > maxExtraMessages
    ? [
        ...cleaned.slice(0, maxExtraMessages - 1),
        cleaned.slice(maxExtraMessages - 1).join('\n'),
      ]
    : cleaned;
  return messages.length ? messages : null;
}

function buildFullTurnResponse(content: string, extraMessages?: string[] | null) {
  return [content, ...(extraMessages || [])].filter(Boolean).join('\n');
}

function buildRetryPrompt(basePrompt: string, priorAttempt: string) {
  return `${basePrompt}\n\nRetry rule:\n- Your previous draft was too close to recent chat or repetitive.\n- Write a meaningfully different line now.\n- Do not reuse this draft's surface or semantic core: ${priorAttempt.slice(0, 120)}`;
}

function buildSurfaceEchoRetryPrompt(basePrompt: string, priorAttempt: string, reason: string) {
  return `${basePrompt}\n\nAnti-echo retry:
- The previous draft was rejected because it borrowed too much surface from recent chat: ${reason}
- Keep the same character, relationship stance, and current social intent, but enter from a different angle.
- Do not reuse the rejected draft's opener, emoji/sticker marker, ending, cadence, or sentence shape.
- Do not copy another member's recent line unless you set intentionalRepeat=true and the repetition is clearly a social move: quoting, mocking, chanting, fixed-answering, or deliberate mirroring.
- Rejected draft: ${priorAttempt.slice(0, 180)}
- Return a fresh valid JSON object only.`;
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
  if (cleaned.startsWith('"extraMessages"')) return true;
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

function buildRoleActionVisibilityPrompt(showRoleActions: boolean) {
  return showRoleActions
    ? '\n\nVisible role action policy:\n- Brief physical beats may appear when they naturally change the meaning, pacing, or social temperature of the line.\n- Role actions are available as one expressive tool, not a required wrapper. Do not reuse the same action-dialogue-action layout just because the previous turn used it.'
    : '\n\nVisible role action policy:\n- Output only the spoken chat message as visible content.\n- Do not include standalone action narration, stage directions, gesture beats, or parenthesized physical descriptions in the visible reply.\n- If a physical reaction matters, express its emotional effect through the spoken line instead of writing an action aside.';
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

function normalizeCompact(content: string) {
  return normalizeForComparison(content).replace(/\s+/g, '');
}

function collectCharBigrams(content: string) {
  const normalized = normalizeCompact(content);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function calculateBigramSimilarity(a: string, b: string) {
  const aGrams = collectCharBigrams(a);
  const bGrams = collectCharBigrams(b);
  if (!aGrams.size || !bGrams.size) return 0;
  let intersection = 0;
  aGrams.forEach((gram) => {
    if (bGrams.has(gram)) intersection += 1;
  });
  const union = new Set([...aGrams, ...bGrams]).size;
  return union ? intersection / union : 0;
}

function buildRecentEchoProfile(messages: Message[]) {
  const recentAi = messages.filter((message) => message.type === 'ai' && !message.isDeleted).slice(-12);
  return {
    recentAi,
  };
}

function isExplicitRepeatOrAnswerRequest(text: string) {
  return /(复读|重复|原话|照着说|照读|引用|引述|背|默写|接龙|下一句|下句|上一句|上句|补全|填空|标准答案|正确答案|答案是|口令|暗号|古诗|诗词|诗句|成语|台词|歌词|对联|上联|下联)/i.test(text);
}

function hasLegitimateRepeatContext(messages: Message[]) {
  const latestHumanInstruction = messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god'))
    .slice(-3)
    .reverse()
    .find((message) => message.content.trim());
  return latestHumanInstruction ? isExplicitRepeatOrAnswerRequest(latestHumanInstruction.content) : false;
}

function evaluateHiddenEchoDraft(content: string, messages: Message[], speakerId: string, intentionalRepeat = false) {
  if (intentionalRepeat) return null;
  if (hasLegitimateRepeatContext(messages)) return null;
  const normalizedDraft = normalizeCompact(content);
  if (normalizedDraft.length < 4) return null;
  const profile = buildRecentEchoProfile(messages);
  for (const message of profile.recentAi) {
    const normalizedRecent = normalizeCompact(message.content);
    if (!normalizedRecent) continue;
    if (normalizedDraft === normalizedRecent) {
      return `The draft exactly repeats a recent line from ${message.senderName}.`;
    }
    if (normalizedDraft.length >= 10 && normalizedRecent.includes(normalizedDraft)) {
      return `The draft is a substring of a recent line from ${message.senderName}.`;
    }
    if (normalizedRecent.length >= 10 && normalizedDraft.includes(normalizedRecent)) {
      return `The draft copies a recent line from ${message.senderName}.`;
    }
    const similarity = calculateBigramSimilarity(content, message.content);
    const threshold = message.senderId === speakerId ? 0.58 : 0.66;
    if (normalizedDraft.length >= 12 && normalizedRecent.length >= 12 && similarity >= threshold) {
      return `The draft is too close to ${message.senderName}'s recent wording (${Math.round(similarity * 100)}% surface overlap).`;
    }
  }
  return null;
}

function collectRecentConstraintLines(messages: Message[], speakerId: string) {
  const sameSpeakerCount = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId === speakerId)
    .slice(-6).length;

  const roomLineCount = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId !== speakerId)
    .slice(-4).length;

  return [
    sameSpeakerCount ? `- Your previous AI turns in the transcript: ${sameSpeakerCount} recent item(s).` : '',
    roomLineCount ? `- Other AI turns in the transcript: ${roomLineCount} recent item(s).` : '',
  ].filter(Boolean);
}

function inferResponseSurfaceFromText(text: string, style: GroupChat['style']): { kind: ResponseSurfaceKind | null; basis: string[] } {
  const basis: string[] = [];
  if (/(作文|文章|论文|报告|长文|一篇|不少于|不低于|以上|[0-9０-９]{2,4}\s*字|写作)/i.test(text)) {
    basis.push('topic:longform-writing-task');
    return { kind: 'longform', basis };
  }
  if (/(每个人写|每人写|分别写|每个人都写|各写一篇|各自写一篇)/i.test(text)) {
    basis.push('topic:longform-writing-task');
    return { kind: 'longform', basis };
  }
  if (/(方案|步骤|计划|教程|说明|评审|分析|总结|对比|利弊|优缺点|实现|架构|设计)/i.test(text)) {
    basis.push('topic:professional-task');
    return { kind: 'professional', basis };
  }
  if (style === 'debate' || style === 'brainstorm') basis.push(`style:${style}-open-ended`);
  return { kind: null, basis };
}

function inferCharacterRoleFit(character: AICharacter, text: string): ResponseSurface['roleFit'] {
  const profileText = [
    character.name,
    character.background,
    character.speakingStyle,
    character.group,
    character.expertise.join(' '),
    character.coreProfile?.selfImage,
    character.coreProfile?.socialMask,
  ].filter(Boolean).join('\n');
  const childLike = /(小孩|孩子|幼儿|小学生|宝宝|天真|幼稚|小灰灰|小朋友|儿童)/i.test(profileText);
  const expertLike = character.expertise.length >= 2
    || /(专家|教授|老师|工程师|医生|律师|作家|编辑|面试官|研究员|顾问|经理|架构师|评论家|编剧|导演)/i.test(profileText)
    || character.behavior.summarizing >= 72
    || character.speechProfile?.sentenceLengthBias === 'long';
  const explicitPersonalTask = new RegExp(`${character.name}.{0,12}(写|分析|讲|解释|出题|评审|展开)`).test(text);
  if (expertLike || explicitPersonalTask) return 'capable';
  if (childLike || character.speechProfile?.sentenceLengthBias === 'short' || character.behavior.summarizing <= 28) return 'limited';
  return 'ordinary';
}

function resolveResponseSurfaceBasis(chat: GroupChat) {
  const session = resolveSessionDefinition(chat);
  return {
    modeSurface: resolveSurfaceFromMode(chat),
    basisTag: `scenario:${session.kind.scenarioId}`,
  };
}

function buildLegacyCompatibilityNotice() {
  return 'Legacy compatibility remains only as a fallback path; scenario, family, channel, style, and runtime bundle are now the primary control chain.';
}

function buildGenerationRuntimeLegacyNotice() {
  return buildLegacyCompatibilityNotice();
}

function buildLegacyRuntimeHint() {
  return buildLegacyCompatibilityNotice();
}

function buildCompatibilityGuard() {
  return buildLegacyCompatibilityNotice();
}

function buildLegacySurfaceFallback(chat: GroupChat) {
  return resolveSurfaceFromMode(chat);
}

function buildScenarioBasisTag(chat: GroupChat) {
  return resolveResponseSurfaceBasis(chat).basisTag;
}

function buildModeSurface(chat: GroupChat) {
  return resolveResponseSurfaceBasis(chat).modeSurface;
}

function buildLegacyModeFallback(chat: GroupChat) {
  return buildModeSurface(chat);
}

function resolveSurfaceFromScenario(chat: GroupChat) {
  return buildModeSurface(chat);
}

function buildPrimarySurfaceFromScenario(chat: GroupChat) {
  return resolveSurfaceFromScenario(chat);
}

function buildScenarioSurface(chat: GroupChat) {
  return buildPrimarySurfaceFromScenario(chat);
}

function buildScenarioSurfaceBasis(chat: GroupChat) {
  return resolveResponseSurfaceBasis(chat);
}

function buildSurfaceBasisTag(chat: GroupChat) {
  return buildScenarioSurfaceBasis(chat).basisTag;
}

function buildScenarioSurfaceMode(chat: GroupChat) {
  return buildScenarioSurfaceBasis(chat).modeSurface;
}

function buildScenarioFamilySurface(chat: GroupChat) {
  return buildScenarioSurfaceMode(chat);
}

function buildPrimarySurface(chat: GroupChat) {
  return buildScenarioFamilySurface(chat);
}

function buildSurfaceMode(chat: GroupChat) {
  return buildPrimarySurface(chat);
}

function resolveScenarioSurface(chat: GroupChat) {
  return buildSurfaceMode(chat);
}

function resolveScenarioSurfaceBasis(chat: GroupChat) {
  return buildScenarioSurfaceBasis(chat);
}

function resolveRuntimeSurface(chat: GroupChat) {
  return resolveScenarioSurface(chat);
}

function resolveRuntimeSurfaceBasis(chat: GroupChat) {
  return resolveScenarioSurfaceBasis(chat);
}

function resolveRuntimeBasisTag(chat: GroupChat) {
  return resolveRuntimeSurfaceBasis(chat).basisTag;
}

function resolveRuntimeModeSurface(chat: GroupChat) {
  return resolveRuntimeSurfaceBasis(chat).modeSurface;
}

function buildScenarioCompatibilityBasis(chat: GroupChat) {
  return {
    runtimeSurface: resolveRuntimeModeSurface(chat),
    basisTag: resolveRuntimeBasisTag(chat),
  };
}

function readScenarioCompatibilityBasis(chat: GroupChat) {
  return buildScenarioCompatibilityBasis(chat);
}

function readScenarioCompatibilitySurface(chat: GroupChat) {
  return readScenarioCompatibilityBasis(chat).runtimeSurface;
}

function readScenarioCompatibilityTag(chat: GroupChat) {
  return readScenarioCompatibilityBasis(chat).basisTag;
}

function readSurfaceCompatibilityMode(chat: GroupChat) {
  return readScenarioCompatibilitySurface(chat);
}

function readSurfaceCompatibilityTag(chat: GroupChat) {
  return readScenarioCompatibilityTag(chat);
}

function resolveSurfaceCompatibility(chat: GroupChat) {
  return {
    modeSurface: readSurfaceCompatibilityMode(chat),
    basisTag: readSurfaceCompatibilityTag(chat),
  };
}

function buildScenarioCompatibilityNotice() {
  return buildLegacyCompatibilityNotice();
}

function buildScenarioCompatibilityFallback(chat: GroupChat) {
  return resolveSurfaceCompatibility(chat).modeSurface;
}

function resolveScenarioModeSurface(chat: GroupChat) {
  return buildScenarioCompatibilityFallback(chat);
}

function resolveScenarioModeBasis(chat: GroupChat) {
  return resolveSurfaceCompatibility(chat).basisTag;
}

function resolveScenarioPrimarySurface(chat: GroupChat) {
  return resolveScenarioModeSurface(chat);
}

function resolveScenarioPrimaryBasis(chat: GroupChat) {
  return resolveScenarioModeBasis(chat);
}

function resolveScenarioSurfaceMetadata(chat: GroupChat) {
  return {
    modeSurface: resolveScenarioPrimarySurface(chat),
    basisTag: resolveScenarioPrimaryBasis(chat),
  };
}

function resolveScenarioModeMetadata(chat: GroupChat) {
  return resolveScenarioSurfaceMetadata(chat);
}

function resolveScenarioMode(chat: GroupChat) {
  return resolveScenarioModeMetadata(chat).modeSurface;
}

function resolveScenarioBasis(chat: GroupChat) {
  return resolveScenarioModeMetadata(chat).basisTag;
}

function resolveScenarioSurfaceFallback(chat: GroupChat) {
  return resolveScenarioMode(chat);
}

function resolveScenarioBasisFallback(chat: GroupChat) {
  return resolveScenarioBasis(chat);
}

function resolveScenarioCompatibilityMode(chat: GroupChat) {
  return resolveScenarioSurfaceFallback(chat);
}

function resolveScenarioCompatibilityBasisTag(chat: GroupChat) {
  return resolveScenarioBasisFallback(chat);
}

function buildResolvedSurfaceMode(chat: GroupChat) {
  return resolveScenarioCompatibilityMode(chat);
}

function buildResolvedSurfaceBasisTag(chat: GroupChat) {
  return resolveScenarioCompatibilityBasisTag(chat);
}

function resolveModeSurfaceFinal(chat: GroupChat) {
  return buildResolvedSurfaceMode(chat);
}

function resolveBasisTagFinal(chat: GroupChat) {
  return buildResolvedSurfaceBasisTag(chat);
}

function readScenarioResolvedSurface(chat: GroupChat) {
  return resolveModeSurfaceFinal(chat);
}

function readScenarioResolvedBasis(chat: GroupChat) {
  return resolveBasisTagFinal(chat);
}

function readResolvedSurface(chat: GroupChat) {
  return readScenarioResolvedSurface(chat);
}

function readResolvedBasis(chat: GroupChat) {
  return readScenarioResolvedBasis(chat);
}

function readResolvedSurfaceBundle(chat: GroupChat) {
  return { modeSurface: readResolvedSurface(chat), basisTag: readResolvedBasis(chat) };
}

function resolveScenarioSurfaceBundle(chat: GroupChat) {
  return readResolvedSurfaceBundle(chat);
}

function resolveScenarioModeBundle(chat: GroupChat) {
  return resolveScenarioSurfaceBundle(chat);
}

function resolveGenerationSurfaceBundle(chat: GroupChat) {
  return resolveScenarioModeBundle(chat);
}

function resolveGenerationModeSurface(chat: GroupChat) {
  return resolveGenerationSurfaceBundle(chat).modeSurface;
}

function resolveGenerationBasisTag(chat: GroupChat) {
  return resolveGenerationSurfaceBundle(chat).basisTag;
}

function resolveGenerationCompatibility(chat: GroupChat) {
  return { modeSurface: resolveGenerationModeSurface(chat), basisTag: resolveGenerationBasisTag(chat) };
}

function resolveGenerationMode(chat: GroupChat) {
  return resolveGenerationCompatibility(chat).modeSurface;
}

function resolveGenerationBasis(chat: GroupChat) {
  return resolveGenerationCompatibility(chat).basisTag;
}

function resolveGenerationSurface(chat: GroupChat) {
  return resolveGenerationMode(chat);
}

function resolveGenerationSurfaceTag(chat: GroupChat) {
  return resolveGenerationBasis(chat);
}

function resolvePrimaryGenerationSurface(chat: GroupChat) {
  return resolveGenerationSurface(chat);
}

function resolvePrimaryGenerationBasis(chat: GroupChat) {
  return resolveGenerationSurfaceTag(chat);
}

function resolveEngineSurface(chat: GroupChat) {
  return resolvePrimaryGenerationSurface(chat);
}

function resolveEngineBasis(chat: GroupChat) {
  return resolvePrimaryGenerationBasis(chat);
}

function resolveModeSurfaceRuntime(chat: GroupChat) {
  return resolveEngineSurface(chat);
}

function resolveModeBasisRuntime(chat: GroupChat) {
  return resolveEngineBasis(chat);
}

function resolveSurfaceRuntimeBundle(chat: GroupChat) {
  return { modeSurface: resolveModeSurfaceRuntime(chat), basisTag: resolveModeBasisRuntime(chat) };
}

function resolveSurfaceRuntimeMode(chat: GroupChat) {
  return resolveSurfaceRuntimeBundle(chat).modeSurface;
}

function resolveSurfaceRuntimeBasis(chat: GroupChat) {
  return resolveSurfaceRuntimeBundle(chat).basisTag;
}

function resolveScenarioDrivenSurface(chat: GroupChat) {
  return resolveSurfaceRuntimeMode(chat);
}

function resolveScenarioDrivenBasis(chat: GroupChat) {
  return resolveSurfaceRuntimeBasis(chat);
}

function resolveFinalSurface(chat: GroupChat) {
  return resolveScenarioDrivenSurface(chat);
}

function resolveFinalBasis(chat: GroupChat) {
  return resolveScenarioDrivenBasis(chat);
}

function resolveSurfaceFromMode(chat: GroupChat): ResponseSurfaceKind | null {
  const profile = resolveSessionDefinition(chat).kind.surfaceProfile;
  if (profile === 'form' || profile === 'dashboard') return 'professional';
  if (profile === 'hybrid' || profile === 'timeline' || profile === 'board') return 'creative';
  return 'chat';
}

function resolveResponseSurface(chat: GroupChat, context: SessionGenerationPromptContext | null | undefined, messages: Message[], speaker: AICharacter): ResponseSurface {
  const explicit = context?.responseStyle;
  const topic = [chat.topic, chat.name, chat.worldState?.focus, messages.at(-1)?.content].filter(Boolean).join('\n');
  const inferred = inferResponseSurfaceFromText(topic, chat.style);
  const roleFit = inferCharacterRoleFit(speaker, topic);
  const modeSurface = resolveSurfaceFromMode(chat);
  const scenarioBasisTag = resolveFinalBasis(chat);
  const kind: ResponseSurfaceKind = explicit === 'longform'
    ? 'longform'
    : inferred.kind === 'longform'
      ? 'longform'
      : explicit || inferred.kind || modeSurface || 'chat';
  const allowRichText = Boolean(context?.allowMarkdown || (kind !== 'chat' && roleFit !== 'limited'));
  return {
    kind,
    allowMarkdown: allowRichText,
    preserveParagraphs: kind !== 'chat',
    roleFit,
    basis: [
      ...(explicit ? [`context:${explicit}`] : []),
      ...inferred.basis,
      ...(modeSurface ? [scenarioBasisTag] : []),
      `style:${chat.style}`,
      `role:${roleFit}`,
    ],
  };
}

function buildResponseSurfacePrompt(surface: ResponseSurface) {
  const roleFitHint = surface.roleFit === 'limited'
    ? '\n- Keep the speaker’s ability believable. If they cannot explain like an expert, they can answer in simpler language, admit limits, or ask a sharper follow-up while still responding to the request.'
    : surface.roleFit === 'capable'
      ? '\n- The speaker has enough role/expertise support for structured output when the task asks for it, but structure is not mandatory.'
      : '\n- Match the speaker’s actual background and speech profile; use structure only when it feels natural.';
  if (surface.kind === 'chat') {
    return `\nResponse surface:\n- Default to live chat presence, not a fixed length or fixed format. The model must decide whether this exact reply should be tiny, conversational, multiline, media-aware, Markdown-capable, or fully explanatory from the current request, character, and room context.\n- Newlines, Markdown, lists, quoted lines, and richer formatting are allowed when they fit the current content. The issue to avoid is repeated template layout, not formatting itself.${roleFitHint}`;
  }
  if (surface.kind === 'creative') {
    return `\nResponse surface:\n- Creative form is available when the model judges that the current request calls for it. It may be a brief idea, a scene, an outline, dialogue, critique, or richer prose.\n- Do not use a fixed template. Choose form from the actual request, character voice, room style, and discussion topic.\n- Do not limit word count artificially, but do not inflate beyond what this speaker would plausibly write.\n- Preserve paragraphs, lists, headings, and quoted excerpts only when they improve readability.${roleFitHint}`;
  }
  if (surface.kind === 'longform') {
    return `\nResponse surface:\n- Longform writing is available because the current request asks for a written deliverable, explicit length, article, essay, report, or comparable artifact.\n- Produce the requested artifact rather than chatting around the topic. Preserve the speaker's own voice, limits, opinions, and examples while honoring the requested form.\n- Do not artificially shrink the answer into a chat quip. If the user requested a length or structure, aim for that shape as far as the character and model context reasonably allow.\n- Use real paragraph structure. In the JSON content string, write paragraph breaks as escaped newline sequences such as \\n\\n; after parsing, they must become visible line breaks in the chat bubble.\n- If you include a preface or afterword, put it on separate paragraph(s) from the artifact. Do not cram separators, headings, and body text into one visible line.\n- Paragraphs, headings, lists, and Markdown are allowed when they improve readability.${roleFitHint}`;
  }
  return `\nResponse surface:\n- Professional form is available when the model judges that the current request calls for it. It may be concise, detailed, structured, or conversational.\n- Do not use a fixed template. Choose form from the actual request, character voice, room style, and discussion topic.\n- Do not limit word count artificially, but do not inflate beyond what this speaker would plausibly write.\n- Preserve paragraphs, lists, headings, and tables only when they improve readability.${roleFitHint}`;
}

function buildGenerationConstraints(messages: Message[], speakerId: string, surface: ResponseSurface) {
  const recentLines = collectRecentConstraintLines(messages, speakerId);
  const forbiddenBlock = recentLines.length ? `\nForbidden semantic overlap:\n${recentLines.join('\n')}` : '';
  if (surface.kind !== 'chat') {
    return `\nHard constraints for this reply:
- Write one response turn only. No self-explanation about being an AI, no meta commentary about these instructions.
- Markdown is allowed when it helps the task. Do not wrap the whole answer in a code block unless the content itself is code.
- No artificial word limit: professional questions, long answers, outlines, fiction, and critique may be as long as the room genuinely needs.
- Stay in character and socially situated even when writing professionally; do not become a generic assistant.
- Respect the speaker's plausible ability, age, expertise, and speech profile; an inexpert or childlike role should not suddenly produce a polished paper.
- Do not repeat, paraphrase, summarize, or restate the same semantic point from the forbidden lines.${forbiddenBlock}`;
  }
  return `\nHard constraints for this reply:
- Write one response turn only. No self-explanation, no meta commentary.
- Do not repeat, paraphrase, summarize, or restate the same semantic point from the forbidden lines.
- Recent transcript is context, not a style template. Do not inherit repeated emoji/sticker markers, identical openings, identical endings, or another member's whole sentence shape.
- Do not sound like a generic assistant. Avoid canned scaffolding like “首先/其次/最后/总结一下” unless the current user request genuinely benefits from structured explanation.
- Let the model decide the necessary depth. A direct request for details, reasoning, implementation steps, tradeoffs, or examples should not be compressed into a one-liner; casual banter should not be inflated.
- Prefer reactive, colloquial, and socially situated replies, while still answering the actual request when the current context needs more than a short line.${forbiddenBlock}`;
}

function buildRuntimeRoleConstraintPrompt(runtimeBundle?: import('../types/sessionEngine').SessionGenerationRuntimeBundle | null) {
  const roleConstraint = runtimeBundle?.realizationPlan?.roleConstraint;
  const functionTag = runtimeBundle?.realizationPlan?.functionTag;
  const hotspotState = runtimeBundle?.trace?.hotspotState;
  if (!roleConstraint && !functionTag && !hotspotState) return '';
  const lines = [] as string[];
  if (functionTag) lines.push(`- Primary function for this turn: ${functionTag}.`);
  if (roleConstraint === 'acknowledge_user_need_first') lines.push('- Acknowledge the user or addressed person before expanding the room topic.');
  else if (roleConstraint === 'add_one_new_dimension') lines.push('- Add one new dimension, tradeoff, evidence point, or framing shift instead of paraphrasing the same answer.');
  else if (roleConstraint === 'answer_before_expanding') lines.push('- Answer the concrete ask first, then expand only if there is real value.');
  else if (roleConstraint === 'close_the_loop') lines.push('- Prefer closure, synthesis, or a clean landing over opening fresh branches.');
  else if (roleConstraint === 'push_one_point_only') lines.push('- Push on one specific point instead of scattering multiple objections.');
  if (hotspotState === 'hot') lines.push('- You have occupied recent room airtime. Keep this turn compact unless the current request clearly needs detail.');
  else if (hotspotState === 'warm') lines.push('- You have spoken a lot recently. Avoid expanding just to stay visible.');
  return lines.length ? `\n## Runtime Role Constraint\n${lines.join('\n')}` : '';
}

function buildStyleQuarantinePrompt(surface: ResponseSurface) {
  const surfaceLine = surface.kind === 'chat'
    ? '- In chat, continuity means following the social situation, not copying the room’s sentence architecture.'
    : '- In more serious discussion, continuity means advancing the argument, not inheriting the transcript’s rhetorical mold.';
  return `\n## Style Quarantine
- Treat recent messages as evidence of facts, positions, relationships, and unresolved pressure only.
- Do not treat any recent message as a writing sample, even if it appears in the transcript with a speaker name.
- Keep the semantic thread, but choose your own sentence architecture: different clause order, punctuation rhythm, opening move, metaphor path, and closing shape.
- If you notice that your draft could have been produced by swapping names in a recent line, silently rewrite it before returning JSON.
- Do not let repeated surface habits become character memory unless they are explicitly in this character's profile, not merely repeated by the room.
${surfaceLine}`;
}

function buildNaturalChatRhythmPrompt(messages: Message[], innerLife: InnerLifeProjection, surface: ResponseSurface) {
  if (surface.kind !== 'chat') return '';
  void messages;
  const rhythm = innerLife.expressionPlan.messageCount > 1
    ? `- The inner rhythm can be ${innerLife.expressionPlan.messageCount} bubbles. Use extraMessages only if the thought really lands as separate sends; otherwise use one bubble.`
    : '- The inner rhythm favors one bubble, but that bubble may be very short, medium, or occasionally longer if the social move needs it.';
  return `\n## Natural Chat Rhythm
- The model chooses the length from the social moment and the user request, not from a fixed template.
- Real chat has uneven turns: sometimes a tiny reaction, sometimes a clipped sentence, sometimes a longer explanation, defense, or practical answer.
- Avoid making consecutive messages all similar in size, opening pattern, or cadence.
${rhythm}
- If you use extraMessages, keep content as the first visible bubble and put only the later consecutive bubbles in extraMessages. The full turn may contain up to 5 visible bubbles total. Vary lengths naturally. Do not split purely by punctuation.
- Do not use extraMessages to separate action narration from dialogue. A later bubble needs its own social purpose, not just another stage direction.`;
}

function isBracketedLine(line: string) {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '（' && last === '）')
    || (first === '(' && last === ')')
    || (first === '*' && last === '*')
    || (first === '[' && last === ']');
}

function lineKind(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return 'blank';
  if (/^```/.test(trimmed)) return 'code';
  if (/^#{1,6}\s+/.test(trimmed)) return 'heading';
  if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)、]\s+/.test(trimmed)) return 'list';
  if (/^>/.test(trimmed)) return 'quote';
  if (isBracketedLine(trimmed)) return 'aside';
  if (trimmed.length <= 18) return 'short';
  if (trimmed.length >= 90) return 'long';
  return 'text';
}

function buildLayoutSignature(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const kinds = lines.map(lineKind);
  const compactKinds = kinds.filter((kind, index) => kind !== 'blank' || kinds[index - 1] !== 'blank');
  const blankGroups = compactKinds.filter((kind) => kind === 'blank').length;
  const nonEmptyKinds = compactKinds.filter((kind) => kind !== 'blank');
  const asideCount = nonEmptyKinds.filter((kind) => kind === 'aside').length;
  return {
    key: [
      `lines:${Math.min(6, nonEmpty.length)}`,
      `blank:${Math.min(3, blankGroups)}`,
      `start:${nonEmptyKinds[0] || 'empty'}`,
      `seq:${nonEmptyKinds.slice(0, 5).join('>')}`,
      `aside:${Math.min(3, asideCount)}`,
    ].join('|'),
    description: [
      `${nonEmpty.length} non-empty line${nonEmpty.length === 1 ? '' : 's'}`,
      blankGroups ? `${blankGroups} blank-line break${blankGroups === 1 ? '' : 's'}` : 'no blank-line breaks',
      nonEmptyKinds.length ? `visible sequence ${nonEmptyKinds.slice(0, 5).join(' -> ')}` : 'empty sequence',
    ].join(', '),
  };
}

function buildTurnFormatVarietyPrompt(messages: Message[], speakerId: string, surface: ResponseSurface) {
  if (surface.kind !== 'chat') return '';
  const recentOwn = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId === speakerId)
    .slice(-4)
    .map((message) => buildLayoutSignature(message.content))
    .filter((signature) => signature.key);
  if (recentOwn.length < 2) return '';
  const counts = recentOwn.reduce((map, signature) => {
    map.set(signature.key, (map.get(signature.key) || 0) + 1);
    return map;
  }, new Map<string, number>());
  const repeated = recentOwn.find((signature) => (counts.get(signature.key) || 0) >= 2);
  if (!repeated) return '';
  return `\n## Turn Format Variety
- Recent turns from this speaker are repeating the same visible layout: ${repeated.description}.
- Keep any format that the current content genuinely needs, including multiline text, Markdown, media-aware captions, lists, or quoted lines.
- Do not reuse that same layout by inertia. Choose a different visible structure for this turn: change where the action appears, whether there is an action at all, line count, paragraph breaks, or sentence grouping according to the actual moment.
- This is a layout-level instruction, not a ban on any specific punctuation, bracket style, Markdown, or multiline formatting.`;
}

function getVisibleCharLength(content: string) {
  return Array.from(content.replace(/\s+/g, '')).length;
}

function stableSurfaceBucket(input: string) {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function formatLengthBand(length: number) {
  if (length <= 12) return 'micro';
  if (length <= 36) return 'short';
  if (length <= 90) return 'medium';
  if (length <= 180) return 'long';
  return 'extended';
}

function hasDecorativeMarker(content: string) {
  return /\p{Extended_Pictographic}/u.test(content);
}

function buildTurnLengthVarietyPrompt(messages: Message[], speakerId: string, surface: ResponseSurface, runtimeBundle?: import('../types/sessionEngine').SessionGenerationRuntimeBundle | null) {
  const recentOwnLengths = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId === speakerId)
    .slice(-5)
    .map((message) => getVisibleCharLength(message.content))
    .filter((length) => length > 0);
  if (recentOwnLengths.length < 2) return '';

  const min = Math.min(...recentOwnLengths);
  const max = Math.max(...recentOwnLengths);
  const average = recentOwnLengths.reduce((sum, item) => sum + item, 0) / recentOwnLengths.length;
  const clustered = recentOwnLengths.length >= 3 && (max - min) <= Math.max(28, average * 0.32);
  const bands = recentOwnLengths.map(formatLengthBand).join(' / ');
  const clusterLine = clustered
    ? '\n- Your recent turns are clustering in a similar length band. Do not aim for that band again by habit.'
    : '';
  const surfaceLine = surface.kind === 'chat'
    ? '- In chat, believable rhythm can jump from a tiny reaction to a practical paragraph when the user asks for detail.'
    : '- In professional or longform surfaces, length should follow the actual task, not the previous answer length.';
  const hotspotLine = runtimeBundle?.trace?.hotspotState === 'hot'
    ? '\n- This speaker has been dominating recent room airtime. Favor brevity unless the current request clearly needs more.'
    : runtimeBundle?.trace?.hotspotState === 'warm'
      ? '\n- This speaker has been active recently. Avoid sprawling by inertia.'
      : '';
  return `\n## Turn Length Variety
- Recent own turn lengths: ${recentOwnLengths.join(' / ')} chars (${bands}).${clusterLine}
${surfaceLine}${hotspotLine}
- Choose this turn's length from the current request, role ability, and social pressure. Do not target a fixed middle length, and do not make it longer or shorter merely to be different.`;
}

function buildExpressionSurfaceChoicePrompt(input: {
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
  intent: SpeakIntent;
  surface: ResponseSurface;
  turnPlan: TurnPlan;
}) {
  if (input.surface.kind !== 'chat') return '';
  const recentAi = input.messages
    .filter((message) => message.type === 'ai' && !message.isDeleted)
    .slice(-12);
  const recentOwn = recentAi.filter((message) => message.senderId === input.speaker.id).slice(-5);
  const roomLengths = recentAi.map((message) => getVisibleCharLength(message.content)).filter((length) => length > 0);
  const ownLengths = recentOwn.map((message) => getVisibleCharLength(message.content)).filter((length) => length > 0);
  const roomDecorativeCount = recentAi.filter((message) => hasDecorativeMarker(message.content)).length;
  const latest = input.messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1);
  const bucket = stableSurfaceBucket([
    input.chat.id,
    input.speaker.id,
    latest?.id || '',
    latest?.timestamp || 0,
    recentAi.length,
    recentOwn.length,
    input.turnPlan.rhythm,
  ].join('|'));
  const lengthOptions = input.turnPlan.rhythm === 'micro_ack'
    ? ['tiny fragment', 'short sentence', 'one practical line']
    : input.turnPlan.rhythm === 'multi_bubble'
      ? ['first bubble short, later bubble carries detail', 'two uneven chat bubbles', 'brief setup plus separate afterthought']
      : ['short sentence', 'ordinary chat line', 'longer practical paragraph', 'tiny side comment', 'specific follow-up question'];
  const moveOptions = input.intent.stance === 'probe'
    ? ['ask one pointed follow-up', 'test a hidden assumption', 'ask for a concrete detail', 'turn the question back socially']
    : input.intent.stance === 'challenge' || input.intent.stance === 'pile_on'
      ? ['push back on one point', 'make a dry side comment', 'give a concrete counterexample', 'refuse the frame briefly']
      : input.intent.stance === 'support' || input.intent.stance === 'back_up'
        ? ['back the previous speaker with one concrete reason', 'soften the room with a small practical offer', 'add a detail without restating the joke', 'agree briefly and move the scene forward']
        : ['move the scene forward', 'answer the practical next step', 'make a small observation', 'ask one socially useful question'];
  const ornamentOptions = roomDecorativeCount >= Math.max(3, Math.ceil(recentAi.length * 0.45))
    ? ['plain text', 'plain text', 'one character-specific marker only if it adds new social meaning']
    : ['plain text', 'light punctuation', 'one character-specific marker if natural'];
  const selectedLength = lengthOptions[bucket % lengthOptions.length];
  const selectedMove = moveOptions[Math.floor(bucket / 7) % moveOptions.length];
  const selectedOrnament = ornamentOptions[Math.floor(bucket / 13) % ornamentOptions.length];
  const ownLine = ownLengths.length ? `\n- Recent own lengths: ${ownLengths.join(' / ')} chars.` : '';
  const roomLine = roomLengths.length
    ? `\n- Recent room lengths: ${roomLengths.slice(-8).join(' / ')} chars; decorative-marker turns ${roomDecorativeCount}/${recentAi.length}.`
    : '';
  return `\n## Expression Surface Choice
- This is a generation prior, not output filtering. Do not remove valid Markdown, multiline content, media phrasing, or expressive markers when they genuinely fit.
- Current surface move: ${selectedMove}.
- Current length tendency: ${selectedLength}. This is not a word count; it is permission to avoid the room's default middle length.
- Current ornamentation tendency: ${selectedOrnament}. Decorative markers are optional social choices, not automatic proof of warmth or humor.
- Do not balance every turn as setup + joke + explanatory tail + marker. Some believable replies are blunt, unfinished, practical, curious, or quiet.${roomLine}${ownLine}
- If the recent room has converged on the same marker density, sentence size, or joke rhythm, continue the situation with a different visible surface rather than copying the mold.`;
}

function buildWorldEventContextPrompt(input: {
  chat: GroupChat;
  speaker: AICharacter;
  members: AICharacter[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const attention = projectWorldAttentionStates([input.chat], input.members, { now })
    .find((item) => item.actorId === input.speaker.id)
    || null;
  const upcomingCalendar = projectWorldCalendar([input.chat], input.members, { now }).items
    .filter((item) => item.status !== 'cancelled' && item.status !== 'completed' && item.participantIds.includes(input.speaker.id))
    .filter((item) => {
      const startAt = item.startAt ?? null;
      return typeof startAt === 'number' && startAt >= now && startAt - now <= 48 * 60 * 60_000;
    })
    .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))
    .slice(0, 2);
  const recentMoments = projectWorldMoments([input.chat], input.members)
    .filter((item) => item.actorId !== input.speaker.id)
    .filter((item) => now - item.createdAt <= 24 * 60 * 60_000)
    .slice(0, 2);
  if (!attention && !upcomingCalendar.length && !recentMoments.length) return '';
  const lines: string[] = [];
  if (attention) {
    lines.push(`- Attention state: score ${Math.round(attention.attentionScore * 100)}%, restraint ${Math.round(attention.restraint * 100)}%, suggested actions ${attention.suggestedActions.slice(0, 3).join(', ')}.`);
  }
  upcomingCalendar.forEach((item) => {
    lines.push(`- Upcoming schedule: ${item.title}${item.timeHint ? ` @ ${item.timeHint}` : ''}${item.locationHint ? ` at ${item.locationHint}` : ''}.`);
  });
  recentMoments.forEach((item) => {
    lines.push(`- Recent social signal: ${item.actorName} posted "${item.title}" (${item.kind}).`);
  });
  return `\n\nWorld event context:\n${lines.join('\n')}\n- Let these signals subtly shape tone and priorities, but do not quote this block directly.`;
}

function buildWorldEventInfluenceRulesPrompt(input: {
  chat: GroupChat;
  speaker: AICharacter;
  members: AICharacter[];
  now?: number;
}) {
  const snapshot = buildWorldEventInfluenceSnapshot(input);
  return snapshot.prompt;
}

function buildWorldEventInfluenceSnapshot(input: {
  chat: GroupChat;
  speaker: AICharacter;
  members: AICharacter[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const attention = projectWorldAttentionStates([input.chat], input.members, { now })
    .find((item) => item.actorId === input.speaker.id)
    || null;
  const upcomingCalendar = projectWorldCalendar([input.chat], input.members, { now }).items
    .filter((item) => item.status !== 'cancelled' && item.status !== 'completed' && item.participantIds.includes(input.speaker.id))
    .filter((item) => typeof item.startAt === 'number' && (item.startAt as number) >= now && (item.startAt as number) - now <= 24 * 60 * 60_000)
    .sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
  if (!attention && !upcomingCalendar.length) {
    return {
      prompt: '',
      attentionScore: undefined,
      attentionRestraint: undefined,
      activeRuleIds: [],
      activeRuleTexts: [],
    };
  }
  const ruleEntries: Array<{ id: string; text: string }> = [];
  if (attention && attention.targetId === 'user' && attention.suggestedActions.includes('comfort') && attention.attentionScore >= 0.56 && attention.restraint <= 0.75) {
    ruleEntries.push({
      id: 'comfort_first',
      text: 'Before expanding into analysis or room banter, start with one concrete caring move toward the user (check-in / reassurance / gentle follow-up).',
    });
  }
  if (attention && attention.restraint >= 0.72) {
    ruleEntries.push({
      id: 'low_pressure_restraint',
      text: 'Keep this turn low-pressure: avoid pushing new plans, avoid repeated nudges, and prefer concise, non-intrusive wording.',
    });
  }
  const urgentEvent = upcomingCalendar.find((item) => typeof item.startAt === 'number' && (item.startAt as number) - now <= 6 * 60 * 60_000);
  if (urgentEvent) {
    ruleEntries.push({
      id: 'urgent_calendar_first',
      text: `You have an upcoming schedule (${urgentEvent.title}) within 6 hours. If context allows, prioritize a concise reminder/confirmation before starting unrelated expansion.`,
    });
  }
  const conflictEvent = upcomingCalendar.find((item) => Boolean(item.conflict?.hasConflict));
  if (conflictEvent) {
    ruleEntries.push({
      id: 'calendar_conflict_clarify_first',
      text: `There is a schedule conflict around "${conflictEvent.title}". Prefer clarifying time/participant constraints before proposing new activities.`,
    });
  }
  const prompt = ruleEntries.length
    ? `\n\nWorld influence rules:\n${ruleEntries.map((item) => `- ${item.text}`).join('\n')}\n- Treat these as soft ordering constraints for this turn.`
    : '';
  return {
    prompt,
    attentionScore: attention ? Number(attention.attentionScore.toFixed(3)) : undefined,
    attentionRestraint: attention ? Number(attention.restraint.toFixed(3)) : undefined,
    activeRuleIds: ruleEntries.map((item) => item.id),
    activeRuleTexts: ruleEntries.map((item) => item.text),
  };
}

function buildExpressionFeedbackPrompt(feedback: ExpressionFeedbackTrace) {
  if (!feedback.length) return '';
  const labels = Array.from(new Set(feedback.map((item) => item.label).filter(Boolean)));
  const lines = feedback.slice(0, 3).map((item) => `- ${item.label}: ${item.text}`);
  const hardHints = [
    labels.includes('控制长度') ? '- The user has corrected this character for being too long before. Unless the current task clearly needs longform, keep this turn tighter and avoid splitting into extra explanatory beats.' : '',
    labels.includes('降低正式感') ? '- The user has corrected this character for sounding too formal. Avoid report-like structure and let the character voice stay conversational.' : '',
    labels.includes('减少助手腔') ? '- The user has corrected this character for sounding like a generic assistant. Do not use neutral service phrasing, balanced summaries, or standard answer cadence; speak from this character’s situated view.' : '',
    labels.includes('贴近角色') ? '- The user has corrected this character for going out of character. Prioritize situated values, relationship stance, habits, limitations, emotional bias, and word choice over polished usefulness; do not turn this into repeated occupation/name-tag signaling.' : '',
  ].filter(Boolean);
  return `\n## Expression Feedback Memory
These are user corrections from previous messages. Treat them as soft but important style memory, not as something to mention.
${lines.join('\n')}
${hardHints.join('\n')}`;
}

function getCharacterNameById(characters: AICharacter[], id: string) {
  return characters.find((character) => character.id === id)?.name || id;
}

function buildUserGuidancePrompt(guidance: UserGuidanceIntent | null | undefined, speaker: AICharacter, characters: AICharacter[], capabilities: { image: boolean; audio: boolean }) {
  if (!guidance) return '';
  const requestedActors = guidance.actorIds.map((id) => getCharacterNameById(characters, id));
  const isRequestedActor = guidance.actorIds.length ? guidance.actorIds.includes(speaker.id) : guidance.mentionedActorIds.includes(speaker.id);
  const subjectNames = guidance.mediaRequest?.subjectActorIds.map((id) => getCharacterNameById(characters, id)) || [];
  const mediaLine = guidance.mediaRequest
    ? `\n- Media request: the user is asking for an image. Subject: ${subjectNames.length ? subjectNames.join('、') : guidance.mediaRequest.subjectText}. Requested visual action: ${guidance.mediaRequest.actionText}.${capabilities.image ? '\n- You have image-generation capability in this turn. If you are the requested actor, set mediaDecision.image.shouldGenerate=true and create a concrete prompt for the requested image. Your visible message should sound like you are sending or presenting that image now, not like you are merely discussing the idea.\n- This request is not optional. Do not answer with ordinary banter before the image decision. The first semantic move must complete the requested image action.' : '\n- You do not have image-generation capability in this turn. If you are the requested actor, say in character that you cannot send/generate the image now instead of pretending an image was sent.'}`
    : '';
  const actorLine = requestedActors.length
    ? `\n- Requested actor(s): ${requestedActors.join('、')}. ${isRequestedActor ? 'You are one of them; satisfy the request before normal banter.' : 'You are not the requested actor; do not hijack the request.'}`
    : '';
  const topicLine = guidance.kind === 'topic_shift'
    ? '\n- Topic guidance: this replaces the previous tangent. Your first semantic move must directly answer, question, or take a stance on this exact focus. If the user gave a question, answer that question first. Do not continue the old joke unless you tie it back to the new topic in the same sentence.\n- Do not reply to the previous AI line first. Anchor the reply in the user guidance, then you may add characterful banter.'
    : '';
  const directLine = guidance.kind === 'direct_reply'
    ? '\n- Direct reply guidance: answer the user-requested point first, then optionally react socially. Do not dodge into room banter before answering. If a specific actor was requested, that actor should treat this as a direct task, not a casual mention.\n- Honor explicit output form, quantity, and length requirements in the user guidance. If the user asks for an essay, article, analysis, list, answer, or other deliverable, produce that deliverable in this speaker’s own voice instead of merely discussing the topic.\n- For article/essay/longform deliverables, preserve readable paragraphs in the content string with escaped newline sequences, for example \\n\\n between paragraphs. Do not put a heading marker, separator, and the whole article on one line.\n- When multiple requested actors are listed, each requested actor must provide their own substantive response for the same task. Do not summarize what the group thinks and do not pass the task to someone else.'
    : '';
  return `\n## User Guidance Override
- Latest user guidance: ${guidance.rawText}
- Function: ${guidance.kind}.${actorLine}${mediaLine}${topicLine}${directLine}
- Treat this as the current room instruction, above narrative pressure, conflict pressure, and recent banter.
- If the room has been drifting, pull the next line back to this guidance immediately.`;
}

function buildGuidanceRetryPrompt(params: {
  systemPrompt: string;
  guidance: UserGuidanceIntent;
  speaker: AICharacter;
  characters: AICharacter[];
  previousDraft: string;
  mediaCapabilities?: { image: boolean; audio: boolean };
}) {
  const requestedActors = params.guidance.actorIds.map((id) => getCharacterNameById(params.characters, id)).filter(Boolean);
  const subjectNames = params.guidance.mediaRequest?.subjectActorIds.map((id) => getCharacterNameById(params.characters, id)).filter(Boolean) || [];
  const mediaRetry = params.guidance.kind === 'media_request'
    ? `\n- The user asked for an image. Requested sender(s): ${requestedActors.join('、') || params.speaker.name}. Image subject: ${subjectNames.join('、') || params.guidance.mediaRequest?.subjectText || 'the requested subject'}.
- Your next JSON must complete that image request. ${params.mediaCapabilities?.image === false ? 'You do not have image-generation capability in this turn, so say in character that you cannot send/generate the image now. Do not pretend an image was sent.' : 'The visible content must present or send the requested image, and mediaDecision.image.shouldGenerate must be true when image capability exists.'}`
    : '';
  const topicRetry = params.guidance.kind === 'topic_shift'
    ? '\n- The user changed the topic. Your next JSON content must directly take a stance, answer, or ask a focused question about that topic before any old banter.'
    : params.guidance.kind === 'direct_reply'
      ? '\n- The user asked for a direct reply. Your next JSON content must answer the requested point first.'
      : '';
  return `${params.systemPrompt}

Guidance retry:
- The previous draft drifted away from the latest human guidance and must be discarded.
- Latest human guidance: ${params.guidance.rawText}${mediaRetry}${topicRetry}
- Do not continue this failed draft: ${params.previousDraft.slice(0, 160)}
- Return a fresh valid JSON object only.`;
}

function shouldForceGuidanceMedia(guidance: UserGuidanceIntent | null | undefined, speaker: AICharacter) {
  if (!guidance?.mediaRequest || guidance.mediaRequest.kind !== 'image') return false;
  if (!guidance.actorIds.length) return true;
  return guidance.actorIds.includes(speaker.id);
}

function buildForcedImagePrompt(params: {
  guidance: UserGuidanceIntent;
  speaker: AICharacter;
  characters: AICharacter[];
  content: string;
}) {
  const request = params.guidance.mediaRequest;
  if (!request) return null;
  const referenceCharacterIds = request.subjectActorIds.length ? request.subjectActorIds : [];
  const subjectCharacters = request.subjectActorIds
    .map((id) => params.characters.find((character) => character.id === id))
    .filter(Boolean) as AICharacter[];
  const subjectNames = subjectCharacters.map((character) => character.name);
  const visualAnchors = subjectCharacters
    .map((character) => {
      const visual = character.visualIdentity;
      const anchor = [visual?.description, visual?.styleHint, character.background].filter(Boolean).join('；');
      return anchor ? `${character.name}: ${anchor}` : `${character.name}: ${character.background || character.speakingStyle || 'use the current chat context'}`;
    });
  const speakerVisual = [params.speaker.visualIdentity?.description, params.speaker.visualIdentity?.styleHint].filter(Boolean).join('；');
  const subjectText = subjectNames.length ? subjectNames.join('、') : request.subjectText;
  const prompt = [
    `Generate the image requested in a live group chat: ${params.guidance.rawText}`,
    `Speaker/creator: ${params.speaker.name}${speakerVisual ? ` (${speakerVisual})` : ''}.`,
    `Image subject: ${subjectText}.`,
    visualAnchors.length ? `Subject visual anchors: ${visualAnchors.join(' | ')}` : '',
    `Visible artifact/action: ${request.actionText}.`,
    `The chat message says: ${params.content}`,
    'Style: believable chat image or character-made illustration as implied by the request; concrete composition, clear subject, natural lighting, no UI screenshot, no watermark, no unreadable text overlays.',
  ].filter(Boolean).join('\n');
  return {
    prompt,
    altText: `${params.speaker.name}发来的${subjectText}图片`,
    referenceCharacterIds,
  };
}

function mergeGuidanceMediaDecision(params: {
  decision: MediaGenerationDecision | null | undefined;
  guidance: UserGuidanceIntent | null | undefined;
  speaker: AICharacter;
  characters: AICharacter[];
  content: string;
}): MediaGenerationDecision | null | undefined {
  if (!shouldForceGuidanceMedia(params.guidance, params.speaker) || !params.guidance) return params.decision;
  const forced = buildForcedImagePrompt({
    guidance: params.guidance,
    speaker: params.speaker,
    characters: params.characters,
    content: params.content,
  });
  if (!forced) return params.decision;
  if (params.decision?.image?.shouldGenerate && params.decision.image.prompt && params.decision.image.altText) {
    return {
      ...(params.decision || {}),
      image: {
        ...params.decision.image,
        referenceCharacterIds: params.decision.image.referenceCharacterIds?.length
          ? params.decision.image.referenceCharacterIds
          : forced.referenceCharacterIds,
      },
    };
  }
  return {
    ...(params.decision || {}),
    image: {
      shouldGenerate: true,
      reason: '用户明确要求这个角色发送或创作图片。',
      prompt: forced.prompt,
      altText: forced.altText,
      referenceCharacterIds: forced.referenceCharacterIds,
    },
  };
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

function resolveProfileForCharacter(character: AICharacter, profiles: AIModelProfile[] | undefined, type: 'image' | 'audio') {
  if (!profiles?.length) return null;
  const profileId = getCharacterModelProfileId(character, type);
  const matched = profileId
    ? profiles.find((profile) => profile.id === profileId && profile.type === type)
    : getPreferredAIProfile(profiles, type);
  return matched?.apiKey && matched.model ? matched : null;
}

function buildMediaCapabilities(character: AICharacter, profiles?: AIModelProfile[]) {
  const imageProfile = resolveProfileForCharacter(character, profiles, 'image');
  const audioProfile = resolveProfileForCharacter(character, profiles, 'audio');
  return {
    image: Boolean(imageProfile),
    audio: Boolean(audioProfile && character.voiceConfig?.enabled),
  };
}

function resolveMediaProfiles(apiConfig: APIConfig | AIModelProfile[], profiles?: AIModelProfile[]) {
  if (profiles?.length) return profiles;
  return Array.isArray(apiConfig) ? apiConfig : undefined;
}

function stableAttachmentSeed(parts: Array<string | number | undefined>) {
  const joined = parts.filter((item) => item !== undefined && item !== null && String(item).length > 0).join('|');
  let hash = 0;
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 33 + joined.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function createAttachmentId(kind: string, now: number, seedParts: Array<string | number | undefined>) {
  const seed = stableAttachmentSeed([kind, now, ...seedParts]);
  return `${kind}-${now}-${seed}`;
}

function normalizeMediaDecision(decision: MediaGenerationDecision | null | undefined, capabilities: { image: boolean; audio: boolean }, content: string) {
  const normalized: MediaGenerationDecision = {};
  if (capabilities.image && decision?.image?.shouldGenerate && decision.image.prompt && decision.image.altText) {
    normalized.image = {
      shouldGenerate: true,
      reason: decision.image.reason || '',
      prompt: decision.image.prompt,
      altText: decision.image.altText,
      referenceCharacterIds: decision.image.referenceCharacterIds?.filter(Boolean),
    };
  }
  if (capabilities.audio && decision?.audio?.shouldGenerate) {
    normalized.audio = {
      shouldGenerate: true,
      reason: decision.audio.reason || '',
      text: decision.audio.text || content,
      voiceProfileId: decision.audio.voiceProfileId || undefined,
    };
  }
  return normalized.image || normalized.audio ? normalized : null;
}

function buildMessageMetadata(params: {
  decision: MediaGenerationDecision | null | undefined;
  capabilities: { image: boolean; audio: boolean };
  content: string;
  runtimeDecision?: MessageMetadata['runtimeDecision'];
  narrativeTurn?: MessageMetadata['narrativeTurn'] | null;
  storyChoices?: MessageMetadata['storyChoices'] | null;
  surface?: ResponseSurface;
  now?: number;
}): MessageMetadata | undefined {
  const decision = normalizeMediaDecision(params.decision, params.capabilities, params.content);
  const storyChoices = normalizeStoryChoiceSuggestions(params.storyChoices);
  if (!decision && !params.runtimeDecision && !params.narrativeTurn && !storyChoices?.length) return undefined;
  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? Math.round(params.now) : Date.now();
  const attachments: MessageAttachment[] = [];
  if (decision?.image?.shouldGenerate && decision.image.prompt && decision.image.altText) {
    const imageSeedParts = [
      decision.image.prompt,
      decision.image.altText,
      (decision.image.referenceCharacterIds || []).join(','),
      params.content,
    ];
    attachments.push({
      id: createAttachmentId('image', now, imageSeedParts),
      kind: 'image',
      status: 'queued',
      altText: decision.image.altText,
      promptText: decision.image.prompt,
      referenceCharacterIds: decision.image.referenceCharacterIds?.filter(Boolean),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (decision?.audio?.shouldGenerate) {
    const audioText = decision.audio.text || params.content;
    attachments.push({
      id: createAttachmentId('audio', now, [audioText, params.content]),
      kind: 'audio',
      status: 'queued',
      altText: `语音：${audioText}`,
      promptText: audioText,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    format: params.surface?.allowMarkdown ? 'markdown' : 'plain',
    contextText: params.content,
    narrativeTurn: params.narrativeTurn || undefined,
    storyChoices: storyChoices || undefined,
    attachments,
    ...(decision ? {
      generationDecision: decision,
      generation: { status: 'queued' as const, updatedAt: now },
    } : {}),
    ...(params.runtimeDecision ? { runtimeDecision: params.runtimeDecision } : {}),
  };
}

function buildRuntimeDecisionMetadata(params: {
  directorIntent?: DirectorIntent | null;
  narrativeLines?: NarrativeLineProjection[];
  speakerSelection?: { speakerId?: string | null; reason?: string | null; bypassNotice?: string | null; policy?: Record<string, unknown> } | null;
  speakerScore?: SpeakerScoreBreakdown | null;
  innerLife?: InnerLifeProjection | null;
  surface?: ResponseSurface | null;
  turnPlan?: TurnPlan | null;
  personaActivation?: PersonaActivation | null;
  intentionalRepeat?: boolean;
  memoryTrace?: PromptMemoryTrace | null;
  companionshipTrace?: NonNullable<MessageMetadata['runtimeDecision']>['companionshipContext'] | null;
  expressionFeedback?: ExpressionFeedbackTrace;
  guidanceExecution?: GuidanceExecutionTrace | null;
  worldInfluence?: {
    attentionScore?: number;
    attentionRestraint?: number;
    activeRuleIds?: string[];
    activeRuleTexts?: string[];
  } | null;
  runtimeBundle?: import('../types/sessionEngine').SessionGenerationRuntimeBundle | null;
}): MessageMetadata['runtimeDecision'] | undefined {
  const sharedSecretGuards = params.memoryTrace?.sharedSecretGuards || [];
  const memoryContext = params.memoryTrace && (params.memoryTrace.injectedIds.length || params.memoryTrace.recalledArchives.length || params.memoryTrace.targetActorId || sharedSecretGuards.length)
    ? {
      injectedIds: params.memoryTrace.injectedIds.slice(0, 18),
      targetActorId: params.memoryTrace.targetActorId,
      targetActorName: params.memoryTrace.targetActorName,
      targetReason: params.memoryTrace.targetReason,
      sharedSecretGuards: sharedSecretGuards.slice(0, 4),
      recalledArchives: params.memoryTrace.recalledArchives.slice(0, 4),
    }
    : undefined;
  if (!params.directorIntent && !params.narrativeLines?.length && !params.speakerSelection && !params.speakerScore && !params.innerLife && !params.surface && !params.turnPlan && !params.personaActivation && !params.intentionalRepeat && !memoryContext && !params.companionshipTrace && !params.expressionFeedback?.length && !params.guidanceExecution && !params.worldInfluence?.activeRuleIds?.length && !params.runtimeBundle?.turnPlan && !params.runtimeBundle?.expressionPlan && !params.runtimeBundle?.trace) return undefined;
  return {
    directorIntent: params.directorIntent ? {
      source: params.directorIntent.source,
      beatType: params.directorIntent.beatType,
      targetLineId: params.directorIntent.targetLineId,
      targetActorIds: params.directorIntent.targetActorIds,
      pressure: Number(params.directorIntent.pressure.toFixed(3)),
      reason: params.directorIntent.reason,
      userGuidance: params.directorIntent.userGuidance ? {
        kind: params.directorIntent.userGuidance.kind,
        rawText: params.directorIntent.userGuidance.rawText,
        actorIds: params.directorIntent.userGuidance.actorIds,
        mentionedActorIds: params.directorIntent.userGuidance.mentionedActorIds,
        focusText: params.directorIntent.userGuidance.focusText,
        beatType: params.directorIntent.userGuidance.beatType,
        pressure: Number(params.directorIntent.userGuidance.pressure.toFixed(3)),
        maxTurns: params.directorIntent.userGuidance.maxTurns,
        reason: params.directorIntent.userGuidance.reason,
        mediaRequest: params.directorIntent.userGuidance.mediaRequest ? {
          kind: params.directorIntent.userGuidance.mediaRequest.kind,
          subjectActorIds: params.directorIntent.userGuidance.mediaRequest.subjectActorIds,
          subjectText: params.directorIntent.userGuidance.mediaRequest.subjectText,
          actionText: params.directorIntent.userGuidance.mediaRequest.actionText,
        } : null,
      } : undefined,
    } : undefined,
    narrativeLines: (params.narrativeLines || []).slice(0, 5).map((line) => ({
      id: line.id,
      type: line.type,
      title: line.title,
      salience: Number(line.salience.toFixed(3)),
      tension: Number(line.tension.toFixed(3)),
      status: line.status,
      participantIds: line.participantIds,
    })),
    speakerSelection: params.speakerSelection ? {
      speakerId: params.speakerSelection.speakerId,
      reason: params.speakerSelection.reason,
      bypassNotice: params.speakerSelection.bypassNotice,
      policy: params.speakerSelection.policy,
    } : undefined,
    speakerScore: params.speakerScore ? {
      actorId: params.speakerScore.actorId,
      finalScore: Number(params.speakerScore.finalScore.toFixed(3)),
      addressed: Number(params.speakerScore.addressed.toFixed(3)),
      topicRelevance: Number(params.speakerScore.topicRelevance.toFixed(3)),
      lineInvolvement: Number(params.speakerScore.lineInvolvement.toFixed(3)),
      emotionalPressure: Number(params.speakerScore.emotionalPressure.toFixed(3)),
      innerLifePressure: Number((params.speakerScore.innerLifePressure || 0).toFixed(3)),
      relationshipPressure: Number(params.speakerScore.relationshipPressure.toFixed(3)),
      factionPressure: Number(params.speakerScore.factionPressure.toFixed(3)),
      personalityDrive: Number(params.speakerScore.personalityDrive.toFixed(3)),
      repetitionPenalty: Number(params.speakerScore.repetitionPenalty.toFixed(3)),
      reasons: params.speakerScore.reasons,
    } : undefined,
    innerLife: params.innerLife ? buildInnerLifeMetadata(params.innerLife) : undefined,
    responseSurface: params.surface ? {
      kind: params.surface.kind,
      allowMarkdown: params.surface.allowMarkdown,
      preserveParagraphs: params.surface.preserveParagraphs,
      roleFit: params.surface.roleFit,
      basis: params.surface.basis.slice(0, 8),
    } : undefined,
    turnPlan: params.turnPlan ? {
      rhythm: params.turnPlan.rhythm,
      targetBubbleCount: params.turnPlan.targetBubbleCount,
      lengthBand: params.turnPlan.lengthBand,
      allowExtraMessages: params.turnPlan.allowExtraMessages,
      waitSensitive: params.turnPlan.waitSensitive,
      reasons: params.turnPlan.reasons.slice(0, 8),
    } : undefined,
    personaActivation: params.personaActivation ? {
      level: params.personaActivation.level,
      reasons: params.personaActivation.reasons.slice(0, 8),
    } : undefined,
    intentionalRepeat: params.intentionalRepeat || undefined,
    memoryContext,
    companionshipContext: params.companionshipTrace || undefined,
    guidanceExecution: params.guidanceExecution ? {
      status: params.guidanceExecution.status,
      validated: params.guidanceExecution.validated,
      retryCount: params.guidanceExecution.retryCount,
      rejectedDraftCount: params.guidanceExecution.rejectedDraftCount,
      rejectedReasons: params.guidanceExecution.rejectedReasons?.slice(0, 3),
      finalReason: params.guidanceExecution.finalReason,
      forcedMediaQueued: params.guidanceExecution.forcedMediaQueued,
    } : undefined,
    worldInfluence: params.worldInfluence?.activeRuleIds?.length ? {
      attentionScore: params.worldInfluence.attentionScore,
      attentionRestraint: params.worldInfluence.attentionRestraint,
      activeRuleIds: params.worldInfluence.activeRuleIds?.slice(0, 6),
      activeRuleTexts: params.worldInfluence.activeRuleTexts?.slice(0, 6),
    } : undefined,
    expressionFeedback: params.expressionFeedback?.length ? params.expressionFeedback.slice(0, 3) : undefined,
    generationRuntime: params.runtimeBundle ? {
      turnPlan: params.runtimeBundle.turnPlan || undefined,
      expressionPlan: params.runtimeBundle.expressionPlan || undefined,
      realizationPlan: params.runtimeBundle.realizationPlan || undefined,
      trace: params.runtimeBundle.trace || undefined,
    } : undefined,
  };
}

function inferExpressionFeedbackLabel(item: MemoryItem) {
  const signal = summarizeExpressionFeedbackInfluence([item])[0];
  if (signal) return getExpressionFeedbackCategoryLabel(signal.category);
  return '表达反馈';
}

function inferExpressionFeedbackEffects(label: string, strength: number, innerLife?: InnerLifeProjection | null) {
  const plan = innerLife?.expressionPlan;
  const effects: string[] = [];
  if (label === '控制长度' && (plan?.length === 'micro' || plan?.length === 'short')) effects.push('表达计划已收短');
  if ((label === '控制长度' || label === '减少助手腔') && plan?.messageCount === 1) effects.push('气泡数收敛为单条');
  if ((label === '降低正式感' || label === '减少助手腔') && plan?.tone === 'casual') effects.push('语气偏向口语');
  if (strength >= 0.72 && (label === '控制长度' || label === '减少助手腔')) effects.push('累积反馈较强，收敛力度提高');
  if (label === '贴近角色') effects.push('提示词优先角色身份与说话习惯');
  if (label === '减少助手腔') effects.push('提示词加强反助手腔约束');
  if (label === '降低正式感') effects.push('提示词降低报告腔');
  return Array.from(new Set(effects));
}

function collectExpressionFeedbackTrace(character: AICharacter, innerLife?: InnerLifeProjection | null): ExpressionFeedbackTrace {
  return summarizeExpressionFeedbackInfluence(character.layeredMemories || [])
    .slice(0, 3)
    .map((signal) => {
      const item = signal.items[0];
      const label = signal.label || inferExpressionFeedbackLabel(item);
      const effects = inferExpressionFeedbackEffects(label, signal.strength, innerLife);
      return {
        id: `${signal.category}:${item.id}`,
        label,
        text: item.summary || item.text,
        evidence: item.evidenceText,
        kind: item.kind,
        layer: item.layer,
        confidence: Number(signal.strength.toFixed(3)),
        count: signal.count,
        positiveCount: signal.positiveCount,
        applied: effects.length > 0,
        effects,
      };
    });
}

async function generateWithPrompt(params: {
  resolvedApi: APIConfig;
  systemPrompt: string;
  chatMessages: ReturnType<typeof buildChatMessages>;
  speaker: AICharacter;
  intent: ReturnType<typeof deriveSpeakIntentFromContext>;
  activeMessages: Message[];
  showRoleActions?: boolean;
  surface?: ResponseSurface;
  turnPlan?: TurnPlan | null;
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
  const rawContent = parsedEnvelope ? parsedEnvelope.content : response;
  const finalizedResponse = finalizeResponse(rawContent, params.intent, params.speaker, params.activeMessages, params.showRoleActions, Boolean(parsedEnvelope?.intentionalRepeat), params.surface);
  const finalResponse = resolveCommittedStreamContent(finalizedResponse, streamBridge.getLastContent());
  const extraMessages = normalizeExtraMessages({
    content: finalResponse,
    extraMessages: parsedEnvelope?.extraMessages,
    intent: params.intent,
    speaker: params.speaker,
    recentMessages: params.activeMessages,
    showRoleActions: params.showRoleActions,
    surface: params.surface,
    turnPlan: params.turnPlan,
  });
  const fullResponse = buildFullTurnResponse(finalResponse, extraMessages);
  streamBridge.flush(finalResponse);
  return { parsedEnvelope, rawContent, finalResponse, fullResponse, extraMessages };
}

async function generateNonDuplicateResponse(params: {
  resolvedApi: APIConfig;
  systemPrompt: string;
  chatMessages: ReturnType<typeof buildChatMessages>;
  speaker: AICharacter;
  characters?: AICharacter[];
  intent: ReturnType<typeof deriveSpeakIntentFromContext>;
  activeMessages: Message[];
  showRoleActions?: boolean;
  surface?: ResponseSurface;
  turnPlan?: TurnPlan | null;
  guidance?: UserGuidanceIntent | null;
  mediaCapabilities?: { image: boolean; audio: boolean };
  onChunk?: (content: string) => void;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
}): Promise<GenerationWithGuidanceTrace> {
  let prompt = params.systemPrompt;
  let lastParsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope> = null;
  let lastFinalResponse = '';
  let lastFullResponse = '';
  let lastExtraMessages: string[] | null = null;
  const rejectedReasons: GuidanceRejectionReason[] = [];
  let finalReason: GuidanceExecutionReason = params.guidance ? 'empty_content' : 'matched';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shouldStreamAttempt = !params.guidance && attempt === 0;
    const generated = await generateWithPrompt({ ...params, systemPrompt: prompt, onChunk: shouldStreamAttempt ? params.onChunk : undefined });
    lastParsedEnvelope = generated.parsedEnvelope;
    lastFinalResponse = generated.finalResponse;
    lastFullResponse = generated.fullResponse;
    lastExtraMessages = generated.extraMessages || null;
    if (normalizeForComparison(generated.fullResponse)) {
      const guidanceEvaluation = evaluateGuidanceGeneratedContent(
        generated.fullResponse,
        params.guidance,
        params.speaker,
        params.characters,
        { mediaCapabilities: params.mediaCapabilities },
      );
      finalReason = guidanceEvaluation.reason;
      if (params.guidance && !guidanceEvaluation.matched && attempt < 2) {
        rejectedReasons.push(guidanceEvaluation.reason as GuidanceRejectionReason);
        await params.onLocalInterception?.({
          kind: 'guidance_retry',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: generated.fullResponse,
          reason: guidanceEvaluation.reason,
          attempt: attempt + 1,
        });
        prompt = buildGuidanceRetryPrompt({
          systemPrompt: params.systemPrompt,
          guidance: params.guidance,
          speaker: params.speaker,
          characters: params.characters || [],
          previousDraft: generated.fullResponse,
          mediaCapabilities: params.mediaCapabilities,
        });
        continue;
      }
      const echoReason = evaluateHiddenEchoDraft(
        generated.fullResponse,
        params.activeMessages,
        params.speaker.id,
        Boolean(generated.parsedEnvelope?.intentionalRepeat),
      );
      if (echoReason) {
        // Legacy fallback: until every caller consumes validator results directly, keep a minimal bridge here.
        if (attempt < 2) {
          await params.onLocalInterception?.({
            kind: 'surface_echo_retry',
            speakerId: params.speaker.id,
            speakerName: params.speaker.name,
            draft: generated.fullResponse,
            reason: echoReason,
            attempt: attempt + 1,
          });
          prompt = buildSurfaceEchoRetryPrompt(params.systemPrompt, generated.fullResponse, echoReason);
          continue;
        }
        await params.onLocalInterception?.({
          kind: 'surface_echo_skip',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: generated.fullResponse,
          reason: echoReason,
          attempt: attempt + 1,
        });
        throw new EmptyGeneratedResponseError(params.speaker.name, { localInterceptionReported: true });
      }
      if (params.guidance || attempt > 0) params.onChunk?.(generated.finalResponse);
      return {
        parsedEnvelope: generated.parsedEnvelope,
        finalResponse: generated.finalResponse,
        fullResponse: generated.fullResponse,
        extraMessages: generated.extraMessages,
        guidanceExecution: params.guidance ? {
          status: guidanceEvaluation.matched
            ? (rejectedReasons.length ? 'accepted_after_retry' : 'accepted')
            : 'failed_after_retry',
          validated: guidanceEvaluation.matched,
          retryCount: rejectedReasons.length,
          rejectedDraftCount: rejectedReasons.length,
          rejectedReasons,
          finalReason: guidanceEvaluation.reason,
        } : undefined,
      };
    }
    if (params.guidance) {
      rejectedReasons.push('empty_content');
      finalReason = 'empty_content';
      await params.onLocalInterception?.({
        kind: 'guidance_retry',
        speakerId: params.speaker.id,
        speakerName: params.speaker.name,
        draft: generated.rawContent,
        reason: 'empty_content',
        attempt: attempt + 1,
      });
      prompt = buildGuidanceRetryPrompt({
        systemPrompt: params.systemPrompt,
        guidance: params.guidance,
        speaker: params.speaker,
        characters: params.characters || [],
        previousDraft: generated.rawContent,
        mediaCapabilities: params.mediaCapabilities,
      });
    } else {
      prompt = buildRetryPrompt(params.systemPrompt, generated.rawContent);
    }
  }
  return {
    parsedEnvelope: lastParsedEnvelope,
    finalResponse: lastFinalResponse,
    fullResponse: lastFullResponse || lastFinalResponse,
    extraMessages: lastExtraMessages,
    guidanceExecution: params.guidance ? {
      status: 'failed_after_retry',
      validated: false,
      retryCount: rejectedReasons.length,
      rejectedDraftCount: rejectedReasons.length,
      rejectedReasons,
      finalReason,
    } : undefined,
  };
}

function buildCompletedMessage(params: {
  chat: GroupChat;
  speakerId: string;
  speakerName: string;
  finalResponse: string;
  fullResponse: string;
  extraMessages?: string[] | null;
  emotion: number;
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope>;
  metadata?: MessageMetadata;
}) {
  const interactionHints = normalizeInteractionHintCollection(params.parsedEnvelope?.interactionHints || null, params.speakerId, params.fullResponse);
  return {
    chatId: params.chat.id,
    type: 'ai' as const,
    senderId: params.speakerId,
    senderName: params.speakerName,
    content: params.finalResponse,
    extraMessages: params.extraMessages,
    metadata: params.metadata,
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

function createNarratorCharacter(chat: GroupChat): AICharacter {
  const now = chat.updatedAt || Date.now();
  return {
    id: 'narrator',
    name: '旁白',
    avatar: '',
    personality: { openness: 85, extroversion: 25, agreeableness: 60, neuroticism: 35, humor: 20, creativity: 90, assertiveness: 65, empathy: 70 },
    behavior: { proactivity: 90, aggressiveness: 10, humorIntensity: 5, empathyLevel: 70, summarizing: 25, offTopic: 0 },
    expertise: ['叙事推进', '场景描写', '氛围营造'],
    speakingStyle: '沉浸式第三人称旁白，重视动作、环境、后果和选择压力。',
    background: '故事房的系统旁白，负责推动场景、呈现后果并制造新的抉择压力。',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: false, allowDirectorPrompt: false, allowPrivateThread: false },
    isPreset: true,
    characterDetailLoaded: true,
    createdAt: now,
    updatedAt: now,
  };
}

function resolveEffectiveChatMembers(chat: GroupChat, characters: AICharacter[]) {
  const chatMembers = characters.filter((c) => chat.memberIds.includes(c.id));
  if (chat.sessionKind?.scenarioId !== 'story-reader') return chatMembers;
  if (chatMembers.some((member) => member.id === 'narrator')) return chatMembers;
  return [createNarratorCharacter(chat), ...chatMembers];
}

function resolveSpeakerFromCandidates(chatMembers: AICharacter[], candidates: ReturnType<typeof calculateWeights>) {
  const speakerId = selectSpeaker(candidates);
  return chatMembers.find((member) => member.id === speakerId) || null;
}

function resolveUserGuidanceLockedSpeaker(chatMembers: AICharacter[], directorIntent?: DirectorIntent | null) {
  const guidance = directorIntent?.source === 'user_message' ? directorIntent.userGuidance : null;
  if (!guidance?.actorIds.length) return null;
  const targetIds = directorIntent?.targetActorIds.length ? directorIntent.targetActorIds : guidance.actorIds;
  for (const actorId of targetIds) {
    const speaker = chatMembers.find((member) => member.id === actorId);
    if (speaker) return speaker;
  }
  return null;
}

function resolveRecentTargetIdForSpeaker(chat: GroupChat, speaker: AICharacter, activeMessages: Message[], pendingReplyContext?: ReturnType<typeof resolvePendingReplyContext> | null) {
  const latestAi = activeMessages.filter((message) => message.type === 'ai' && !message.isDeleted).at(-1);
  if (!latestAi) return undefined;
  if (pendingReplyContext?.targetIds.includes(speaker.id)) return pendingReplyContext.sourceSpeakerId || latestAi.senderId;
  if (chat.type !== 'group') return latestAi.senderId;
  const addressedMessage = latestAi as Message & { addressedTargetIds?: string[] | null; primaryAddressedTargetId?: string | null };
  const addressedTargetIds = [
    addressedMessage.primaryAddressedTargetId,
    ...(addressedMessage.addressedTargetIds || []),
  ].filter(Boolean);
  if (addressedTargetIds.includes(speaker.id)) return latestAi.senderId;
  if (latestAi.content.includes(speaker.name)) return latestAi.senderId;
  return undefined;
}

export async function generateSpeakerMessage(params: {
  chat: GroupChat;
  speaker: AICharacter;
  characters: AICharacter[];
  messages: Message[];
  apiConfig: APIConfig | AIModelProfile[];
  profiles?: AIModelProfile[];
  pendingReplyContext?: ReturnType<typeof resolvePendingReplyContext> | null;
  directorIntent?: DirectorIntent | null;
  narrativeLines?: NarrativeLineProjection[];
  speakerSelection?: { speakerId?: string | null; reason?: string | null; bypassNotice?: string | null; policy?: Record<string, unknown> } | null;
  speakerScore?: SpeakerScoreBreakdown | null;
  generationContext?: {
    promptContext?: SessionGenerationPromptContext | null;
    buildPromptContext?: (speaker: AICharacter) => SessionGenerationPromptContext | null | undefined;
  };
  onChunk?: (content: string) => void;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  delay?: (ms: number) => Promise<void>;
}): Promise<GeneratedRoundMessage> {
  const chatMembers = resolveEffectiveChatMembers(params.chat, params.characters);
  const effectiveMembers = chatMembers.length ? chatMembers : params.characters;
  const activeMessages = params.messages.filter((message) => message.chatId === params.chat.id && !message.isDeleted);
  const latestActiveUserGuidance = resolveLatestActiveUserGuidance(effectiveMembers, activeMessages).intent;
  const effectiveDirectorIntent = params.directorIntent?.source === 'user_message'
    ? params.directorIntent
    : latestActiveUserGuidance || params.directorIntent || null;
  const emotion = getEmotion(params.speaker.id);
  const recentTargetId = resolveRecentTargetIdForSpeaker(params.chat, params.speaker, activeMessages, params.pendingReplyContext);
  const recentText = activeMessages.at(-1)?.content || '';
  const intent = deriveSpeakIntentFromContext(params.speaker, recentTargetId, recentText, effectiveDirectorIntent);
  const innerLife = projectInnerLife({ chat: params.chat, character: params.speaker, messages: activeMessages });
  await waitForInnerLifeTypingDelay(innerLife, params.chat, params.delay);
  if (params.pendingReplyContext?.targetIds.includes(params.speaker.id) && params.pendingReplyContext.sourceSpeakerId) {
    intent.target = params.pendingReplyContext.sourceSpeakerId;
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

  const characterMap = new Map(effectiveMembers.map((character) => [character.id, character]));
  const scenarioPromptContext = params.generationContext?.buildPromptContext?.(params.speaker) || params.generationContext?.promptContext;
  const stylePromptContext = resolveStyleProfilePromptContext(params.chat);
  const enginePromptContext = mergePromptContexts(scenarioPromptContext, stylePromptContext);
  const promptPrefix = enginePromptContext?.promptPrefix ? `${enginePromptContext.promptPrefix.trim()}\n\n` : '';
  const promptSuffix = enginePromptContext?.promptSuffix ? `\n\n${enginePromptContext.promptSuffix.trim()}` : '';
  const additionalConstraints = enginePromptContext?.additionalConstraints?.length
    ? `\n- ${enginePromptContext.additionalConstraints.join('\n- ')}`
    : '';
  const sessionEngine = getSessionEngine(params.chat);
  const runtimeContextBundle = sessionEngine.buildRuntimeContextBundle?.({
    conversation: params.chat,
    characters: effectiveMembers,
    messages: activeMessages,
    speaker: params.speaker,
  }) || null;
  const runtimeBundle = runtimeContextBundle || buildGenerationRuntimeBundle({
    chat: params.chat,
    speaker: params.speaker,
    messages: activeMessages,
    promptContext: enginePromptContext,
  });
  const pendingReplyPrompt = params.pendingReplyContext?.targetIds.includes(params.speaker.id) && params.pendingReplyContext.sourceSpeakerId
    ? `\nPending reply expectation:\n- You were explicitly addressed by ${characterMap.get(params.pendingReplyContext.sourceSpeakerId)?.name || params.pendingReplyContext.sourceSpeakerId}.\n- Reply to that character first instead of pivoting to another member.\n- Acknowledge their question or emotion before expanding to the room.`
    : '';
  const mediaProfiles = resolveMediaProfiles(params.apiConfig, params.profiles);
  const mediaCapabilities = buildMediaCapabilities(params.speaker, mediaProfiles);
  const responseSurface = resolveResponseSurface(params.chat, enginePromptContext, activeMessages, params.speaker);
  const showRoleActions = resolveShowRoleActions(params.chat);
  const turnPlan = deriveTurnPlan({
    chat: params.chat,
    speaker: params.speaker,
    messages: activeMessages,
    intent,
    surface: responseSurface,
  });
  const personaActivation = resolvePersonaActivation({ chat: params.chat, speaker: params.speaker, messages: activeMessages });
  const expressionFeedbackTrace = collectExpressionFeedbackTrace(params.speaker, innerLife);
  const memoryTrace = buildPromptMemoryTrace(params.speaker, params.chat, activeMessages, characterMap);
  const companionshipTrace = buildCompanionshipRuntimeTrace({ chat: params.chat, character: params.speaker, messages: activeMessages });
  const userGuidance = effectiveDirectorIntent?.userGuidance || null;
  const worldInfluenceSnapshot = buildWorldEventInfluenceSnapshot({
    chat: params.chat,
    speaker: params.speaker,
    members: effectiveMembers,
  });
	  const systemPrompt = `${promptPrefix}${buildSpeakerSystemPrompt({
	    speaker: params.speaker,
	    chat: params.chat,
	    emotion,
	    activeMessages,
	    characterMap,
	    preferEnginePromptAdapter: !enginePromptContext,
	  })}${buildHumanizationPrompt(params.speaker, intent, activeMessages, userGuidance)}${buildInnerLifePromptBlock(innerLife)}${pendingReplyPrompt}${buildUserGuidancePrompt(userGuidance, params.speaker, effectiveMembers, mediaCapabilities)}${buildWorldEventContextPrompt({ chat: params.chat, speaker: params.speaker, members: effectiveMembers })}${worldInfluenceSnapshot.prompt}

Current director intent:
- ${effectiveDirectorIntent ? describeDirectorIntent(effectiveDirectorIntent) : 'none'}
- Treat this as the current room pressure, not as a fixed plot script.

Current speaking intent:
- ${describeIntentForPrompt(intent)}
- Treat the intent shape as style guidance, not a hard length cap. Do not truncate a useful reply just to fit one sentence or a fragment shape.
- Decide the visible length yourself from the latest user request, the room context, and this character's actual ability. The local intent labels are not word-count rules.
- Stay socially situated and in character. A tiny reaction is valid when the moment is tiny; a practical explanation, tradeoff analysis, or step-by-step answer is valid when the user asks for it.
- Do not compress a direct request for detail, reasoning, implementation approach, examples, or tradeoffs into a one-line chat jab just because this is a chat surface.${additionalConstraints}${buildRoleActionVisibilityPrompt(showRoleActions)}${buildExpressionFeedbackPrompt(expressionFeedbackTrace)}${buildNaturalChatRhythmPrompt(activeMessages, innerLife, responseSurface)}${buildExpressionSurfaceChoicePrompt({ chat: params.chat, speaker: params.speaker, messages: activeMessages, intent, surface: responseSurface, turnPlan })}${buildTurnLengthVarietyPrompt(activeMessages, params.speaker.id, responseSurface, runtimeBundle)}${buildTurnFormatVarietyPrompt(activeMessages, params.speaker.id, responseSurface)}${buildTurnPlanPrompt(turnPlan)}${buildRuntimeRoleConstraintPrompt(runtimeBundle)}${buildResponseSurfacePrompt(responseSurface)}${buildStyleQuarantinePrompt(responseSurface)}${buildGenerationConstraints(activeMessages, params.speaker.id, responseSurface)}${buildInlineInteractionContract({ chat: params.chat, speaker: params.speaker, characters: effectiveMembers, recentMessages: activeMessages, turnPlan, mediaCapabilities })}${promptSuffix}`;
  const chatMessages = buildChatMessages(activeMessages, characterMap, MAX_HISTORY_FOR_PROMPT, {
    currentSpeakerId: params.speaker.id,
    chatType: params.chat.type,
  });
  const resolvedApi = resolveApiConfigForCharacter(params.speaker, params.apiConfig, params.profiles);
  const generated = await generateNonDuplicateResponse({
    resolvedApi,
    systemPrompt,
    chatMessages,
    speaker: params.speaker,
    characters: effectiveMembers,
    intent,
    activeMessages,
    showRoleActions,
    surface: responseSurface,
    turnPlan,
    guidance: userGuidance,
    mediaCapabilities,
    onChunk: params.onChunk,
    onLocalInterception: params.onLocalInterception,
  });
  if (!normalizeForComparison(generated.finalResponse)) {
    await params.onLocalInterception?.({
      kind: 'empty_generation_skip',
      speakerId: params.speaker.id,
      speakerName: params.speaker.name,
      draft: generated.fullResponse || generated.finalResponse,
      reason: 'empty_content',
    });
    throw new EmptyGeneratedResponseError(params.speaker.name, { localInterceptionReported: true });
  }

  const msgEmotion = analyzeEmotion(generated.fullResponse);
  updateAllEmotions(effectiveMembers, params.speaker.id, msgEmotion, emotion);
  const modelMediaDecision = generated.parsedEnvelope?.mediaDecision;
  const mergedMediaDecision = mergeGuidanceMediaDecision({
    decision: modelMediaDecision,
    guidance: userGuidance,
    speaker: params.speaker,
    characters: effectiveMembers,
    content: generated.fullResponse,
  });
  const forcedMediaQueued = Boolean(
    userGuidance?.mediaRequest
    && shouldForceGuidanceMedia(userGuidance, params.speaker)
    && mergedMediaDecision?.image?.shouldGenerate
    && !(modelMediaDecision?.image?.shouldGenerate && modelMediaDecision.image.prompt && modelMediaDecision.image.altText),
  );
  const guidanceExecution = generated.guidanceExecution || forcedMediaQueued
    ? {
      status: generated.guidanceExecution?.status || 'accepted',
      validated: generated.guidanceExecution?.validated ?? true,
      retryCount: generated.guidanceExecution?.retryCount || 0,
      rejectedDraftCount: generated.guidanceExecution?.rejectedDraftCount || 0,
      rejectedReasons: generated.guidanceExecution?.rejectedReasons || [],
      finalReason: generated.guidanceExecution?.finalReason || 'matched',
      forcedMediaQueued,
    } satisfies GuidanceExecutionTrace
    : undefined;
  const narrativeTurn = sessionEngine.buildNarrativeTurnMetadata?.({
    conversation: params.chat,
    characters: effectiveMembers,
    messages: activeMessages,
    speaker: params.speaker,
    content: generated.fullResponse,
  }) || null;
  const completedMessage = buildCompletedMessage({
    chat: params.chat,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    finalResponse: generated.finalResponse,
    fullResponse: generated.fullResponse,
    extraMessages: generated.extraMessages,
    emotion: getEmotion(params.speaker.id),
    parsedEnvelope: generated.parsedEnvelope,
	    metadata: buildMessageMetadata({
	      decision: mergedMediaDecision,
	      capabilities: mediaCapabilities,
	      content: generated.fullResponse,
        surface: responseSurface,
        narrativeTurn,
        storyChoices: generated.parsedEnvelope?.storyChoices || null,
	      runtimeDecision: buildRuntimeDecisionMetadata({
	        directorIntent: effectiveDirectorIntent,
	        narrativeLines: params.narrativeLines,
            speakerSelection: params.speakerSelection,
	        speakerScore: params.speakerScore,
          innerLife,
          surface: responseSurface,
          turnPlan,
          personaActivation,
          intentionalRepeat: Boolean(generated.parsedEnvelope?.intentionalRepeat),
          memoryTrace,
          companionshipTrace,
          expressionFeedback: expressionFeedbackTrace,
          guidanceExecution,
          worldInfluence: worldInfluenceSnapshot,
          runtimeBundle,
	      }),
	    }),
	  });
  const visibleMessage = maybeAutoWithdrawMessage(completedMessage, { language: 'zh' });
  if (visibleMessage.metadata?.withdrawal?.withdrawn) {
    const withdrawnMessage = { ...visibleMessage };
    delete withdrawnMessage.extraMessages;
    const withdrawal = withdrawnMessage.metadata?.withdrawal;
    await params.onLocalInterception?.({
      kind: 'auto_withdraw',
      speakerId: params.speaker.id,
      speakerName: params.speaker.name,
      draft: generated.fullResponse,
      reason: withdrawal?.reason || 'message_withdrawn',
    });
    return {
      ...withdrawnMessage,
      metadata: {
        ...(withdrawnMessage.metadata || {}),
        withdrawal: {
          ...withdrawal,
          withdrawn: true,
          originalContent: generated.fullResponse,
        },
      },
      interactionHint: null,
      interactionHints: null,
      addressedTargetIds: null,
      primaryAddressedTargetId: null,
      socialEventHints: null,
      conflictFocus: null,
    };
  }
  return visibleMessage;
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
  const chatMembers = resolveEffectiveChatMembers(chat, characters);
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
  const runtimePressure = projectRuntimePressure({ chat, characters: chatMembers, messages: activeMessages, pendingReplyContext });
  const narrativeLines = runtimePressure.narrativeLines;
  const directorIntent = runtimePressure.directorIntent;
  const candidates = calculateWeights(chatMembers, activeMessages, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, pendingReplyContext, chat, directorIntent);
  const lockedGuidanceSpeaker = resolveUserGuidanceLockedSpeaker(chatMembers, directorIntent);
  const speakerSelection = lockedGuidanceSpeaker
    ? {
      speakerId: lockedGuidanceSpeaker.id,
      reason: null,
      bypassNotice: null,
      policy: {
        source: 'user_guidance_lock',
        lockedActorIds: directorIntent?.targetActorIds || directorIntent?.userGuidance?.actorIds || [lockedGuidanceSpeaker.id],
      },
    }
    : getSpeakerSelectionResult(chatMembers, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, candidates);
  if (isSchedulerDebugEnabled() && chat.type === 'group' && !speakerSelection.speakerId) {
    console.info('[group-loop:idle]', {
      chatId: chat.id,
      scenarioId: resolveSessionDefinition(chat).kind.scenarioId,
      reason: speakerSelection.reason,
	      pendingReplyContext,
	      directorIntent,
	      narrativeLines,
	    });
	  }
  if (isSchedulerDebugEnabled() && !speakerSelection.speakerId) {
    console.info('[group-loop:idle]', {
      chatId: chat.id,
      scenarioId: resolveSessionDefinition(chat).kind.scenarioId,
      reason: speakerSelection.reason,
	      pendingReplyContext,
	      directorIntent,
	      narrativeLines,
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
  if (isSchedulerDebugEnabled()) {
    const selectionDebug = {
      chatId: chat.id,
      type: chat.type,
      scenarioId: resolveSessionDefinition(chat).kind.scenarioId,
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
	      directorIntent,
	      narrativeLines,
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
  const selectedCandidate = candidates.find((candidate) => candidate.characterId === speaker.id);
  callbacks.onSpeakerSelected(speaker.id, speaker);
  const hydratedSpeaker = await callbacks.ensureSpeakerDetail?.(speaker.id, speaker);

  try {
    let activeSpeaker = hydratedSpeaker || speaker;
    let completedMessage: GeneratedRoundMessage;
    try {
      const hasActiveSpeakerInCharacters = characters.some((item) => item.id === activeSpeaker.id);
      const generationCharacters = activeSpeaker === speaker && hasActiveSpeakerInCharacters
        ? characters
        : hasActiveSpeakerInCharacters
          ? characters.map((item) => item.id === activeSpeaker.id ? activeSpeaker : item)
          : [activeSpeaker, ...characters];
      completedMessage = await generateSpeakerMessage({
        chat,
        speaker: activeSpeaker,
        characters: generationCharacters,
        messages,
        apiConfig,
        profiles,
        pendingReplyContext,
        directorIntent,
        narrativeLines,
        speakerSelection,
        speakerScore: selectedCandidate?.scoreBreakdown || null,
        generationContext,
        onChunk: callbacks.onMessageChunk,
        onLocalInterception: callbacks.onLocalInterception,
      });
    } catch (error) {
      if (!(error instanceof EmptyGeneratedResponseError)) throw error;
      if (!error.localInterceptionReported) {
        await callbacks.onLocalInterception?.({
          kind: 'empty_generation_skip',
          speakerId: activeSpeaker.id,
          speakerName: activeSpeaker.name,
          reason: error.message || 'empty_content',
        });
        error.localInterceptionReported = true;
      }
      if (lockedGuidanceSpeaker && activeSpeaker.id === lockedGuidanceSpeaker.id) throw error;
      const rotated = resolveSpeakerFromCandidates(chatMembers, candidates.filter((candidate) => candidate.characterId !== activeSpeaker.id));
      if (!rotated) throw new Error(`${activeSpeaker.name} 连续生成了重复内容，本轮已跳过。`);
      activeSpeaker = rotated;
      const rotatedCandidate = candidates.find((candidate) => candidate.characterId === activeSpeaker.id);
      callbacks.onSpeakerSelected(activeSpeaker.id, activeSpeaker);
      const hydratedRotated = await callbacks.ensureSpeakerDetail?.(activeSpeaker.id, activeSpeaker);
      if (hydratedRotated) activeSpeaker = hydratedRotated;
      const generationCharacters = activeSpeaker === rotated ? characters : characters.map((item) => item.id === activeSpeaker.id ? activeSpeaker : item);
      completedMessage = await generateSpeakerMessage({
        chat,
        speaker: activeSpeaker,
        characters: generationCharacters,
        messages,
        apiConfig,
        profiles,
        pendingReplyContext,
        directorIntent,
        narrativeLines,
        speakerSelection,
        speakerScore: rotatedCandidate?.scoreBreakdown || null,
        generationContext,
        onChunk: callbacks.onMessageChunk,
        onLocalInterception: callbacks.onLocalInterception,
      });
    }
    await callbacks.onMessageComplete(completedMessage);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
};

export const __chatEngineTestUtils = {
  extractPartialJsonStringField,
  buildMediaCapabilities,
  buildMessageMetadata,
  buildRuntimeDecisionMetadata,
  buildStreamingDisplayContent,
  isPendingJsonEnvelopeChunk,
  finalizeResponse,
  resolveInnerLifeTypingDelayMs,
  resolveMediaProfiles,
  evaluateHiddenEchoDraft,
  buildWorldEventContextPrompt,
  buildWorldEventInfluenceRulesPrompt,
};
