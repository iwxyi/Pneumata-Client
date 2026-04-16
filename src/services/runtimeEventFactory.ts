export interface RuntimeEventPayload {
  eventType: string;
  title: string;
  summary: string;
  pair?: [string, string];
  metrics?: unknown;
}

export function buildRuntimeEvent(payload: RuntimeEventPayload) {
  return JSON.stringify(payload);
}
