import type { AICharacter } from '../types/character';
import type { ConversationConflictAxis, DriverCharacterPatch, DriverEventPayload, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { deriveFallbackRelationshipDelta, updateCharacterRelationship, updateCharacterRelationshipFromDelta } from './relationshipEngine';
import { createBaselineRelationshipCurrent, inferRelationshipDelta, reduceRelationshipLedger } from './relationshipLedger';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { deriveEmotionalState, derivePersonalityDrift, getRuntimeAffectEventDriftLine, getRuntimeAffectEventEmotionLines } from './personalityDrift';import { accumulateChatRuntime } from './chatRuntime';
import { accumulateCharacterRuntime } from './characterRuntime';
import { extractMemoryCandidate } from './memoryEngine';
import { evolveConflictAxes, summarizeConflictAxes } from './conflictAxisEngine';
import { appendMemoryCandidateEvents, buildMemoryCandidateEvents, updateLayeredMemoriesWithEvents } from './layeredMemoryEngine';
import { normalizeRuntimeEvent } from './runtimeEventFactory';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';
import type { RuntimeEvolutionConfig } from './runtimeEvolutionConfig';
import { resolveRuntimeEvolutionConfig } from './runtimeEvolutionConfig';

function truncateWithEllipsis(text: string, maxLength: number) {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function buildNextWorldState(conversation: GroupChat, message: Pick<Message, 'content' | 'type'>, config: RuntimeEvolutionConfig = resolveRuntimeEvolutionConfig(conversation.runtimeEvolutionIntensity)) {
  const nextConflictAxes = message.type === 'ai' && config.worldMultiplier >= 0.7 ? evolveConflictAxes(conversation, message.content) : (conversation.worldState.conflictAxes || []);
  return {
    worldState: {
      ...conversation.worldState,
      conflictAxes: nextConflictAxes,
      recentEvent: message.type === 'ai' && nextConflictAxes.length ? summarizeConflictAxes(nextConflictAxes) : conversation.worldState.recentEvent,
    },
    nextConflictAxes,
  };
}

function buildSeededRelationshipLedger(conversation: GroupChat, characters: AICharacter[]) {
  if ((conversation.relationshipLedger || []).length > 0) return conversation.relationshipLedger || [];
  const seeded = characters.flatMap((character) => character.relationships
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
  return seeded;
}

export function buildRelationshipTransition(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: import('../types/runtimeEvent').InteractionEventPayload | null; interactionHints?: import('../types/runtimeEvent').InteractionEventPayload[] | null };
  previousAiMessage?: Pick<Message, 'senderId'> | null;
  config?: RuntimeEvolutionConfig;
}) {
  const runtimeEvents: DriverEventPayload[] = [];
  const characterPatches: DriverCharacterPatch[] = [];
  let relationshipLedger = buildSeededRelationshipLedger(params.conversation, params.characters);
  const previousAiMessage = params.previousAiMessage;
  const config = params.config || resolveRuntimeEvolutionConfig(params.conversation.runtimeEvolutionIntensity);
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
    const driftEntries = localizedDriftSummary ? [
      {
        type: 'drift' as const,
        text: localizedDriftSummary,
        createdAt: Date.now(),
      },
    ] : [];

    const updatedSpeakerRelationships = targetEntries.reduce((relationships, { target, hint }) => {
      const explicitDelta = inferRelationshipDelta(hint)?.delta || deriveFallbackRelationshipDelta(params.message.content);
      return updateCharacterRelationshipFromDelta({ ...speaker, relationships }, target.id, explicitDelta, config.relationshipMultiplier).relationships;
    }, speaker.relationships);

    characterPatches.push({
      characterId: speaker.id,
      patch: {
        relationships: updatedSpeakerRelationships,
        personalityDrift: speakerDrift,
        emotionalState: speakerEmotion,
        layeredMemories: updateCharacterLayeredMemories({
          character: {
            ...speaker,
            relationships: updatedSpeakerRelationships,
            emotionalState: speakerEmotion,
          },
          targetId: targetEntries[0].target.id,
          targetName: targetEntries.map(({ target }) => target.name).join('、'),
          content: params.message.content,
          personalityDrift: speakerDrift,
        }),
        runtimeTimeline: accumulateCharacterRuntime(speaker, {
          type: 'relationship',
          text: `对 ${targetEntries.map(({ target }) => target.name).join('、')} 的态度发生变化：${summary}`,
        }).concat(driftEntries).slice(-Math.max(20, config.maxTimeline)),
      },
    });

    const relationshipLines: string[] = [];

    for (const { target, hint } of targetEntries) {
      const reciprocalDelta = inferRelationshipDelta(hint)?.delta || deriveFallbackRelationshipDelta(params.message.content);
      const updatedTarget = updateCharacterRelationshipFromDelta(target, speaker.id, reciprocalDelta, config.reciprocalRelationshipMultiplier);
      const targetEmotion = deriveEmotionalState(target, params.message.content, config.emotionMultiplier * 0.85, config.emotionDecayBias);

      characterPatches.push({
        characterId: target.id,
        patch: {
          relationships: updatedTarget.relationships,
          emotionalState: targetEmotion,
          layeredMemories: updateCharacterLayeredMemories({
            character: {
              ...target,
              relationships: updatedTarget.relationships,
              emotionalState: targetEmotion,
            },
            targetId: speaker.id,
            targetName: speaker.name,
            content: params.message.content,
            personalityDrift: {},
          }),
          runtimeTimeline: accumulateCharacterRuntime(target, {
            type: 'relationship',
            text: `${speaker.name} 的发言影响了对 TA 的态度：${truncateWithEllipsis(params.message.content, 36)}`,
          }).slice(-Math.max(16, config.maxTimeline - 4)),
        },
      });

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

  return { runtimeEvents, characterPatches, relationshipLedger };
}

export function buildWorldRuntimeEvents(message: Pick<Message, 'content' | 'type'>, worldState: GroupChat['worldState'], nextConflictAxes: ConversationConflictAxis[], config: RuntimeEvolutionConfig) {
  const runtimeEvents: DriverEventPayload[] = [];

  if (message.type === 'ai' && nextConflictAxes.length && config.worldMultiplier >= 0.7) {
    runtimeEvents.push(normalizeRuntimeEvent({
      eventType: 'conflict_axis_shift',
      title: '群聊冲突轴发生偏移',
      summary: summarizeConflictAxes(nextConflictAxes),
      timelineType: 'note',
      eventClass: 'phase',
      visibilityScope: 'public',
    }));
  }

  if (message.type === 'ai' && worldState.recentEvent && config.worldMultiplier >= 0.9) {
    runtimeEvents.push(normalizeRuntimeEvent({
      eventType: 'world_state_shift',
      title: '群聊状态发生变化',
      summary: [worldState.mood, worldState.focus, worldState.recentEvent].filter(Boolean).join(' / ').slice(0, 90),
      timelineType: 'note',
      eventClass: 'phase',
      visibilityScope: 'public',
    }));
  }

  return runtimeEvents;
}

export function buildChatPatch(conversation: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'>, worldState: GroupChat['worldState'], runtimeEvents: DriverEventPayload[], config: RuntimeEvolutionConfig = resolveRuntimeEvolutionConfig(conversation.runtimeEvolutionIntensity)) {
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

  const nextLayeredMemories = updateLayeredMemoriesWithEvents(
    conversation.layeredMemories || [],
    {
      ...conversation,
      ...chatPatch,
      worldState,
    } as GroupChat,
    message,
    runtimeEvents,
  );

  const memoryCandidateEvents = buildMemoryCandidateEvents({
    chat: conversation,
    message,
    existingMemories: conversation.layeredMemories || [],
    nextMemories: nextLayeredMemories,
  });

  chatPatch.layeredMemories = nextLayeredMemories;
  chatPatch.runtimeEventsV2 = appendMemoryCandidateEvents(conversation.runtimeEventsV2 || [], memoryCandidateEvents);

  return chatPatch;
}
