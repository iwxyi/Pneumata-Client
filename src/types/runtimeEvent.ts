export type RuntimeEventKind =
  | 'message_generated'
  | 'interaction'
  | 'relationship_delta'
  | 'room_shift'
  | 'memory_candidate'
  | 'artifact';

export type InteractionKind =
  | 'support'
  | 'challenge'
  | 'mock'
  | 'dismiss'
  | 'defend'
  | 'evade'
  | 'probe'
  | 'pile_on'
  | 'redirect'
  | 'side_comment';

export interface InteractionEventPayload {
  kind: InteractionKind;
  actorId: string;
  targetId?: string | null;
  intensity: number;
  tone: 'warm' | 'annoyed' | 'defensive' | 'excited' | 'sarcastic' | 'cold';
  evidenceText: string;
  confidence: number;
}

export interface RelationshipDeltaPayload {
  actorId: string;
  targetId: string;
  delta: {
    affinity?: number;
    respect?: number;
    hostility?: number;
    contempt?: number;
  };
  reason: string;
}

export interface RoomShiftPayload {
  heat?: number;
  cohesion?: number;
  topicDrift?: number;
  dominantThread?: [string, string] | null;
  pileOnTarget?: string | null;
  delta?: {
    heat?: number;
    cohesion?: number;
    topicDrift?: number;
  };
}

export interface MemoryCandidatePayload {
  kind: 'fact' | 'topic' | 'preference' | 'secret' | 'relationship';
  text: string;
  salience: number;
  confidence: number;
}

export interface RuntimeEventV2 {
  id: string;
  conversationId: string;
  kind: RuntimeEventKind;
  createdAt: number;
  actorIds?: string[];
  targetIds?: string[];
  evidenceMessageIds?: string[];
  summary: string;
  payload: InteractionEventPayload | RelationshipDeltaPayload | RoomShiftPayload | MemoryCandidatePayload | Record<string, unknown>;
}

export interface RelationshipLedgerEntry {
  pairKey: string;
  actorId: string;
  targetId: string;
  current: {
    affinity: number;
    respect: number;
    hostility: number;
    contempt: number;
  };
  trend: 'up' | 'down' | 'volatile' | 'flat';
  recentEvents: RuntimeEventV2[];
  lastUpdatedAt: number;
}

export interface RoomStateSnapshotV2 {
  heat: number;
  cohesion: number;
  topicDrift: number;
  dominantThread: [string, string] | null;
  alliances: Array<[string, string]>;
  conflictPairs: Array<[string, string]>;
  pileOnTarget: string | null;
  silencedActors: string[];
}
