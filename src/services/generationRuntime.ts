import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SessionExecutionTrace, SessionExpressionPlan, SessionGenerationPromptContext, SessionGenerationRuntimeBundle, SessionRealizationPlan, SessionTargetScope, SessionTurnPlan } from '../types/sessionEngine';
import { resolveDuplicateValidator } from './duplicateValidatorRegistry';
import type { ChatStyleProfile } from './styleProfileRegistry';
import { resolveSessionDefinition } from '../types/sessionEngine';
import { getStyleProfile, resolveDefaultStyleProfile } from './styleProfileRegistry';
import { buildScenarioRuntimeDecision } from './scenarioRuntime';
import { resolveEffectiveCapabilities } from './capabilityGraph';
import { applyHumanAppraisalToExpressionPlan, applyHumanAppraisalToTurnPlan, buildHumanAppraisalPatch, isHumanAppraisalActive } from './humanAppraisal';

function latestVisibleMessage(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1) || null;
}

function resolveMoveClass(chat: GroupChat, promptContext: SessionGenerationPromptContext | null | undefined) {
  const style = promptContext?.styleProfile || resolveDefaultStyleProfile({
    scenarioId: chat.sessionKind?.scenarioId || resolveSessionDefinition(chat).kind.scenarioId,
    family: chat.sessionKind?.family || resolveSessionDefinition(chat).kind.family,
  });
  if (style === 'analytical_room') return 'deepen' as const;
  if (style === 'discovery_room') return 'expand' as const;
  if (style === 'companion_room') return 'stabilize' as const;
  if (style === 'dramatic_room') return 'perform' as const;
  if (style === 'task_room') return 'respond' as const;
  return 'advance' as const;
}

function resolveTargetScope(chat: GroupChat): SessionTargetScope {
  const session = resolveSessionDefinition(chat);
  if (chat.type === 'direct' || chat.type === 'ai_direct') return 'person';
  if (session.kind.family === 'analysis' || session.kind.family === 'study' || session.kind.family === 'interview') return 'topic';
  if (session.kind.family === 'deduction' || session.kind.family === 'mystery' || session.kind.family === 'simulation') return 'scene';
  return 'room';
}

function isProfessionalScenario(chat: GroupChat) {
  const session = resolveSessionDefinition(chat);
  return session.kind.family === 'analysis' || session.kind.family === 'study' || session.kind.family === 'interview';
}

function isLongformPromptContext(promptContext: SessionGenerationPromptContext | null | undefined) {
  return promptContext?.responseStyle === 'professional' || promptContext?.responseStyle === 'longform';
}

function deriveExpressionSurface(styleProfile: ChatStyleProfile) {
  return styleProfile === 'analytical_room'
    ? 'analytical'
    : styleProfile === 'companion_room'
      ? 'companion'
      : styleProfile === 'dramatic_room'
        ? 'dramatic'
        : styleProfile === 'task_room'
          ? 'task'
          : 'casual';
}

function deriveExpressionTexture(styleProfile: ChatStyleProfile) {
  return styleProfile === 'analytical_room' || styleProfile === 'task_room' ? 'rich' : 'ordinary';
}

function buildValidationSeed(turnPlan: SessionTurnPlan) {
  return `${turnPlan.moveClass}:${turnPlan.targetScope}:${(turnPlan.targetIds || []).join(',')}`;
}

function deriveNoveltyGoal(moveClass: SessionTurnPlan['moveClass']) {
  return moveClass === 'expand'
    ? 'new_example'
    : moveClass === 'deepen'
      ? 'new_angle'
      : moveClass === 'challenge'
        ? 'new_evidence'
        : moveClass === 'repair'
          ? 'repair'
          : moveClass === 'resolve'
            ? 'resolve'
            : 'none';
}

function deriveFunctionTag(turnPlan: SessionTurnPlan) {
  if (turnPlan.moveClass === 'respond') return 'answer' as const;
  if (turnPlan.moveClass === 'expand' || turnPlan.moveClass === 'deepen') return 'add_angle' as const;
  if (turnPlan.moveClass === 'stabilize' || turnPlan.moveClass === 'repair') return 'comfort' as const;
  if (turnPlan.moveClass === 'challenge') return 'challenge' as const;
  if (turnPlan.moveClass === 'resolve') return 'summarize' as const;
  return 'advance' as const;
}

function deriveRoleConstraint(params: {
  speaker: AICharacter;
  capabilities: ReturnType<typeof resolveEffectiveCapabilities>;
  latest: Message | null;
  turnPlan: SessionTurnPlan;
}) {
  if (params.latest?.type === 'user' || params.latest?.type === 'god') {
    if (params.capabilities.styleProfile === 'companion_room') return 'acknowledge_user_need_first';
    if (params.capabilities.family === 'analysis' || params.capabilities.styleProfile === 'analytical_room') return 'add_one_new_dimension';
    if (params.capabilities.styleProfile === 'task_room') return 'answer_before_expanding';
  }
  if (params.turnPlan.moveClass === 'resolve') return 'close_the_loop';
  if (params.turnPlan.moveClass === 'challenge') return 'push_one_point_only';
  return 'stay_in_lane';
}

function deriveHotspotState(messages: Message[], speakerId: string) {
  const recentAi = messages.filter((message) => message.type === 'ai' && !message.isDeleted).slice(-8);
  if (!recentAi.length) return 'clear' as const;
  const ownCount = recentAi.filter((message) => message.senderId === speakerId).length;
  if (ownCount >= 4) return 'hot' as const;
  if (ownCount >= 3) return 'warm' as const;
  return 'clear' as const;
}

function adjustDepthForHotspot(depth: SessionTurnPlan['depth'], hotspotState: ReturnType<typeof deriveHotspotState>) {
  if (hotspotState !== 'hot') return depth;
  return depth === 'deep' ? 'normal' : depth === 'normal' ? 'brief' : depth;
}

function deriveEmotionalPosture(surface: SessionExpressionPlan['surface']) {
  return surface === 'companion' ? 'warm' : surface === 'dramatic' ? 'tense' : 'cold';
}

function adjustMoveClassForValidation(moveClass: SessionTurnPlan['moveClass']): SessionTurnPlan['moveClass'] {
  return moveClass === 'expand' ? 'deepen' : moveClass === 'deepen' ? 'challenge' : moveClass;
}

function buildRuntimeTrace(params: {
  styleProfile: ChatStyleProfile;
  turnPlan: SessionTurnPlan;
  capabilities: ReturnType<typeof resolveEffectiveCapabilities>;
  scenarioDecision: ReturnType<typeof buildScenarioRuntimeDecision>;
  validationDecision: { reason?: string | null };
  functionTag: NonNullable<SessionRealizationPlan['functionTag']>;
  roleConstraint: string;
  hotspotState: NonNullable<SessionExecutionTrace['hotspotState']>;
  humanAppraisal: ReturnType<typeof buildHumanAppraisalPatch>;
}): SessionExecutionTrace {
  const humanAppraisalActive = isHumanAppraisalActive(params.humanAppraisal);
  return {
    policyHits: [
      params.styleProfile,
      params.turnPlan.moveClass,
      params.turnPlan.targetScope,
      params.capabilities.memoryMode,
      params.capabilities.duplicateTolerance,
      params.functionTag,
      params.roleConstraint,
      ...(humanAppraisalActive ? [`human_appraisal:${params.humanAppraisal.moveBias}`, ...params.humanAppraisal.reasonTags] : []),
    ],
    scenarioChecks: [params.scenarioDecision.scenarioId, params.scenarioDecision.family, params.scenarioDecision.phaseKey, params.capabilities.channelType, params.hotspotState],
    duplicateDecision: params.validationDecision.reason || null,
    functionTag: params.functionTag,
    roleConstraint: params.roleConstraint,
    hotspotState: params.hotspotState,
    humanAppraisal: humanAppraisalActive ? params.humanAppraisal : null,
  };
}

function buildRealizationPlan(params: {
  turnPlan: SessionTurnPlan;
  surface: SessionExpressionPlan['surface'];
  functionTag: NonNullable<SessionRealizationPlan['functionTag']>;
  roleConstraint: string;
}): SessionRealizationPlan {
  return {
    moveClass: params.turnPlan.moveClass,
    targetScope: params.turnPlan.targetScope,
    targetIds: params.turnPlan.targetIds,
    noveltyGoal: deriveNoveltyGoal(params.turnPlan.moveClass),
    emotionalPosture: deriveEmotionalPosture(params.surface),
    surfaceDepth: params.turnPlan.depth,
    functionTag: params.functionTag,
    roleConstraint: params.roleConstraint,
  };
}

function runValidationCycle(params: {
  validator: ReturnType<typeof resolveDuplicateValidator>;
  speakerId: string;
  recentMessages: Message[];
  styleProfile: ChatStyleProfile;
  scenarioId: string;
  channelType: GroupChat['type'];
  turnPlan: SessionTurnPlan;
}) {
  const firstDecision = params.validator.validate({
    content: buildValidationSeed(params.turnPlan),
    speakerId: params.speakerId,
    recentMessages: params.recentMessages,
    styleProfile: params.styleProfile,
    scenarioId: params.scenarioId,
    channelType: params.channelType,
  });
  if (firstDecision.allowed) return firstDecision;
  params.turnPlan.moveClass = adjustMoveClassForValidation(params.turnPlan.moveClass);
  const retryDecision = params.validator.validate({
    content: buildValidationSeed(params.turnPlan),
    speakerId: params.speakerId,
    recentMessages: params.recentMessages,
    styleProfile: params.styleProfile,
    scenarioId: params.scenarioId,
    channelType: params.channelType,
  });
  return retryDecision.allowed
    ? { allowed: true, reason: firstDecision.reason || retryDecision.reason }
    : retryDecision;
}

function buildTurnPlan(params: {
  latest: Message | null;
  scenarioDecision: ReturnType<typeof buildScenarioRuntimeDecision>;
  capabilities: ReturnType<typeof resolveEffectiveCapabilities>;
  chat: GroupChat;
  promptContext?: SessionGenerationPromptContext | null;
  speaker: AICharacter;
  hotspotState: ReturnType<typeof deriveHotspotState>;
}): SessionTurnPlan {
  return {
    ...params.scenarioDecision.turnPlan,
    obligation: params.latest?.type === 'user' || params.latest?.type === 'god'
      ? (params.capabilities.replyToAddressedTarget ? 'should' : params.scenarioDecision.turnPlan.obligation)
      : params.scenarioDecision.turnPlan.obligation,
    moveClass: params.capabilities.preferredMoveClass || resolveMoveClass(params.chat, params.promptContext) || params.scenarioDecision.turnPlan.moveClass,
    targetScope: params.capabilities.preferredTargetScope || params.scenarioDecision.turnPlan.targetScope,
    targetIds: params.latest?.senderId && params.latest.senderId !== params.speaker.id ? [params.latest.senderId] : params.scenarioDecision.turnPlan.targetIds,
    depth: adjustDepthForHotspot(isLongformPromptContext(params.promptContext) ? 'deep' : params.scenarioDecision.turnPlan.depth, params.hotspotState),
  };
}

function buildExpressionPlan(params: {
  styleProfile: ChatStyleProfile;
  chat: GroupChat;
  capabilities: ReturnType<typeof resolveEffectiveCapabilities>;
  style: ReturnType<typeof getStyleProfile>;
  promptContext?: SessionGenerationPromptContext | null;
}): SessionExpressionPlan {
  const surface = deriveExpressionSurface(params.styleProfile);
  return {
    surface,
    texture: deriveExpressionTexture(params.styleProfile),
    rhythm: params.chat.type === 'group'
      ? (params.capabilities.roomActivity === 'focused' ? 'one_shot' : params.capabilities.roomActivity === 'lively' ? 'branching' : 'back_and_forth')
      : 'one_shot',
    allowMarkdown: params.capabilities.allowMarkdown ?? params.style?.promptContext.allowMarkdown ?? params.promptContext?.allowMarkdown,
  };
}

export function buildGenerationRuntimeBundle(params: {
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
  promptContext?: SessionGenerationPromptContext | null;
}) : SessionGenerationRuntimeBundle {
  const latest = latestVisibleMessage(params.messages);
  const scenarioDecision = buildScenarioRuntimeDecision({
    conversation: params.chat,
    characters: [],
    messages: params.messages,
    speaker: params.speaker,
    promptContext: params.promptContext,
  });
  const capabilities = resolveEffectiveCapabilities(params.chat, params.promptContext);
  const styleProfile = (params.promptContext?.styleProfile as ChatStyleProfile | undefined) || resolveDefaultStyleProfile({
    scenarioId: params.chat.sessionKind?.scenarioId || resolveSessionDefinition(params.chat).kind.scenarioId,
    family: params.chat.sessionKind?.family || resolveSessionDefinition(params.chat).kind.family,
  });
  const style = getStyleProfile(styleProfile);
  const hotspotState = deriveHotspotState(params.messages, params.speaker.id);
  const baseTurnPlan = buildTurnPlan({
    latest,
    scenarioDecision,
    capabilities,
    chat: params.chat,
    promptContext: params.promptContext,
    speaker: params.speaker,
    hotspotState,
  });
  const baseExpressionPlan = buildExpressionPlan({
    styleProfile,
    chat: params.chat,
    capabilities,
    style,
    promptContext: params.promptContext,
  });
  const humanAppraisal = buildHumanAppraisalPatch({
    chat: params.chat,
    speaker: params.speaker,
    messages: params.messages,
  });
  const turnPlan = applyHumanAppraisalToTurnPlan(baseTurnPlan, humanAppraisal);
  const expressionPlan = applyHumanAppraisalToExpressionPlan(baseExpressionPlan, humanAppraisal);
  const validator = resolveDuplicateValidator(styleProfile);
  const validationDecision = runValidationCycle({
    validator,
    speakerId: params.speaker.id,
    recentMessages: params.messages,
    styleProfile,
    scenarioId: scenarioDecision.scenarioId,
    channelType: params.chat.type,
    turnPlan,
  });
  const functionTag = deriveFunctionTag(turnPlan);
  const roleConstraint = deriveRoleConstraint({
    speaker: params.speaker,
    capabilities,
    latest,
    turnPlan,
  });
  const realizationPlan = buildRealizationPlan({
    turnPlan,
    surface: expressionPlan.surface,
    functionTag,
    roleConstraint,
  });
  const trace = buildRuntimeTrace({
    styleProfile,
    turnPlan,
    capabilities,
    scenarioDecision,
    validationDecision,
    functionTag,
    roleConstraint,
    hotspotState,
    humanAppraisal,
  });
  return { turnPlan, expressionPlan, realizationPlan, validationDecision, trace };
}
