import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventPayload } from './runtimeEventFactory';
import { buildRuntimeMemoryEntryFromEvent, buildTimelineEntryFromRuntimeEvent, normalizeRuntimeEvent, parseRuntimeEvent } from './runtimeEventFactory';

interface RuntimeMemoryEntry {
  kind: 'note' | 'artifact';
  text: string;
}

function uniq(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function accumulateChatRuntime(
  chat: GroupChat,
  message: Pick<Message, 'content' | 'type'>,
  memory?: RuntimeMemoryEntry | null,
  events: RuntimeEventPayload[] = []
) {
  const normalizedEvents = events.map(normalizeRuntimeEvent);
  const nextNotes = [...(chat.runtimeNotes || [])];
  const nextArtifacts = [...(chat.runtimeArtifacts || [])];
  const nextTimeline = [...(chat.runtimeTimeline || [])];

  if (memory?.kind === 'note') {
    nextNotes.push(memory.text);
    nextTimeline.push({ type: 'note', text: memory.text, createdAt: Date.now() });
  }

  if (memory?.kind === 'artifact') {
    nextArtifacts.push(memory.text);
    nextTimeline.push({ type: 'artifact', text: memory.text, createdAt: Date.now() });
  }

  if (message.type === 'event') {
    const parsedEvent = parseRuntimeEvent(message.content);
    if (parsedEvent) {
      normalizedEvents.push(parsedEvent);
    }
  }

  for (const event of normalizedEvents) {
    const timelineEntry = buildTimelineEntryFromRuntimeEvent(event);
    nextTimeline.push(timelineEntry);
    const memoryEntry = buildRuntimeMemoryEntryFromEvent(event);
    if (memoryEntry?.kind === 'note') nextNotes.push(memoryEntry.text);
    if (memoryEntry?.kind === 'artifact') nextArtifacts.push(memoryEntry.text);
  }

  return {
    runtimeNotes: uniq(nextNotes).slice(-12),
    runtimeArtifacts: uniq(nextArtifacts).slice(-8),
    runtimeTimeline: nextTimeline.slice(-20),
  };
}

export function accumulateChatRuntimeFromEvents(chat: GroupChat, events: RuntimeEventPayload[]) {
  return accumulateChatRuntime(chat, { type: 'system', content: '' }, null, events);
}
