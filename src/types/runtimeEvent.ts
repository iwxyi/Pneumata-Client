export type RuntimeEventKind =
  | 'message_generated'
  | 'interaction'
  | 'relationship_delta'
  | 'room_shift'
  | 'memory_candidate'
  | 'artifact'
  | 'event_candidate'
  | 'phase_transition'
  | 'action_resolution'
  | 'board_state'
  | 'score_update';

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

export interface InteractionHintEnvelope {
  targetId?: string | null;
  kind?: InteractionKind;
  tone?: InteractionEventPayload['tone'];
  intensity?: number;
  confidence?: number;
  reason?: string;
}

export interface InteractionHintCollection {
  primary?: InteractionHintEnvelope | null;
  secondary?: InteractionHintEnvelope[] | null;
}

export function isInteractionPayloadMeaningful(payload: Pick<InteractionEventPayload, 'targetId' | 'kind'> | null | undefined) {
  return Boolean(payload?.targetId && payload?.kind && payload.kind !== 'side_comment');
}

export function normalizeInteractionHintPayload(hint: InteractionHintEnvelope | null | undefined, actorId: string, content: string): InteractionEventPayload | null {
  if (!hint?.targetId || !hint.kind || hint.kind === 'side_comment') return null;
  const rawIntensity = Number(hint.intensity || 0);
  const rawConfidence = Number(hint.confidence || 0);
  const intensity = Math.max(1, Math.min(5, rawIntensity > 5 ? Math.round(rawIntensity / 20) : rawIntensity));
  const confidence = Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));
  return {
    actorId,
    targetId: hint.targetId,
    kind: hint.kind,
    tone: hint.tone || 'cold',
    intensity,
    confidence,
    evidenceText: content.slice(0, 120),
  };
}

export function normalizeInteractionHintCollection(hints: InteractionHintCollection | null | undefined, actorId: string, content: string) {
  const primary = normalizeInteractionHintPayload(hints?.primary || null, actorId, content);
  const secondary = (hints?.secondary || []).map((hint) => normalizeInteractionHintPayload(hint, actorId, content)).filter(Boolean) as InteractionEventPayload[];
  return [primary, ...secondary].filter(Boolean) as InteractionEventPayload[];
}

export function summarizeCompactRelationshipDeltaLines(lines: Array<{ actorName: string; targetName: string; delta: Partial<Record<'warmth' | 'competence' | 'trust' | 'threat', number>> }>) {
  return lines.map((line) => {
    const parts = [
      line.delta.warmth ? `亲和${line.delta.warmth > 0 ? '+' : ''}${line.delta.warmth}` : '',
      line.delta.competence ? `能力${line.delta.competence > 0 ? '+' : ''}${line.delta.competence}` : '',
      line.delta.trust ? `信任${line.delta.trust > 0 ? '+' : ''}${line.delta.trust}` : '',
      line.delta.threat ? `威胁${line.delta.threat > 0 ? '+' : ''}${line.delta.threat}` : '',
    ].filter(Boolean).join('，');
    return `${line.actorName}→${line.targetName}：${parts || '无变化'}`;
  }).join('\n');
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
  channelId?: string;
  causedByIntentId?: string;
  threadRef?: string;
  eventClass?: 'message' | 'action' | 'board' | 'phase' | 'score' | 'artifact';
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
