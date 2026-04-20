import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { consolidateMemoryCandidates } from './memoryConsolidation';
import { retrieveRelevantMemories } from './memoryRetrieval';
import type { RuntimeEventPayload } from './runtimeEventFactory';
import { normalizeRuntimeEvent } from './runtimeEventFactory';

interface RuntimeEventLike extends RuntimeEventPayload {}

function buildDecisionCandidate(chat: GroupChat, text: string): MemoryCandidate | null {
  if (!/(总结|共识|方案|清单|计划|summary|plan|checklist)/i.test(text)) return null;
  return {
    scope: 'conversation',
    layerHint: 'long_term',
    kind: 'decision',
    ownerId: chat.id,
    text: text.slice(0, 120),
    sourceEventIds: [],
    scoreBreakdown: { stability: 0.8, recurrence: 0.4, impact: 0.7, specificity: 0.7, durability: 0.8 },
  };
}

function buildConflictCandidate(chat: GroupChat): MemoryCandidate | null {
  if (!chat.worldState.conflictAxes?.length) return null;
  return {
    scope: 'conversation',
    layerHint: 'episodic',
    kind: 'conflict',
    ownerId: chat.id,
    text: `${chat.worldState.conflictAxes.map((axis) => `${axis.title}:${axis.currentTilt || 0}`).join('；')}`,
    sourceEventIds: [],
    scoreBreakdown: { stability: 0.55, recurrence: 0.6, impact: 0.7, specificity: 0.65, durability: 0.6 },
  };
}

function buildWorldStateCandidate(chat: GroupChat): MemoryCandidate | null {
  if (!chat.worldState.focus && !chat.worldState.mood && !chat.worldState.recentEvent) return null;
  return {
    scope: 'system_runtime',
    layerHint: 'working',
    kind: 'status_shift',
    ownerId: chat.id,
    text: [chat.worldState.mood, chat.worldState.focus, chat.worldState.recentEvent].filter(Boolean).join(' / ').slice(0, 120),
    sourceEventIds: [],
    scoreBreakdown: { stability: 0.45, recurrence: 0.55, impact: 0.6, specificity: 0.6, durability: 0.45 },
  };
}

function buildRelationshipCandidate(chat: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'>): MemoryCandidate | null {
  if (message.type !== 'ai' || !/反对|支持|欣赏|讨厌|质疑|阴阳|嘲讽|帮助|护着|针对/i.test(message.content)) return null;
  return {
    scope: 'conversation',
    layerHint: 'episodic',
    kind: 'trait_evidence',
    ownerId: chat.id,
    text: message.content.trim().slice(0, 120),
    sourceEventIds: [],
    scoreBreakdown: { stability: 0.5, recurrence: 0.5, impact: 0.65, specificity: 0.7, durability: 0.5 },
  };
}

function buildMemoryCandidatesFromRuntimeEvents(chat: GroupChat, events: RuntimeEventLike[]): MemoryCandidate[] {
  return events.map(normalizeRuntimeEvent).flatMap<MemoryCandidate>((event) => {
    if (event.eventType === 'group_relationship_shift' || event.eventType === 'relationship_shift') {
      return [{
        scope: 'relationship',
        layerHint: 'episodic',
        kind: /升温|靠近|支持|保护/.test(event.summary) ? 'bond' : 'resentment',
        ownerId: chat.id,
        subjectIds: event.pair || [],
        text: `${event.title}：${event.summary}`.slice(0, 128),
        sourceEventIds: [event.eventType],
        scoreBreakdown: { stability: 0.65, recurrence: 0.55, impact: 0.8, specificity: 0.7, durability: 0.65 },
      }];
    }

    if (event.eventType === 'private_chat_started') {
      return [{
        scope: 'thread',
        layerHint: 'episodic',
        kind: 'thread_effect',
        ownerId: chat.id,
        subjectIds: event.pair || [],
        text: `${event.title}：${event.summary}`.slice(0, 128),
        sourceEventIds: [event.eventType],
        scoreBreakdown: { stability: 0.6, recurrence: 0.45, impact: 0.75, specificity: 0.7, durability: 0.6 },
      }];
    }

    if (event.eventType === 'conflict_axis_shift') {
      return [{
        scope: 'conversation',
        layerHint: 'episodic',
        kind: 'conflict',
        ownerId: chat.id,
        text: event.summary.slice(0, 128),
        sourceEventIds: [event.eventType],
        scoreBreakdown: { stability: 0.7, recurrence: 0.6, impact: 0.8, specificity: 0.7, durability: 0.65 },
      }];
    }

    if (event.eventType === 'world_state_shift') {
      return [{
        scope: 'system_runtime',
        layerHint: 'working',
        kind: 'status_shift',
        ownerId: chat.id,
        text: event.summary.slice(0, 128),
        sourceEventIds: [event.eventType],
        scoreBreakdown: { stability: 0.5, recurrence: 0.55, impact: 0.7, specificity: 0.65, durability: 0.5 },
      }];
    }

    return [];
  });
}

export function buildMemoryCandidates(chat: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'>, events: RuntimeEventLike[] = []) {
  const normalizedEvents = events.map(normalizeRuntimeEvent);
  const eventCandidates = buildMemoryCandidatesFromRuntimeEvents(chat, normalizedEvents);
  const fallbackCandidates = normalizedEvents.length === 0 ? [
    buildDecisionCandidate(chat, message.content.trim()),
    buildConflictCandidate(chat),
    buildWorldStateCandidate(chat),
    buildRelationshipCandidate(chat, message),
  ].filter(Boolean) as MemoryCandidate[] : [];
  return [...eventCandidates, ...fallbackCandidates];
}

export function updateLayeredMemories(existing: MemoryItem[], chat: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'>) {
  return consolidateMemoryCandidates(existing, buildMemoryCandidates(chat, message));
}

export function updateLayeredMemoriesWithEvents(existing: MemoryItem[], chat: GroupChat, message: Pick<Message, 'content' | 'type' | 'senderId'>, events: RuntimeEventLike[] = []) {
  return consolidateMemoryCandidates(existing, buildMemoryCandidates(chat, message, events));
}

export function summarizeLayeredMemories(items: MemoryItem[]) {
  return items.slice(-3).map((item) => item.text).join(' / ');
}

export function getMemoryContext(items: MemoryItem[], speakerId: string, targetId: string | null | undefined, conversationId: string) {
  return retrieveRelevantMemories(items, {
    speakerId,
    targetId,
    conversationId,
    maxItems: 6,
  });
}
