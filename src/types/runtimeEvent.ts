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
  targetIds?: string[] | null;
  kind?: InteractionKind;
  tone?: InteractionEventPayload['tone'];
  intensity?: number;
  confidence?: number;
  reason?: string;
}

export interface AddressedTargetHintEnvelope {
  targetIds?: string[] | null;
  primaryTargetId?: string | null;
  confidence?: number;
  reason?: string;
}

export interface AddressedTargetHint {
  actorId: string;
  targetIds: string[];
  primaryTargetId?: string | null;
  confidence: number;
  evidenceText: string;
}

export interface InteractionHintCollection {
  primary?: InteractionHintEnvelope | null;
  secondary?: InteractionHintEnvelope[] | null;
}

export function isInteractionPayloadMeaningful(payload: Pick<InteractionEventPayload, 'targetId' | 'kind'> | null | undefined) {
  return Boolean(payload?.targetId && payload?.kind && payload.kind !== 'side_comment');
}

export function normalizeInteractionHintPayload(hint: InteractionHintEnvelope | null | undefined, actorId: string, content: string): InteractionEventPayload | null {
  const resolvedTargetId = hint?.targetId || hint?.targetIds?.[0] || null;
  if (!resolvedTargetId || !hint?.kind || hint.kind === 'side_comment') return null;
  const rawIntensity = Number(hint.intensity || 0);
  const rawConfidence = Number(hint.confidence || 0);
  const intensity = Math.max(1, Math.min(5, rawIntensity > 5 ? Math.round(rawIntensity / 20) : rawIntensity));
  const confidence = Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));
  return {
    actorId,
    targetId: resolvedTargetId,
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

export type ConflictType =
  | 'identity_ownership'
  | 'authority_challenge'
  | 'status_competition'
  | 'alliance_boundary'
  | 'care_jealousy'
  | 'value_conflict'
  | 'goal_conflict'
  | 'resource_conflict'
  | 'fairness_conflict'
  | 'contradiction_exposure'
  | 'tone_escalation'
  | 'misrecognition';

export type ConflictStage = 'latent' | 'emerging' | 'open' | 'escalating' | 'fragmented' | 'cooling' | 'resolved';
export type ConflictNextPressure = 'escalate' | 'spread' | 'stabilize' | 'divert' | 'cool';
export type ConflictDevelopmentHook =
  | 'invite_target_response'
  | 'force_side_taking'
  | 'expose_contradiction'
  | 'raise_stakes'
  | 'shift_public_private'
  | 'cool_down_with_residue'
  | 'redirect_topic'
  | 'trigger_memory_recall';

export interface ConflictFocusPayload {
  present: boolean;
  type?: ConflictType;
  severity?: number;
  stage?: ConflictStage;
  summary?: string;
  primaryTargetIds?: string[];
  participantIds?: string[];
  nextPressure?: ConflictNextPressure;
  developmentHooks?: ConflictDevelopmentHook[];
  why?: string;
}

export interface ConflictFocusState {
  id: string;
  scope: 'group' | 'direct' | 'ai_direct';
  type: ConflictType;
  severity: number;
  stage: ConflictStage;
  summary: string;
  participantIds: string[];
  targetIds?: string[];
  triggerMessageId?: string;
  nextPressure: ConflictNextPressure;
  developmentHooks: ConflictDevelopmentHook[];
  sourceEventIds: string[];
  updatedAt: number;
}

export interface ConflictRuntimeState {
  primaryConflict?: ConflictFocusState | null;
  activeConflicts: ConflictFocusState[];
  developmentHooks: ConflictDevelopmentHook[];
  volatility: number;
  cooling: number;
  updatedAt: number;
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
  payload: InteractionEventPayload | RelationshipDeltaPayload | RoomShiftPayload | MemoryCandidatePayload | SocialEventCandidatePayload | SocialEventEffectPayload | SocialEventArtifactPayload | ConflictFocusPayload | Record<string, unknown>;
}

export interface RelationshipLedgerRecentEvent {
  id: string;
  kind: RuntimeEventKind;
  createdAt: number;
  summary: string;
  actorIds?: string[];
  targetIds?: string[];
}

export function toRelationshipLedgerRecentEvent(event: Pick<RuntimeEventV2, 'id' | 'kind' | 'createdAt' | 'summary' | 'actorIds' | 'targetIds'>): RelationshipLedgerRecentEvent {
  return {
    id: event.id,
    kind: event.kind,
    createdAt: event.createdAt,
    summary: event.summary,
    actorIds: event.actorIds,
    targetIds: event.targetIds,
  };
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
  recentEvents: RelationshipLedgerRecentEvent[];
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
