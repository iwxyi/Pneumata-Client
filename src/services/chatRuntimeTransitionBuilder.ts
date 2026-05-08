import type { AICharacter } from '../types/character';
import type { ConversationConflictAxis, DriverCharacterPatch, DriverEventPayload, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { updateCharacterRelationship } from './relationshipEngine';
import { deriveEmotionalState, derivePersonalityDrift } from './personalityDrift';
import { accumulateChatRuntime } from './chatRuntime';
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

export function buildRelationshipTransition(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
  config?: RuntimeEvolutionConfig;
}) {
  const runtimeEvents: DriverEventPayload[] = [];
  const characterPatches: DriverCharacterPatch[] = [];
  const previousAiMessage = params.previousAiMessage;
  const config = params.config || resolveRuntimeEvolutionConfig(params.conversation.runtimeEvolutionIntensity);
  const recentNonSpeaker = [...params.characters].find((item) => item.id !== params.message.senderId && (params.message.content.includes(item.name) || previousAiMessage?.senderId === item.id));

  if (params.message.type === 'ai' && recentNonSpeaker) {
    const speaker = params.characters.find((item) => item.id === params.message.senderId);
    const target = recentNonSpeaker;
    if (speaker && target) {
      const updatedSpeakerBase = updateCharacterRelationship(speaker, target.id, params.message.content, config.relationshipMultiplier);
      const updatedTargetBase = updateCharacterRelationship(target, speaker.id, params.message.content, config.reciprocalRelationshipMultiplier);
      const summary = truncateWithEllipsis(params.message.content, 48);
      const updatedSpeaker = {
        ...updatedSpeakerBase,
        relationships: updatedSpeakerBase.relationships.map((relation) => relation.characterId === target.id ? { ...relation, note: `${speaker.name} ↔ ${target.name}：${summary}` } : relation),
      };
      const updatedTarget = {
        ...updatedTargetBase,
        relationships: updatedTargetBase.relationships.map((relation) => relation.characterId === speaker.id ? { ...relation, note: `${target.name} ↔ ${speaker.name}：${summary}` } : relation),
      };
      const speakerDrift = derivePersonalityDrift(speaker, params.message.content, config.driftMultiplier);
      const speakerEmotion = deriveEmotionalState(speaker, params.message.content, config.emotionMultiplier, config.emotionDecayBias);
      const targetEmotion = deriveEmotionalState(target, params.message.content, config.emotionMultiplier * 0.85, config.emotionDecayBias);
      const driftEntries = Object.keys(speakerDrift).length ? [
        {
          type: 'drift' as const,
          text: `受到互动影响，性格出现漂移：${Object.entries(speakerDrift).map(([key, value]) => `${key}${value > 0 ? '+' : ''}${value}`).join('，')}`,
          createdAt: Date.now(),
        },
      ] : [];

      characterPatches.push({
        characterId: speaker.id,
        patch: {
          relationships: updatedSpeaker.relationships,
          personalityDrift: speakerDrift,
          emotionalState: speakerEmotion,
          layeredMemories: updateCharacterLayeredMemories({
            character: {
              ...speaker,
              relationships: updatedSpeaker.relationships,
              emotionalState: speakerEmotion,
            },
            targetId: target.id,
            targetName: target.name,
            content: params.message.content,
            personalityDrift: speakerDrift,
          }),
          runtimeTimeline: accumulateCharacterRuntime(speaker, {
            type: 'relationship',
            text: `对 ${target.name} 的态度发生变化：${summary}`,
          }).concat(driftEntries).slice(-Math.max(20, config.maxTimeline)),
        },
      });

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

      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'group_relationship_shift',
        title: `${speaker.name} 对 ${target.name} 的态度发生变化`,
        summary: summary,
        pair: [speaker.name, target.name],
        metrics: updatedSpeaker.relationships.find((item) => item.characterId === target.id) || null,
        timelineType: 'relationship',
        eventClass: 'action',
        visibilityScope: 'public',
      }));
    }
  }

  return { runtimeEvents, characterPatches };
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
