import type { AICharacter } from '../types/character';
import type { ConversationConflictAxis, DriverCharacterPatch, DriverEventPayload, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { updateCharacterRelationship } from './relationshipEngine';
import { deriveEmotionalState, derivePersonalityDrift } from './personalityDrift';
import { accumulateChatRuntime } from './chatRuntime';
import { accumulateCharacterRuntime } from './characterRuntime';
import { extractMemoryCandidate } from './memoryEngine';
import { evolveConflictAxes, summarizeConflictAxes } from './conflictAxisEngine';
import { updateLayeredMemoriesWithEvents } from './layeredMemoryEngine';
import { normalizeRuntimeEvent } from './runtimeEventFactory';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';

export function buildNextWorldState(conversation: GroupChat, message: Pick<Message, 'content' | 'type'>) {
  const nextConflictAxes = message.type === 'ai' ? evolveConflictAxes(conversation, message.content) : (conversation.worldState.conflictAxes || []);
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
}) {
  const runtimeEvents: DriverEventPayload[] = [];
  const characterPatches: DriverCharacterPatch[] = [];
  const previousAiMessage = params.previousAiMessage;

  if (params.conversation.type === 'group' && params.message.type === 'ai' && previousAiMessage && previousAiMessage.senderId !== params.message.senderId) {
    const speaker = params.characters.find((item) => item.id === params.message.senderId);
    const target = params.characters.find((item) => item.id === previousAiMessage.senderId);
    if (speaker && target) {
      const updatedSpeaker = updateCharacterRelationship(speaker, target.id, params.message.content, 0.45);
      const speakerDrift = derivePersonalityDrift(speaker, params.message.content);
      const speakerEmotion = deriveEmotionalState(speaker, params.message.content);
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
            },
            targetId: target.id,
            targetName: target.name,
            content: params.message.content,
            personalityDrift: speakerDrift,
          }),
          runtimeTimeline: accumulateCharacterRuntime(speaker, {
            type: 'relationship',
            text: `对 ${target.name} 的态度发生变化：${params.message.content.slice(0, 48)}`,
          }).concat(driftEntries).slice(-20),
        },
      });

      runtimeEvents.push(normalizeRuntimeEvent({
        eventType: 'group_relationship_shift',
        title: `${speaker.name} 对 ${target.name} 的态度发生变化`,
        summary: params.message.content.slice(0, 48),
        pair: [speaker.name, target.name],
        metrics: updatedSpeaker.relationships.find((item) => item.characterId === target.id) || null,
        timelineType: 'relationship',
      }));
    }
  }

  return { runtimeEvents, characterPatches };
}

export function buildWorldRuntimeEvents(message: Pick<Message, 'content' | 'type'>, worldState: GroupChat['worldState'], nextConflictAxes: ConversationConflictAxis[]) {
  const runtimeEvents: DriverEventPayload[] = [];

  if (message.type === 'ai' && nextConflictAxes.length) {
    runtimeEvents.push(normalizeRuntimeEvent({
      eventType: 'conflict_axis_shift',
      title: '群聊冲突轴发生偏移',
      summary: summarizeConflictAxes(nextConflictAxes),
      timelineType: 'note',
    }));
  }

  if (message.type === 'ai' && worldState.recentEvent) {
    runtimeEvents.push(normalizeRuntimeEvent({
      eventType: 'world_state_shift',
      title: '群聊状态发生变化',
      summary: [worldState.mood, worldState.focus, worldState.recentEvent].filter(Boolean).join(' / ').slice(0, 90),
      timelineType: 'note',
    }));
  }

  return runtimeEvents;
}

export function buildChatPatch(conversation: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'>, worldState: GroupChat['worldState'], runtimeEvents: DriverEventPayload[]) {
  const memoryCandidate = message.type === 'ai' ? extractMemoryCandidate(message.content) : null;
  const chatPatch: Partial<GroupChat> = {
    ...accumulateChatRuntime(conversation, message, memoryCandidate ? { kind: memoryCandidate.kind, text: memoryCandidate.text } : null, runtimeEvents),
    worldState,
  };

  chatPatch.layeredMemories = updateLayeredMemoriesWithEvents(
    conversation.layeredMemories || [],
    {
      ...conversation,
      ...chatPatch,
      worldState,
    } as GroupChat,
    message,
    runtimeEvents,
  );

  return chatPatch;
}
