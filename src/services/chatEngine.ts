import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
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
import { buildEngineAwarePrompt } from './promptContextAssembler';
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, getSpeakerSelectionResult, resolvePendingReplyContext, selectSpeaker } from './scheduler';
import { deriveSpeakIntentFromContext, describeIntentForPrompt } from './intentEngine';
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

export interface GeneratedRoundMessage extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'> {
  extraMessages?: string[] | null;
  interactionHint?: InteractionEventPayload | null;
  interactionHints?: InteractionEventPayload[] | null;
  addressedTargetIds?: string[] | null;
  primaryAddressedTargetId?: string | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
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
  constructor(speakerName: string) {
    super(`${speakerName} 连续生成了重复内容，本轮已跳过。`);
    this.name = 'EmptyGeneratedResponseError';
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
  return preserveParagraphs ? trimmed.replace(/\n{3,}/g, '\n\n') : trimmed.replace(/\n{2,}/g, '\n');
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
}) {
  if (!Array.isArray(params.extraMessages)) return null;
  const normalizedContent = normalizeForComparison(params.content);
  const seen = new Set<string>(normalizedContent ? [normalizedContent] : []);
  const cleaned = params.extraMessages
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
  const messages = cleaned.length > MAX_EXTRA_MESSAGES
    ? [
        ...cleaned.slice(0, MAX_EXTRA_MESSAGES - 1),
        cleaned.slice(MAX_EXTRA_MESSAGES - 1).join('\n'),
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

function inferResponseSurfaceFromText(text: string, style: GroupChat['style']): { kind: ResponseSurfaceKind | null; basis: string[] } {
  const basis: string[] = [];
  const creativeSignal = /(小说|正文|章节|片段|大纲|人设|世界观|剧本|诗|散文|创作|续写|改写|文风|角色小传|分镜)/i.test(text);
  const professionalSignal = /(面试|系统设计|技术方案|报告|分析|评审|复盘|教案|课堂|论文|长文|详细|展开|Markdown|表格|列表|富文本|会议纪要|需求|架构|案例题|case)/i.test(text);
  if (creativeSignal) basis.push('topic:creative-task');
  if (professionalSignal) basis.push('topic:professional-task');
  if (style === 'roleplay' && creativeSignal) basis.push('style:roleplay-creative');
  if ((style === 'debate' || style === 'brainstorm') && professionalSignal) basis.push(`style:${style}-structured`);
  if (creativeSignal) return { kind: 'creative', basis };
  if (professionalSignal) return { kind: 'professional', basis };
  if ((style === 'debate' || style === 'brainstorm') && /(为什么|怎么|如何|利弊|对比|设计|规划|讨论|判断)/i.test(text)) {
    return { kind: 'professional', basis: basis.concat(`style:${style}-reasoning`) };
  }
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

function resolveSurfaceFromMode(chat: GroupChat): ResponseSurfaceKind | null {
  if (chat.mode === 'interview' || chat.mode === 'classroom' || chat.mode === 'group_discussion' || chat.mode === 'roundtable') return 'professional';
  return null;
}

function resolveResponseSurface(chat: GroupChat, context: SessionGenerationPromptContext | null | undefined, messages: Message[], speaker: AICharacter): ResponseSurface {
  const explicit = context?.responseStyle;
  const topic = [chat.topic, chat.name, chat.worldState?.focus, messages.at(-1)?.content].filter(Boolean).join('\n');
  const inferred = inferResponseSurfaceFromText(topic, chat.style);
  const roleFit = inferCharacterRoleFit(speaker, topic);
  const modeSurface = resolveSurfaceFromMode(chat);
  const kind: ResponseSurfaceKind = explicit || inferred.kind || modeSurface || 'chat';
  const allowRichText = Boolean(context?.allowMarkdown || (kind !== 'chat' && roleFit !== 'limited'));
  return {
    kind,
    allowMarkdown: allowRichText,
    preserveParagraphs: kind !== 'chat',
    roleFit,
    basis: [
      ...(explicit ? [`context:${explicit}`] : []),
      ...inferred.basis,
      ...(modeSurface ? [`mode:${chat.mode}`] : []),
      `style:${chat.style}`,
      `role:${roleFit}`,
    ],
  };
}

function buildResponseSurfacePrompt(surface: ResponseSurface) {
  const roleFitHint = surface.roleFit === 'limited'
    ? '\n- The speaker has limited longform/professional capacity. Do not suddenly turn them into an essayist or expert; let them answer in their own simpler voice, ask for help, or give a short concrete reaction when that is truer to the role.'
    : surface.roleFit === 'capable'
      ? '\n- The speaker has enough role/expertise support for structured or longer output when the task asks for it.'
      : '\n- Match the speaker’s actual background and speech profile; use structure only when the task and character both support it.';
  if (surface.kind === 'chat') {
    return `\nResponse surface:\n- Default to live chat style: choose the natural length for this exact moment. It can be a tiny reaction, a clipped sentence, or a fuller emotional/argumentative line; do not converge every reply to a neat medium length.${roleFitHint}`;
  }
  if (surface.kind === 'creative') {
    return `\nResponse surface:\n- Creative longform is allowed when the task, topic, and speaker make it natural. You may write fiction, outlines, scene drafts, dialogue, critique, or rich discussion when useful.\n- Do not use a fixed template. Choose form from the actual request, character voice, room style, and discussion topic.\n- Do not limit word count artificially, but do not inflate beyond what this speaker would plausibly write.\n- Preserve paragraphs, lists, headings, and quoted excerpts only when they improve readability.${roleFitHint}`;
  }
  return `\nResponse surface:\n- Professional longform is allowed when the task, topic, and speaker make it natural. You may ask or answer detailed interview, analysis, teaching, design, review, or planning content when useful.\n- Do not use a fixed template. Choose form from the actual request, character voice, room style, and discussion topic.\n- Do not limit word count artificially, but do not inflate beyond what this speaker would plausibly write.\n- Preserve paragraphs, lists, headings, and tables only when they improve readability.${roleFitHint}`;
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
- Do not sound like an assistant answer. Never use structures like “首先/其次/最后/总结一下”, “first/second/finally”, or “in summary”.
- Do not give a balanced full explanation unless the room absolutely requires it.
- Prefer reactive, colloquial, and socially situated replies, but keep the full reply when the current context needs more than a short line.
- Prefer one sharp move when it fits: a quick challenge, follow-up, jab, side remark, or clipped agreement.${forbiddenBlock}`;
}

function visibleTextLength(text: string) {
  return text.replace(/\s+/g, '').length;
}

function buildNaturalChatRhythmPrompt(messages: Message[], innerLife: InnerLifeProjection, surface: ResponseSurface) {
  if (surface.kind !== 'chat') return '';
  const recentAiLengths = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted)
    .slice(-8)
    .map((message) => visibleTextLength(message.content))
    .filter((length) => length > 0);
  const mediumCluster = recentAiLengths.filter((length) => length >= 16 && length <= 38).length;
  const clustered = recentAiLengths.length >= 4 && mediumCluster / recentAiLengths.length >= 0.65;
  const rhythm = innerLife.expressionPlan.messageCount > 1
    ? `- The inner rhythm can be ${innerLife.expressionPlan.messageCount} bubbles. Use extraMessages only if the thought really lands as separate sends; otherwise use one bubble.`
    : '- The inner rhythm favors one bubble, but that bubble may be very short, medium, or occasionally longer if the social move needs it.';
  return `\n## Natural Chat Rhythm
- Do not default to the same 20-30 Chinese-character length. Real chat has uneven turns: sometimes 1-6 characters, sometimes a clipped sentence, sometimes a longer annoyed or caring explanation.
- Choose length from the social moment, not from a fixed template. A short “啊？” can be better than a neat sentence; a character who is defending, explaining, showing off, or emotionally cornered may naturally run longer.
- Avoid making consecutive messages all similar in size, opening pattern, or cadence.${clustered ? '\n- Recent room lines are clustering around medium length. Deliberately break that rhythm with either a shorter jab/fragment or a fuller line if it fits.' : ''}
${rhythm}
- If you use extraMessages, keep content as the first visible bubble and put only the later consecutive bubbles in extraMessages. The full turn may contain up to 5 visible bubbles total. Vary lengths naturally. Do not split purely by punctuation.`;
}

function buildExpressionFeedbackPrompt(feedback: ExpressionFeedbackTrace) {
  if (!feedback.length) return '';
  const labels = Array.from(new Set(feedback.map((item) => item.label).filter(Boolean)));
  const lines = feedback.slice(0, 3).map((item) => `- ${item.label}: ${item.text}`);
  const hardHints = [
    labels.includes('控制长度') ? '- The user has corrected this character for being too long before. Unless the current task clearly needs longform, keep this turn tighter and avoid splitting into extra explanatory beats.' : '',
    labels.includes('降低正式感') ? '- The user has corrected this character for sounding too formal. Avoid report-like structure and let the character voice stay conversational.' : '',
    labels.includes('减少助手腔') ? '- The user has corrected this character for sounding like a generic assistant. Do not use neutral service phrasing, balanced summaries, or standard answer cadence; speak from this character’s situated view.' : '',
    labels.includes('贴近角色') ? '- The user has corrected this character for going out of character. Prioritize age, background, relationship stance, habits, and limitations over polished usefulness.' : '',
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
    ? '\n- Direct reply guidance: answer the user-requested point first, then optionally react socially. Do not dodge into room banter before answering. If a specific actor was requested, that actor should treat this as a direct task, not a casual mention.'
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

function createAttachmentId(kind: string) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  surface?: ResponseSurface;
}): MessageMetadata | undefined {
  const decision = normalizeMediaDecision(params.decision, params.capabilities, params.content);
  if (!decision && !params.runtimeDecision) return undefined;
  const now = Date.now();
  const attachments: MessageAttachment[] = [];
  if (decision?.image?.shouldGenerate && decision.image.prompt && decision.image.altText) {
    attachments.push({
      id: createAttachmentId('image'),
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
    attachments.push({
      id: createAttachmentId('audio'),
      kind: 'audio',
      status: 'queued',
      altText: `语音：${decision.audio.text || params.content}`,
      promptText: decision.audio.text || params.content,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    format: params.surface?.allowMarkdown ? 'markdown' : 'plain',
    contextText: params.content,
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
  speakerScore?: SpeakerScoreBreakdown | null;
  innerLife?: InnerLifeProjection | null;
  surface?: ResponseSurface | null;
  memoryTrace?: PromptMemoryTrace | null;
  expressionFeedback?: ExpressionFeedbackTrace;
  guidanceExecution?: GuidanceExecutionTrace | null;
}): MessageMetadata['runtimeDecision'] | undefined {
  const memoryContext = params.memoryTrace && (params.memoryTrace.injectedIds.length || params.memoryTrace.recalledArchives.length || params.memoryTrace.targetActorId)
    ? {
      injectedIds: params.memoryTrace.injectedIds.slice(0, 18),
      targetActorId: params.memoryTrace.targetActorId,
      targetActorName: params.memoryTrace.targetActorName,
      targetReason: params.memoryTrace.targetReason,
      recalledArchives: params.memoryTrace.recalledArchives.slice(0, 4),
    }
    : undefined;
  if (!params.directorIntent && !params.narrativeLines?.length && !params.speakerScore && !params.innerLife && !params.surface && !memoryContext && !params.expressionFeedback?.length && !params.guidanceExecution) return undefined;
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
    memoryContext,
    guidanceExecution: params.guidanceExecution ? {
      status: params.guidanceExecution.status,
      validated: params.guidanceExecution.validated,
      retryCount: params.guidanceExecution.retryCount,
      rejectedDraftCount: params.guidanceExecution.rejectedDraftCount,
      rejectedReasons: params.guidanceExecution.rejectedReasons?.slice(0, 3),
      finalReason: params.guidanceExecution.finalReason,
      forcedMediaQueued: params.guidanceExecution.forcedMediaQueued,
    } : undefined,
    expressionFeedback: params.expressionFeedback?.length ? params.expressionFeedback.slice(0, 3) : undefined,
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
  const finalizedResponse = finalizeResponse(rawContent, params.intent, params.speaker, params.activeMessages, params.showRoleActions, false, params.surface);
  const finalResponse = resolveCommittedStreamContent(finalizedResponse, streamBridge.getLastContent());
  const extraMessages = normalizeExtraMessages({
    content: finalResponse,
    extraMessages: parsedEnvelope?.extraMessages,
    intent: params.intent,
    speaker: params.speaker,
    recentMessages: params.activeMessages,
    showRoleActions: params.showRoleActions,
    surface: params.surface,
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
  guidance?: UserGuidanceIntent | null;
  mediaCapabilities?: { image: boolean; audio: boolean };
  onChunk?: (content: string) => void;
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
      if (params.guidance) params.onChunk?.(generated.finalResponse);
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
	  speakerScore?: SpeakerScoreBreakdown | null;
	  generationContext?: {
    promptContext?: SessionGenerationPromptContext | null;
    buildPromptContext?: (speaker: AICharacter) => SessionGenerationPromptContext | null | undefined;
  };
  onChunk?: (content: string) => void;
  delay?: (ms: number) => Promise<void>;
}): Promise<GeneratedRoundMessage> {
  const chatMembers = params.characters.filter((character) => params.chat.memberIds.includes(character.id));
  const effectiveMembers = chatMembers.length ? chatMembers : params.characters;
  const activeMessages = params.messages.filter((message) => message.chatId === params.chat.id && !message.isDeleted);
  const latestActiveUserGuidance = resolveLatestActiveUserGuidance(effectiveMembers, activeMessages).intent;
  const effectiveDirectorIntent = params.directorIntent?.source === 'user_message'
    ? params.directorIntent
    : latestActiveUserGuidance || params.directorIntent || null;
  const emotion = getEmotion(params.speaker.id);
  const fallbackRecentTargetId = activeMessages.filter((message) => message.type === 'ai' && !message.isDeleted).at(-1)?.senderId;
  const recentTargetId = params.pendingReplyContext?.targetIds.includes(params.speaker.id)
    ? params.pendingReplyContext.sourceSpeakerId || fallbackRecentTargetId
    : fallbackRecentTargetId;
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
  const enginePromptContext = params.generationContext?.buildPromptContext?.(params.speaker) || params.generationContext?.promptContext;
  const promptPrefix = enginePromptContext?.promptPrefix ? `${enginePromptContext.promptPrefix.trim()}\n\n` : '';
  const promptSuffix = enginePromptContext?.promptSuffix ? `\n\n${enginePromptContext.promptSuffix.trim()}` : '';
  const additionalConstraints = enginePromptContext?.additionalConstraints?.length
    ? `\n- ${enginePromptContext.additionalConstraints.join('\n- ')}`
    : '';
  const pendingReplyPrompt = params.pendingReplyContext?.targetIds.includes(params.speaker.id) && params.pendingReplyContext.sourceSpeakerId
    ? `\nPending reply expectation:\n- You were explicitly addressed by ${characterMap.get(params.pendingReplyContext.sourceSpeakerId)?.name || params.pendingReplyContext.sourceSpeakerId}.\n- Reply to that character first instead of pivoting to another member.\n- Acknowledge their question or emotion before expanding to the room.`
    : '';
  const mediaProfiles = resolveMediaProfiles(params.apiConfig, params.profiles);
  const mediaCapabilities = buildMediaCapabilities(params.speaker, mediaProfiles);
  const responseSurface = resolveResponseSurface(params.chat, enginePromptContext, activeMessages, params.speaker);
  const expressionFeedbackTrace = collectExpressionFeedbackTrace(params.speaker, innerLife);
  const memoryTrace = buildPromptMemoryTrace(params.speaker, params.chat, activeMessages, characterMap);
  const userGuidance = effectiveDirectorIntent?.userGuidance || null;
	  const systemPrompt = `${promptPrefix}${buildSpeakerSystemPrompt({ speaker: params.speaker, chat: params.chat, emotion, activeMessages, characterMap })}${buildHumanizationPrompt(params.speaker, intent, activeMessages, userGuidance)}${buildInnerLifePromptBlock(innerLife)}${pendingReplyPrompt}${buildUserGuidancePrompt(userGuidance, params.speaker, effectiveMembers, mediaCapabilities)}

Current director intent:
- ${effectiveDirectorIntent ? describeDirectorIntent(effectiveDirectorIntent) : 'none'}
- Treat this as the current room pressure, not as a fixed plot script.

Current speaking intent:
- ${describeIntentForPrompt(intent)}
- Treat the intent shape as style guidance, not a hard length cap. Do not truncate a useful reply just to fit one sentence or a fragment shape.
- ${responseSurface.kind === 'chat' ? 'Respond like a WeChat message: quick, targeted, partial, reactive, and slightly messy. Do not write a balanced full answer unless the conversation truly needs it.' : 'Respond in the surface the scene requires: professional or creative longform is allowed, including Markdown, while keeping this speaker’s personality and social position.'}
- ${responseSurface.kind === 'chat' ? 'Prefer sounding impulsive, socially situated, colloquial, and slightly incomplete over sounding polished.' : 'Prefer clarity, useful structure, and role-specific judgment over forced brevity; keep warmth, bias, doubts, or personality where they belong.'}
- ${responseSurface.kind === 'chat' ? 'If a human would just say “啊？”, “行吧”, “不是这个意思”, “那你这也太…”, or one sharp follow-up, do that instead of expanding.' : 'If the room asks for a professional question, long answer, fiction draft, outline, or critique, satisfy that task fully instead of compressing it into chat banter.'}${additionalConstraints}${buildExpressionFeedbackPrompt(expressionFeedbackTrace)}${buildNaturalChatRhythmPrompt(activeMessages, innerLife, responseSurface)}${buildResponseSurfacePrompt(responseSurface)}${buildGenerationConstraints(activeMessages, params.speaker.id, responseSurface)}${buildInlineInteractionContract({ chat: params.chat, speaker: params.speaker, characters: effectiveMembers, recentMessages: activeMessages, mediaCapabilities })}${promptSuffix}`;
  const chatMessages = buildChatMessages(activeMessages, characterMap, MAX_HISTORY_FOR_PROMPT);
  const resolvedApi = resolveApiConfigForCharacter(params.speaker, params.apiConfig, params.profiles);
  const generated = await generateNonDuplicateResponse({
    resolvedApi,
    systemPrompt,
    chatMessages,
    speaker: params.speaker,
    characters: effectiveMembers,
    intent,
    activeMessages,
    showRoleActions: params.chat.showRoleActions,
    surface: responseSurface,
    guidance: userGuidance,
    mediaCapabilities,
    onChunk: params.onChunk,
  });
  if (!normalizeForComparison(generated.finalResponse)) {
    throw new EmptyGeneratedResponseError(params.speaker.name);
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
	      runtimeDecision: buildRuntimeDecisionMetadata({
	        directorIntent: effectiveDirectorIntent,
	        narrativeLines: params.narrativeLines,
	        speakerScore: params.speakerScore,
          innerLife,
          surface: responseSurface,
          memoryTrace,
          expressionFeedback: expressionFeedbackTrace,
          guidanceExecution,
	      }),
	    }),
	  });
  const visibleMessage = maybeAutoWithdrawMessage(completedMessage, { language: 'zh' });
  if (visibleMessage.metadata?.withdrawal?.withdrawn) {
    const { extraMessages: _extraMessages, ...withdrawnMessage } = visibleMessage;
    const withdrawal = withdrawnMessage.metadata?.withdrawal;
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
  const runtimePressure = projectRuntimePressure({ chat, characters: chatMembers, messages: activeMessages, pendingReplyContext });
  const narrativeLines = runtimePressure.narrativeLines;
  const directorIntent = runtimePressure.directorIntent;
  const candidates = calculateWeights(chatMembers, activeMessages, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, pendingReplyContext, chat, directorIntent);
  const lockedGuidanceSpeaker = resolveUserGuidanceLockedSpeaker(chatMembers, directorIntent);
  const speakerSelection = lockedGuidanceSpeaker
    ? { speakerId: lockedGuidanceSpeaker.id, reason: null, bypassNotice: null }
    : getSpeakerSelectionResult(chatMembers, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, candidates);
  if (isSchedulerDebugEnabled() && chat.type === 'group' && !speakerSelection.speakerId) {
    console.info('[group-loop:idle]', {
      chatId: chat.id,
      mode: chat.mode,
      reason: speakerSelection.reason,
	      pendingReplyContext,
	      directorIntent,
	      narrativeLines,
	    });
	  }
  if (isSchedulerDebugEnabled() && !speakerSelection.speakerId) {
    console.info('[group-loop:idle]', {
      chatId: chat.id,
      mode: chat.mode,
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

  try {
    let activeSpeaker = speaker;
    let completedMessage: GeneratedRoundMessage;
    try {
      completedMessage = await generateSpeakerMessage({
        chat,
        speaker: activeSpeaker,
        characters,
        messages,
        apiConfig,
        profiles,
        pendingReplyContext,
        directorIntent,
        narrativeLines,
        speakerScore: selectedCandidate?.scoreBreakdown || null,
        generationContext,
        onChunk: callbacks.onMessageChunk,
      });
    } catch (error) {
      if (!(error instanceof EmptyGeneratedResponseError)) throw error;
      if (lockedGuidanceSpeaker && activeSpeaker.id === lockedGuidanceSpeaker.id) throw error;
      const rotated = resolveSpeakerFromCandidates(chatMembers, candidates.filter((candidate) => candidate.characterId !== activeSpeaker.id));
      if (!rotated) throw new Error(`${activeSpeaker.name} 连续生成了重复内容，本轮已跳过。`);
      activeSpeaker = rotated;
      const rotatedCandidate = candidates.find((candidate) => candidate.characterId === activeSpeaker.id);
      callbacks.onSpeakerSelected(activeSpeaker.id, activeSpeaker);
      completedMessage = await generateSpeakerMessage({
        chat,
        speaker: activeSpeaker,
        characters,
        messages,
        apiConfig,
        profiles,
        pendingReplyContext,
        directorIntent,
        narrativeLines,
        speakerScore: rotatedCandidate?.scoreBreakdown || null,
        generationContext,
        onChunk: callbacks.onMessageChunk,
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
};
