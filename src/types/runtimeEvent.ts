export type RuntimeEventKind =
  | 'message_generated'
  | 'interaction'
  | 'relationship_delta'
  | 'room_shift'
  | 'memory_candidate'
  | 'artifact'
  | 'event_candidate';

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

export interface RelationshipAxisReason {
  axis: 'warmth' | 'competence' | 'trust' | 'threat';
  value: number;
  reason: string;
  evidence: string;
  createdAt?: number;
}

export interface RelationshipDeltaPayload {
  actorId: string;
  targetId: string;
  delta: {
    warmth?: number;
    competence?: number;
    trust?: number;
    threat?: number;
  };
  reason: string;
  axisReasons?: Partial<Record<'warmth' | 'competence' | 'trust' | 'threat', RelationshipAxisReason[]>>;
  spikeType?: 'normal' | 'turning_point' | 'rupture' | 'bonding';
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

export type SocialEventKind = 'pair_private_thread' | 'social_outing' | 'post_moment' | 'status_update' | 'gift_exchange' | 'conflict_expression' | 'custom';

export interface SocialEventCandidatePayload {
  eventKind: SocialEventKind;
  initiatorId: string;
  participantIds: string[];
  targetIds?: string[];
  reasonType: string;
  confidence: number;
  urgency: 'immediate' | 'soon' | 'defer';
  seedIntent: string;
  visibilityPlan: 'public' | 'conversation_private' | 'user_private' | 'mixed';
  expectedArtifacts?: string[];
  sourceText?: string;
  title?: string;
  activityType?: string;
  timeHint?: string | null;
  locationHint?: string | null;
  dedupeKey?: string | null;
}

export interface SocialEventHintEnvelope {
  eventKind: SocialEventKind;
  targetIds?: string[];
  participantIds?: string[];
  reasonType?: string;
  confidence?: number;
  urgency?: 'immediate' | 'soon' | 'defer';
  seedIntent?: string;
  visibilityPlan?: 'public' | 'conversation_private' | 'user_private' | 'mixed';
  expectedArtifacts?: string[];
  title?: string;
  activityType?: string;
  timeHint?: string | null;
  locationHint?: string | null;
  dedupeKey?: string | null;
}

export interface RecentSocialEventSummary {
  eventKind: SocialEventKind;
  title?: string;
  activityType?: string;
  participantIds?: string[];
  targetIds?: string[];
  createdAt: number;
  summary: string;
}

export interface SocialOutingAnalysisResult {
  shouldCreate: boolean;
  title?: string;
  activityType?: string;
  timeHint?: string | null;
  locationHint?: string | null;
  participantIds?: string[];
  confidence?: number;
  reasonType?: string;
  dedupeKey?: string | null;
  seedIntent?: string;
}

export interface PostMomentAnalysisResult {
  shouldCreate: boolean;
  title?: string;
  activityType?: string;
  targetIds?: string[];
  confidence?: number;
  reasonType?: string;
  dedupeKey?: string | null;
  seedIntent?: string;
}

export interface PairPrivateThreadAnalysisResult {
  shouldCreate: boolean;
  participantIds?: string[];
  targetIds?: string[];
  confidence?: number;
  reasonType?: string;
  dedupeKey?: string | null;
  seedIntent?: string;
}

export interface SocialEventEffectPayload {
  eventKind: SocialEventKind;
  effectType: 'memory' | 'relationship' | 'room' | 'artifact';
  summary: string;
  confidence: number;
}

export interface SocialEventArtifactPayload {
  artifactType: string;
  eventKind: SocialEventKind;
  text: string;
  expectedArtifacts?: string[];
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
  visibility?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public';
  visibleToIds?: string[];
  visibleToRoles?: string[];
  payload: InteractionEventPayload | RelationshipDeltaPayload | RoomShiftPayload | MemoryCandidatePayload | SocialEventCandidatePayload | SocialEventEffectPayload | SocialEventArtifactPayload | Record<string, unknown>;
}

export interface RelationshipLedgerEntry {
  pairKey: string;
  actorId: string;
  targetId: string;
  current: {
    warmth: number;
    competence: number;
    trust: number;
    threat: number;
  };
  derived?: {
    stability?: number;
    reciprocity?: number;
    salience?: number;
  };
  axisReasons?: Partial<Record<'warmth' | 'competence' | 'trust' | 'threat', RelationshipAxisReason[]>>;
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
