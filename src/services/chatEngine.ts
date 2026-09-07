import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import { resolveShowRoleActions, type GroupChat } from '../types/chat';
import type { Message, StoryEvent } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import type { MediaGenerationDecision, MessageAttachment, MessageMetadata, NarrativeBlock } from '../types/message';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionGenerationRuntimeBundle } from '../types/sessionEngine';
import type { MemoryItem } from './memoryTypes';
import { getPreferredAIProfile, inferTextInputCapabilities, isAIProfileUsable } from '../types/settings';
import type { ConflictFocusPayload, InteractionEventPayload, SocialEventHintEnvelope } from '../types/runtimeEvent';
import { normalizeInteractionHintCollection, normalizeSocialEventHints } from '../types/runtimeEvent';
import { generateResponse } from './aiClient';
import { buildSystemPromptWithContext, buildPromptAssemblyWithContext, buildChatMessages, buildPromptMemoryTrace, buildPromptCharacterMindTrace, type PromptAssemblyWithContext, type PromptCharacterMindTrace, type PromptMemoryTrace } from './promptBuilder';
import { buildEngineAwarePrompt } from './promptContextAssembler';
import { resolveSessionDefinition } from '../types/sessionEngine';
import { loadSessionEngine } from './sessionEngineLoader';
import { getStyleProfile, resolveChatStyleProfile, resolveDefaultStyleProfile } from './styleProfileRegistry';
import { getChannelSemantics } from './channelSemanticsRegistry';
import { logDeveloperDiagnostic } from './developerDiagnostics';
import { getCurrentRetentionLimits } from './retentionLimits';

function getSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return loadSessionEngine(chat);
}
import { analyzeEmotion, updateEmotion } from './emotionTracker';
import { calculateWeights, getSpeakerSelectionResult, isChatMemberMuted, resolvePendingReplyContext, selectSpeaker } from './scheduler';
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
import { getExpressionFeedbackCategoryLabel, summarizeExpressionFeedbackInfluence } from './expressionFeedbackInfluence';
import type { UserGuidanceIntent } from './userGuidanceIntent';
import { collectGuidanceProgressAfterTimestamp, evaluateGuidanceGeneratedContent, type GuidanceExecutionReason, type GuidanceRejectionReason } from './guidanceExecution';
import { projectWorldAttentionStates, projectWorldCalendar, projectWorldMoments } from './worldRuntimeProjection';
import { buildTurnPlanPrompt, deriveTurnPlan, type TurnPlan } from './turnPlanner';
import { resolvePersonaActivation, type PersonaActivation } from './personaActivation';
import { buildGenerationRuntimeBundle } from './generationRuntime';
import { buildConversationMovePrompt, planConversationMove } from './conversationMovePlanner';
import { buildPromptPlayModeBlock, composePromptBlocks, resolvePromptPlayMode, type PromptBlock } from './promptBlockComposer';
import { buildTurnDirective, buildTurnDirectivePrompt } from './turnDirective';
import { resolveSessionEngineKey, resolveSessionFamilyKey } from './sessionEngineKeys';
import { isCharacterAvailableForScheduling } from './characterPresence';
import { enrichRuntimeBundleWithHumanAppraisal } from './humanAppraisal';
import { normalizeStoryChoiceSuggestions } from './storyChoices';
import type { StoryContinuationState } from './narrativeRuntime';
import { sanitizeUserFacingText } from './displayTextSanitizer';
import { enhanceImagePrompt } from './imagePromptComposer';
import { useSettingsStore } from '../stores/useSettingsStore';
import { api, ApiError, type AiSearchResultItem } from './api';
import { useAuthStore } from '../stores/useAuthStore';
import { canUseStickerCapability } from './capabilityGraph';
import { getPromptSpeakerLabel, getPromptTurnTypeLabel, isHumanDirectedMessage } from './chatMessageSemantics';

export interface GeneratedRoundMessage extends Omit<Message, 'id' | 'timestamp' | 'isDeleted'> {
  extraMessages?: string[] | null;
  messageParts?: Array<{ content: string; metadata?: MessageMetadata }> | null;
  interactionHint?: InteractionEventPayload | null;
  interactionHints?: InteractionEventPayload[] | null;
  addressedTargetIds?: string[] | null;
  primaryAddressedTargetId?: string | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
}

type SpeakerSelectionState = {
  speakerId?: string | null;
  reason?: string | null;
  bypassNotice?: string | null;
  policy?: Record<string, unknown>;
} | null;

export type LocalInterceptionKind =
  | 'guidance_retry'
  | 'analysis_artifacts_present'
  | 'analysis_artifacts_missing'
  | 'presence_metadata_missing'
  | 'surface_contract_warning'
  | 'surface_echo_warning'
  | 'surface_echo_retry'
  | 'surface_echo_skip'
  | 'surface_contract_retry'
  | 'surface_contract_skip'
  | 'empty_generation_skip'
  | 'streamed_draft_committed'
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
type WebSearchTurnCacheEntry = {
  expiresAt: number;
  promptBlock: string;
  query: string;
};

const WEB_SEARCH_TURN_CACHE_TTL_MS = 5 * 60 * 1000;
const webSearchTurnCache = new Map<string, WebSearchTurnCacheEntry>();

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
  rawResponse?: string;
  narrativeText?: string | null;
  narrativeBlocks?: NarrativeBlock[] | null;
  storyChoices?: MessageMetadata['storyChoices'] | null;
  fullNarrativeResponse?: string;
  extraMessages?: string[] | null;
  messageParts?: Array<{ content: string; mediaDecision?: MediaGenerationDecision | null }> | null;
  storyEvents?: import('../types/message').StoryEvent[] | null;
  guidanceExecution?: GuidanceExecutionTrace;
  streamedFallbackUsed?: boolean;
};

const MAX_EXTRA_MESSAGES = 4;
const emotionMap: Record<string, number> = {};
type NarrativeRuntimeModule = typeof import('./narrativeRuntime');

function loadNarrativeRuntime() {
  return import('./narrativeRuntime');
}

function hasCompanionshipRuntimeState(chat: GroupChat, character: AICharacter) {
  if (
    character.layeredMemories?.length
    || character.relationships?.length
    || character.memory?.userMemories?.length
  ) {
    return true;
  }
  return (chat.runtimeEventsV2 || []).some((event) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    return Boolean(
      payload?.eventType
      && typeof payload.eventType === 'string'
      && payload.eventType.startsWith('companionship_')
      && payload.characterId === character.id,
    );
  });
}

async function buildCompanionshipTraceIfNeeded(params: {
  chat: GroupChat;
  character: AICharacter;
  messages: Message[];
}) {
  if (!hasCompanionshipRuntimeState(params.chat, params.character)) return null;
  const { buildCompanionshipRuntimeTrace } = await import('./companionshipProjection');
  return buildCompanionshipRuntimeTrace({
    chat: params.chat,
    character: params.character,
    messages: params.messages,
  });
}

export class EmptyGeneratedResponseError extends Error {
  localInterceptionReported: boolean;
  reason: string;

  constructor(speakerName: string, options?: { localInterceptionReported?: boolean; reason?: string; message?: string }) {
    const reason = options?.reason || 'duplicate_content';
    super(options?.message || (reason === 'story_protocol_invalid'
      ? `${speakerName} 没有按故事房格式生成结构化正文，本轮已跳过。`
      : reason === 'empty_content'
        ? `${speakerName} 没有生成有效内容，本轮已跳过。`
        : `${speakerName} 连续生成了重复内容，本轮已跳过。`));
    this.name = 'EmptyGeneratedResponseError';
    this.localInterceptionReported = Boolean(options?.localInterceptionReported);
    this.reason = reason;
  }
}

function isSchedulerDebugEnabled() {
  return isDeveloperModeEnabled()
    && Boolean((globalThis as { __AICHATGROUP_DEBUG_SCHEDULER__?: boolean }).__AICHATGROUP_DEBUG_SCHEDULER__);
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

function compactAnalysisPromptText(text: string | undefined | null, max = 180) {
  const normalized = sanitizeUserFacingText(text).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function buildAnalysisSpeakerSystemPrompt(args: {
  speaker: AICharacter;
  chat: GroupChat;
  messages: Message[];
}) {
  const limits = getCurrentRetentionLimits();
  const memoryLines = [
    args.speaker.memory?.shortTermSummary ? `- Short memory: ${compactAnalysisPromptText(args.speaker.memory.shortTermSummary, 140)}` : '',
    ...(args.speaker.memory?.longTerm || []).slice(-2).map((item) => `- Long memory: ${compactAnalysisPromptText(item, 120)}`),
    ...(args.speaker.layeredMemories || []).slice(-limits.characterLayeredMemories.recall).map((item) => `- Character memory: ${compactAnalysisPromptText(item.text, 120)}`),
  ].filter(Boolean);
  const latest = args.messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1);
  return [
    'You are a participant in a structured analysis room.',
    `Current speaker: ${args.speaker.name}.`,
    args.speaker.background ? `Background reference: ${compactAnalysisPromptText(args.speaker.background, 180)}` : '',
    args.speaker.expertise?.length ? `Relevant expertise: ${args.speaker.expertise.slice(0, 5).join(', ')}.` : '',
    args.speaker.speakingStyle ? `Voice reference: ${compactAnalysisPromptText(args.speaker.speakingStyle, 160)}` : '',
    `Room topic: ${compactAnalysisPromptText(args.chat.topic || args.chat.name, 220) || '未提供'}.`,
    args.chat.worldState?.focus ? `Current focus: ${compactAnalysisPromptText(args.chat.worldState.focus, 180)}.` : '',
    latest ? `Latest visible turn: ${latest.senderName || latest.senderId}: ${compactAnalysisPromptText(latest.content, 220)}` : '',
    memoryLines.length ? `\n## Compact Character Memory\n${memoryLines.join('\n')}` : '',
    `\n## Analysis Speaker Rules
- Use the character only as an angle, vocabulary, and lived examples. Do not let persona warmth, relationship repair, farewell, or scene closure become the point.
- Treat recent messages as claims, evidence, counterexamples, or drift to correct. They are not style samples to imitate.
- Prefer one clear deliberative move over emotional continuation: challenge a premise, add a boundary, test evidence, answer an unresolved question, separate two claims, or synthesize a provisional verdict.
- If there is no useful new point, say that plainly in character and return deliberationArtifacts=null.`,
  ].filter(Boolean).join('\n');
}

function buildStoryReaderSystemPrompt(params: {
  chat: GroupChat;
  speaker: AICharacter;
  characters: AICharacter[];
  activeMessages: Message[];
  promptPrefix: string;
  additionalConstraints: string;
  promptSuffix: string;
}) {
  const policy = resolvePromptPlayMode(params.chat);
  const characterLines = params.characters
    .map((character) => `- id=${character.id}; name=${character.name}`)
    .join('\n') || '- No named characters available.';
  const latestChapter = params.chat.scenarioState?.storyChapters?.at(-1);
  const chapterTitle = params.chat.scenarioState?.chapterRecap?.title || latestChapter?.title || '未命名';
  return composePromptBlocks([
    { id: 'engine_prefix', layer: 'core', priority: -100, content: params.promptPrefix },
    {
      id: 'story_reader_contract',
      layer: 'core',
      priority: 0,
      content: `You are the story-reader narrative engine for this room.
- Write the next committed page of the same continuous novel.
- The active generator is narrator/旁白. Characters appear only through storyEvents.speech.
- Do not answer as an ordinary chat participant.
- Do not output plain prose, markdown, analysis, recap, candidate drafts, or chat bubbles outside JSON.
- Return exactly one valid JSON object whose visible story body is storyEvents.`,
    },
    buildPromptPlayModeBlock(policy),
    {
      id: 'story_room_state',
      layer: 'scene',
      priority: 0,
      content: `\nStory room:
- room=${params.chat.name || params.chat.topic || params.chat.id}
- phase=${params.chat.scenarioState?.phase || 'scene'}
- chapter=${chapterTitle}`,
    },
    {
      id: 'story_actors',
      layer: 'character',
      priority: 0,
      content: `\nAvailable story actors:
${characterLines}`,
    },
    { id: 'engine_constraints', layer: 'task', priority: 10, content: params.additionalConstraints },
    {
      id: 'inline_interaction_contract',
      layer: 'output',
      priority: 20,
      content: buildInlineInteractionContract({
        chat: params.chat,
        speaker: params.speaker,
        characters: params.characters,
        recentMessages: params.activeMessages,
      }),
    },
    { id: 'engine_suffix', layer: 'suffix', priority: 100, content: params.promptSuffix },
  ], policy);
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
  const defaultStyleProfileKey = resolveDefaultStyleProfile({
    scenarioId: chat.sessionKind?.scenarioId || session.kind.scenarioId,
    family: chat.sessionKind?.family || session.kind.family,
  });
  const explicitChatStyle = chat.type === 'group' && session.kind.family === 'conversation'
    ? resolveChatStyleProfile(chat.style)
    : null;
  const styleProfileKey = explicitChatStyle || defaultStyleProfileKey;
  return getStyleProfile(styleProfileKey)?.promptContext || null;
}

function buildChannelSemanticPrefix(chat: GroupChat) {
  return getChannelSemantics(chat).promptPrefix;
}

function buildSessionPrompt(prompt: string, messages: Message[], chat: GroupChat) {
  if (resolveSessionFamilyKey(chat) === 'analysis') {
    return `This is a structured analysis room. Recent transcript is deliberation evidence, not a social script or style sample.\n\n${prompt}\n\nRecent context signals:\n- Complete recent transcript is supplied as separate chat messages and is not repeated here.\n${buildRecentContextSignalSummary(messages)}`;
  }
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
  promptAssembly?: PromptAssemblyWithContext | null;
}) {
  const basePrompt = resolveSessionFamilyKey(args.chat) === 'analysis'
    ? buildAnalysisSpeakerSystemPrompt({
      speaker: args.speaker,
      chat: args.chat,
      messages: args.activeMessages,
    })
    : args.promptAssembly?.systemPrompt || buildSessionSystemPrompt({
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
  return getPromptSpeakerLabel(message);
}

function buildRecentContextSignalSummary(messages: Message[]) {
  const recent = messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .slice(-8);
  if (!recent.length) return '- No visible recent turns yet.';
  const latest = recent.at(-1);
  const humanCount = recent.filter(isHumanDirectedMessage).length;
  const aiCount = recent.filter((message) => message.type === 'ai').length;
  const speakers = Array.from(new Set(recent.map(getSessionMessageSpeakerName))).slice(-6);
  return [
    `- Complete recent transcript is supplied as separate chat messages and is not repeated here.`,
    `- Recent window: ${recent.length} turns (${humanCount} human / ${aiCount} AI).`,
    `- Latest turn: ${latest ? `${getPromptTurnTypeLabel(latest)} from ${getSessionMessageSpeakerName(latest)}` : 'none'}.`,
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
  signal?: AbortSignal;
}

function isTestRuntime() {
  return Boolean((globalThis as { __vitest_worker__?: unknown; __VITEST__?: unknown }).__vitest_worker__ || (globalThis as { __VITEST__?: unknown }).__VITEST__);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
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

function shouldApplyInnerLifeTypingDelay(chat: GroupChat) {
  return chat.sessionKind?.scenarioId !== 'story-reader';
}

async function waitForInnerLifeTypingDelay(projection: InnerLifeProjection, chat: GroupChat, delay?: (ms: number) => Promise<void>) {
  if (!shouldApplyInnerLifeTypingDelay(chat)) return 0;
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

function extractParentheticalSegments(content: string) {
  const matches = content.match(/[（(][^）)\n]{2,260}[）)]/gu) || [];
  return matches.map((segment) => segment.slice(1, -1).trim()).filter(Boolean);
}

function hasLongNarrativeStageAside(content: string) {
  const trimmed = content.trim();
  const segments = extractParentheticalSegments(content);
  if (!segments.length) return false;
  if (/^[（(]/u.test(trimmed) && segments[0].length >= 14) return true;
  if (segments.some((segment) => segment.length >= 28)) return true;
  if (segments.length >= 2 && segments.reduce((sum, segment) => sum + segment.length, 0) >= 24) return true;
  return false;
}

function findLeakedSpeakerLine(content: string, speaker: AICharacter, characters: AICharacter[] = []) {
  const otherNames = characters
    .filter((character) => character.id !== speaker.id)
    .map((character) => character.name)
    .filter((name) => name && name.length <= 24);
  return otherNames.find((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\n。！？!?]\\s*)${escaped}\\s*[:：]`, 'u').test(content);
  }) || '';
}

function evaluateVisibleSurfaceContract(params: {
  chat: GroupChat;
  speaker: AICharacter;
  characters?: AICharacter[];
  content: string;
  showRoleActions?: boolean;
}) {
  if (params.chat.sessionKind?.scenarioId === 'story-reader') return null;
  const content = params.content.trim();
  if (!content) return null;
  const analysisRoom = resolveSessionFamilyKey(params.chat) === 'analysis';
  const roleActionsDisabled = params.showRoleActions === false || analysisRoom;
  if ((roleActionsDisabled || analysisRoom) && hasLongNarrativeStageAside(content)) {
    return 'contains narrated stage directions or parenthesized scene beats';
  }
  const leakedSpeaker = findLeakedSpeakerLine(content, params.speaker, params.characters || []);
  if (leakedSpeaker) {
    return `contains another speaker line inside one response (${leakedSpeaker})`;
  }
  return null;
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

function stripLeakedInlineProtocol(content: string) {
  return content
    .replace(/\s+(?:["'`])?(?:extraMessages|intentionalRepeat|presenceUpdate|interactionHints|socialEventHints|conflictFocus)(?:["'`])?\s*:[\s\S]*$/u, '')
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

function finalizeResponse(content: string, intent: ReturnType<typeof deriveSpeakIntentFromContext>, speaker: AICharacter, recentMessages: Message[], showRoleActions?: boolean, intentionalRepeat = false, surface?: ResponseSurface) {
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  const sanitized = stripLeakedInlineProtocol(trimHumanChatStyle(showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix, surface?.preserveParagraphs));
  if (surface?.kind !== 'chat' && normalizeForComparison(sanitized)) return sanitizeUserFacingText(sanitized, [], { preserveLineBreaks: true });
  const processed = postProcessHumanChat(sanitized, intent, speaker, recentMessages, intentionalRepeat);
  if (normalizeForComparison(processed)) return sanitizeUserFacingText(processed, [], { preserveLineBreaks: true });
  return sanitizeUserFacingText(salvageEmptyResponse(content, speaker.name, showRoleActions), [], { preserveLineBreaks: true });
}

function normalizeStoryActorName(value: string) {
  return value.trim().replace(/[（(].*?[）)]/gu, '').replace(/\s+/g, '').toLowerCase();
}

function extractInlineStoryActorName(text: string) {
  const match = text.match(/^([^\n：:（(]{1,24})(?:[（(][^\n）)]{1,24}[）)])?[：:]?\s*\n+/u);
  return match?.[1]?.trim() || '';
}

function resolveStoryBlockCharacter(params: {
  characters: AICharacter[];
  characterById: Map<string, AICharacter>;
  actorId: string;
  actorName: string;
  inlineActorName: string;
  blockIndex: number;
  text: string;
}) {
  const byId = params.inlineActorName ? null : params.characterById.get(params.actorId);
  if (byId) return byId;
  const candidates = [params.inlineActorName, params.actorName, params.actorId].map(normalizeStoryActorName).filter(Boolean);
  const matches = params.characters.filter((character) => candidates.includes(normalizeStoryActorName(character.name)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    if (isDeveloperModeEnabled() && typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[story-reader] Ambiguous narrative dialogue actor name; downgraded to narrator prose.', {
        blockIndex: params.blockIndex,
        actorId: params.actorId,
        actorName: params.actorName,
        text: params.text,
        matchedCharacters: matches.map((character) => ({ id: character.id, name: character.name })),
      });
    }
  } else if (params.actorId || params.actorName || params.inlineActorName) {
    if (isDeveloperModeEnabled() && typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[story-reader] Unknown narrative dialogue actor; downgraded to narrator prose.', {
        blockIndex: params.blockIndex,
        actorId: params.actorId,
        actorName: params.actorName || params.inlineActorName,
        text: params.text,
        knownCharacters: params.characters.map((character) => ({ id: character.id, name: character.name })),
      });
    }
  }
  return null;
}

function normalizeStoryNarrativeBlocks(params: {
  blocks: unknown;
  events?: unknown;
  characters: AICharacter[];
  fallbackNarrativeText: string;
}): NarrativeBlock[] {
  const characterById = new Map(params.characters.map((character) => [character.id, character]));
  const source = Array.isArray(params.events) && params.events.length
    ? params.events.map((event) => {
      if (!event || typeof event !== 'object') return event;
      const raw = event as { type?: unknown; actorId?: unknown; actorName?: unknown; characterId?: unknown; speakerName?: unknown; text?: unknown };
      if (raw.type === 'speech') return { actorId: raw.actorId || raw.characterId, actorName: raw.actorName || raw.speakerName, kind: 'dialogue', text: raw.text };
      if (raw.type === 'narration') return { actorId: 'narrator', actorName: '旁白', kind: 'prose', text: raw.text };
      return null;
    }).filter(Boolean)
    : params.blocks;
  const normalized = Array.isArray(source)
    ? source.flatMap((block, index): NarrativeBlock[] => {
      if (!block || typeof block !== 'object') return [];
      const raw = block as { actorId?: unknown; actorName?: unknown; kind?: unknown; text?: unknown };
      const rawText = typeof raw.text === 'string' ? trimHumanChatStyle(raw.text, true) : '';
      if (!rawText) return [];
      const inlineActorName = extractInlineStoryActorName(rawText);
      const text = inlineActorName ? rawText.replace(/^([^\n：:（(]{1,24})(?:[（(][^\n）)]{1,24}[）)])?[：:]?\s*\n+/u, '').trim() : rawText;
      if (!text) return [];
      const requestedKind = raw.kind === 'dialogue' || inlineActorName ? 'dialogue' : 'prose';
      const requestedActorId = typeof raw.actorId === 'string' && raw.actorId.trim() ? raw.actorId.trim() : '';
      const requestedActorName = typeof raw.actorName === 'string' && raw.actorName.trim() ? raw.actorName.trim() : '';
      const isNarratorActor = inlineActorName
        ? normalizeStoryActorName(inlineActorName) === normalizeStoryActorName('旁白')
        : requestedActorId === 'narrator' || normalizeStoryActorName(requestedActorId) === normalizeStoryActorName('旁白') || normalizeStoryActorName(requestedActorName) === normalizeStoryActorName('旁白');
      const character = requestedKind === 'dialogue' && !isNarratorActor ? resolveStoryBlockCharacter({
        characters: params.characters,
        characterById,
        actorId: requestedActorId,
        actorName: requestedActorName,
        inlineActorName,
        blockIndex: index,
        text,
      }) : null;
      if (character) {
        return [{
          id: `block-${index + 1}`,
          actorId: character.id,
          actorKind: 'character',
          kind: 'dialogue',
          displayMode: 'bubble',
          text,
          actorName: character.name,
          characterId: character.id,
        }];
      }
      return [{
        id: `block-${index + 1}`,
        actorId: 'narrator',
        actorKind: 'narrator',
        kind: 'prose',
        displayMode: 'paragraph',
        text,
      }];
    })
    : [];
  if (normalized.length) return normalized;
  const fallback = trimHumanChatStyle(params.fallbackNarrativeText, true);
  if (!fallback) return [];
  return fallback.split(/\n{2,}/).map((text, index) => ({
    id: `block-${index + 1}`,
    actorId: 'narrator',
    actorKind: 'narrator',
    kind: 'prose',
    displayMode: 'paragraph',
    text: text.trim(),
  }));
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

function isDeveloperModeEnabled() {
  return Boolean(useSettingsStore.getState().developerMode);
}

function logRawAiResponse(params: {
  chat: GroupChat;
  speaker: AICharacter;
  attempt: number;
  response: string;
}) {
  if (!isDeveloperModeEnabled() || typeof console === 'undefined' || typeof console.debug !== 'function') return;
  console.debug('[ai-raw-response]', {
    chatId: params.chat.id,
    chatName: params.chat.name,
    scenarioId: resolveSessionDefinition(params.chat).kind.scenarioId,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    attempt: params.attempt,
    response: params.response,
  });
}

function logAiGenerationFailure(params: {
  chat: GroupChat;
  speaker: AICharacter;
  reason: string;
  message: string;
  attempt?: number;
  draft?: string;
  details?: Record<string, unknown>;
}) {
  if (!isDeveloperModeEnabled() || typeof console === 'undefined' || typeof console.warn !== 'function') return;
  const payload = {
    chatId: params.chat.id,
    chatName: params.chat.name,
    scenarioId: resolveSessionDefinition(params.chat).kind.scenarioId,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    reason: params.reason,
    message: params.message,
    attempt: params.attempt,
    draft: params.draft,
    details: params.details,
  };
  console.warn('[ai-generation-failure]', payload);
  console.warn('[ai-generation-failure:json]', JSON.stringify(payload, null, 2));
}

function buildRetryPrompt(basePrompt: string, priorAttempt: string) {
  return `${basePrompt}\n\nRetry rule:\n- Your previous draft was too close to recent chat or repetitive.\n- Write a meaningfully different line now.\n- Do not reuse this draft's surface or semantic core: ${priorAttempt.slice(0, 120)}`;
}

function buildEmptyContentRetryPrompt(basePrompt: string) {
  return `${basePrompt}\n\nEmpty-output retry:
- The previous model output had no visible content. It was not a valid pause, not a valid silence marker, and not a valid JSON chat turn.
- Return one valid JSON object now with a non-empty content string.
- If the room feels low-pressure, write a real boundary, counterexample, unresolved issue, interim judgment, or natural pause line instead of using whitespace or an empty string. Keep it as short or as developed as the scene actually needs.
- Do not output only spaces, newlines, null content, or an object whose visible fields are empty.`;
}

function buildSurfaceEchoRetryPrompt(basePrompt: string, priorAttempt: string, reason: string) {
  return `${basePrompt}\n\nAnti-echo retry:
- The previous draft was rejected because it borrowed too much surface from recent chat: ${reason}
- Keep the same character, relationship stance, and current social intent, but enter from a different angle.
- Do not reuse the rejected draft's opener, emoji/sticker marker, ending, cadence, or sentence shape.
- Do not reuse the same case, anecdote, quote, number, conclusion, or action plan from the rejected draft or the speaker's recent turns. Add one genuinely unused fact, consequence, doubt, question, or relationship reaction; if none is available, make a short natural handoff instead of restating the point.
- Do not copy another member's recent line unless you set intentionalRepeat=true and the repetition is clearly a social move: quoting, mocking, chanting, fixed-answering, or deliberate mirroring.
- Rejected draft: ${priorAttempt.slice(0, 180)}
- Return a fresh valid JSON object only.`;
}

function buildStoryProtocolPrompt(basePrompt: string) {
  return `${basePrompt}

Final story-reader output requirements:
- Return exactly one valid JSON object, with no markdown and no prose outside JSON.
- storyEvents is mandatory and must contain at least one visible narration or speech event. It may also include a choice_point event for a real decision pause and a chapter_update event for structured chapter indexing.
- Write a complete novel-like beat, not a stub. As a soft default, ordinary story beats often land around 900-1600 Chinese characters, while consequence, reveal, danger, or chapter-climax beats often need 1200-2200 Chinese characters. Scene needs override these ranges: a sharp exchange can be shorter, and a major scene can be longer.
- Use as many narration and speech events as the current story beat needs. Suggested ranges are guidance, not enforcement: do not pad with filler, truncate, or stop early merely to fit a count or character range.
- Put all visible story text inside storyEvents only. Do not write story prose as markdown, plain text, or any separate top-level prose container.
- If a character speaks, represent it as a storyEvents speech event with actorId or exact actorName.
- If you output a choice_point, each choice should include label, prompt, intent, risk, and reward.
- Before a choice_point, first write enough visible story for the reader to feel the pressure, cost, clue, or relationship shift on screen. Do not stop after only a few setup paragraphs just to ask for input.
- For non-choice beats, write a complete readable section that lands on a hook, pressure, consequence, or scene movement. Stop for the user only at a genuine choice_point.
- When opening or settling a chapter, add one chapter_update event with title and optional summary/status; do not put chapter metadata in visible prose.`;
}

function buildStoryProtocolQualityRetryPrompt(basePrompt: string, reason: string) {
  return `${buildStoryProtocolPrompt(basePrompt)}

Story protocol retry:
- The previous draft was rejected because it violated the storyEvents contract: ${reason}
- Return storyEvents as the only visible story body.
- Output one committed, complete novel-like section only. Expand the actual current beat with concrete action, consequence, pressure, clue movement, sensory detail, and useful dialogue; do not include alternate rewrites, previous transcript recap, candidate continuations, or multiple versions of the same consequence.
- Do not reuse any wording, paragraph, opening frame, final image, or dialogue from the rejected draft.`;
}

function buildStoryContinuityQualityRetryPrompt(
  basePrompt: string,
  reason: string,
  state?: StoryContinuationState | null,
) {
  return `${buildStoryProtocolPrompt(basePrompt)}

Story continuity retry:
- The previous draft was rejected because it did not continue as the next page of the same novel: ${reason}
- Do not quote, paraphrase, or restate the previous visible beat. Treat it only as the point immediately before this beat; the exact text is already in the transcript and must not be copied.
${state?.lastSpokenLine ? '- The latest spoken line is already in the transcript and still needs a response; answer its pressure without repeating the line.' : ''}
- Start after the final visible moment with the next observable action, reaction, consequence, or spoken line.
- Return storyEvents as the only visible story body.
- Output one committed beat only. Do not include alternate rewrites, previous transcript recap, candidate continuations, or multiple versions of the same consequence.`;
}

function hasLegacyNarrativeBlocks(value: unknown) {
  return Array.isArray(value) && value.some((block) => (
    block
    && typeof block === 'object'
    && typeof (block as { text?: unknown }).text === 'string'
    && (block as { text: string }).text.trim()
  ));
}

function storyEventVisibleText(event: StoryEvent) {
  if (event.type !== 'narration' && event.type !== 'speech') return '';
  return (event.text || '').trim();
}

function countStoryVisibleCharacters(value: string) {
  return value.replace(/\s+/g, '').length;
}

function getMinimumStoryVisibleCharacters(chat: GroupChat) {
  const phase = chat.scenarioState?.phase;
  const beatKind = chat.scenarioState?.storyBeatKind;
  if (phase === 'branch' || beatKind === 'consequence') return 560;
  if (beatKind === 'decision' || chat.scenarioState?.storyChoicePolicy === 'require') return 520;
  return 560;
}

function validateStoryReaderGeneration(params: {
  chat: GroupChat;
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope>;
  storyEvents?: StoryEvent[] | null;
  narrativeText?: string | null;
  narrativeBlocks?: NarrativeBlock[] | null;
  finalResponse?: string;
  rawContent?: string;
  continuationState?: StoryContinuationState | null;
  narrativeRuntime: Pick<NarrativeRuntimeModule, 'evaluateStoryContinuationQuality'>;
}) {
  const storyEvents = params.storyEvents || [];
  const visibleEvents = storyEvents.filter((event) => event.type === 'narration' || event.type === 'speech');
  const visibleText = visibleEvents.map(storyEventVisibleText).join('\n');
  const parsed = params.parsedEnvelope as (ReturnType<typeof parseInlineInteractionEnvelope> & {
    narrativeBlocks?: unknown;
    narrativeText?: unknown;
    content?: unknown;
    extraMessages?: unknown;
  }) | null;
  if (!visibleEvents.length) {
    if (hasLegacyNarrativeBlocks(parsed?.narrativeBlocks)) {
      return {
        code: 'legacy_narrative_blocks',
        message: '故事房生成结果使用了 legacy narrativeBlocks 作为正文，必须改为 storyEvents。',
      };
    }
    if (typeof parsed?.narrativeText === 'string' && parsed.narrativeText.trim()) {
      return {
        code: 'legacy_narrative_text',
        message: '故事房生成结果使用了 narrativeText 作为正文，必须改为 storyEvents。',
      };
    }
    if (typeof parsed?.content === 'string' && parsed.content.trim()) {
      return {
        code: 'legacy_content_body',
        message: '故事房生成结果使用了 content 作为正文，必须改为 storyEvents。',
      };
    }
    if (!parsed && ((params.rawContent || '').trim() || (params.finalResponse || '').trim())) {
      return {
        code: 'plain_text_body',
        message: '故事房生成结果使用了纯文本正文，必须改为 storyEvents。',
      };
    }
    return {
      code: 'story_events_missing',
      message: '故事房生成结果缺少可见 storyEvents narration/speech。',
    };
  }
  const continuationQuality = params.narrativeRuntime.evaluateStoryContinuationQuality(storyEvents, params.continuationState);
  if (!continuationQuality.ok) {
    return {
      code: 'story_continuity_invalid',
      message: continuationQuality.message || '故事房下一节没有按小说连续阅读接续。',
      details: {
        labels: continuationQuality.labels,
        gaps: continuationQuality.gaps,
        lastVisibleBeat: params.continuationState?.lastVisibleBeat || '',
        lastSpokenLine: params.continuationState?.lastSpokenLine || '',
      },
    };
  }
  const visibleCharacterCount = countStoryVisibleCharacters(visibleText);
  const minimumVisibleCharacters = getMinimumStoryVisibleCharacters(params.chat);
  if (visibleCharacterCount < minimumVisibleCharacters) {
    return {
      code: 'story_section_too_short',
      message: `故事房生成结果太短，当前可见正文约 ${visibleCharacterCount} 字，至少需要 ${minimumVisibleCharacters} 字来形成完整小说小节。`,
      details: {
        visibleCharacterCount,
        minimumVisibleCharacters,
        visibleEvents: visibleEvents.length,
        phase: params.chat.scenarioState?.phase || null,
        beatKind: params.chat.scenarioState?.storyBeatKind || null,
      },
    };
  }
  return null;
}

function toModelSafeStoryProtocolReason(issue: NonNullable<ReturnType<typeof validateStoryReaderGeneration>>) {
  switch (issue.code) {
    case 'legacy_narrative_blocks':
    case 'legacy_narrative_text':
    case 'legacy_content_body':
    case 'plain_text_body':
      return 'visible story text was placed in an old top-level body container instead of storyEvents';
    case 'story_events_missing':
      return 'the response did not include a visible storyEvents narration or speech event';
    case 'story_continuity_invalid':
      return issue.message;
    case 'story_section_too_short':
      return 'the visible story section was too short to read as a complete novel beat';
    default:
      return 'the response did not satisfy the storyEvents contract';
  }
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

function isLikelyInlineEnvelopeResponse(raw: string) {
  const cleaned = cleanJsonLikeText(raw).trimStart();
  if (!cleaned.startsWith('{')) return false;
  return /"(content|extraMessages|storyEvents|intentionalRepeat|interactionHints|socialEventHints|conflictFocus)"\s*:/.test(cleaned);
}

function buildStreamingDisplayContent(raw: string, speaker: AICharacter, showRoleActions?: boolean) {
  const extractedNarrativeText = extractPartialJsonStringField(raw, 'narrativeText');
  const extractedContent = extractPartialJsonStringField(raw, 'content');
  if (extractedNarrativeText === null && extractedContent === null) {
    if (isPendingJsonEnvelopeChunk(raw)) {
      return null;
    }
  }
  const content = extractedNarrativeText ?? extractedContent ?? raw;
  const withoutPrefix = trimSpeakerPrefix(content, speaker.name);
  return showRoleActions === false ? stripRoleActions(withoutPrefix) : withoutPrefix;
}

function buildRoleActionVisibilityPrompt(showRoleActions: boolean) {
  return showRoleActions
    ? '\n\nRole actions: brief physical beats are optional only when they change meaning or social temperature; do not use a fixed action-dialogue-action wrapper.'
    : '\n\nRole actions: visible content must be spoken chat only. No standalone stage directions, gesture beats, or parenthesized action asides.';
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
  return /(复读|重复|原话|照着说|照读|引用|引述|背|默写|接龙|下一句|下句|上一句|上句|补全|填空|标准答案|正确答案|答案是|口令|暗号|古诗|诗词|诗句|成语|台词|歌词|对联|上联|下联|一起说|一起喊|跟着说|跟着喊|齐声|应和)/i.test(text);
}

function hasLegitimateRepeatContext(messages: Message[]) {
  const latestHumanInstruction = messages
    .filter((message) => !message.isDeleted && isHumanDirectedMessage(message))
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

function latestHumanPressure(messages: Message[], speakerName: string) {
  const latestHuman = [...messages]
    .reverse()
    .find((message) => !message.isDeleted && isHumanDirectedMessage(message) && message.content.trim());
  const text = latestHuman?.content || '';
  return {
    text,
    asksDecision: /帮我选|替我选|你们帮我选|直接选|别再问|不用问|给个结论|推荐一个|定一个|怎么选|怎么办/.test(text),
    namesCurrent: Boolean(speakerName && text.includes(speakerName)),
    namesSomeone: /[^\s，。！？、]{1,12}[，,、 ]*(你怎么看|你来说|你说|想听你|直接说)/.test(text) || /我想听/.test(text),
    allowsIntentionalRepeat: isExplicitRepeatOrAnswerRequest(text),
  };
}

function buildFocusedSituationalJobContract(messages: Message[], speaker: AICharacter, surface: ResponseSurface) {
  if (surface.kind !== 'chat') return '';
  const visible = messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event');
  const previous = visible.at(-1);
  const previousSpeakerSame = previous?.type === 'ai' && previous.senderId === speaker.id;
  const recentOwn = visible
    .filter((message) => message.type === 'ai' && message.senderId === speaker.id)
    .slice(-3);
  const latestHuman = latestHumanPressure(visible, speaker.name);
  const signals = [
    previousSpeakerSame ? '- The previous visible speaker was also this speaker: continue only if the situation has moved; do not restate the same ask, pressure, summary, or closing.' : '',
    latestHuman.asksDecision ? '- The latest user pressure asks for a decision or recommendation: prefer one recommendation or a conditional decision instead of another broad preference question.' : '',
    latestHuman.namesSomeone && !latestHuman.namesCurrent ? '- The latest user pressure appears to name someone else: if this speaker is not that person, use a short clean handoff and do not hijack with this speaker’s own plan.' : '',
    latestHuman.allowsIntentionalRepeat ? '- The latest user pressure allows a deliberate repeat, quote, chant, fixed answer, or call-and-response: a concise intentional repeat is valid when it is the natural social move.' : '',
    recentOwn.length ? `- This speaker has ${recentOwn.length} recent own visible line(s). Treat them as no-repeat evidence from the transcript, not assistant history or style samples.` : '',
  ].filter(Boolean);
  if (!signals.length) return '';
  return `\n## Focused Situational Job Contract
${signals.join('\n')}
- Preserve the current unresolved need. Do not switch to a fresh logistical action, new fact, deadline, or softening move merely to be different.
- If answering is needed, answer first; optional detail comes after the answer.
- If pressure has become harsh, soften the temperature while keeping the practical ask visible.
- If a handoff is needed, keep it short and clean; do not attach this speaker's own stance.
- Avoid exact wording, copied opener, copied closing, same sentence frame, and the same pressure shape from recent lines.
- Good reply test: the room can tell what changed, and the reply still solves the latest user or room pressure.`;
}

function buildNameAddressVariants(name?: string | null) {
  const trimmed = (name || '').trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  if (/[\u4e00-\u9fff]/.test(trimmed) && trimmed.length >= 3) {
    variants.add(trimmed.slice(-2));
    if (trimmed.length >= 4) variants.add(trimmed.slice(-3));
  }
  return [...variants].filter((item) => item.length >= 2);
}

function startsWithVisibleNameAddress(content: string, names: Set<string>) {
  const trimmed = content.trimStart();
  if (!trimmed) return false;
  for (const name of names) {
    if (trimmed.startsWith(name) && /^[\s,，、:：]/.test(trimmed.slice(name.length, name.length + 1))) {
      return true;
    }
  }
  return false;
}

function buildNameAddressingDriftLine(messages: Message[]) {
  const recentAi = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.content.trim())
    .slice(-6);
  if (recentAi.length < 3) return '';
  const nameVariants = new Set<string>();
  for (const message of recentAi) {
    for (const variant of buildNameAddressVariants(message.senderName)) {
      nameVariants.add(variant);
    }
  }
  if (!nameVariants.size) return '';
  const addressOpeners = recentAi.filter((message) => startsWithVisibleNameAddress(message.content, nameVariants));
  if (addressOpeners.length < 3 || addressOpeners.length < Math.ceil(recentAi.length * 0.5)) return '';
  return '\n- Recent room replies are overusing visible name-addressing at the start. Do not open this turn with a participant name unless it is needed to grab attention, disambiguate threads, pressure someone, repair, hand off, or make a deliberate social move.';
}

function buildNaturalChatSurfaceContract(messages: Message[], surface: ResponseSurface, showRoleActions?: boolean) {
  if (surface.kind !== 'chat') return '';
  const recentAiLengths = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted)
    .slice(-6)
    .map((message) => getVisibleCharLength(message.content))
    .filter((length) => length > 0);
  const longCount = recentAiLengths.filter((length) => length >= 120).length;
  const longRunRisk = recentAiLengths.length >= 3 && longCount >= Math.ceil(recentAiLengths.length * 0.5);
  const lengthLine = longRunRisk
    ? `\n- Recent room replies are getting long (${recentAiLengths.join(' / ')} chars). It is natural for the next turn to cool back down with one concrete line.`
    : '';
  const nameAddressingLine = buildNameAddressingDriftLine(messages);
  const roleActionLine = showRoleActions
    ? '- Physical actions are usually omitted in ordinary group chat. If one truly changes meaning or social temperature, use at most one brief beat.'
    : '- Role actions are disabled here; keep the visible content as spoken chat.';
  return `\n## Natural Chat Surface Contract
- This contract controls surface shape only. It must not override a focused job, handoff, direct answer, or decision/recommendation required above.
- This is live chat, not an essay, speech, report, script page, or narrator prose.
- Reply to one live point instead of recapping the whole debate or making a personal manifesto.
- Heat may make a reply sharper or slightly longer, but it should not force every next speaker to write longer.${lengthLine}${nameAddressingLine}
${roleActionLine}
- Never use an action + speech + action + speech wrapper. Do not solve repetition by adding backstory, extra examples, or decorative actions.`;
}

function inferResponseSurfaceFromText(text: string, style: GroupChat['style']): { kind: ResponseSurfaceKind | null; basis: string[] } {
  const basis: string[] = [];
  void text;
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

function buildScenarioSurfaceBasis(chat: GroupChat) {
  return resolveResponseSurfaceBasis(chat);
}

function resolveScenarioSurfaceBasis(chat: GroupChat) {
  return buildScenarioSurfaceBasis(chat);
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

function resolveGenerationBasis(chat: GroupChat) {
  return resolveGenerationCompatibility(chat).basisTag;
}

function resolveGenerationSurfaceTag(chat: GroupChat) {
  return resolveGenerationBasis(chat);
}

function resolvePrimaryGenerationBasis(chat: GroupChat) {
  return resolveGenerationSurfaceTag(chat);
}

function resolveEngineBasis(chat: GroupChat) {
  return resolvePrimaryGenerationBasis(chat);
}

function resolveModeBasisRuntime(chat: GroupChat) {
  return resolveEngineBasis(chat);
}

function resolveSurfaceRuntimeBundle(chat: GroupChat) {
  return { basisTag: resolveModeBasisRuntime(chat) };
}

function resolveSurfaceRuntimeBasis(chat: GroupChat) {
  return resolveSurfaceRuntimeBundle(chat).basisTag;
}

function resolveScenarioDrivenBasis(chat: GroupChat) {
  return resolveSurfaceRuntimeBasis(chat);
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
      : inferred.kind && (!explicit || explicit === 'chat')
        ? inferred.kind
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
    return `\nResponse surface: live chat. Pick the natural size and shape from this moment; Markdown/newlines are allowed only when they genuinely help. Natural chat may be partial: the speaker can answer one piece, miss a term, shrug, ask what a word means, or pivot to a concrete nearby detail instead of completing a neat response chain.${roleFitHint}`;
  }
  if (surface.kind === 'creative') {
    return `\nResponse surface: creative form is available when the request calls for it. Choose the form from the actual task and character voice; avoid fixed templates or padding.${roleFitHint}`;
  }
  if (surface.kind === 'longform') {
    return `\nResponse surface: longform requested. Produce the deliverable in this speaker's voice; preserve real paragraph breaks as escaped \\n\\n in JSON content, and do not shrink it into banter.${roleFitHint}`;
  }
  return `\nResponse surface: professional form is available when useful. Choose concise, detailed, structured, or conversational shape from the actual request; avoid fixed templates or padding. Professional does not mean every AI-to-AI continuation needs a long paragraph.${roleFitHint}`;
}

function buildAnalysisRoomContractPrompt(chat: GroupChat) {
  if (resolveSessionFamilyKey(chat) !== 'analysis') return '';
  return `\n## Analysis Room Contract
- This room is a structured deliberation surface, not companionship chat and not roleplay closure.
- Visible content must do exactly one deliberative job: make a claim, test evidence, name an unresolved issue, give a counterexample, define a boundary, state a tradeoff, issue an interim verdict, synthesize the current state, or say plainly that no new deliberation point follows.
- Do not answer the latest metaphor with another metaphor. Do not praise wording, exchange farewells, promise future meetings, narrate objects, or continue emotional scenery unless that sentence is directly used to test the room's central claim.
- If the recent thread is only goodnight/closing/poetic echo, choose concise synthesis or a no-new-point statement. Do not add another closing image.
- If visible content adds durable deliberation material, deliberationArtifacts must extract that same material. If the visible content says no new point follows, deliberationArtifacts must be null.
- No-new-point is still a JSON response: return a short spoken content string and deliberationArtifacts=null. Never put protocol explanations, bracketed notes, or field names into visible content.
- Keep character voice as wording only. The role's job this turn is deliberation, not self-display.`;
}

function buildGenerationConstraints(chat: GroupChat, messages: Message[], speakerId: string, surface: ResponseSurface) {
  const recentLines = collectRecentConstraintLines(messages, speakerId);
  const forbiddenBlock = recentLines.length ? `\nForbidden semantic overlap:\n${recentLines.join('\n')}` : '';
  if (surface.kind !== 'chat') {
    return `\nHard constraints for this reply:
- Write one response turn only. No self-explanation about being an AI, no meta commentary about these instructions.
- Markdown is allowed when useful; do not wrap the whole answer in a code block unless the content itself is code.
- Stay in character and within the speaker's plausible ability; do not become a generic assistant.
- Do not repeat, paraphrase, summarize, or restate the same semantic point from the forbidden lines.${forbiddenBlock}`;
  }
  return `\nHard constraints for this reply:
- Write one response turn only. No self-explanation, no meta commentary.
- Do not repeat, paraphrase, summarize, or restate the same semantic point from the forbidden lines.
- Recent transcript is context, not a style template. Avoid copied openings, endings, emoji habits, or sentence shapes.
- Avoid generic assistant scaffolding unless the user asked for structured explanation.
- ${chat.type === 'group' && resolveSessionFamilyKey(chat) === 'conversation' ? 'Stay compact enough for ordinary group flow unless the current task clearly needs depth.' : 'Use the depth the moment needs: detailed asks deserve substance; casual banter should stay light.'}${forbiddenBlock}`;
}

function buildRuntimeRoleConstraintPrompt(runtimeBundle?: import('../types/sessionEngine').SessionGenerationRuntimeBundle | null) {
  const roleConstraint = runtimeBundle?.realizationPlan?.roleConstraint;
  const functionTag = runtimeBundle?.realizationPlan?.functionTag;
  const hotspotState = runtimeBundle?.trace?.hotspotState;
  const humanHint = runtimeBundle?.trace?.humanAppraisal?.hiddenHint;
  if (!roleConstraint && !functionTag && !hotspotState && !humanHint) return '';
  const lines = [] as string[];
  if (functionTag) lines.push(`- Primary function for this turn: ${functionTag}.`);
  if (roleConstraint === 'acknowledge_user_need_first') lines.push('- Acknowledge the user or addressed person before expanding the room topic.');
  else if (roleConstraint === 'add_one_new_dimension') lines.push('- Add one new dimension, tradeoff, evidence point, or framing shift instead of paraphrasing the same answer.');
  else if (roleConstraint === 'answer_before_expanding') lines.push('- Answer the concrete ask first, then expand only if there is real value.');
  else if (roleConstraint === 'close_the_loop') lines.push('- Prefer closure, synthesis, or a clean landing over opening fresh branches.');
  else if (roleConstraint === 'push_one_point_only') lines.push('- Push on one specific point instead of scattering multiple objections.');
  if (hotspotState === 'hot') lines.push('- You have occupied recent room airtime. Keep this turn compact unless the current request clearly needs detail.');
  else if (hotspotState === 'warm') lines.push('- You have spoken a lot recently. Avoid expanding just to stay visible.');
  if (humanHint) lines.push(`- ${humanHint}`);
  return lines.length ? `\n## Runtime Role Constraint\n${lines.join('\n')}` : '';
}

function buildStyleQuarantinePrompt(surface: ResponseSurface) {
  const surfaceLine = surface.kind === 'chat'
    ? '- In chat, continuity means following the social situation, not copying the room’s sentence architecture.'
    : '- In more serious discussion, continuity means advancing the argument, not inheriting the transcript’s rhetorical mold.';
  const dashLine = surface.kind === 'chat'
    ? '- Prefer sentence breaks, commas, or plain full stops over em dash as a default pause or turn hinge.'
    : '- Prefer ordinary punctuation over em dash unless the speaker or task naturally calls for it.';
  return `\n## Style Quarantine
- Recent messages are facts/positions/pressure, not writing samples.
- Keep the semantic thread but use your own opening, rhythm, sentence architecture, and ending.
- If your draft is just a name-swapped recent line, rewrite it before returning JSON.
${surfaceLine}
${dashLine}`;
}

function buildCurrentIntentPrompt(params: {
  directorIntent: DirectorIntent | null;
  intent: SpeakIntent;
}) {
  const stanceClarifier = params.intent.stance === 'support' || params.intent.stance === 'back_up'
    ? '\n- Support/backing is a social relation move, not automatic viewpoint agreement. You may protect someone, grant one point, add a condition, name a cost, or keep independent judgment.'
    : '';
  return `\nCurrent director intent:
- ${params.directorIntent ? describeDirectorIntent(params.directorIntent) : 'none'}
- Treat this as the current room pressure, not as a fixed plot script.

Current speaking intent:
- ${describeIntentForPrompt(params.intent)}
- Treat the intent shape as style guidance, not a hard length cap. Do not truncate a useful reply just to fit one sentence or a fragment shape.
- Decide the visible length yourself from the latest user request, the room context, and this character's actual ability. The local intent labels are not word-count rules.
- Stay socially situated and in character. A tiny reaction is valid when the moment is tiny; a practical explanation, tradeoff analysis, or step-by-step answer is valid when the user asks for it.
- Do not compress a direct request for detail, reasoning, implementation approach, examples, or tradeoffs into a one-line chat jab just because this is a chat surface.
- In AI-to-AI group flow, do not treat the latest line as homework. It is valid to take only the understandable part, challenge the premise, make a short aside, or let a different angle enter the room.${stanceClarifier}`;
}

function buildPrivateTurnPriorityPrompt(chat: GroupChat) {
  if (chat.type !== 'direct' && chat.type !== 'ai_direct') return '';
  const counterpartLine = chat.type === 'ai_direct'
    ? '- This is an AI private thread: respond to the counterpart as a situated private partner, not as a group performer.'
    : '- This is a user direct chat: answer or care for the user-facing need before drifting into ambient companionship.';
  return `\n## Private Turn Priority
${counterpartLine}
- If the current turn contains a concrete task, question, requested format, or requested deliverable, complete that job first in this character's voice.
- Relationship memory, warmth, teasing, protectiveness, or distance can change tone and omissions; it must not replace the current private-room job.
- If the moment is only companionship, keep it natural and relational instead of forcing a formal answer.`;
}

function buildVisibleMessageSurfaceContractPrompt(chat: GroupChat, showRoleActions?: boolean) {
  if (chat.sessionKind?.scenarioId === 'story-reader') return '';
  const analysisLine = resolveSessionFamilyKey(chat) === 'analysis'
    ? '\n- In analysis rooms, visible content must not enact a scene, close like a novel chapter, or continue decorative farewell staging. Move the issue forward, ask a focused question, name a boundary, or give a concise spoken pause.'
    : '';
  const roleActionLine = showRoleActions
    ? '- Brief role actions are only allowed if this room explicitly uses them and they are short, non-standalone, and not a narrator camera.'
    : '- Role actions are disabled here: do not include parenthesized actions, gesture beats, stage directions, or narrated camera movement.';
  return `\n## Visible Message Surface Contract
- The content field is one speaker's visible chat message, not a script page, transcript editor, or narrator prose.
${roleActionLine}
- Do not write another character's line inside this speaker's content. Use extraMessages only for later bubbles from the same speaker, never for another actor.
- If recent transcript contains stage directions or parenthesized scene beats, treat them as invalid old surface drift and do not continue that form.${analysisLine}`;
}

function buildNaturalChatRhythmPrompt(messages: Message[], innerLife: InnerLifeProjection, surface: ResponseSurface) {
  if (surface.kind !== 'chat') return '';
  void messages;
  const rhythm = innerLife.expressionPlan.messageCount > 1
    ? `- The inner rhythm can be ${innerLife.expressionPlan.messageCount} bubbles. Use extraMessages only if the thought really lands as separate sends; otherwise use one bubble.`
    : '- The inner rhythm favors one bubble, but that bubble may be very short, medium, or occasionally longer if the social move needs it.';
  return `\n## Natural Chat Rhythm
- Real chat is uneven; choose size from the moment, not a fixed template.
${rhythm}
- One bubble can contain multiple paragraphs when the speaker is making one continuous point.
- Multiple bubbles are for consecutive sends with separate social purposes: correction, afterthought, softened add-on, practical follow-up, or a second beat that would feel typed after pressing send.
- A live-chat turn does not always need a new argument or task result. Low-information social signals are valid when they change stance, consent, resistance, timing, face, attention, or emotional temperature.
- Do not use extraMessages for punctuation splitting, action/dialogue separation, another actor's line, or making a lecture longer.`;
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
  if (!clustered && !hotspotLine) return '';
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
    ? ['low-pressure tiny option', 'concise line if enough', 'substantive line if needed']
    : input.turnPlan.rhythm === 'multi_bubble'
      ? ['first bubble short, later bubble carries detail', 'two uneven chat bubbles', 'brief setup plus separate afterthought']
      : ['short sentence if enough', 'ordinary chat line', 'longer practical paragraph', 'brief side comment if enough', 'specific follow-up question'];
  const isAnalysisRoom = resolveSessionFamilyKey(input.chat) === 'analysis';
  const moveOptions = input.intent.stance === 'probe'
    ? ['ask one pointed follow-up', 'test a hidden assumption', 'ask for a concrete detail', 'turn the question back socially']
    : input.intent.stance === 'challenge' || input.intent.stance === 'pile_on'
      ? ['push back on one point', 'make a dry side comment', 'give a concrete counterexample', 'refuse the frame briefly']
      : input.intent.stance === 'support' || input.intent.stance === 'back_up'
        ? isAnalysisRoom
          ? ['answer warmly while separating person from claim', 'add a condition or limitation without turning cold', 'name the part that needs evidence', 'extend the topic with a distinct criterion']
          : ['protect the person without inheriting the claim', 'soften the room with a small practical offer', 'add a condition or cost that changes the next beat', 'shift from agreement into a distinct angle']
        : ['move the scene forward', 'answer the practical next step', 'make a small observation', 'ask one socially useful question'];
  const ornamentOptions = roomDecorativeCount >= Math.max(3, Math.ceil(recentAi.length * 0.45))
    ? ['plain text', 'plain text', 'one character-specific marker only if it adds new social meaning']
    : ['plain text', 'light punctuation', 'one character-specific marker if natural'];
  const selectedLength = lengthOptions[bucket % lengthOptions.length];
  const selectedMove = moveOptions[Math.floor(bucket / 7) % moveOptions.length];
  const selectedOrnament = ornamentOptions[Math.floor(bucket / 13) % ornamentOptions.length];
  const relationOptions = input.chat.type === 'group'
    ? ['answer only the part that caught this speaker', 'respond to the gist without proving full comprehension', 'let a nearby everyday angle enter', 'ask about one missing concrete condition', 'push one assumption instead of carrying the whole chain']
    : ['answer the current person directly', 'start with the practical answer before warmth', 'name the emotional point without overexplaining', 'ask one clarifying question only if needed', 'reply to the need rather than every phrase'];
  const personaLensOptions = ['ordinary life', 'taste or mood', 'relationship stance', 'practical habit', 'ignorance or uncertainty', 'domain expertise only if it is the natural lens'];
  const selectedRelation = relationOptions[Math.floor(bucket / 17) % relationOptions.length];
  const selectedPersonaLens = personaLensOptions[Math.floor(bucket / 19) % personaLensOptions.length];
  const ownLine = ownLengths.length ? `\n- Recent own lengths: ${ownLengths.join(' / ')} chars.` : '';
  const roomLine = roomLengths.length
    ? `\n- Recent room lengths: ${roomLengths.slice(-8).join(' / ')} chars; decorative-marker turns ${roomDecorativeCount}/${recentAi.length}.`
    : '';
  return `\n## Expression Surface Choice
- Surface prior: ${selectedMove}; weak length tendency: ${selectedLength}; ornamentation: ${selectedOrnament}.
- Relation to previous turn: ${selectedRelation}.
- Persona lens for this turn: ${selectedPersonaLens}.
- This is not output filtering. Keep valid Markdown, multiline content, media phrasing, or expressive markers when they genuinely fit.
- The length tendency is not a cap. Scene needs, user tasks, play-mode obligations, and role competence override it.
- A character profile is not a job interview. Background and expertise are available sources, not the required source of every example.
- Avoid defaulting every turn to setup + joke + explanation + marker or acknowledgement + full carry-forward. Believable replies can be blunt, unfinished, practical, curious, quiet, partially informed, or locally off-angle.${roomLine}${ownLine}`;
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
    const targetName = attention.targetId === 'user'
      ? '用户'
      : input.members.find((member) => member.id === attention.targetId)?.name || '相关成员';
    const pressure = attention.restraint >= 0.72
      ? '保持低压力，不要反复催促'
      : attention.attentionScore >= 0.68
        ? '可以在合适时自然接一下'
        : '只作为轻微背景';
    lines.push(`- Attention context: ${targetName} may need ${pressure}.`);
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
      text: 'Before expanding into analysis or room banter, include a concrete caring move toward the user (check-in / reassurance / gentle follow-up) if it fits. This shapes priority and tone, not response length.',
    });
  }
  if (attention && attention.restraint >= 0.72) {
    ruleEntries.push({
      id: 'low_pressure_restraint',
      text: 'Keep this turn low-pressure: avoid pushing new plans and repeated nudges. Low-pressure means optional and non-intrusive, not necessarily short; still answer substantive user requests completely.',
    });
  }
  const urgentEvent = upcomingCalendar.find((item) => typeof item.startAt === 'number' && (item.startAt as number) - now <= 6 * 60 * 60_000);
  if (urgentEvent) {
    ruleEntries.push({
      id: 'urgent_calendar_first',
      text: `You have an upcoming schedule (${urgentEvent.title}) within 6 hours. If context allows, give a clear reminder/confirmation before unrelated expansion. Do not let the reminder prevent a complete answer when the user asked for one.`,
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

function reconcileSelectedInnerLife(
  projection: InnerLifeProjection,
  speakerScore: SpeakerScoreBreakdown | null | undefined,
): InnerLifeProjection {
  if (projection.impulse !== 'stay_silent') return projection;
  if (!speakerScore) return projection;
  const floorGuardian = speakerScore.reasons.includes('guidance_floor_guardian');
  const reason = floorGuardian
    ? '调度最终选择本角色护住当前发言权，需要轻量维持场面而不是接管结论。'
    : '调度最终选择了本角色发言，需要用轻量方式接住当前话题。';
  return {
    ...projection,
    impulse: 'answer',
    tone: projection.tone,
    reason,
    pressure: Math.max(projection.pressure, 0.42),
    evidence: Array.from(new Set([...projection.evidence, floorGuardian ? '调度选择本轮护住发言权' : '调度选择本轮需要发言'])).slice(0, 5),
    state: {
      ...projection.state,
      lastImpulse: 'answer',
      lastImpulseReason: reason,
    },
    expressionPlan: {
      ...projection.expressionPlan,
      length: projection.expressionPlan.length === 'micro' ? 'micro' : 'short',
      messageCount: 1,
      allowWithdraw: false,
    },
  };
}

function reconcileSelectedSpeakerScore(
  speakerScore: SpeakerScoreBreakdown | null | undefined,
  innerLife: InnerLifeProjection,
): SpeakerScoreBreakdown | null | undefined {
  if (!speakerScore) return speakerScore;
  if (!speakerScore.reasons.includes('inner:stay_silent')) return speakerScore;
  if (innerLife.impulse === 'stay_silent') return speakerScore;
  const reasons = speakerScore.reasons
    .filter((reason) => reason !== 'inner:stay_silent')
    .concat('inner:answer_after_scheduler_selection');
  return {
    ...speakerScore,
    innerLifePressure: Math.max(speakerScore.innerLifePressure, 0.08),
    reasons: Array.from(new Set(reasons)),
  };
}

function resolveSelectedSpeakerScore(params: {
  candidateScore: SpeakerScoreBreakdown | null | undefined;
  speakerId: string;
  lockedGuidanceSpeakerId?: string | null;
}): SpeakerScoreBreakdown | null | undefined {
  const score = params.candidateScore;
  if (!score) return score;
  if (params.lockedGuidanceSpeakerId !== params.speakerId) return score;
  return {
    ...score,
    addressed: Math.max(score.addressed, 0.86),
    finalScore: Math.max(score.finalScore, 1.12),
    repetitionPenalty: 0,
    reasons: Array.from(new Set([
      'user_guidance_lock',
      ...score.reasons.filter((reason) => reason !== 'repetition_penalty'),
    ])),
  };
}

function getCharacterNameById(characters: AICharacter[], id: string) {
  return characters.find((character) => character.id === id)?.name || id;
}

function countPriorGuidanceReplies(messages: Message[], guidance: UserGuidanceIntent | null | undefined, speakerId: string) {
  if (!guidance) return 0;
  return messages.filter((message) => (
    message.type === 'ai'
    && !message.isDeleted
    && message.senderId === speakerId
    && message.metadata?.runtimeDecision?.directorIntent?.userGuidance?.rawText === guidance.rawText
  )).length;
}

function countPriorTargetGuidanceReplies(messages: Message[], guidance: UserGuidanceIntent | null | undefined) {
  if (!guidance?.actorIds.length) return 0;
  return messages.filter((message) => (
    message.type === 'ai'
    && !message.isDeleted
    && guidance.actorIds.includes(message.senderId)
    && message.metadata?.runtimeDecision?.directorIntent?.userGuidance?.rawText === guidance.rawText
  )).length;
}

type GuidanceFloorPhase =
  | 'none'
  | 'claim_floor'
  | 'continue_floor'
  | 'settle_or_release'
  | 'released_listener'
  | 'suppressed_wait';

interface GuidanceFloorState {
  phase: GuidanceFloorPhase;
  requestedActorNames: string[];
  suppressedActorNames: string[];
  deferredActorNames: string[];
  priorTargetTurns: number;
  minTargetTurns: number;
}

function resolveGuidanceFloorState(params: {
  guidance: UserGuidanceIntent | null | undefined;
  guidanceTimestamp?: number | null;
  messages: Message[];
  speaker: AICharacter;
  characters: AICharacter[];
}): GuidanceFloorState | null {
  const guidance = params.guidance;
  if (!guidance?.actorIds.length) return null;
  const requestedActorNames = guidance.actorIds.map((id) => getCharacterNameById(params.characters, id)).filter(Boolean);
  const suppressedActorNames = guidance.suppressedActorIds?.map((id) => getCharacterNameById(params.characters, id)).filter(Boolean) || [];
  const deferredActorNames = guidance.deferredActorIds?.map((id) => getCharacterNameById(params.characters, id)).filter(Boolean) || [];
  const minTargetTurns = Math.max(1, Math.round(guidance.minTargetTurns || 1));
  const since = typeof params.guidanceTimestamp === 'number' ? params.guidanceTimestamp : null;
  const progress = since === null
    ? null
    : collectGuidanceProgressAfterTimestamp(params.messages, since, guidance, params.characters);
  const priorTargetTurns = progress
    ? progress.matchedMessages.filter((message) => guidance.actorIds.includes(message.senderId)).length
    : countPriorTargetGuidanceReplies(params.messages, guidance);
  const isRequestedActor = guidance.actorIds.includes(params.speaker.id);
  const isSuppressedActor = Boolean(guidance.suppressedActorIds?.includes(params.speaker.id));
  if (isRequestedActor) {
    if (priorTargetTurns <= 0) {
      return { phase: 'claim_floor', requestedActorNames, suppressedActorNames, deferredActorNames, priorTargetTurns, minTargetTurns };
    }
    if (priorTargetTurns < minTargetTurns) {
      return { phase: 'continue_floor', requestedActorNames, suppressedActorNames, deferredActorNames, priorTargetTurns, minTargetTurns };
    }
    return { phase: 'settle_or_release', requestedActorNames, suppressedActorNames, deferredActorNames, priorTargetTurns, minTargetTurns };
  }
  if (isSuppressedActor && priorTargetTurns < minTargetTurns) {
    return { phase: 'suppressed_wait', requestedActorNames, suppressedActorNames, deferredActorNames, priorTargetTurns, minTargetTurns };
  }
  if (priorTargetTurns >= minTargetTurns) {
    return { phase: 'released_listener', requestedActorNames, suppressedActorNames, deferredActorNames, priorTargetTurns, minTargetTurns };
  }
  return null;
}

function buildGuidanceFloorPrompt(state: GuidanceFloorState | null | undefined) {
  if (!state || state.phase === 'none') return '';
  const requested = state.requestedActorNames.join('、') || 'the requested actor';
  const suppressed = state.suppressedActorNames.join('、');
  const suppressedLine = suppressed
    ? `\n- Someone was pushed out of the speaker role for this guidance: ${suppressed}. Treat that as a floor-control fact, not a reason to over-explain it.`
    : '';
  const deferred = state.deferredActorNames.join('、');
  const deferredLine = deferred
    ? `\n- Someone is temporarily deferred by this guidance: ${deferred}. This is not a ban; it means they should not be the first person to define, package, or redirect the requested actor's answer.`
    : '';
  const phaseLine: Record<GuidanceFloorPhase, string> = {
    none: '',
    claim_floor: `- Phase: claim the floor for ${requested}. Answer in this speaker's own stance before reacting to other room pressure.`,
    continue_floor: `- Phase: continue the same floor for ${requested}. Keep ownership of the answer, but natural live-chat turns may be low-information social signals when they still carry stance, timing, face, boundary, or emotional pressure.`,
    settle_or_release: `- Phase: settle or release the floor for ${requested}. A compact landing, partial concession, changed stance, unresolved feeling, or deliberate handoff is valid; do not manufacture a new thesis just to keep speaking.`,
    released_listener: `- Phase: the requested floor has had room to answer. You may now respond as a listener, supporter, challenger, or side voice. Prefer a narrow reaction, pressure check, question, floor-protection move, or room-temperature move; do not rewrite, package, decide, or conclude the requested actor's answer as if it belonged to you.`,
    suppressed_wait: `- Phase: wait outside the requested floor. If you speak, keep it brief and socially situated; do not answer, decide, or close the issue for ${requested}.`,
  };
  return `\n## Room Floor State
${phaseLine[state.phase]}
- Prior matched target turns in this guidance window: ${state.priorTargetTurns}/${state.minTargetTurns}.
- Floor control chooses who owns the moment; it must not make the visible line stiff, formal, or mechanically purposeful.
- Some real chat turns mainly change social temperature, attention, consent, resistance, or timing. Those are valid when they fit the room and do not dodge a direct user task.${suppressedLine}${deferredLine}`;
}

function buildUserGuidancePrompt(guidance: UserGuidanceIntent | null | undefined, speaker: AICharacter, characters: AICharacter[], capabilities: { image: boolean; audio: boolean }, priorGuidanceReplies = 0) {
  if (!guidance) return '';
  const requestedActors = guidance.actorIds.map((id) => getCharacterNameById(characters, id));
  const isRequestedActor = guidance.actorIds.length ? guidance.actorIds.includes(speaker.id) : guidance.mentionedActorIds.includes(speaker.id);
  const subjectNames = guidance.mediaRequest?.subjectActorIds.map((id) => getCharacterNameById(characters, id)) || [];
  const mediaLine = guidance.mediaRequest
    ? `\n- Media request: the user is asking for an image. Subject: ${subjectNames.length ? subjectNames.join('、') : guidance.mediaRequest.subjectText}. Requested visual action: ${guidance.mediaRequest.actionText}.${capabilities.image ? '\n- You have image-generation capability in this turn. If you are the requested actor, set mediaDecision.image.shouldGenerate=true and create a concrete prompt for the requested image. Your visible message should sound like you are sending or presenting that image now, not like you are merely discussing the idea.\n- This request is not optional. Do not answer with ordinary banter before the image decision. The first semantic move must complete the requested image action.' : '\n- You do not have image-generation capability in this turn. If you are the requested actor, say in character that you cannot send/generate the image now instead of pretending an image was sent.'}`
    : '';
  const voiceLine = guidance.voiceRequest
    ? `\n- Voice request: the user explicitly wants to hear this reply as audio. If TTS capability is available, set mediaDecision.audio.shouldGenerate=true and make audio.text the exact spoken content. Keep this as a voice-first reply rather than merely discussing the request.`
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
  const constraintLine = guidance.hasHardConstraints
    ? `\n- Constraint guidance: the user gave a live constraint or boundary. Keep it active in the next room move, especially for named people, budget, limits, exclusions, priority, or “do not ignore” wording. Do not treat it as background trivia.${guidance.hardConstraintActorIds?.length ? ` Constraint anchor(s): ${guidance.hardConstraintActorIds.map((id) => getCharacterNameById(characters, id)).join('、')}.` : ''}\n- A constraint anchor is not automatically the required next speaker. Other characters may speak if they actively protect, apply, or ask about that constraint instead of ignoring it.`
    : '';
  const suppressedNames = guidance.suppressedActorIds?.map((id) => getCharacterNameById(characters, id)).filter(Boolean) || [];
  const deferredNames = guidance.deferredActorIds?.map((id) => getCharacterNameById(characters, id)).filter(Boolean) || [];
  const suppressionLine = suppressedNames.length
    ? `\n- Speaker suppression: the user just pushed back against ${suppressedNames.join('、')} taking over or speaking for someone else. During this guidance window, ${suppressedNames.join('、')} should not regain control of the thread unless the user explicitly redirects to them or no other character can speak.\n- Correction handling: if you are the requested actor, answer in your own voice and keep ownership of the point. Do not repeat the same plan in different words. If you are not the requested actor, only speak if you can briefly protect the requested actor's floor or ask a necessary clarification; do not summarize their answer as if closing the topic.`
    : '';
  const continuationLine = guidance.actorIds.includes(speaker.id) && priorGuidanceReplies > 0
    ? `\n- Continuation handling: you have already answered this user guidance ${priorGuidanceReplies} time(s). Do not restate the same reason, metaphor, or conclusion. The next live-chat move may add substance, settle, concede, resist, pause socially, or release the floor. Choose the human-sized move that fits the room; do not manufacture a new thesis just to be useful.`
    : '';
  const deferredLine = deferredNames.length
    ? `\n- Deferred speaker guidance: ${deferredNames.join('、')} was mentioned as someone whose framing should not lead this guidance. This is not permanent suppression, but their view should not define, package, or redirect the requested actor's answer before the floor is clearly released.`
    : '';
  return `\n## User Guidance Override
- Latest user guidance: ${guidance.rawText}
- Function: ${guidance.kind}.${actorLine}${mediaLine}${voiceLine}${topicLine}${directLine}${constraintLine}${suppressionLine}${deferredLine}${continuationLine}
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
  const topicRetry = params.guidance.kind === 'topic_shift'
    ? '\n- The user changed the topic. Your next JSON content must directly take a stance, answer, or ask a focused question about that topic before any old banter.'
    : params.guidance.kind === 'direct_reply'
      ? '\n- The user asked for a direct reply. Your next JSON content must answer the requested point first.'
      : '';
  const suppressionRetry = params.guidance.suppressedActorIds?.length && !params.guidance.actorIds.includes(params.speaker.id)
    ? `\n- You are not the requested actor. Do not answer or decide for the requested actor. Return only one short handoff sentence that names ${requestedActors.join('、') || 'the requested actor'} and gives the floor back. No plan, no summary, no "I will handle it".`
    : '';
  return `${params.systemPrompt}

Guidance retry:
- The previous draft drifted away from the latest human guidance and must be discarded.
- Latest human guidance: ${params.guidance.rawText}${topicRetry}${suppressionRetry}
- Do not continue this failed draft: ${params.previousDraft.slice(0, 160)}
- Return a fresh valid JSON object only.`;
}

function mergeGuidanceMediaDecision(params: {
  decision: MediaGenerationDecision | null | undefined;
  mediaCapabilities?: { image: boolean; audio: boolean };
}): MediaGenerationDecision | null | undefined {
  const supportedDecision: MediaGenerationDecision | null | undefined = params.decision ? {
    ...params.decision,
    images: params.mediaCapabilities?.image === false ? undefined : params.decision.images,
    image: params.mediaCapabilities?.image === false ? undefined : params.decision.image,
    audio: params.mediaCapabilities?.audio === false ? undefined : params.decision.audio,
  } : params.decision;
  const hasSupportedDecision = Boolean(
    supportedDecision?.images?.some((image) => image.shouldGenerate)
    || supportedDecision?.image?.shouldGenerate
    || supportedDecision?.audio?.shouldGenerate,
  );
  return hasSupportedDecision ? supportedDecision : undefined;
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
      advancedOptions: matched.advancedOptions,
    } satisfies APIConfig;
  }
  return apiConfig as APIConfig;
}

function resolveProfileForCharacter(character: AICharacter, profiles: AIModelProfile[] | undefined, type: 'image' | 'audio') {
  if (!profiles?.length) return null;
  const profileId = type === 'audio'
    ? character.modelProfileIds?.tts || getCharacterModelProfileId(character, type)
    : getCharacterModelProfileId(character, type);
  const matched = profileId
    ? profiles.find((profile) => profile.id === profileId && (profile.type === type || (type === 'audio' && profile.type === 'tts')))
    : (type === 'audio' ? profiles.find((profile) => profile.type === 'tts' && profile.isDefault) : null)
      || profiles.find((profile) => profile.type === type && profile.isDefault)
      || (type === 'audio' ? profiles.find((profile) => profile.type === 'tts') : null)
      || profiles.find((profile) => profile.type === type)
      || null;
  return isAIProfileUsable(matched) ? matched : null;
}

function buildMediaCapabilities(chat: GroupChat | AICharacter, character: AICharacter | AIModelProfile[], profiles?: AIModelProfile[]) {
  // Keep the small public test helper backwards-compatible with the pre-chat
  // signature while runtime callers continue to pass the conversation first.
  const resolvedChat = ('type' in chat ? chat : null) as GroupChat | null;
  const resolvedCharacter = ('id' in chat && !('type' in chat) ? chat : character) as AICharacter;
  const resolvedProfiles = Array.isArray(character) ? character : profiles;
  const imageProfile = resolveProfileForCharacter(resolvedCharacter, resolvedProfiles, 'image');
  const audioProfile = resolveProfileForCharacter(resolvedCharacter, resolvedProfiles, 'audio');
  return {
    image: Boolean(imageProfile),
    // Learning listening material may use the configured TTS default even when
    // the teacher character has no personal voice assignment.
    audio: Boolean(audioProfile),
    sticker: Boolean(useAuthStore.getState().authMode === 'cloud'
      && useAuthStore.getState().user?.alapiDoutuEnabled === true
      && useSettingsStore.getState().enableChatStickers
      && resolvedChat
      && canUseStickerCapability(resolvedChat)),
  };
}

function resolveMediaProfiles(apiConfig: APIConfig | AIModelProfile[], profiles?: AIModelProfile[]) {
  if (Array.isArray(apiConfig)) return apiConfig;
  return profiles?.length ? profiles : undefined;
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

function normalizeMediaDecision(decision: MediaGenerationDecision | null | undefined, capabilities: { image: boolean; audio: boolean; sticker?: boolean }, content: string) {
  const normalized: MediaGenerationDecision = {};
  const requestedImages = Array.isArray(decision?.images) ? decision.images : decision?.image ? [decision.image] : [];
  const images = capabilities.image ? requestedImages
    .filter((image) => image?.shouldGenerate)
    .slice(0, 9)
    .map((image) => ({
      shouldGenerate: true,
      reason: image.reason || '',
      prompt: image.prompt || content,
      altText: image.altText || content.slice(0, 80) || 'AI 生成图片',
      aspectRatio: image.aspectRatio,
      imageSize: image.imageSize,
      referenceCharacterIds: image.referenceCharacterIds?.filter(Boolean),
      targetImageIds: image.targetImageIds?.filter(Boolean),
      referenceImageIds: image.referenceImageIds?.filter(Boolean),
      styleImageIds: image.styleImageIds?.filter(Boolean),
    })) : [];
  if (images.length) {
    normalized.images = images;
    normalized.image = images[0];
  }
  if (capabilities.audio && decision?.audio?.shouldGenerate) {
    normalized.audio = {
      shouldGenerate: true,
      reason: decision.audio.reason || '',
      text: decision.audio.text || content,
      voiceProfileId: decision.audio.voiceProfileId || undefined,
      audioPurpose: decision.audio.audioPurpose === 'listening_exercise' ? 'listening_exercise' : 'chat_voice',
      transcriptVisibility: decision.audio.transcriptVisibility === 'hidden'
        ? 'hidden'
        : decision.audio.transcriptVisibility === 'visible' ? 'visible' : 'default',
      voice: decision.audio.voice || undefined,
      language: decision.audio.language || undefined,
      speed: typeof decision.audio.speed === 'number' && Number.isFinite(decision.audio.speed) ? decision.audio.speed : undefined,
      pitch: typeof decision.audio.pitch === 'number' && Number.isFinite(decision.audio.pitch) ? decision.audio.pitch : undefined,
      style: decision.audio.style || undefined,
    };
  }
  if (capabilities.sticker && decision?.sticker?.shouldSend) {
    normalized.sticker = { shouldSend: true, keyword: decision.sticker.keyword || content, altText: decision.sticker.altText || '表情包' };
  }
  return normalized.images?.length || normalized.audio || normalized.sticker ? normalized : null;
}

function latestUserReferenceImages(messages: Message[]) {
  const latest = [...messages]
    .reverse()
    .find((message) => (
      !message.isDeleted
      && isHumanDirectedMessage(message)
      && message.metadata?.attachments?.some((attachment) => attachment.kind === 'image' && attachment.status === 'ready' && Boolean(attachment.url))
    ));
  return (latest?.metadata?.attachments || [])
    .filter((attachment) => attachment.kind === 'image' && attachment.status === 'ready' && Boolean(attachment.url))
    .map((attachment) => ({
      url: attachment.url as string,
      mimeType: attachment.mimeType,
      label: attachment.caption || attachment.altText || '用户参考图',
    }))
    .slice(0, 9);
}

function imageReferenceMap(messages: Message[]) {
  const refs = new Map<string, { url: string; mimeType?: string; label?: string }>();
  for (const message of messages) {
    if (message.isDeleted) continue;
    for (const attachment of message.metadata?.attachments || []) {
      if (attachment.kind !== 'image' || attachment.status !== 'ready' || !attachment.url) continue;
      const value = {
        url: attachment.url,
        mimeType: attachment.mimeType,
        label: attachment.caption || attachment.altText || '参考图',
      };
      refs.set(`${message.id}:${attachment.id}`, value);
      refs.set(attachment.id, value);
    }
  }
  return refs;
}

function selectedDecisionReferenceImages(decision: MediaGenerationDecision['image'], messages: Message[]) {
  const selectedIds = Array.from(new Set([
    ...(decision?.targetImageIds || []),
    ...(decision?.referenceImageIds || []),
    ...(decision?.styleImageIds || []),
  ].filter(Boolean))).slice(0, 9);
  if (!selectedIds.length) return [];
  const refs = imageReferenceMap(messages);
  return selectedIds.flatMap((id) => {
    const ref = refs.get(id);
    return ref ? [ref] : [];
  });
}

function buildMessageMetadata(params: {
  decision: MediaGenerationDecision | null | undefined;
  capabilities: { image: boolean; audio: boolean; sticker?: boolean };
  content: string;
  activeMessages?: Message[];
  runtimeDecision?: MessageMetadata['runtimeDecision'];
  deliberationArtifacts?: MessageMetadata['deliberationArtifacts'] | null;
  presenceUpdate?: MessageMetadata['presenceUpdate'] | null;
  storyEvents?: MessageMetadata['storyEvents'] | null;
  storyEventsNormalized?: boolean;
  storyQuality?: MessageMetadata['storyQuality'] | null;
  narrativeTurn?: MessageMetadata['narrativeTurn'] | null;
  storyChoices?: MessageMetadata['storyChoices'] | null;
  surface?: ResponseSurface;
  now?: number;
}): MessageMetadata | undefined {
  const decision = normalizeMediaDecision(params.decision, params.capabilities, params.content);
  const storyChoices = normalizeStoryChoiceSuggestions(params.storyChoices);
  const storyEvents = params.storyEventsNormalized ? (params.storyEvents || []) : [];
  const storyQuality = params.storyQuality || null;
  if (!decision && !params.runtimeDecision && !params.deliberationArtifacts && !params.presenceUpdate && !params.narrativeTurn && !storyChoices?.length && !storyEvents.length) return undefined;
  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? Math.round(params.now) : Date.now();
  const contextText = params.narrativeTurn?.blocks.map((block) => block.text).filter(Boolean).join('\n\n') || params.content;
  const attachments: MessageAttachment[] = [];
  const imageDecisions = decision?.images?.length ? decision.images : decision?.image ? [decision.image] : [];
  for (const imageDecision of imageDecisions) {
    if (!imageDecision?.shouldGenerate || !imageDecision.prompt || !imageDecision.altText) continue;
    const selectedReferenceImages = selectedDecisionReferenceImages(imageDecision, params.activeMessages || []);
    const referenceImages = selectedReferenceImages.length ? selectedReferenceImages : latestUserReferenceImages(params.activeMessages || []);
    const imageSeedParts = [
      imageDecision.prompt,
      imageDecision.altText,
      (imageDecision.referenceCharacterIds || []).join(','),
      referenceImages.map((image) => image.url).join(','),
      params.content,
    ];
    attachments.push({
      id: createAttachmentId('image', now, imageSeedParts),
      kind: 'image',
      status: 'queued',
      altText: imageDecision.altText,
      promptText: enhanceImagePrompt(imageDecision.prompt, { subject: imageDecision.altText, caption: imageDecision.altText }),
      aspectRatio: imageDecision.aspectRatio,
      imageSize: imageDecision.imageSize,
      targetImageIds: imageDecision.targetImageIds?.filter(Boolean),
      referenceImageIds: imageDecision.referenceImageIds?.filter(Boolean),
      styleImageIds: imageDecision.styleImageIds?.filter(Boolean),
      referenceCharacterIds: imageDecision.referenceCharacterIds?.filter(Boolean),
      referenceImages: referenceImages.length ? referenceImages : undefined,
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
      audioPurpose: decision.audio.audioPurpose || 'chat_voice',
      transcriptVisibility: decision.audio.transcriptVisibility || 'default',
      ttsVoice: decision.audio.voice,
      ttsLanguage: decision.audio.language,
      ttsSpeed: decision.audio.speed,
      ttsPitch: decision.audio.pitch,
      ttsStyle: decision.audio.style,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (decision?.sticker?.shouldSend) {
    const keyword = decision.sticker.keyword || params.content;
    attachments.push({
      id: createAttachmentId('sticker', now, [keyword, params.content]), kind: 'sticker', status: 'queued',
      altText: decision.sticker.altText || '表情包', promptText: keyword, createdAt: now, updatedAt: now,
    });
  }
  return {
    format: params.surface?.allowMarkdown ? 'markdown' : 'plain',
    contextText,
    storyEvents: storyEvents.length ? storyEvents : undefined,
    storyQuality: storyQuality || undefined,
    narrativeTurn: params.narrativeTurn || undefined,
    storyChoices: storyChoices || undefined,
    attachments,
    ...(decision ? {
      generationDecision: decision,
      generation: { status: 'queued' as const, updatedAt: now },
    } : {}),
    ...(params.runtimeDecision ? { runtimeDecision: params.runtimeDecision } : {}),
    ...(params.deliberationArtifacts ? { deliberationArtifacts: params.deliberationArtifacts } : {}),
    ...(params.presenceUpdate ? { presenceUpdate: params.presenceUpdate } : {}),
  };
}

function buildRuntimeDecisionMetadata(params: {
  directorIntent?: DirectorIntent | null;
  narrativeLines?: NarrativeLineProjection[];
  speakerSelection?: SpeakerSelectionState;
  speakerScore?: SpeakerScoreBreakdown | null;
  innerLife?: InnerLifeProjection | null;
  surface?: ResponseSurface | null;
  turnPlan?: TurnPlan | null;
  personaActivation?: PersonaActivation | null;
  intentionalRepeat?: boolean;
  memoryTrace?: PromptMemoryTrace | null;
  characterMindTrace?: PromptCharacterMindTrace | null;
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
  if (!params.directorIntent && !params.narrativeLines?.length && !params.speakerSelection && !params.speakerScore && !params.innerLife && !params.surface && !params.turnPlan && !params.personaActivation && !params.intentionalRepeat && !memoryContext && !params.characterMindTrace && !params.companionshipTrace && !params.expressionFeedback?.length && !params.guidanceExecution && !params.worldInfluence?.activeRuleIds?.length && !params.runtimeBundle?.turnPlan && !params.runtimeBundle?.expressionPlan && !params.runtimeBundle?.trace) return undefined;
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
        hardConstraintActorIds: params.directorIntent.userGuidance.hardConstraintActorIds,
        suppressedActorIds: params.directorIntent.userGuidance.suppressedActorIds,
        hasHardConstraints: params.directorIntent.userGuidance.hasHardConstraints,
        focusText: params.directorIntent.userGuidance.focusText,
        beatType: params.directorIntent.userGuidance.beatType,
        pressure: Number(params.directorIntent.userGuidance.pressure.toFixed(3)),
        maxTurns: params.directorIntent.userGuidance.maxTurns,
        minTargetTurns: params.directorIntent.userGuidance.minTargetTurns,
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
    characterMind: params.characterMindTrace ? {
      visibility: params.characterMindTrace.visibility,
      visibleMemoryRecall: params.characterMindTrace.visibleMemoryRecall,
      memorySource: params.characterMindTrace.memorySource,
      targetActorId: params.characterMindTrace.targetActorId,
      targetActorName: params.characterMindTrace.targetActorName,
      omittedPrivateContinuity: params.characterMindTrace.omittedPrivateContinuity || undefined,
      omittedRawRoomLines: params.characterMindTrace.omittedRawRoomLines || undefined,
      coreLineCount: params.characterMindTrace.coreLineCount,
      roomLineCount: params.characterMindTrace.roomLineCount,
      recallCueCount: params.characterMindTrace.recallCueCount,
      hasUserContinuity: params.characterMindTrace.hasUserContinuity || undefined,
      hasRelationshipContinuity: params.characterMindTrace.hasRelationshipContinuity || undefined,
      hasSharedHistory: params.characterMindTrace.hasSharedHistory || undefined,
      hasWorldContext: params.characterMindTrace.hasWorldContext || undefined,
    } : undefined,
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

function hasDeliberationArtifactContent(artifacts: MessageMetadata['deliberationArtifacts'] | null | undefined) {
  if (!artifacts) return false;
  return Boolean(
    artifacts.claims?.length
    || artifacts.evidence?.length
    || artifacts.issues?.length
    || artifacts.verdicts?.length
    || artifacts.summary?.text?.trim(),
  );
}

function countDeliberationArtifacts(artifacts: MessageMetadata['deliberationArtifacts'] | null | undefined) {
  return {
    claims: artifacts?.claims?.length || 0,
    evidence: artifacts?.evidence?.length || 0,
    issues: artifacts?.issues?.length || 0,
    verdicts: artifacts?.verdicts?.length || 0,
    summaries: artifacts?.summary?.text?.trim() ? 1 : 0,
  };
}

function isMoveExpectedToProduceDeliberationArtifacts(moveType: string | undefined) {
  return Boolean(moveType && [
    'add_boundary_condition',
    'answer_unresolved_question',
    'synthesize',
    'test_assumption',
    'counterexample',
    'separate_claims',
    'ask_evidence',
    'name_tradeoff',
  ].includes(moveType));
}

function buildDeliberationArtifactTrace(params: {
  chat: GroupChat;
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope> | null;
  conversationMovePlan: ReturnType<typeof planConversationMove>;
}) {
  if (resolveSessionFamilyKey(params.chat) !== 'analysis') return null;
  const artifacts = params.parsedEnvelope?.deliberationArtifacts || null;
  const present = hasDeliberationArtifactContent(artifacts);
  const expectedByMove = isMoveExpectedToProduceDeliberationArtifacts(params.conversationMovePlan.moveType);
  const policyHits = [
    present ? 'deliberation_artifacts:present' : 'deliberation_artifacts:absent',
    params.parsedEnvelope ? 'deliberation_artifacts:json_envelope_parsed' : 'deliberation_artifacts:no_json_envelope',
    expectedByMove ? `deliberation_artifacts:expected_by_move:${params.conversationMovePlan.moveType}` : `deliberation_artifacts:not_expected_by_move:${params.conversationMovePlan.moveType}`,
  ];
  const guidanceValidation = [
    `deliberationArtifacts=${present ? 'present' : 'absent'}`,
    `expectedByMove=${expectedByMove ? 'yes' : 'no'}`,
    `move=${params.conversationMovePlan.moveType}`,
  ].join(';');
  return {
    present,
    expectedByMove,
    policyHits,
    guidanceValidation,
    reason: present
      ? 'model_returned_deliberation_artifacts'
      : expectedByMove
        ? 'model_omitted_deliberation_artifacts_for_deliberative_move'
        : 'model_omitted_deliberation_artifacts_for_nonartifact_move',
  };
}

function contentExplicitlySignalsAway(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return /(?:^|[。！？!?，,\s])(我|俺|大妈|大姐|这边|我这边|这回|这就|我先|先|我真|真|真的).{0,12}(走了|撤了|下线|关机|睡了|睡觉|去睡|去忙|忙去了|去收租|收租去了|赶车|赶公交|去开会|去洗澡|离开|不回了|挂了|先到这|先这样|回头聊)(?:$|[。！？!?，,\s])/.test(normalized)
    || /(晚安|明天见|回头见|包子铺见).{0,16}(我|俺|大妈|大姐)?.{0,8}(走了|撤了|睡了|下线|关机|挂了)/.test(normalized);
}

function appendRuntimeTraceDiagnostics(
  runtimeBundle: SessionGenerationRuntimeBundle,
  diagnostics: ReturnType<typeof buildDeliberationArtifactTrace>,
): SessionGenerationRuntimeBundle {
  if (!diagnostics) return runtimeBundle;
  return {
    ...runtimeBundle,
    trace: {
      ...(runtimeBundle.trace || {}),
      policyHits: [
        ...(runtimeBundle.trace?.policyHits || []),
        ...diagnostics.policyHits,
      ],
      guidanceValidation: [
        runtimeBundle.trace?.guidanceValidation || '',
        diagnostics.guidanceValidation,
      ].filter(Boolean).join(' | ') || null,
    },
  };
}

function parseRawInlineEnvelopeObject(raw: string): Record<string, unknown> | null {
  try {
    const jsonMatch = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeWebSearchToolRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== 'web_search') return null;
  const query = typeof raw.query === 'string' ? raw.query.trim().slice(0, 300) : '';
  if (!query) return null;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 240) : '';
  return {
    type: 'web_search' as const,
    query,
    reason: reason || null,
  };
}

function formatWebSearchResult(item: AiSearchResultItem, index: number) {
  const body = item.summary || item.snippet || '';
  const source = [item.siteName, item.publishedAt].filter(Boolean).join(' / ');
  return [
    `${index + 1}. ${item.title}`,
    `URL: ${item.url}`,
    source ? `Source: ${source}` : '',
    body ? `Excerpt: ${body}` : '',
  ].filter(Boolean).join('\n');
}

function buildWebSearchResultPromptBlock(params: {
  query: string;
  providerCode: string;
  pointCost: number;
  results: AiSearchResultItem[];
}) {
  return [
    '## Web Search Result',
    `Query: ${params.query}`,
    `Provider: ${params.providerCode}; charged ${params.pointCost} AI points.`,
    'Use these live search results only when relevant. Do not invent citations or claim unsupported facts. Prefer concise synthesis over listing every result.',
    params.results.map(formatWebSearchResult).join('\n\n') || 'No usable result items were returned.',
  ].join('\n');
}

function getLatestHumanTurnId(messages: Message[]) {
  return [...messages]
    .reverse()
    .find((message) => !message.isDeleted && isHumanDirectedMessage(message) && message.content.trim())
    ?.id || 'no-human-turn';
}

function getWebSearchTurnCacheKey(chatId: string, latestHumanTurnId: string, query: string) {
  return `${chatId}:${latestHumanTurnId}:${query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 300)}`;
}

function getCachedWebSearchPromptBlock(cacheKey: string) {
  const cached = webSearchTurnCache.get(cacheKey);
  if (!cached) return '';
  if (cached.expiresAt <= Date.now()) {
    webSearchTurnCache.delete(cacheKey);
    return '';
  }
  return cached.promptBlock;
}

function setCachedWebSearchPromptBlock(cacheKey: string, query: string, promptBlock: string) {
  webSearchTurnCache.set(cacheKey, {
    query,
    promptBlock,
    expiresAt: Date.now() + WEB_SEARCH_TURN_CACHE_TTL_MS,
  });
  if (webSearchTurnCache.size > 80) {
    const now = Date.now();
    for (const [key, value] of webSearchTurnCache) {
      if (value.expiresAt <= now || webSearchTurnCache.size > 60) webSearchTurnCache.delete(key);
    }
  }
}

function countRawHintItems(value: unknown) {
  if (Array.isArray(value)) return value.length;
  return value && typeof value === 'object' ? 1 : 0;
}

function buildStructuredOutputProtocolTrace(params: {
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope>;
  rawResponse: string;
  userGuidance?: UserGuidanceIntent | null;
}) {
  const rawObject = parseRawInlineEnvelopeObject(params.rawResponse);
  const socialHints = normalizeSocialEventHints(params.parsedEnvelope?.socialEventHints || null);
  const interactionHints = normalizeInteractionHintCollection(params.parsedEnvelope?.interactionHints || null, 'protocol-check', params.rawResponse);
  const rawSocialHintCount = countRawHintItems(rawObject?.socialEventHints);
  const rawInteractionHintCount = params.parsedEnvelope?.interactionHints
    ? countRawHintItems(params.parsedEnvelope.interactionHints.primary) + countRawHintItems(params.parsedEnvelope.interactionHints.secondary)
    : countRawHintItems(rawObject?.interactionHints);
  const hasSocialOuting = socialHints.some((hint) => hint.eventKind === 'social_outing');
  const policyHits = [
    params.parsedEnvelope ? 'structured_output:json_envelope_parsed' : 'structured_output:no_json_envelope',
    `structured_output:social_event_hints:${socialHints.length}`,
    `structured_output:interaction_hints:${interactionHints.length}`,
    rawSocialHintCount > socialHints.length ? `structured_output:social_event_hints_dropped:${rawSocialHintCount - socialHints.length}` : '',
    rawInteractionHintCount > interactionHints.length ? `structured_output:interaction_hints_dropped:${rawInteractionHintCount - interactionHints.length}` : '',
    params.userGuidance?.beatType === 'invite' && !hasSocialOuting ? 'structured_output:invite_guidance_without_social_outing' : '',
  ].filter(Boolean) as string[];
  const guidanceValidation = [
    `jsonEnvelope=${params.parsedEnvelope ? 'parsed' : rawObject ? 'invalid_visible_contract' : 'missing'}`,
    `socialEventHints=${socialHints.length}`,
    `interactionHints=${interactionHints.length}`,
    rawSocialHintCount > socialHints.length ? `droppedSocialEventHints=${rawSocialHintCount - socialHints.length}` : '',
    rawInteractionHintCount > interactionHints.length ? `droppedInteractionHints=${rawInteractionHintCount - interactionHints.length}` : '',
    params.userGuidance?.beatType === 'invite' && !hasSocialOuting ? 'inviteGuidanceSocialOuting=missing' : '',
  ].filter(Boolean).join(';');
  return {
    policyHits,
    guidanceValidation,
  };
}

function appendStructuredOutputProtocolTrace(
  runtimeBundle: SessionGenerationRuntimeBundle,
  trace: ReturnType<typeof buildStructuredOutputProtocolTrace>,
): SessionGenerationRuntimeBundle {
  return {
    ...runtimeBundle,
    trace: {
      ...(runtimeBundle.trace || {}),
      policyHits: [
        ...(runtimeBundle.trace?.policyHits || []),
        ...trace.policyHits,
      ],
      guidanceValidation: [
        runtimeBundle.trace?.guidanceValidation || '',
        trace.guidanceValidation,
      ].filter(Boolean).join(' | ') || null,
    },
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

function isDeepSeekLikeConfig(config: Pick<APIConfig, 'provider' | 'model'>) {
  return config.provider === 'deepseek'
    || config.provider === 'official-deepseek'
    || /deepseek/i.test(config.model || '');
}

function shouldUseJsonResponseFormat(chat: Pick<GroupChat, 'mode' | 'sessionKind'>, config: Pick<APIConfig, 'provider' | 'model'>) {
  if (isDeepSeekLikeConfig(config)) return false;
  void chat;
  return true;
}

function shouldAddJsonProtocolReminder(chat: Pick<GroupChat, 'mode' | 'sessionKind'>, config: Pick<APIConfig, 'provider' | 'model'>) {
  void chat;
  return isDeepSeekLikeConfig(config);
}

function buildJsonProtocolReminder(chat: Pick<GroupChat, 'mode' | 'sessionKind'>): ReturnType<typeof buildChatMessages>[number] {
  const isAnalysisRoom = resolveSessionFamilyKey(chat) === 'analysis';
  return {
    role: 'user',
    content: isAnalysisRoom
      ? '格式校验：只返回一个可解析 JSON 对象，不要直接输出聊天正文。JSON 必须包含 content 字符串；如果本轮提出了观点、证据、问题、裁决或小结，必须在 deliberationArtifacts 中写入对应数组。'
      : '格式校验：只返回一个可解析 JSON 对象，不要直接输出正文。JSON 必须遵守本轮输出协议；如果需要连续发送多条文字、图片或语音消息，使用 messages 数组，每项包含 content 和自己的 mediaDecision，语音项必须独立成条。角色具备的图片/语音能力应通过结构化字段提交，不要声称无法发送，也不要把协议说明写进可见正文。',
  };
}

async function generateWithPrompt(params: {
  chat: GroupChat;
  resolvedApi: APIConfig;
  systemPrompt: string;
  chatMessages: ReturnType<typeof buildChatMessages>;
  speaker: AICharacter;
  characters: AICharacter[];
  intent: ReturnType<typeof deriveSpeakIntentFromContext>;
  attempt: number;
  activeMessages: Message[];
  showRoleActions?: boolean;
  surface?: ResponseSurface;
  turnPlan?: TurnPlan | null;
  onChunk?: (content: string) => void;
  signal?: AbortSignal;
}) {
  const streamBridge = createStreamingDisplayBridge(params.speaker, params.showRoleActions, params.onChunk);
  const jsonPrompt = `${params.systemPrompt}\n\nThe response must be exactly one valid JSON object. Do not wrap it in markdown.`;
  const useJsonResponseFormat = shouldUseJsonResponseFormat(params.chat, params.resolvedApi);
  const requestMessages = shouldAddJsonProtocolReminder(params.chat, params.resolvedApi)
    ? [...params.chatMessages, buildJsonProtocolReminder(params.chat)]
    : params.chatMessages;
  const requestStartedAt = nowMs();
  let firstRawChunkLogged = false;
  const rawChunkHandler = !useJsonResponseFormat && params.onChunk
    ? (raw: string) => {
        if (!firstRawChunkLogged) {
          firstRawChunkLogged = true;
          logDeveloperDiagnostic('chat-run:model-first-raw-chunk', {
            chatId: params.chat.id,
            speakerId: params.speaker.id,
            speakerName: params.speaker.name,
            provider: params.resolvedApi.provider,
            model: params.resolvedApi.model,
            attempt: params.attempt,
            rawLength: raw.length,
            elapsedMs: Number((nowMs() - requestStartedAt).toFixed(2)),
          }, 'info', 'chat-run');
        }
        streamBridge.push(raw);
    }
    : undefined;
  logDeveloperDiagnostic('chat-run:model-request-start', {
    chatId: params.chat.id,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    provider: params.resolvedApi.provider,
    model: params.resolvedApi.model,
    attempt: params.attempt,
    streaming: Boolean(rawChunkHandler),
    promptLength: jsonPrompt.length,
    messageCount: requestMessages.length,
  }, 'debug', 'chat-run');
  const response = await generateResponse(
    params.resolvedApi,
    jsonPrompt,
    requestMessages,
    rawChunkHandler,
    {
      signal: params.signal,
      responseFormat: useJsonResponseFormat ? 'json' : 'text',
      aiUsage: {
        type: params.chat.sessionKind?.scenarioId === 'story-reader' ? 'story_chat' : params.chat.type === 'direct' ? 'direct_chat' : 'group_chat',
        label: params.chat.sessionKind?.scenarioId === 'story-reader' ? '生成故事回复' : params.chat.type === 'direct' ? '生成单聊回复' : '生成群聊回复',
        scope: 'chat',
        resourceId: params.chat.id,
      },
    },
  );
  logDeveloperDiagnostic('chat-run:model-request-finished', {
    chatId: params.chat.id,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    provider: params.resolvedApi.provider,
    model: params.resolvedApi.model,
    attempt: params.attempt,
    responseLength: response.length,
    elapsedMs: Number((nowMs() - requestStartedAt).toFixed(2)),
  }, 'info', 'chat-run');
  logRawAiResponse({ chat: params.chat, speaker: params.speaker, attempt: params.attempt, response });
  const parsedEnvelope = parseInlineInteractionEnvelope(response);
  const isStoryReader = params.chat.sessionKind?.scenarioId === 'story-reader';
  const narrativeRuntime = isStoryReader ? await loadNarrativeRuntime() : null;
  const storyEvents = narrativeRuntime
    ? narrativeRuntime.normalizeStoryEvents(parsedEnvelope?.storyEvents, { previousMessages: params.activeMessages })
    : [];
  const storyEventContent = storyEvents.length && narrativeRuntime
    ? narrativeRuntime.buildStoryEventsVisibleText(storyEvents, params.characters || [])
    : '';
  const messageParts = isStoryReader || !Array.isArray(parsedEnvelope?.messages)
    ? null
    : parsedEnvelope.messages
      .filter((part): part is { content: string; mediaDecision?: MediaGenerationDecision | null } => Boolean(part && typeof part.content === 'string' && part.content.trim()))
      .slice(0, 5)
      .map((part) => ({ content: part.content.trim(), mediaDecision: part.mediaDecision || null }));
  const rawContent = storyEventContent || (messageParts?.[0]?.content || (parsedEnvelope ? parsedEnvelope.content : isLikelyInlineEnvelopeResponse(response) ? '' : response));
  const rawNarrativeText = typeof parsedEnvelope?.narrativeText === 'string' ? parsedEnvelope.narrativeText : '';
  const finalizedResponse = finalizeResponse(rawContent, params.intent, params.speaker, params.activeMessages, params.showRoleActions, Boolean(parsedEnvelope?.intentionalRepeat), params.surface);
  const finalizedNarrativeText = rawNarrativeText ? trimHumanChatStyle(rawNarrativeText, true) : '';
  const narrativeBlocks = normalizeStoryNarrativeBlocks({
    blocks: parsedEnvelope?.narrativeBlocks,
    events: parsedEnvelope?.storyEvents,
    characters: params.characters,
    fallbackNarrativeText: isStoryReader ? '' : finalizedNarrativeText,
  });
  const keepStoryEventsAsContent = isStoryReader
    && storyEvents.length > 0
    && !params.chat.memberIds.includes(params.speaker.id);
  let finalResponse = narrativeBlocks.length && !keepStoryEventsAsContent ? '' : finalizedResponse;
  let streamedFallbackUsed = false;
  if (!isStoryReader && !normalizeForComparison(finalResponse)) {
    const streamedFallback = streamBridge.getLastContent();
    if (normalizeForComparison(streamedFallback)) {
      finalResponse = sanitizeUserFacingText(
        trimHumanChatStyle(params.showRoleActions === false ? stripRoleActions(streamedFallback) : streamedFallback, params.surface?.preserveParagraphs),
        [],
        { preserveLineBreaks: true },
      );
      streamedFallbackUsed = true;
    }
  }
  const extraMessages = isStoryReader ? null : normalizeExtraMessages({
    content: finalResponse,
    extraMessages: parsedEnvelope?.extraMessages,
    intent: params.intent,
    speaker: params.speaker,
    recentMessages: params.activeMessages,
    showRoleActions: params.showRoleActions,
    surface: params.surface,
    turnPlan: params.turnPlan,
  });
  const fullResponse = messageParts?.length
    ? messageParts.map((part) => part.content).join('\n')
    : buildFullTurnResponse(finalResponse, extraMessages);
  const eventStoryChoices = narrativeRuntime ? narrativeRuntime.getStoryChoicesFromEvents(storyEvents) : [];
  const storyChoices = eventStoryChoices?.length ? eventStoryChoices : normalizeStoryChoiceSuggestions(parsedEnvelope?.storyChoices);
  const fullNarrativeResponse = narrativeBlocks.map((block) => block.text).join('\n\n') || finalizedNarrativeText;
  streamBridge.flush(fullNarrativeResponse || finalResponse);
  return { parsedEnvelope, rawContent, rawNarrativeText, finalResponse, narrativeText: finalizedNarrativeText, narrativeBlocks, storyChoices, fullResponse, fullNarrativeResponse, extraMessages, messageParts, storyEvents, streamedFallbackUsed };
}

async function generateNonDuplicateResponse(params: {
  chat: GroupChat;
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
  conversationMovePlan?: ReturnType<typeof planConversationMove> | null;
  onChunk?: (content: string) => void;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<GenerationWithGuidanceTrace> {
  const isStoryReader = params.chat.sessionKind?.scenarioId === 'story-reader';
  const narrativeRuntime = isStoryReader ? await loadNarrativeRuntime() : null;
  let prompt = isStoryReader ? buildStoryProtocolPrompt(params.systemPrompt) : params.systemPrompt;
  const storyContinuationState = isStoryReader
    ? narrativeRuntime?.buildStoryContinuationState({ conversation: params.chat, messages: params.activeMessages })
    : null;
  let lastParsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope> = null;
  let lastFinalResponse = '';
  let lastFullResponse = '';
  let lastRawResponse = '';
  let lastNarrativeText = '';
  let lastNarrativeBlocks: NarrativeBlock[] = [];
  let lastFullNarrativeResponse = '';
  let lastExtraMessages: string[] | null = null;
  let lastMessageParts: GenerationWithGuidanceTrace['messageParts'] = null;
  let lastStoryEvents: import('../types/message').StoryEvent[] | null = null;
  let lastStoryChoices: MessageMetadata['storyChoices'] | null = null;
  let lastStreamedFallbackUsed = false;
  const rejectedReasons: GuidanceRejectionReason[] = [];
  let finalReason: GuidanceExecutionReason = params.guidance ? 'empty_content' : 'matched';
  const requestUsesJsonResponseFormat = shouldUseJsonResponseFormat(params.chat, params.resolvedApi);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shouldStreamAttempt = !requestUsesJsonResponseFormat && !isStoryReader && !params.guidance && attempt === 0;
    let generated = await generateWithPrompt({ ...params, characters: params.characters || [], systemPrompt: prompt, attempt: attempt + 1, onChunk: shouldStreamAttempt ? params.onChunk : undefined });
    const webSearchRequest = attempt === 0 && !isStoryReader && params.chat.modeState.assistantCapabilities?.webSearch
      ? normalizeWebSearchToolRequest(generated.parsedEnvelope?.toolRequest)
      : null;
    if (webSearchRequest) {
      const latestHumanTurnId = getLatestHumanTurnId(params.activeMessages);
      const cacheKey = getWebSearchTurnCacheKey(params.chat.id, latestHumanTurnId, webSearchRequest.query);
      let searchPromptBlock = getCachedWebSearchPromptBlock(cacheKey);
      if (searchPromptBlock) {
        logDeveloperDiagnostic('chat-run:web-search-cache-hit', {
          chatId: params.chat.id,
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          query: webSearchRequest.query,
          latestHumanTurnId,
        }, 'info', 'chat-run');
      } else {
        try {
          const searchResponse = await api.searchWeb(webSearchRequest.query, {
            source: 'group_chat',
            resourceId: params.chat.id,
          });
          searchPromptBlock = buildWebSearchResultPromptBlock({
            query: searchResponse.query,
            providerCode: searchResponse.providerCode,
            pointCost: searchResponse.pointCost,
            results: searchResponse.results,
          });
          setCachedWebSearchPromptBlock(cacheKey, searchResponse.query, searchPromptBlock);
          logDeveloperDiagnostic('chat-run:web-search-completed', {
            chatId: params.chat.id,
            speakerId: params.speaker.id,
            speakerName: params.speaker.name,
            query: searchResponse.query,
            resultCount: searchResponse.results.length,
            pointCost: searchResponse.pointCost,
            latestHumanTurnId,
          }, 'info', 'chat-run');
        } catch (error) {
          const expectedSkip = error instanceof ApiError && (
            error.code === 'AI_SEARCH_ENTITLEMENT_REQUIRED'
            || error.code === 'AI_SEARCH_PROVIDER_UNAVAILABLE'
            || error.code === 'AI_SEARCH_POINTS_INSUFFICIENT'
            || error.status === 401
          );
          logDeveloperDiagnostic('chat-run:web-search-failed', {
            chatId: params.chat.id,
            speakerId: params.speaker.id,
            speakerName: params.speaker.name,
            query: webSearchRequest.query,
            code: error instanceof ApiError ? error.code : undefined,
            reason: error instanceof Error ? error.message : 'search failed',
            expectedSkip,
          }, expectedSkip ? 'debug' : 'info', 'chat-run');
          searchPromptBlock = [
            '## Web Search Result',
            `Query: ${webSearchRequest.query}`,
            `Search failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            'Answer from the available conversation and stable knowledge. If current facts are required, say the search was unavailable and avoid inventing details. Keep toolRequest=null.',
          ].join('\n');
        }
      }
      generated = await generateWithPrompt({
        ...params,
        characters: params.characters || [],
        systemPrompt: `${prompt}\n\n${searchPromptBlock}\n\nSearch tool has already been handled for this turn. Return the final visible reply now and keep toolRequest=null.`,
        attempt: attempt + 1,
        onChunk: params.onChunk,
      });
    }
    lastParsedEnvelope = generated.parsedEnvelope;
    lastFinalResponse = generated.finalResponse;
    lastFullResponse = generated.fullResponse;
    lastRawResponse = generated.rawContent;
    lastNarrativeText = generated.narrativeText;
    lastNarrativeBlocks = generated.narrativeBlocks;
    lastFullNarrativeResponse = generated.fullNarrativeResponse;
    lastExtraMessages = generated.extraMessages || null;
    lastMessageParts = generated.messageParts || null;
    lastStoryEvents = generated.storyEvents || null;
    lastStoryChoices = generated.storyChoices || null;
    lastStreamedFallbackUsed = Boolean(generated.streamedFallbackUsed);
    // Some reasoning models can consume the completion budget without
    // emitting visible text (especially for media or artifact-heavy study
    // requests). Retry with an explicit concise-output contract instead of
    // issuing the same request three times and eventually surfacing an empty
    // generation error.
    if (!normalizeForComparison(generated.fullNarrativeResponse || generated.fullResponse)) {
      if (attempt < 2) {
        prompt = `${buildEmptyContentRetryPrompt(params.systemPrompt)}\n- The previous attempt may have exhausted its reasoning budget before visible output. Reply concisely without reasoning aloud, and preserve any requested artifact or media decision in the supported structured format.`;
        continue;
      }
    }
    const storyProtocolIssue = isStoryReader && narrativeRuntime ? validateStoryReaderGeneration({
      chat: params.chat,
      parsedEnvelope: generated.parsedEnvelope,
      storyEvents: generated.storyEvents || null,
      narrativeText: generated.narrativeText,
      narrativeBlocks: generated.narrativeBlocks,
      finalResponse: generated.finalResponse,
      rawContent: generated.rawContent,
      continuationState: storyContinuationState,
      narrativeRuntime,
    }) : null;
    if (storyProtocolIssue) {
      const draft = generated.rawContent || generated.fullResponse;
      if (attempt < 2) {
        logAiGenerationFailure({
          chat: params.chat,
          speaker: params.speaker,
          reason: `${storyProtocolIssue.code}_retry`,
          message: `${storyProtocolIssue.message} 准备重试。`,
          attempt: attempt + 1,
          draft,
          details: {
            code: storyProtocolIssue.code,
            storyEvents: generated.storyEvents?.length || 0,
            narrativeBlocks: generated.narrativeBlocks.length,
            hasParsedEnvelope: Boolean(generated.parsedEnvelope),
            ...('details' in storyProtocolIssue ? storyProtocolIssue.details : {}),
          },
        });
        const modelSafeStoryProtocolReason = storyProtocolIssue.code === 'story_section_too_short'
          ? `${toModelSafeStoryProtocolReason(storyProtocolIssue)}; ${storyProtocolIssue.message}`
          : toModelSafeStoryProtocolReason(storyProtocolIssue);
        prompt = storyProtocolIssue.code === 'story_continuity_invalid'
          ? buildStoryContinuityQualityRetryPrompt(params.systemPrompt, storyProtocolIssue.message, storyContinuationState)
          : buildStoryProtocolQualityRetryPrompt(params.systemPrompt, modelSafeStoryProtocolReason);
        continue;
      }
      logAiGenerationFailure({
        chat: params.chat,
        speaker: params.speaker,
        reason: storyProtocolIssue.code,
        message: storyProtocolIssue.message,
        attempt: attempt + 1,
        draft,
        details: {
          code: storyProtocolIssue.code,
          storyEvents: generated.storyEvents?.length || 0,
          narrativeBlocks: generated.narrativeBlocks.length,
          hasParsedEnvelope: Boolean(generated.parsedEnvelope),
          ...('details' in storyProtocolIssue ? storyProtocolIssue.details : {}),
        },
      });
      throw new EmptyGeneratedResponseError(params.speaker.name, { reason: 'story_protocol_invalid', message: storyProtocolIssue.message });
    }
    const evaluationResponse = generated.fullNarrativeResponse || generated.fullResponse;
    if (normalizeForComparison(evaluationResponse)) {
      const guidanceEvaluation = evaluateGuidanceGeneratedContent(
        evaluationResponse,
        params.guidance,
        params.speaker,
        params.characters,
        {
          mediaCapabilities: params.mediaCapabilities,
          mediaDecisions: generated.messageParts?.map((part) => part.mediaDecision || {}) || [],
        },
      );
      finalReason = guidanceEvaluation.reason;
      if (params.guidance && !guidanceEvaluation.matched && attempt < 2) {
        rejectedReasons.push(guidanceEvaluation.reason as GuidanceRejectionReason);
        await params.onLocalInterception?.({
          kind: 'guidance_retry',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason: guidanceEvaluation.reason,
          attempt: attempt + 1,
        });
        prompt = buildGuidanceRetryPrompt({
          systemPrompt: params.systemPrompt,
          guidance: params.guidance,
          speaker: params.speaker,
          characters: params.characters || [],
          previousDraft: evaluationResponse,
          mediaCapabilities: params.mediaCapabilities,
        });
        continue;
      }
      const surfaceContractIssue = evaluateVisibleSurfaceContract({
        chat: params.chat,
        speaker: params.speaker,
        characters: params.characters || [],
        content: evaluationResponse,
        showRoleActions: params.showRoleActions,
      });
      if (surfaceContractIssue) {
        await params.onLocalInterception?.({
          kind: 'surface_contract_warning',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason: surfaceContractIssue,
          attempt: attempt + 1,
        });
      }
      if (generated.streamedFallbackUsed) {
        await params.onLocalInterception?.({
          kind: 'streamed_draft_committed',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason: '最终结构化正文为空，但流式阶段已经产生可见内容；已保留并提交这段流式草稿。',
          attempt: attempt + 1,
        });
      }
      const echoReason = evaluateHiddenEchoDraft(
        evaluationResponse,
        params.activeMessages,
        params.speaker.id,
        Boolean(generated.parsedEnvelope?.intentionalRepeat),
      );
      if (echoReason) {
        if (attempt < 2) {
          await params.onLocalInterception?.({
            kind: 'surface_echo_retry',
            speakerId: params.speaker.id,
            speakerName: params.speaker.name,
            draft: evaluationResponse,
            reason: echoReason,
            attempt: attempt + 1,
          });
          prompt = buildSurfaceEchoRetryPrompt(params.systemPrompt, evaluationResponse, echoReason);
          continue;
        }
        await params.onLocalInterception?.({
          kind: 'surface_echo_skip',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason: echoReason,
          attempt: attempt + 1,
        });
        throw new EmptyGeneratedResponseError(params.speaker.name, {
          localInterceptionReported: true,
          reason: 'duplicate_content',
        });
      }
      const conversationMovePlan = params.conversationMovePlan;
      const analysisProtocolTrace = conversationMovePlan ? buildDeliberationArtifactTrace({
        chat: params.chat,
        parsedEnvelope: generated.parsedEnvelope,
        conversationMovePlan,
      }) : null;
      if (conversationMovePlan && analysisProtocolTrace && !analysisProtocolTrace.present && analysisProtocolTrace.expectedByMove) {
        const reason = '本轮回复做了审议动作，但模型没有返回结构化审议产物；消息已保留，面板不会新增审议产物。';
        logDeveloperDiagnostic('chat-run:analysis-artifacts-missing', {
          chatId: params.chat.id,
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          kind: 'analysis_artifacts_missing',
          draft: evaluationResponse,
          reason,
          moveType: conversationMovePlan.moveType,
          moveReason: conversationMovePlan.reason,
        }, 'warn', 'chat-run');
        await params.onLocalInterception?.({
          kind: 'analysis_artifacts_missing',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason,
        });
      } else if (conversationMovePlan && analysisProtocolTrace?.present) {
        const counts = countDeliberationArtifacts(generated.parsedEnvelope?.deliberationArtifacts);
        const reason = `本轮回复返回了结构化审议产物：主张 ${counts.claims}、证据 ${counts.evidence}、质询 ${counts.issues}、裁决 ${counts.verdicts}、总结 ${counts.summaries}；消息提交后会写入审议面板。`;
        logDeveloperDiagnostic('chat-run:analysis-artifacts-present', {
          chatId: params.chat.id,
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          kind: 'analysis_artifacts_present',
          draft: evaluationResponse,
          reason,
          moveType: conversationMovePlan.moveType,
          moveReason: conversationMovePlan.reason,
          counts,
        }, 'info', 'chat-run');
        await params.onLocalInterception?.({
          kind: 'analysis_artifacts_present',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason,
        });
      }
      if (contentExplicitlySignalsAway(evaluationResponse) && !generated.parsedEnvelope?.presenceUpdate) {
        const reason = '可见回复表示离开、睡觉或忙碌，但模型没有返回下线状态标记；消息已保留，角色在线状态不变。';
        logDeveloperDiagnostic('chat-run:presence-metadata-missing', {
          chatId: params.chat.id,
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          kind: 'presence_metadata_missing',
          draft: evaluationResponse,
          reason,
        }, 'warn', 'chat-run');
        await params.onLocalInterception?.({
          kind: 'presence_metadata_missing',
          speakerId: params.speaker.id,
          speakerName: params.speaker.name,
          draft: evaluationResponse,
          reason,
        });
      }
      if (params.guidance || attempt > 0) params.onChunk?.(generated.narrativeText || generated.finalResponse);
      return {
        parsedEnvelope: generated.parsedEnvelope,
        finalResponse: generated.finalResponse,
        narrativeText: generated.narrativeText,
        narrativeBlocks: generated.narrativeBlocks,
        storyChoices: generated.storyChoices,
        fullResponse: generated.fullResponse,
        fullNarrativeResponse: generated.fullNarrativeResponse,
        extraMessages: generated.extraMessages,
        messageParts: generated.messageParts || null,
        storyEvents: generated.storyEvents || null,
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
      prompt = normalizeForComparison(generated.rawContent)
        ? buildRetryPrompt(params.systemPrompt, generated.rawContent)
        : buildEmptyContentRetryPrompt(params.systemPrompt);
    }
  }
  return {
    parsedEnvelope: lastParsedEnvelope,
    finalResponse: lastFinalResponse,
    narrativeText: lastNarrativeText,
    narrativeBlocks: lastNarrativeBlocks,
    storyChoices: lastStoryChoices,
    fullResponse: lastFullResponse || lastFinalResponse,
    rawResponse: lastRawResponse || lastFullResponse || lastFinalResponse,
    fullNarrativeResponse: lastFullNarrativeResponse || lastNarrativeText || lastFullResponse || lastFinalResponse,
    extraMessages: lastExtraMessages,
    messageParts: lastMessageParts,
    storyEvents: lastStoryEvents,
    streamedFallbackUsed: lastStreamedFallbackUsed,
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
  characters: AICharacter[];
  speakerId: string;
  speakerName: string;
  finalResponse: string;
  fullResponse: string;
  extraMessages?: string[] | null;
  messageParts?: Array<{ content: string; metadata?: MessageMetadata }> | null;
  emotion: number;
  parsedEnvelope: ReturnType<typeof parseInlineInteractionEnvelope>;
  metadata?: MessageMetadata;
}) {
  const interactionHints = normalizeInteractionHintCollection(params.parsedEnvelope?.interactionHints || null, params.speakerId, params.fullResponse);
  const inferredAddressedTargets = inferAddressedTargetsFromContent(params.finalResponse, params.speakerId, params.characters);
  const envelopeTargetIds = params.parsedEnvelope?.addressedTargets?.targetIds || [];
  const addressedTargetIds = Array.from(new Set([...envelopeTargetIds, ...inferredAddressedTargets]));
  const primaryAddressedTargetId = params.parsedEnvelope?.addressedTargets?.primaryTargetId
    || params.parsedEnvelope?.addressedTargets?.targetIds?.[0]
    || addressedTargetIds[0]
    || null;
  return {
    chatId: params.chat.id,
    type: 'ai' as const,
    senderId: params.speakerId,
    senderName: params.speakerName,
    content: params.finalResponse,
    extraMessages: params.extraMessages,
    messageParts: params.messageParts,
    metadata: params.metadata,
    emotion: params.emotion,
    interactionHint: interactionHints[0] || null,
    interactionHints,
    addressedTargetIds: addressedTargetIds.length ? addressedTargetIds : null,
    primaryAddressedTargetId,
    socialEventHints: params.parsedEnvelope?.socialEventHints || null,
    conflictFocus: params.parsedEnvelope?.conflictFocus || null,
  };
}

function buildAddressNameVariants(name: string) {
  const compact = name.replace(/\s+/g, '');
  if (!compact) return [];
  const variants = new Set<string>([compact]);
  if (/^[\p{Script=Han}]{3,}$/u.test(compact)) {
    variants.add(compact.slice(-2));
    const titlePrefix = compact.match(/^(御厨|顾问|老师|医生|律师|将军|先生|小姐|老板|店长|经理)/u)?.[1];
    if (titlePrefix) variants.add(titlePrefix);
  }
  return Array.from(variants).filter((item) => item.length >= 2);
}

function inferAddressedTargetsFromContent(content: string, speakerId: string, characters: AICharacter[]) {
  const variantOwners = new Map<string, string[]>();
  characters
    .filter((character) => character.id !== speakerId && character.name)
    .forEach((character) => {
      buildAddressNameVariants(character.name).forEach((variant) => {
        variantOwners.set(variant, [...(variantOwners.get(variant) || []), character.id]);
      });
    });
  const targets: string[] = [];
  variantOwners.forEach((ownerIds, variant) => {
    if (ownerIds.length !== 1) return;
    if (!content.includes(variant)) return;
    targets.push(ownerIds[0]);
  });
  return Array.from(new Set(targets));
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
  const chatMembers = characters.filter((c) => chat.memberIds.includes(c.id) && !c.deletedAt);
  if (chat.sessionKind?.scenarioId !== 'story-reader') return chatMembers;
  if (chatMembers.some((member) => member.id === 'narrator')) return chatMembers;
  return [createNarratorCharacter(chat), ...chatMembers];
}

function countSpeakableParticipants(chat: GroupChat, autoSpeakableMembers: AICharacter[]) {
  return autoSpeakableMembers.length + (chat.memberIds.includes('user') ? 1 : 0);
}

function resolveSpeakerFromCandidates(chatMembers: AICharacter[], candidates: ReturnType<typeof calculateWeights>) {
  const speakerId = selectSpeaker(candidates);
  return chatMembers.find((member) => member.id === speakerId) || null;
}

function resolveUserGuidanceLockedSpeaker(chatMembers: AICharacter[], directorIntent?: DirectorIntent | null) {
  const guidance = directorIntent?.source === 'user_message' ? directorIntent.userGuidance : null;
  const targetIds = directorIntent?.targetActorIds || [];
  if (!targetIds.length) return null;
  if (!guidance?.actorIds.length) return null;
  if (guidance.kind !== 'direct_reply' && guidance.kind !== 'media_request') return null;
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

function resolveRoundtableTurnSpeaker(chat: GroupChat, chatMembers: AICharacter[]) {
  if (chat.sessionKind?.scenarioId !== 'roundtable-review' && chat.mode !== 'roundtable') return null;
  if (chat.scenarioState?.phase === 'synthesis') return null;
  const turnOrder = (chat.scenarioState?.turnOrder?.length ? chat.scenarioState.turnOrder : chat.memberIds)
    .filter((memberId) => memberId && memberId !== 'user');
  const startIndex = Math.max(0, turnOrder.indexOf(chat.scenarioState?.currentTurnActorId || ''));
  const orderedCandidateIds = turnOrder.length
    ? [...turnOrder.slice(startIndex), ...turnOrder.slice(0, startIndex)]
    : [];
  const speaker = orderedCandidateIds
    .map((memberId) => chatMembers.find((member) => member.id === memberId))
    .find((member): member is AICharacter => Boolean(member && !isChatMemberMuted(chat, member.id)));
  if (!speaker) return null;
  return {
    speakerId: speaker.id,
    reason: null,
    bypassNotice: null,
    policy: {
      source: 'roundtable_turn_order',
      scenarioId: chat.sessionKind?.scenarioId,
      phase: chat.scenarioState?.phase || null,
    },
  };
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
    sessionEngine?: SessionEngineDefinition | null;
  };
  onChunk?: (content: string) => void;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  delay?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<GeneratedRoundMessage> {
  const startedAt = nowMs();
  const chatMembers = resolveEffectiveChatMembers(params.chat, params.characters);
  const effectiveMembers = chatMembers.length ? chatMembers : params.characters;
  const activeMessages = params.messages.filter((message) => message.chatId === params.chat.id && !message.isDeleted);
  const latestActiveUserGuidanceResolution = resolveLatestActiveUserGuidance(effectiveMembers, activeMessages);
  const latestActiveUserGuidance = latestActiveUserGuidanceResolution.intent;
  const effectiveDirectorIntent = params.directorIntent?.source === 'user_message'
    ? params.directorIntent
    : latestActiveUserGuidance || params.directorIntent || null;
  const emotion = getEmotion(params.speaker.id);
  const recentTargetId = resolveRecentTargetIdForSpeaker(params.chat, params.speaker, activeMessages, params.pendingReplyContext);
  const recentText = activeMessages.at(-1)?.content || '';
  const intent = deriveSpeakIntentFromContext(params.speaker, recentTargetId, recentText, effectiveDirectorIntent, {
    conversationFamily: params.chat.sessionKind?.family,
    scenarioId: params.chat.sessionKind?.scenarioId,
  });
  const innerLife = reconcileSelectedInnerLife(
    projectInnerLife({ chat: params.chat, character: params.speaker, messages: activeMessages }),
    params.speakerScore,
  );
  const reconciledSpeakerScore = reconcileSelectedSpeakerScore(params.speakerScore, innerLife);
  const typingDelayMs = await waitForInnerLifeTypingDelay(innerLife, params.chat, params.delay);
  if (typingDelayMs > 0) {
    logDeveloperDiagnostic('chat-run:typing-delay', {
      chatId: params.chat.id,
      speakerId: params.speaker.id,
      speakerName: params.speaker.name,
      delayMs: typingDelayMs,
      elapsedMs: Number((nowMs() - startedAt).toFixed(2)),
    }, 'debug', 'chat-run');
  }
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
  const promptPrepStartedAt = nowMs();
  const scenarioPromptContext = params.generationContext?.buildPromptContext?.(params.speaker) || params.generationContext?.promptContext;
  const promptContextReadyAt = nowMs();
  const stylePromptContext = resolveStyleProfilePromptContext(params.chat);
  const enginePromptContext = mergePromptContexts(scenarioPromptContext, stylePromptContext);
  const promptPrefix = enginePromptContext?.promptPrefix ? `${enginePromptContext.promptPrefix.trim()}\n\n` : '';
  const promptSuffix = enginePromptContext?.promptSuffix ? `\n\n${enginePromptContext.promptSuffix.trim()}` : '';
  const additionalConstraints = enginePromptContext?.additionalConstraints?.length
    ? `\n- ${enginePromptContext.additionalConstraints.join('\n- ')}`
    : '';
  const sessionEngine = params.generationContext?.sessionEngine || await getSessionEngine(params.chat);
  const runtimeContextBundle = sessionEngine.buildRuntimeContextBundle?.({
    conversation: params.chat,
    characters: effectiveMembers,
    messages: activeMessages,
    speaker: params.speaker,
  }) || null;
  const baseRuntimeBundle = runtimeContextBundle || buildGenerationRuntimeBundle({
    chat: params.chat,
    speaker: params.speaker,
    messages: activeMessages,
    promptContext: enginePromptContext,
    sessionEngine,
  });
  const runtimeBundle = enrichRuntimeBundleWithHumanAppraisal({
    bundle: baseRuntimeBundle,
    chat: params.chat,
    speaker: params.speaker,
    messages: activeMessages,
  });
  const conversationMovePlan = planConversationMove({
    chat: params.chat,
    speaker: params.speaker,
    messages: activeMessages,
    speakerScore: reconciledSpeakerScore,
  });
  const runtimeBundleWithMovePlan = {
    ...runtimeBundle,
    trace: {
      ...(runtimeBundle.trace || {}),
      policyHits: [
        ...(runtimeBundle.trace?.policyHits || []),
        `conversation_move:${conversationMovePlan.moveType}`,
        `conversation_move_reason:${conversationMovePlan.reason}`,
      ],
      guidanceValidation: [
        runtimeBundle.trace?.guidanceValidation || '',
        `move=${conversationMovePlan.moveType};posture=${conversationMovePlan.socialPosture.warmth}/${conversationMovePlan.socialPosture.directness};confidence=${conversationMovePlan.confidence.toFixed(2)}`,
      ].filter(Boolean).join(' | ') || null,
    },
  };
  const pendingReplyPrompt = params.pendingReplyContext?.targetIds.includes(params.speaker.id) && params.pendingReplyContext.sourceSpeakerId
    ? `\nPending reply expectation:
- You were explicitly addressed by ${characterMap.get(params.pendingReplyContext.sourceSpeakerId)?.name || params.pendingReplyContext.sourceSpeakerId}.
- Give that address some priority, but do not over-answer by default.
- If the address is a casual aside, technical metaphor, or broad riff, you may respond to the gist, say the term is not your lane, ask a small clarification, or answer briefly before moving on.`
    : '';
  const mediaProfiles = resolveMediaProfiles(params.apiConfig, params.profiles);
  const mediaCapabilities = buildMediaCapabilities(params.chat, params.speaker, mediaProfiles);
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
  const promptAssembly = resolveSessionEngineKey(params.chat) === 'open_chat'
    && resolveSessionFamilyKey(params.chat) !== 'analysis'
    ? buildPromptAssemblyWithContext(params.speaker, params.chat, emotion, activeMessages, characterMap)
    : null;
  const memoryTrace = promptAssembly?.memoryTrace || buildPromptMemoryTrace(params.speaker, params.chat, activeMessages, characterMap);
  const characterMindTrace = promptAssembly?.characterMindTrace || buildPromptCharacterMindTrace(params.speaker, params.chat, activeMessages, characterMap);
  const memoryTraceReadyAt = nowMs();
  const isAnalysisRoom = resolveSessionFamilyKey(params.chat) === 'analysis';
  const companionshipTrace = isAnalysisRoom
    ? null
    : await buildCompanionshipTraceIfNeeded({ chat: params.chat, character: params.speaker, messages: activeMessages });
  const companionshipTraceReadyAt = nowMs();
  const userGuidance = effectiveDirectorIntent?.userGuidance || null;
  const priorGuidanceReplies = countPriorGuidanceReplies(activeMessages, userGuidance, params.speaker.id);
  const guidanceFloorState = resolveGuidanceFloorState({
    guidance: userGuidance,
    guidanceTimestamp: effectiveDirectorIntent === latestActiveUserGuidance
      ? latestActiveUserGuidanceResolution.timestamp
      : null,
    messages: activeMessages,
    speaker: params.speaker,
    characters: effectiveMembers,
  });
  const worldInfluenceSnapshot = buildWorldEventInfluenceSnapshot({
    chat: params.chat,
    speaker: params.speaker,
    members: effectiveMembers,
  });
  const unifiedTurnDirective = buildTurnDirective({
    chat: params.chat,
    speaker: params.speaker,
    members: effectiveMembers,
    messages: activeMessages,
    styleProfile: enginePromptContext?.styleProfile,
    intent,
    innerLife,
    conversationMovePlan,
    turnPlan,
    runtimeBundle: runtimeBundleWithMovePlan,
    userGuidance,
  });
  const isStoryReader = params.chat.sessionKind?.scenarioId === 'story-reader';
  const promptPlayMode = resolvePromptPlayMode(params.chat);
  const webSearchEnabled = Boolean(params.chat.modeState.assistantCapabilities?.webSearch) && !isStoryReader;
  const speakerSystemPrompt = buildSpeakerSystemPrompt({
    speaker: params.speaker,
    chat: params.chat,
    emotion,
    activeMessages,
    characterMap,
    preferEnginePromptAdapter: !enginePromptContext,
    promptAssembly,
  });
  const promptBlocks: PromptBlock[] = [
    { id: 'engine_prefix', layer: 'core', priority: -100, content: promptPrefix },
    { id: 'speaker_identity', layer: 'core', priority: 0, content: speakerSystemPrompt },
    buildPromptPlayModeBlock(promptPlayMode),
    { id: 'humanization', layer: 'character', priority: 20, content: buildHumanizationPrompt(params.speaker, intent, activeMessages, userGuidance) },
    { id: 'inner_life', layer: 'character', priority: 30, content: buildInnerLifePromptBlock(innerLife) },
    { id: 'pending_reply', layer: 'task', priority: 10, content: pendingReplyPrompt },
    { id: 'user_guidance', layer: 'task', priority: 20, content: buildUserGuidancePrompt(userGuidance, params.speaker, effectiveMembers, mediaCapabilities, priorGuidanceReplies) },
    { id: 'room_floor_state', layer: 'task', priority: 25, content: buildGuidanceFloorPrompt(guidanceFloorState) },
    { id: 'world_event_context', layer: 'scene', priority: 20, content: buildWorldEventContextPrompt({ chat: params.chat, speaker: params.speaker, members: effectiveMembers }) },
    { id: 'world_influence', layer: 'scene', priority: 30, content: worldInfluenceSnapshot.prompt },
    { id: 'current_intent', layer: 'task', priority: 30, content: buildCurrentIntentPrompt({ directorIntent: effectiveDirectorIntent, intent }) },
    { id: 'private_turn_priority', layer: 'task', priority: 35, content: buildPrivateTurnPriorityPrompt(params.chat) },
    { id: 'engine_constraints', layer: 'task', priority: 40, content: additionalConstraints },
    { id: 'analysis_room_contract', layer: 'task', priority: 45, content: buildAnalysisRoomContractPrompt(params.chat) },
    { id: 'role_action_visibility', layer: 'runtime', priority: 10, content: buildRoleActionVisibilityPrompt(showRoleActions) },
    { id: 'expression_feedback', layer: 'runtime', priority: 20, content: buildExpressionFeedbackPrompt(expressionFeedbackTrace) },
    { id: 'turn_directive', layer: 'task', priority: 48, content: buildTurnDirectivePrompt(unifiedTurnDirective) },
    { id: 'natural_chat_rhythm', layer: 'style', priority: 10, content: buildNaturalChatRhythmPrompt(activeMessages, innerLife, responseSurface) },
    { id: 'conversation_move', layer: 'task', priority: 50, content: buildConversationMovePrompt(conversationMovePlan, params.chat) },
    { id: 'expression_surface_choice', layer: 'style', priority: 20, content: buildExpressionSurfaceChoicePrompt({ chat: params.chat, speaker: params.speaker, messages: activeMessages, intent, surface: responseSurface, turnPlan }) },
    { id: 'turn_length_variety', layer: 'style', priority: 30, content: buildTurnLengthVarietyPrompt(activeMessages, params.speaker.id, responseSurface, runtimeBundleWithMovePlan) },
    { id: 'turn_format_variety', layer: 'style', priority: 40, content: buildTurnFormatVarietyPrompt(activeMessages, params.speaker.id, responseSurface) },
    { id: 'turn_plan', layer: 'runtime', priority: 30, content: buildTurnPlanPrompt(turnPlan) },
    { id: 'runtime_role_constraint', layer: 'runtime', priority: 40, content: buildRuntimeRoleConstraintPrompt(runtimeBundleWithMovePlan) },
    { id: 'response_surface', layer: 'style', priority: 50, content: buildResponseSurfacePrompt(responseSurface) },
    { id: 'style_quarantine', layer: 'style', priority: 60, content: buildStyleQuarantinePrompt(responseSurface) },
    { id: 'visible_message_surface_contract', layer: 'output', priority: 0, content: buildVisibleMessageSurfaceContractPrompt(params.chat, showRoleActions) },
    { id: 'focused_situational_job_contract', layer: 'output', priority: 5, content: buildFocusedSituationalJobContract(activeMessages, params.speaker, responseSurface) },
    { id: 'natural_chat_surface_contract', layer: 'output', priority: 7, content: buildNaturalChatSurfaceContract(activeMessages, responseSurface, showRoleActions) },
    { id: 'generation_constraints', layer: 'output', priority: 10, content: buildGenerationConstraints(params.chat, activeMessages, params.speaker.id, responseSurface) },
    { id: 'inline_interaction_contract', layer: 'output', priority: 20, content: buildInlineInteractionContract({ chat: params.chat, speaker: params.speaker, characters: effectiveMembers, recentMessages: activeMessages, turnPlan, mediaCapabilities, mediaRequested: Boolean(userGuidance?.mediaRequest), webSearchEnabled }) },
    { id: 'engine_suffix', layer: 'suffix', priority: 100, content: promptSuffix },
  ];
  const baseSystemPrompt = isStoryReader
    ? buildStoryReaderSystemPrompt({
      chat: params.chat,
      speaker: params.speaker,
      characters: effectiveMembers,
      activeMessages,
      promptPrefix,
      additionalConstraints,
      promptSuffix,
    })
    : composePromptBlocks(promptBlocks, promptPlayMode);
  const systemPrompt = baseSystemPrompt;
  const resolvedApi = resolveApiConfigForCharacter(params.speaker, params.apiConfig, params.profiles);
  const textInputCapabilities = inferTextInputCapabilities(resolvedApi.provider, resolvedApi.model);
  const chatMessages = buildChatMessages(activeMessages, characterMap, MAX_HISTORY_FOR_PROMPT, {
    currentSpeakerId: isStoryReader ? undefined : params.speaker.id,
    chatType: params.chat.type,
    imageAttachmentMode: textInputCapabilities.imageInput ? 'latest-user' : 'none',
  });
  const promptPrepElapsedMs = Number((nowMs() - promptPrepStartedAt).toFixed(2));
  logDeveloperDiagnostic('chat-run:prompt-prep-ready', {
    chatId: params.chat.id,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    promptContextMs: Number((promptContextReadyAt - promptPrepStartedAt).toFixed(2)),
    memoryTraceMs: Number((memoryTraceReadyAt - promptContextReadyAt).toFixed(2)),
    companionshipTraceMs: Number((companionshipTraceReadyAt - memoryTraceReadyAt).toFixed(2)),
    totalMs: promptPrepElapsedMs,
    activeMessages: activeMessages.length,
  }, promptPrepElapsedMs >= 500 ? 'info' : 'debug', 'chat-run');
  logDeveloperDiagnostic('chat-run:generation-context-ready', {
    chatId: params.chat.id,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    provider: resolvedApi.provider,
    model: resolvedApi.model,
    activeMessages: activeMessages.length,
    promptLength: systemPrompt.length,
    chatMessages: chatMessages.length,
    elapsedMs: Number((nowMs() - startedAt).toFixed(2)),
  }, 'debug', 'chat-run');
  const generated = await generateNonDuplicateResponse({
    chat: params.chat,
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
    conversationMovePlan,
    guidance: userGuidance,
    mediaCapabilities,
    onChunk: params.onChunk,
    onLocalInterception: params.onLocalInterception,
    signal: params.signal,
  });
  const generatedDialogueResponse = generated.fullResponse || '';
  const generatedStoryResponse = generated.fullNarrativeResponse || generatedDialogueResponse || '';
  if (!normalizeForComparison(generatedStoryResponse)) {
    await params.onLocalInterception?.({
      kind: 'empty_generation_skip',
      speakerId: params.speaker.id,
      speakerName: params.speaker.name,
      draft: generatedStoryResponse,
      reason: 'empty_content',
    });
    logAiGenerationFailure({
      chat: params.chat,
      speaker: params.speaker,
      reason: 'empty_content',
      message: '模型没有生成可展示的有效内容。',
      draft: generatedStoryResponse,
    });
    throw new EmptyGeneratedResponseError(params.speaker.name, { localInterceptionReported: true, reason: 'empty_content' });
  }

  const msgEmotion = analyzeEmotion(generatedStoryResponse);
  updateAllEmotions(effectiveMembers, params.speaker.id, msgEmotion, emotion);
  const modelMediaDecision = generated.parsedEnvelope?.mediaDecision;
  const mergedMediaDecision = mergeGuidanceMediaDecision({
    decision: modelMediaDecision,
    mediaCapabilities,
  });
  const guidanceExecution = generated.guidanceExecution
    ? {
      status: generated.guidanceExecution?.status || 'accepted',
      validated: generated.guidanceExecution?.validated ?? true,
      retryCount: generated.guidanceExecution?.retryCount || 0,
      rejectedDraftCount: generated.guidanceExecution?.rejectedDraftCount || 0,
      rejectedReasons: generated.guidanceExecution?.rejectedReasons || [],
      finalReason: generated.guidanceExecution?.finalReason || 'matched',
      forcedMediaQueued: false,
    } satisfies GuidanceExecutionTrace
    : undefined;
  const storyEvents = generated.storyEvents || [];
  const narrativeRuntime = storyEvents.length || isStoryReader ? await loadNarrativeRuntime() : null;
  const storyChoicesFromEvents = narrativeRuntime ? narrativeRuntime.getStoryChoicesFromEvents(storyEvents) : [];
  const legacyStoryChoices = normalizeStoryChoiceSuggestions(generated.parsedEnvelope?.storyChoices || null);
  const storyChoices = storyChoicesFromEvents.length ? storyChoicesFromEvents : legacyStoryChoices;
  const baseNarrativeTurn = narrativeRuntime && storyEvents.length
    ? narrativeRuntime.buildNarrativeTurnFromStoryEvents({
        conversation: params.chat,
        events: storyEvents,
        characters: effectiveMembers,
      })
    : sessionEngine.buildNarrativeTurnMetadata?.({
    conversation: params.chat,
    characters: effectiveMembers,
    messages: activeMessages,
    speaker: params.speaker,
    content: generated.narrativeText || '',
    blocks: generated.narrativeBlocks || null,
  }) || null;
  const narrativeTurn = narrativeRuntime ? narrativeRuntime.appendStoryReadingPanelBlock({
    conversation: params.chat,
    narrativeTurn: baseNarrativeTurn,
    choices: storyChoices,
  }) : baseNarrativeTurn;
  const deliberationArtifactTrace = buildDeliberationArtifactTrace({
    chat: params.chat,
    parsedEnvelope: generated.parsedEnvelope,
    conversationMovePlan,
  });
  const structuredOutputTrace = buildStructuredOutputProtocolTrace({
    parsedEnvelope: generated.parsedEnvelope,
    rawResponse: generated.rawResponse || generated.fullResponse || generated.finalResponse || '',
    userGuidance,
  });
  const runtimeBundleWithDiagnostics = appendStructuredOutputProtocolTrace(
    appendRuntimeTraceDiagnostics(runtimeBundleWithMovePlan, deliberationArtifactTrace),
    structuredOutputTrace,
  );
  const runtimeDecisionMetadata = buildRuntimeDecisionMetadata({
    directorIntent: effectiveDirectorIntent,
    narrativeLines: params.narrativeLines,
    speakerSelection: params.speakerSelection,
    speakerScore: reconciledSpeakerScore,
    innerLife,
    surface: responseSurface,
    turnPlan,
    personaActivation,
    intentionalRepeat: Boolean(generated.parsedEnvelope?.intentionalRepeat),
    memoryTrace,
    characterMindTrace,
    companionshipTrace,
    expressionFeedback: expressionFeedbackTrace,
    guidanceExecution,
    worldInfluence: worldInfluenceSnapshot,
    runtimeBundle: runtimeBundleWithDiagnostics,
  });
  if (structuredOutputTrace.policyHits.includes('structured_output:no_json_envelope')
    || structuredOutputTrace.policyHits.some((item) => item.includes('_dropped:'))
    || structuredOutputTrace.policyHits.includes('structured_output:invite_guidance_without_social_outing')) {
    logDeveloperDiagnostic('chat-run:structured-output-protocol', {
      chatId: params.chat.id,
      speakerId: params.speaker.id,
      speakerName: params.speaker.name,
      policyHits: structuredOutputTrace.policyHits,
      guidanceValidation: structuredOutputTrace.guidanceValidation,
      responseLength: generatedStoryResponse.length,
    }, 'warn', 'chat-run');
  }
  if (deliberationArtifactTrace && !deliberationArtifactTrace.present && deliberationArtifactTrace.expectedByMove) {
    logDeveloperDiagnostic('chat-run:deliberation-artifacts-missing', {
      chatId: params.chat.id,
      speakerId: params.speaker.id,
      speakerName: params.speaker.name,
      reason: deliberationArtifactTrace.reason,
      moveType: conversationMovePlan.moveType,
      moveReason: conversationMovePlan.reason,
      parsedEnvelope: Boolean(generated.parsedEnvelope),
      responseLength: generatedStoryResponse.length,
    }, 'warn', 'chat-run');
  }
  const baseMetadata = buildMessageMetadata({
    decision: generated.messageParts?.length ? null : mergedMediaDecision,
    capabilities: mediaCapabilities,
    content: generatedStoryResponse,
    activeMessages,
    surface: responseSurface,
    storyEvents,
    storyEventsNormalized: true,
    storyQuality: narrativeRuntime && storyEvents.length ? narrativeRuntime.evaluateStoryEventQuality(storyEvents) : null,
    narrativeTurn,
    storyChoices,
    deliberationArtifacts: generated.parsedEnvelope?.deliberationArtifacts || null,
    presenceUpdate: generated.parsedEnvelope?.presenceUpdate || null,
    runtimeDecision: runtimeDecisionMetadata,
  });
  const messageParts = generated.messageParts?.map((part, index) => ({
    content: part.content,
    metadata: buildMessageMetadata({
      decision: part.mediaDecision || null,
      capabilities: mediaCapabilities,
      content: part.content,
      activeMessages,
      surface: responseSurface,
      storyEvents: index === 0 ? storyEvents : [],
      storyEventsNormalized: true,
      storyQuality: index === 0 && narrativeRuntime && storyEvents.length ? narrativeRuntime.evaluateStoryEventQuality(storyEvents) : null,
      narrativeTurn: index === 0 ? narrativeTurn : null,
      storyChoices: index === 0 ? storyChoices : null,
      deliberationArtifacts: index === 0 ? generated.parsedEnvelope?.deliberationArtifacts || null : null,
      presenceUpdate: index === 0 ? generated.parsedEnvelope?.presenceUpdate || null : null,
      runtimeDecision: index === 0 ? runtimeDecisionMetadata : undefined,
    }),
  })) || null;
  const completedMessage = buildCompletedMessage({
    chat: params.chat,
    characters: effectiveMembers,
    speakerId: params.speaker.id,
    speakerName: params.speaker.name,
    finalResponse: generated.finalResponse,
    fullResponse: generatedDialogueResponse,
    extraMessages: generated.extraMessages,
    messageParts,
    emotion: getEmotion(params.speaker.id),
    parsedEnvelope: generated.parsedEnvelope,
	    metadata: baseMetadata,
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
    sessionEngine?: SessionEngineDefinition | null;
  },
  cooldownMap?: Record<string, number>
): Promise<void> => {
  const roundStartedAt = nowMs();
  const chatMembers = resolveEffectiveChatMembers(chat, characters);
  if (chatMembers.length === 0) {
    callbacks.onError(new Error('No AI members in this chat'));
    return;
  }
  const now = Date.now();
  const autoSpeakableMembers = chatMembers.filter((member) => isCharacterAvailableForScheduling(member, now));
  const storyNarrator = chat.sessionKind?.scenarioId === 'story-reader'
    ? chatMembers.find((member) => member.id === 'narrator')
    : null;
  const isSingleTutorLearningSession = resolveSessionDefinition(chat).kind.scenarioId === 'learning-progress';
  if (chat.type === 'group' && !storyNarrator && !isSingleTutorLearningSession && countSpeakableParticipants(chat, autoSpeakableMembers) < 2) {
    const reason = autoSpeakableMembers.length === 0
      ? '群里已无多人在线，当前没有可自动发言的角色'
      : '群里已无多人在线，只剩一个可发言成员';
    logDeveloperDiagnostic('chat-run:speaker-selection-idle', {
      chatId: chat.id,
      type: chat.type,
      scenarioId: resolveSessionDefinition(chat).kind.scenarioId,
      reason,
      memberCount: chat.memberIds.length,
      autoSpeakableCount: autoSpeakableMembers.length,
    }, 'info', 'chat-run');
    callbacks.onIdle?.(reason);
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
  const pendingReplyContext = chat.type === 'group' ? resolvePendingReplyContext(autoSpeakableMembers, activeMessages) : null;
  const runtimePressure = projectRuntimePressure({ chat, characters: autoSpeakableMembers, messages: activeMessages, pendingReplyContext });
  const narrativeLines = runtimePressure.narrativeLines;
  const directorIntent = runtimePressure.directorIntent;
  const candidates = calculateWeights(autoSpeakableMembers, activeMessages, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, pendingReplyContext, chat, directorIntent);
  const lockedGuidanceSpeaker = resolveUserGuidanceLockedSpeaker(autoSpeakableMembers, directorIntent);
  const roundtableTurnSpeaker = resolveRoundtableTurnSpeaker(chat, autoSpeakableMembers);
  let speakerSelection: SpeakerSelectionState = storyNarrator
    ? {
      speakerId: storyNarrator.id,
      reason: null,
      bypassNotice: null,
      policy: {
        source: 'narrative_runtime',
        actorKind: 'narrator',
        scenarioId: chat.sessionKind?.scenarioId,
      },
    }
    : lockedGuidanceSpeaker
    ? {
      speakerId: lockedGuidanceSpeaker.id,
      reason: null,
      bypassNotice: null,
      policy: {
        source: 'user_guidance_lock',
        lockedActorIds: directorIntent?.targetActorIds || [lockedGuidanceSpeaker.id],
      },
    }
    : roundtableTurnSpeaker
      ? roundtableTurnSpeaker
    : getSpeakerSelectionResult(chatMembers, effectiveCooldownMap, chat.speed, BASE_COOLDOWN_MS, candidates);
  const selectionElapsedMs = Number((nowMs() - roundStartedAt).toFixed(2));
  logDeveloperDiagnostic('chat-run:speaker-selection-ready', {
    chatId: chat.id,
    type: chat.type,
    scenarioId: resolveSessionDefinition(chat).kind.scenarioId,
    speakerId: speakerSelection.speakerId,
    reason: speakerSelection.reason,
    candidateCount: candidates.length,
    topCandidates: candidates
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map((candidate) => ({
        characterId: candidate.characterId,
        speakerName: chatMembers.find((member) => member.id === candidate.characterId)?.name || candidate.characterId,
        weight: Number(candidate.weight.toFixed(4)),
        reasons: candidate.scoreBreakdown?.reasons || [],
      })),
    elapsedMs: selectionElapsedMs,
  }, selectionElapsedMs >= 500 ? 'info' : 'debug', 'chat-run');
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
      pickedSpeakerId: speakerSelection?.speakerId || null,
      pickedSpeakerName: chatMembers.find((member) => member.id === speakerSelection?.speakerId)?.name || null,
      idleReason: speakerSelection?.reason || null,
	      pendingReplyContext,
	      directorIntent,
	      narrativeLines,
	    };
    logDeveloperDiagnostic('group-loop:selection', selectionDebug);
  }
  const currentSpeakerSelection = speakerSelection;
  if (!currentSpeakerSelection?.speakerId) {
    logDeveloperDiagnostic('chat-run:speaker-selection-idle', {
      chatId: chat.id,
      type: chat.type,
      scenarioId: resolveSessionDefinition(chat).kind.scenarioId,
      reason: currentSpeakerSelection?.reason || null,
      elapsedMs: selectionElapsedMs,
    }, 'info', 'chat-run');
    if (currentSpeakerSelection?.reason) callbacks.onIdle?.(currentSpeakerSelection.reason);
    return;
  }

  const speaker = chatMembers.find((c) => c.id === currentSpeakerSelection.speakerId);
  if (!speaker) return;
  const selectedCandidate = candidates.find((candidate) => candidate.characterId === speaker.id);
  const selectedSpeakerScore = resolveSelectedSpeakerScore({
    candidateScore: selectedCandidate?.scoreBreakdown || null,
    speakerId: speaker.id,
    lockedGuidanceSpeakerId: lockedGuidanceSpeaker?.id || null,
  });
  callbacks.onSpeakerSelected(speaker.id, speaker);
  const hydrateStartedAt = nowMs();
  const hydratedSpeaker = await callbacks.ensureSpeakerDetail?.(speaker.id, speaker);
  logDeveloperDiagnostic('chat-run:speaker-detail-ready', {
    chatId: chat.id,
    speakerId: speaker.id,
    speakerName: speaker.name,
    hydrated: Boolean(hydratedSpeaker),
    elapsedMs: Number((nowMs() - hydrateStartedAt).toFixed(2)),
  }, 'debug', 'chat-run');

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
        speakerScore: selectedSpeakerScore || null,
        generationContext,
        onChunk: callbacks.onMessageChunk,
        onLocalInterception: callbacks.onLocalInterception,
        signal: callbacks.signal,
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
      if (chat.sessionKind?.scenarioId === 'story-reader') throw error;
      if (lockedGuidanceSpeaker && activeSpeaker.id === lockedGuidanceSpeaker.id) throw error;
      const rotated = resolveSpeakerFromCandidates(chatMembers, candidates.filter((candidate) => candidate.characterId !== activeSpeaker.id));
      if (!rotated) {
        logAiGenerationFailure({
          chat,
          speaker: activeSpeaker,
          reason: error.reason,
          message: error.message,
          details: { noFallbackSpeaker: true },
        });
        throw error;
      }
      activeSpeaker = rotated;
      speakerSelection = {
        speakerId: activeSpeaker.id,
        reason: null,
        bypassNotice: 'fallback_after_empty_generation',
      };
      const rotatedCandidate = candidates.find((candidate) => candidate.characterId === activeSpeaker.id);
      callbacks.onSpeakerSelected(activeSpeaker.id, activeSpeaker);
      const rotatedHydrateStartedAt = nowMs();
      const hydratedRotated = await callbacks.ensureSpeakerDetail?.(activeSpeaker.id, activeSpeaker);
      logDeveloperDiagnostic('chat-run:speaker-detail-ready', {
        chatId: chat.id,
        speakerId: activeSpeaker.id,
        speakerName: activeSpeaker.name,
        hydrated: Boolean(hydratedRotated),
        rotated: true,
        elapsedMs: Number((nowMs() - rotatedHydrateStartedAt).toFixed(2)),
      }, 'debug', 'chat-run');
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
        signal: callbacks.signal,
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
  shouldApplyInnerLifeTypingDelay,
  resolveMediaProfiles,
  evaluateHiddenEchoDraft,
  buildFocusedSituationalJobContract,
  buildNaturalChatSurfaceContract,
  resolveGuidanceFloorState,
  buildGuidanceFloorPrompt,
  buildWorldEventContextPrompt,
  buildWorldEventInfluenceRulesPrompt,
};
