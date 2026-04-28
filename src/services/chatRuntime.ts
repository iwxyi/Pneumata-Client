import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { RuntimeEventPayload } from './runtimeEventFactory';
import { buildRuntimeMemoryEntryFromEvent, buildTimelineEntryFromRuntimeEvent, normalizeRuntimeEvent, parseRuntimeEvent } from './runtimeEventFactory';

function convertRuntimeEventV2ToPayload(event: RuntimeEventV2): RuntimeEventPayload {
  return {
    eventType: event.kind,
    title: event.kind,
    summary: event.summary,
    createdAt: event.createdAt,
    timelineType: event.kind === 'artifact' ? 'artifact' : event.kind === 'interaction' || event.kind === 'relationship_delta' ? 'relationship' : 'note',
  };
}

function eventToMemoryEntry(event: RuntimeEventV2) {
  return buildRuntimeMemoryEntryFromEvent(convertRuntimeEventV2ToPayload(event));
}

function eventToTimelineEntry(event: RuntimeEventV2) {
  return buildTimelineEntryFromRuntimeEvent(convertRuntimeEventV2ToPayload(event));
}

void eventToTimelineEntry;

void eventToMemoryEntry;

void convertRuntimeEventV2ToPayload;

void normalizeRuntimeEvent;

function uniq(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function accumulateChatRuntime(
  chat: GroupChat,
  message: Pick<Message, 'content' | 'type'>,
  events: RuntimeEventPayload[] = [],
  options: { maxTimeline?: number } = {}
) {
  const normalizedEvents = events.map(normalizeRuntimeEvent);
  const nextTimeline = [...(chat.runtimeTimeline || [])];

  if (message.type === 'event') {
    const parsedEvent = parseRuntimeEvent(message.content);
    if (parsedEvent) normalizedEvents.push(parsedEvent);
  }

  for (const event of normalizedEvents) {
    nextTimeline.push(buildTimelineEntryFromRuntimeEvent(event));
  }

  return {
    runtimeTimeline: nextTimeline.slice(-(options.maxTimeline || 20)),
  };
}

export function accumulateChatRuntimeFromEvents(chat: GroupChat, events: RuntimeEventPayload[], options: { maxTimeline?: number } = {}) {
  return accumulateChatRuntime(chat, { type: 'system', content: '' }, events, options);
}

export function projectLegacyRuntimeSeed(chat: GroupChat) {
  const notes = [...(chat.runtimeSeed?.notes || [])];
  const artifacts = [...(chat.runtimeSeed?.artifacts || [])];

  for (const event of chat.runtimeEventsV2 || []) {
    const memoryEntry = eventToMemoryEntry(event);
    if (memoryEntry?.kind === 'note') notes.push(memoryEntry.text);
    if (memoryEntry?.kind === 'artifact') artifacts.push(memoryEntry.text);
  }

  for (const item of chat.runtimeTimeline || []) {
    if (item.type === 'note') notes.push(item.text);
    if (item.type === 'artifact') artifacts.push(item.text);
  }

  return {
    notes: uniq(notes),
    artifacts: uniq(artifacts),
  };
}
