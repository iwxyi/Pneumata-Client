import type { AICharacter } from '../types/character';
import type { ConversationConflictAxis, DriverCharacterPatch, DriverEventPayload, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { deriveFallbackRelationshipDelta, updateCharacterRelationshipFromDelta } from './relationshipEngine';
import { createBaselineRelationshipCurrent, inferRelationshipDelta, reduceRelationshipLedger } from './relationshipLedger';
import type { ConflictFocusPayload, ConflictFocusState, ConflictRuntimeState, RuntimeEventV2 } from '../types/runtimeEvent';
import { deriveEmotionalState, derivePersonalityDrift, getRuntimeAffectEventDriftLine, getRuntimeAffectEventEmotionLines } from './personalityDrift';
import { accumulateChatRuntime } from './chatRuntime';
import { accumulateCharacterRuntime } from './characterRuntime';
import { extractMemoryCandidate } from './memoryEngine';
import { createDefaultConflictAxes, evolveConflictAxes, summarizeConflictAxes } from './conflictAxisEngine';
import { appendMemoryCandidateEvents, buildMemoryCandidateEvents, updateLayeredMemoriesWithEvents } from './layeredMemoryEngine';
import { consolidateMemoryCandidates } from './memoryConsolidation';
import { createMemoryDistillationRuntimeEvent, debugCharacterMemoryDistillation, debugChatMemoryDistillation, distillChatMemoryCandidates, distillCharacterMemoryCandidates, getLocalDistillationPolicy, localizeDistillationEventInfo, shouldDistillChatMemories, shouldDistillCharacterMemories } from './memoryDistillation';
import { normalizeRuntimeEvent } from './runtimeEventFactory';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';
import type { RuntimeEvolutionConfig } from './runtimeEvolutionConfig';
import { resolveRuntimeEvolutionConfig } from './runtimeEvolutionConfig';

const { chatGap: CHAT_DISTILLATION_TURN_COUNT, characterGap: CHARACTER_DISTILLATION_TURN_COUNT } = getLocalDistillationPolicy();
const PRIMARY_CONFLICT_DECAY_STEP = 0.12;
const SECONDARY_CONFLICT_DECAY_STEP = 0.08;
const CONFLICT_ACTIVE_THRESHOLD = 0.36;
const CONFLICT_COOLING_THRESHOLD = 0.54;

function areRuntimeValuesEqual(left: unknown, right: unknown) {
  if (left === right) return true;
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

function pruneUnchangedChatRuntimePatch(conversation: GroupChat, patch: Partial<GroupChat>) {
  const keys: Array<keyof GroupChat> = [
    'runtimeTimeline',
    'runtimeSeed',
    'worldState',
    'layeredMemories',
    'runtimeEventsV2',
    'relationshipLedger',
  ];
  for (const key of keys) {
    if (!(key in patch)) continue;
    if (areRuntimeValuesEqual(patch[key], conversation[key])) {
      delete patch[key];
    }
  }
  return patch;
}

function truncateWithEllipsis(text: string, maxLength: number) {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function countAiTurnsFromLayeredMemories(items: { sourceEventIds?: string[] }[] | undefined) {
  const turnIds = new Set<string>();
  for (const item of items || []) {
    for (const sourceEventId of item.sourceEventIds || []) {
      if (!sourceEventId) continue;
      turnIds.add(sourceEventId);
    }
  }
  return turnIds.size;
}

function resolveCharacterDistillationTurnCount(layeredMemories: AICharacter['layeredMemories']) {
  return Math.max(CHARACTER_DISTILLATION_TURN_COUNT, countAiTurnsFromLayeredMemories(layeredMemories));
}

function resolveChatDistillationTurnCount(layeredMemories: GroupChat['layeredMemories']) {
  return Math.max(CHAT_DISTILLATION_TURN_COUNT, countAiTurnsFromLayeredMemories(layeredMemories));
}

function maybeDistillCharacterLayeredMemories(character: AICharacter, layeredMemories: AICharacter['layeredMemories']) {
  if (!layeredMemories?.length) return { layeredMemories, debugInfo: null };
  const candidateCharacter = { ...character, layeredMemories };
  const turnCount = resolveCharacterDistillationTurnCount(layeredMemories);
  const debugInfo = debugCharacterMemoryDistillation(candidateCharacter, turnCount);
  if (!shouldDistillCharacterMemories(candidateCharacter, turnCount)) return { layeredMemories, debugInfo: null };
  const distilled = distillCharacterMemoryCandidates(candidateCharacter);
  if (!distilled.length) return { layeredMemories, debugInfo: null };
  return {
    layeredMemories: consolidateMemoryCandidates(layeredMemories, distilled),
    debugInfo: {
      ...debugInfo,
      triggered: true,
      reason: 'distilled',
      candidateTexts: distilled.map((item) => item.text),
    },
  };
}

function maybeDistillChatLayeredMemories(chat: GroupChat, layeredMemories: GroupChat['layeredMemories']) {
  if (!layeredMemories?.length) return { layeredMemories, debugInfo: null };
  const candidateChat = { ...chat, layeredMemories };
  const turnCount = resolveChatDistillationTurnCount(layeredMemories);
  const debugInfo = debugChatMemoryDistillation(candidateChat, turnCount);
  if (!shouldDistillChatMemories(candidateChat, turnCount)) return { layeredMemories, debugInfo: null };
  const distilled = distillChatMemoryCandidates(candidateChat);
  if (!distilled.length) return { layeredMemories, debugInfo: null };
  return {
    layeredMemories: consolidateMemoryCandidates(layeredMemories, distilled),
    debugInfo: {
      ...debugInfo,
      triggered: true,
      reason: 'distilled',
      candidateTexts: distilled.map((item) => item.text),
    },
  };
}

function appendDistilledMemoryEvents(conversation: GroupChat, existingEvents: RuntimeEventV2[], nextLayeredMemories: GroupChat['layeredMemories']) {
  const distilled = (nextLayeredMemories || []).filter((item) => item.origin === 'distilled');
  const knownTexts = new Set(existingEvents.filter((event) => event.kind === 'memory_candidate').map((event) => String((event.payload as Record<string, unknown>).text || '')));
  const newEvents = distilled
    .filter((item) => !knownTexts.has(item.text))
    .map<RuntimeEventV2>((item) => ({
      id: `distilled-${item.id}`,
      conversationId: conversation.id,
      createdAt: item.distilledAt || item.updatedAt,
      kind: 'memory_candidate',
      actorIds: [],
      targetIds: item.subjectIds,
      evidenceMessageIds: [],
      summary: item.text,
      eventClass: 'artifact',
      visibility: 'public',
      visibleToIds: [],
      visibleToRoles: [],
      payload: {
        kind: item.kind,
        text: item.text,
        salience: item.salience,
        confidence: item.confidence,
        origin: 'distilled',
      },
    }));
  return [...existingEvents, ...newEvents];
}

function normalizeConflictFocus(payload: ConflictFocusPayload | null | undefined, conversation: GroupChat, message: Pick<Message, 'content' | 'senderId'>): ConflictFocusState | null {
  if (!payload?.present || !payload.type || !payload.summary) return null;
  const severity = typeof payload.severity === 'number' && Number.isFinite(payload.severity) ? Math.max(0, Math.min(1, payload.severity)) : 0;
  if (severity < 0.55) return null;
  const participantIds = (payload.participantIds || [message.senderId]).filter((id) => conversation.memberIds.includes(id));
  const targetIds = (payload.primaryTargetIds || []).filter((id) => conversation.memberIds.includes(id));
  return {
    id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: conversation.type,
    type: payload.type,
    severity,
    stage: payload.stage || (severity >= 0.85 ? 'escalating' : severity >= 0.7 ? 'open' : 'emerging'),
    summary: payload.summary,
    participantIds: participantIds.length ? participantIds : [message.senderId],
    targetIds,
    nextPressure: payload.nextPressure || 'stabilize',
    developmentHooks: payload.developmentHooks || [],
    sourceEventIds: [],
    updatedAt: Date.now(),
  };
}

function normalizeIdList(ids: string[] | undefined) {
  return Array.from(new Set((ids || []).filter(Boolean))).sort();
}

function buildConflictIdentity(conflict: ConflictFocusState | null | undefined) {
  if (!conflict) return null;
  return {
    type: conflict.type,
    stage: conflict.stage,
    severityBand: Math.round(conflict.severity * 10) / 10,
    summary: conflict.summary.trim(),
    nextPressure: conflict.nextPressure,
    participantIds: normalizeIdList(conflict.participantIds),
    targetIds: normalizeIdList(conflict.targetIds),
  };
}

function hasMeaningfulConflictChange(previous: ConflictFocusState | null | undefined, next: ConflictFocusState | null) {
  if (!next) return false;
  const previousIdentity = buildConflictIdentity(previous);
  const nextIdentity = buildConflictIdentity(next);
  if (!previousIdentity) return true;
  return JSON.stringify(previousIdentity) !== JSON.stringify(nextIdentity);
}

function sameConflictBranch(left: ConflictFocusState | null | undefined, right: ConflictFocusState | null | undefined) {
  const leftIdentity = buildConflictIdentity(left);
  const rightIdentity = buildConflictIdentity(right);
  return Boolean(leftIdentity && rightIdentity && JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity));
}

function decayConflictFocus(conflict: ConflictFocusState, step: number): ConflictFocusState | null {
  const severity = Math.max(0, Number((conflict.severity - step).toFixed(2)));
  if (severity < CONFLICT_ACTIVE_THRESHOLD) return null;
  return {
    ...conflict,
    severity,
    stage: severity <= CONFLICT_COOLING_THRESHOLD ? 'cooling' : conflict.stage === 'escalating' ? 'open' : conflict.stage,
    nextPressure: severity <= CONFLICT_COOLING_THRESHOLD ? 'cool' : conflict.nextPressure,
    updatedAt: Date.now(),
  };
}

function updateConflictRuntimeState(previous: ConflictRuntimeState | null | undefined, nextConflict: ConflictFocusState | null): ConflictRuntimeState | null {
  if (!nextConflict) {
    const decayedActiveConflicts = (previous?.activeConflicts || [])
      .map((item) => decayConflictFocus(item, PRIMARY_CONFLICT_DECAY_STEP))
      .filter((item): item is ConflictFocusState => Boolean(item))
      .slice(0, 6);
    if (!decayedActiveConflicts.length) return null;
    const primaryConflict = decayedActiveConflicts[0] || null;
    return {
      primaryConflict,
      activeConflicts: decayedActiveConflicts,
      developmentHooks: primaryConflict?.developmentHooks || [],
      volatility: Math.max(0, Number(((previous?.volatility || 0) - 0.12).toFixed(2))),
      cooling: Math.min(1, Number(((previous?.cooling || 0) + 0.18).toFixed(2))),
      updatedAt: Date.now(),
    };
  }

  const decayedPreviousConflicts = (previous?.activeConflicts || [])
    .filter((item) => !sameConflictBranch(item, nextConflict))
    .map((item) => decayConflictFocus(item, SECONDARY_CONFLICT_DECAY_STEP))
    .filter((item): item is ConflictFocusState => Boolean(item));
  const activeConflicts = [nextConflict, ...decayedPreviousConflicts].slice(0, 6);
  return {
    primaryConflict: nextConflict,
    activeConflicts,
    developmentHooks: nextConflict.developmentHooks,
    volatility: Math.max(nextConflict.severity, Math.max(0, Number(((previous?.volatility || 0) - 0.06).toFixed(2)))),
    cooling: nextConflict.nextPressure === 'cool' ? Math.min(1, (previous?.cooling || 0) + 0.2) : Math.max(0, (previous?.cooling || 0) - 0.1),
    updatedAt: Date.now(),
  };
}

function buildConflictAxesSummary(axes: ConversationConflictAxis[]) {
  return summarizeConflictAxes(axes).trim();
}

function shouldEmitConflictAxisShift(previousAxes: ConversationConflictAxis[] | undefined, nextAxes: ConversationConflictAxis[], messageType: Message['type'], config: RuntimeEvolutionConfig) {
  if (messageType !== 'ai' || !nextAxes.length || config.worldMultiplier < 0.7) return false;
  return buildConflictAxesSummary(previousAxes || []) !== buildConflictAxesSummary(nextAxes);
}

function buildWorldStateShiftSummary(worldState: GroupChat['worldState']) {
  return [worldState.mood, worldState.focus, worldState.recentEvent].filter(Boolean).join(' / ').slice(0, 90);
}

function shouldEmitWorldStateShift(previousWorldState: GroupChat['worldState'], nextWorldState: GroupChat['worldState'], messageType: Message['type'], config: RuntimeEvolutionConfig) {
  if (messageType !== 'ai' || config.worldMultiplier < 0.9) return false;
  const nextSummary = buildWorldStateShiftSummary(nextWorldState);
  if (!nextSummary) return false;
  return buildWorldStateShiftSummary(previousWorldState) !== nextSummary;
}

export function buildNextWorldState(conversation: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'> & { conflictFocus?: ConflictFocusPayload | null }, config: RuntimeEvolutionConfig = resolveRuntimeEvolutionConfig(conversation.runtimeEvolutionIntensity)) {
  const existingAxes = (conversation.worldState.conflictAxes || []).length ? (conversation.worldState.conflictAxes || []) : createDefaultConflictAxes(conversation);
  const normalizedConflict = message.type === 'ai' ? normalizeConflictFocus(message.conflictFocus || null, conversation, message) : null;
  const nextConflictAxes = normalizedConflict && message.type === 'ai' && config.worldMultiplier >= 0.7
    ? evolveConflictAxes(conversation, message.content)
    : existingAxes;
  const nextConflictState = updateConflictRuntimeState(conversation.worldState.conflictState || null, normalizedConflict);
  return {
    worldState: {
      ...conversation.worldState,
      conflictAxes: nextConflictAxes,
      conflictState: nextConflictState,
      recentEvent: normalizedConflict?.summary || conversation.worldState.recentEvent || (nextConflictAxes.length ? summarizeConflictAxes(nextConflictAxes) : conversation.worldState.recentEvent),
    },
    nextConflictAxes,
    nextConflictState,
  };
}

function buildSeededRelationshipLedger(conversation: GroupChat, characters: AICharacter[]) {
  if ((conversation.relationshipLedger || []).length > 0) return conversation.relationshipLedger || [];
  return characters.flatMap((character) => character.relationships
    .filter((relation) => !/^draft-\d+$/i.test(relation.characterId))
    .map((relation) => ({
      pairKey: `${character.id}->${relation.characterId}`,
      actorId: character.id,
      targetId: relation.characterId,
      current: {
        warmth: relation.warmth ?? createBaselineRelationshipCurrent().warmth,
        competence: relation.competence ?? createBaselineRelationshipCurrent().competence,
        trust: relation.trust ?? createBaselineRelationshipCurrent().trust,
        threat: relation.threat ?? createBaselineRelationshipCurrent().threat,
      },
      derived: {},
      axisReasons: {},
      trend: 'flat' as const,
      recentEvents: [],
      lastUpdatedAt: relation.updatedAt || conversation.updatedAt || Date.now(),
    })));
}

export function buildRelationshipTransition(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: import('../types/runtimeEvent').InteractionEventPayload | null; interactionHints?: import('../types/runtimeEvent').InteractionEventPayload[] | null; conflictFocus?: ConflictFocusPayload | null };
  previousAiMessage?: Pick<Message, 'senderId'> | null;
  config?: RuntimeEvolutionConfig;
}) {
  const runtimeEvents: DriverEventPayload[] = [];
  const characterPatches: DriverCharacterPatch[] = [];
  let relationshipLedger = buildSeededRelationshipLedger(params.conversation, params.characters);
  const previousAiMessage = params.previousAiMessage;
  const config = params.config || resolveRuntimeEvolutionConfig(params.conversation.runtimeEvolutionIntensity);
  const distillationParticipants = params.characters.map((item) => ({ id: item.id, name: item.name }));
  const speaker = params.characters.find((item) => item.id === params.message.senderId);
  const explicitHints = params.message.interactionHints || (params.message.interactionHint ? [params.message.interactionHint] : []);
  const uniqueHints = explicitHints.filter((hint, index, array) => {
    if (!hint?.targetId) return false;
    return array.findIndex((candidate) => candidate.targetId === hint.targetId && candidate.kind === hint.kind) === index;
  });
  const hintedTargets = uniqueHints
    .map((hint) => ({ hint, target: params.characters.find((item) => item.id === hint.targetId) }))
    .filter((item): item is { hint: NonNullable<typeof uniqueHints[number]>; target: AICharacter } => Boolean(item.target));
  const fallbackTarget = !hintedTargets.length
    ? [...params.characters].find((item) => item.id !== params.message.senderId && (params.message.content.includes(item.name) || previousAiMessage?.senderId === item.id))
    : null;
  const targetEntries = hintedTargets.length
    ? hintedTargets
    : (fallbackTarget && params.message.interactionHint?.targetId === fallbackTarget.id
      ? [{ hint: params.message.interactionHint, target: fallbackTarget }]
      : []);

  if (params.message.type === 'ai' && speaker && targetEntries.length) {
    const summary = truncateWithEllipsis(params.message.content, 48);
    const speakerDrift = derivePersonalityDrift(speaker, params.message.content, config.driftMultiplier);
    const speakerEmotion = deriveEmotionalState(speaker, params.message.content, config.emotionMultiplier, config.emotionDecayBias);
    const localizedDriftSummary = getRuntimeAffectEventDriftLine(speaker.name, speakerDrift, 'zh');
    const driftEntries = localizedDriftSummary ? [{ type: 'drift' as const, text: localizedDriftSummary, createdAt: Date.now() }] : [];

    const updatedSpeakerRelationships = targetEntries.reduce((relationships, { target, hint }) => {
      const explicitDelta = inferRelationshipDelta(hint)?.delta || deriveFallbackRelationshipDelta(params.message.content);
      return updateCharacterRelationshipFromDelta({ ...speaker, relationships }, target.id, explicitDelta, config.relationshipMultiplier).relationships;
    }, speaker.relationships);

    const speakerLayeredResult = maybeDistillCharacterLayeredMemories({
      ...speaker,
      relationships: updatedSpeakerRelationships,
      emotionalState: speakerEmotion,
    }, updateCharacterLayeredMemories({
      character: {
        ...speaker,
        relationships: updatedSpeakerRelationships,
        emotionalState: speakerEmotion,
      },
      targetId: targetEntries[0].target.id,
      targetName: targetEntries.map(({ target }) => target.name).join('、'),
      content: params.message.content,
      personalityDrift: speakerDrift,
    }));

    characterPatches.push({
      characterId: speaker.id,
      patch: {
        relationships: updatedSpeakerRelationships,
        personalityDrift: speakerDrift,
        emotionalState: speakerEmotion,
        layeredMemories: speakerLayeredResult.layeredMemories,
        runtimeTimeline: accumulateCharacterRuntime(speaker, {
          type: 'relationship',
          text: `对 ${targetEntries.map(({ target }) => target.name).join('、')} 的态度发生变化：${summary}`,
        }).concat(driftEntries).slice(-Math.max(20, config.maxTimeline)),
      },
    });
    if (speakerLayeredResult.debugInfo) {
      runtimeEvents.push(createMemoryDistillationRuntimeEvent(localizeDistillationEventInfo(speakerLayeredResult.debugInfo, distillationParticipants)));
    }

    const relationshipLines: string[] = [];

    for (const { target, hint } of targetEntries) {
      const reciprocalDelta = inferRelationshipDelta(hint)?.delta || deriveFallbackRelationshipDelta(params.message.content);
      const updatedTarget = updateCharacterRelationshipFromDelta(target, speaker.id, reciprocalDelta, config.reciprocalRelationshipMultiplier);
      const targetEmotion = deriveEmotionalState(target, params.message.content, config.emotionMultiplier * 0.85, config.emotionDecayBias);
      const targetLayeredResult = maybeDistillCharacterLayeredMemories({
        ...target,
        relationships: updatedTarget.relationships,
        emotionalState: targetEmotion,
      }, updateCharacterLayeredMemories({
        character: {
          ...target,
          relationships: updatedTarget.relationships,
          emotionalState: targetEmotion,
        },
        targetId: speaker.id,
        targetName: speaker.name,
        content: params.message.content,
        personalityDrift: {},
      }));

      characterPatches.push({
        characterId: target.id,
        patch: {
          relationships: updatedTarget.relationships,
          emotionalState: targetEmotion,
          layeredMemories: targetLayeredResult.layeredMemories,
          runtimeTimeline: accumulateCharacterRuntime(target, {
            type: 'relationship',
            text: `${speaker.name} 的发言影响了对 TA 的态度：${truncateWithEllipsis(params.message.content, 36)}`,
          }).slice(-Math.max(16, config.maxTimeline - 4)),
        },
      });
      if (targetLayeredResult.debugInfo) {
        runtimeEvents.push(createMemoryDistillationRuntimeEvent(localizeDistillationEventInfo(targetLayeredResult.debugInfo, distillationParticipants)));
      }

      const relationshipDelta = inferRelationshipDelta(hint);
      if (!relationshipDelta) continue;
      const deltaParts = [
        relationshipDelta.delta.warmth ? `亲和${relationshipDelta.delta.warmth > 0 ? '+' : ''}${relationshipDelta.delta.warmth}` : '',
        relationshipDelta.delta.competence ? `能力${relationshipDelta.delta.competence > 0 ? '+' : ''}${relationshipDelta.delta.competence}` : '',
        relationshipDelta.delta.trust ? `信任${relationshipDelta.delta.trust > 0 ? '+' : ''}${relationshipDelta.delta.trust}` : '',
        relationshipDelta.delta.threat ? `威胁${relationshipDelta.delta.threat > 0 ? '+' : ''}${relationshipDelta.delta.threat}` : '',
      ].filter(Boolean);
      if (!deltaParts.length) continue;

      const confidenceLabel = `${Math.round((hint.confidence || 0) * 100)}%`;
      const relationshipSummary = `${speaker.name}→${target.name}：${deltaParts.join('，')}｜${confidenceLabel}`;
      relationshipLines.push(relationshipSummary);
      const relationshipEvent: RuntimeEventV2 = {
        id: `relationship-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conversationId: params.conversation.id,
        createdAt: Date.now(),
        kind: 'relationship_delta',
        actorIds: [speaker.id],
        targetIds: [target.id],
        summary: relationshipSummary,
        eventClass: 'action',
        visibility: 'public',
        visibleToIds: [],
        visibleToRoles: [],
        payload: relationshipDelta,
      };
      relationshipLedger = reduceRelationshipLedger(relationshipLedger, hint, relationshipEvent);
    }

    if (relationshipLines.length) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'group_relationship_shift',
        title: `${speaker.name} 触发关系变化`,
        summary: relationshipLines.join('\n'),
        pair: [speaker.name, targetEntries[0].target.name],
        metrics: null,
        timelineType: 'relationship',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }

    const normalizedConflict = normalizeConflictFocus(params.message.conflictFocus || null, params.conversation, params.message);
    if (hasMeaningfulConflictChange(params.conversation.worldState.conflictState?.primaryConflict || null, normalizedConflict)) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'conflict_focus_shift',
        title: `${speaker.name} 抓住了一个矛盾点`,
        summary: normalizedConflict?.summary || '',
        metrics: {
          type: normalizedConflict?.type,
          stage: normalizedConflict?.stage,
          severity: normalizedConflict?.severity,
          nextPressure: normalizedConflict?.nextPressure,
          developmentHooks: normalizedConflict?.developmentHooks,
        },
        timelineType: 'note',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }

    if (localizedDriftSummary) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'speaker_drift_shift',
        title: `${speaker.name} 出现人格偏移`,
        summary: localizedDriftSummary,
        timelineType: 'note',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }

    const speakerEmotionLines = getRuntimeAffectEventEmotionLines([{ name: speaker.name, emotion: speakerEmotion }], 'zh');
    if (speakerEmotionLines.length) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'speaker_emotion_shift',
        title: `${speaker.name} 出现情绪变化`,
        summary: speakerEmotionLines.join('\n'),
        timelineType: 'note',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }

    const targetEmotionLines = getRuntimeAffectEventEmotionLines(
      targetEntries.map(({ target }) => ({ target, emotion: deriveEmotionalState(target, params.message.content, config.emotionMultiplier * 0.85, config.emotionDecayBias), name: target.name })),
      'zh'
    );

    if (targetEmotionLines.length) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'target_emotion_shift',
        title: '目标角色出现情绪变化',
        summary: targetEmotionLines.join('\n'),
        timelineType: 'note',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }
  }

  if (params.message.type === 'ai' && speaker && !targetEntries.length) {
    const speakerDrift = derivePersonalityDrift(speaker, params.message.content, config.driftMultiplier * 0.75);
    const speakerEmotion = deriveEmotionalState(speaker, params.message.content, config.emotionMultiplier, config.emotionDecayBias);
    const localizedDriftSummary = getRuntimeAffectEventDriftLine(speaker.name, speakerDrift, 'zh');
    const speakerLayeredResult = maybeDistillCharacterLayeredMemories({
      ...speaker,
      emotionalState: speakerEmotion,
    }, updateCharacterLayeredMemories({
      character: { ...speaker, emotionalState: speakerEmotion },
      content: params.message.content,
      personalityDrift: speakerDrift,
      sourceEventTag: params.conversation.type === 'ai_direct' ? 'ai_direct_self_message' : params.conversation.type === 'direct' ? 'direct_ai_message' : 'interaction',
    }));
    const driftEntries = localizedDriftSummary ? [{ type: 'drift' as const, text: localizedDriftSummary, createdAt: Date.now() }] : [];

    characterPatches.push({
      characterId: speaker.id,
      patch: {
        personalityDrift: speakerDrift,
        emotionalState: speakerEmotion,
        layeredMemories: speakerLayeredResult.layeredMemories,
        runtimeTimeline: accumulateCharacterRuntime(speaker, {
          type: 'memory',
          text: `在${params.conversation.type === 'group' ? '群聊' : params.conversation.type === 'ai_direct' ? 'AI私聊' : '单聊'}中表达了新状态：${truncateWithEllipsis(params.message.content, 48)}`,
        }).concat(driftEntries).slice(-Math.max(20, config.maxTimeline)),
      },
    });
    if (speakerLayeredResult.debugInfo) {
      runtimeEvents.push(createMemoryDistillationRuntimeEvent(localizeDistillationEventInfo(speakerLayeredResult.debugInfo, distillationParticipants)));
    }

    if (localizedDriftSummary) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'speaker_drift_shift',
        title: `${speaker.name} 出现人格偏移`,
        summary: localizedDriftSummary,
        timelineType: 'note',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }

    const speakerEmotionLines = getRuntimeAffectEventEmotionLines([{ name: speaker.name, emotion: speakerEmotion }], 'zh');
    if (speakerEmotionLines.length) {
      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'speaker_emotion_shift',
        title: `${speaker.name} 出现情绪变化`,
        summary: speakerEmotionLines.join('\n'),
        timelineType: 'note',
        eventClass: 'action',
        visibilityScope: 'public',
        createdAt: Date.now(),
      }));
    }
  }

  return { runtimeEvents, characterPatches, relationshipLedger };
}

export function buildWorldRuntimeEvents(
  message: Pick<Message, 'content' | 'type'>,
  previousWorldState: GroupChat['worldState'],
  worldState: GroupChat['worldState'],
  nextConflictAxes: ConversationConflictAxis[],
  config: RuntimeEvolutionConfig,
) {
  const runtimeEvents: DriverEventPayload[] = [];

  if (shouldEmitConflictAxisShift(previousWorldState.conflictAxes || [], nextConflictAxes, message.type, config)) {
    runtimeEvents.push(normalizeRuntimeEvent({
      eventType: 'conflict_axis_shift',
      title: '会话冲突轴发生偏移',
      summary: buildConflictAxesSummary(nextConflictAxes),
      timelineType: 'note',
      eventClass: 'phase',
      visibilityScope: 'public',
    }));
  }

  if (shouldEmitWorldStateShift(previousWorldState, worldState, message.type, config)) {
    runtimeEvents.push(normalizeRuntimeEvent({
      eventType: 'world_state_shift',
      title: '会话状态发生变化',
      summary: buildWorldStateShiftSummary(worldState),
      timelineType: 'note',
      eventClass: 'phase',
      visibilityScope: 'public',
    }));
  }

  return runtimeEvents;
}

export function buildChatPatch(
  conversation: GroupChat,
  message: Pick<Message, 'content' | 'type' | 'senderId'>,
  worldState: GroupChat['worldState'],
  runtimeEvents: DriverEventPayload[],
  config: RuntimeEvolutionConfig = resolveRuntimeEvolutionConfig(conversation.runtimeEvolutionIntensity),
  participants: Array<{ id: string; name: string }> = [],
) {
  const memoryCandidate = message.type === 'ai' ? extractMemoryCandidate(message.content) : null;
  const chatPatch: Partial<GroupChat> = {
    ...accumulateChatRuntime(
      conversation,
      message,
      runtimeEvents,
      { maxTimeline: config.maxTimeline }
    ),
    runtimeSeed: {
      notes: conversation.runtimeSeed?.notes || [],
      artifacts: conversation.runtimeSeed?.artifacts || [],
    },
    ...(memoryCandidate ? {
      runtimeSeed: {
        notes: memoryCandidate.kind === 'note'
          ? [...(conversation.runtimeSeed?.notes || []), memoryCandidate.text].slice(-config.maxNotes)
          : (conversation.runtimeSeed?.notes || []),
        artifacts: memoryCandidate.kind === 'artifact'
          ? [...(conversation.runtimeSeed?.artifacts || []), memoryCandidate.text].slice(-config.maxArtifacts)
          : (conversation.runtimeSeed?.artifacts || []),
      },
    } : {}),
    worldState,
  };

  const chatDistillationResult = maybeDistillChatLayeredMemories(
    { ...conversation, ...chatPatch, worldState } as GroupChat,
    updateLayeredMemoriesWithEvents(
      conversation.layeredMemories || [],
      {
        ...conversation,
        ...chatPatch,
        worldState,
      } as GroupChat,
      message,
      runtimeEvents,
    )
  );

  const nextLayeredMemories = chatDistillationResult.layeredMemories;

  const memoryCandidateEvents = buildMemoryCandidateEvents({
    chat: conversation,
    message,
    existingMemories: conversation.layeredMemories || [],
    nextMemories: nextLayeredMemories,
  });

  chatPatch.layeredMemories = nextLayeredMemories;
  const runtimeEventsV2WithCandidates = appendDistilledMemoryEvents(
    conversation,
    appendMemoryCandidateEvents(conversation.runtimeEventsV2 || [], memoryCandidateEvents),
    nextLayeredMemories,
  );
  chatPatch.runtimeEventsV2 = runtimeEventsV2WithCandidates;

  return {
    ...pruneUnchangedChatRuntimePatch(conversation, chatPatch),
    localDistillationEvent: chatDistillationResult.debugInfo
      ? createMemoryDistillationRuntimeEvent(localizeDistillationEventInfo(chatDistillationResult.debugInfo, participants))
      : null,
  } as Partial<GroupChat> & { localDistillationEvent?: DriverEventPayload | null };
}
