export interface RuntimeEventPayload {
  eventType: string;
  title: string;
  summary: string;
  pair?: [string, string];
  metrics?: unknown;
  timelineType?: 'note' | 'artifact' | 'relationship';
  createdAt?: number;
}

export function normalizeRuntimeEvent(payload: RuntimeEventPayload): RuntimeEventPayload {
  return {
    ...payload,
    timelineType: payload.timelineType || (payload.eventType === 'group_relationship_shift' || payload.eventType === 'relationship_shift' ? 'relationship' : 'note'),
    createdAt: payload.createdAt || Date.now(),
  };
}

export function buildRuntimeEvent(payload: RuntimeEventPayload) {
  return JSON.stringify(normalizeRuntimeEvent(payload));
}

export function parseRuntimeEvent(content: string): RuntimeEventPayload | null {
  try {
    return normalizeRuntimeEvent(JSON.parse(content) as RuntimeEventPayload);
  } catch {
    return null;
  }
}

export function describeRuntimeEvent(payload: RuntimeEventPayload) {
  const event = normalizeRuntimeEvent(payload);
  return [event.title, event.summary].filter(Boolean).join('：').slice(0, 120);
}

export function buildTimelineEntryFromRuntimeEvent(payload: RuntimeEventPayload) {
  const event = normalizeRuntimeEvent(payload);
  return {
    type: event.timelineType || 'note',
    text: describeRuntimeEvent(event),
    createdAt: event.createdAt || Date.now(),
  };
}

export function buildRuntimeMemoryEntryFromEvent(payload: RuntimeEventPayload): { kind: 'note' | 'artifact'; text: string } | null {
  const event = normalizeRuntimeEvent(payload);
  if (event.eventType === 'world_state_shift' || event.eventType === 'conflict_axis_shift') {
    return { kind: 'note', text: describeRuntimeEvent(event) };
  }
  return null;
}
