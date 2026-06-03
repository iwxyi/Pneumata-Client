export type CompanionshipStyle = 'romantic' | 'ambiguous' | 'friend' | 'family' | 'mentor' | 'custom';

export type CompanionshipPhase =
  | 'stranger'
  | 'curious'
  | 'fond'
  | 'ambiguous'
  | 'confessing'
  | 'confirmed'
  | 'passionate'
  | 'deep'
  | 'cooling'
  | 'crisis'
  | 'reconciling';

export type PreferredIntimacyStyle = 'reserved' | 'warm' | 'playful' | 'clingy' | 'direct';

export interface IntimacyProjection {
  attraction: number;
  intimacy: number;
  attachment: number;
  longing: number;
  exclusivity: number;
  security: number;
}

export interface PendingCareTopic {
  id: string;
  text: string;
  source: 'memory' | 'recent_message' | 'runtime_event' | 'manual';
  urgency: 'low' | 'medium' | 'high';
  status?: 'active' | 'stale' | 'answered' | 'blocked';
  restraintReason?: string;
  evidence?: string;
  updatedAt: number;
}

export interface AddressingState {
  defaultName: string;
  currentAddress: string;
  privateAddress?: string;
  publicAddress?: string;
  forbiddenAddresses: string[];
  addressHistory: Array<{
    value: string;
    adoptedAt: number;
    reason: string;
    initiatedBy: 'user' | 'character' | 'mutual';
  }>;
}

export interface CarePolicy {
  dailyInitiationBudget: number;
  triggerSensitivity: number;
  silenceAnxietyThresholdHours: number;
  expressionIntensity: number;
  allowGoodMorning: boolean;
  allowGoodNight: boolean;
  allowMissYou: boolean;
  quietHours: { start: string; end: string };
  boundaryReasons: string[];
}

export interface UserProfileMemoryProjection {
  userId: string;
  displayName?: string;
  addressPreference?: string;
  scheduleHints: string[];
  pressureSources: string[];
  preferences: string[];
  dislikes: string[];
  boundaries: string[];
  importantDates: string[];
  recentPlans: string[];
  emotionalPatterns: string[];
  sourceTexts: string[];
  confidence: number;
  updatedAt: number;
}

export type UserProfileMemoryKind =
  | 'display_name'
  | 'address_preference'
  | 'schedule_hint'
  | 'pressure_source'
  | 'preference'
  | 'dislike'
  | 'boundary'
  | 'important_date'
  | 'recent_plan'
  | 'emotional_pattern';

export interface UserProfileMemoryEventItem {
  kind: UserProfileMemoryKind;
  text: string;
  evidence: string;
  confidence: number;
  sensitive?: boolean;
}

export interface UserProfileMemoryEventPayload {
  eventType: 'companionship_user_profile_memory';
  characterId: string;
  userId?: string;
  action: 'upsert' | 'revoke';
  items: UserProfileMemoryEventItem[];
  reason?: string;
  evidence?: string;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface UserBondState {
  userId: string;
  characterId: string;
  style: CompanionshipStyle;
  phase: CompanionshipPhase;
  phaseEnteredAt: number;
  phaseEvidence: string[];
  transitionReadiness: number;
  intimacy: IntimacyProjection;
  lastMeaningfulContactAt: number;
  lastUserReplyAt?: number;
  lastCharacterInitiatedAt?: number;
  pendingCareTopics: PendingCareTopic[];
  rememberedUserPlans: string[];
  unresolvedTensions: string[];
  addressing: AddressingState;
  userProfile: UserProfileMemoryProjection;
  preferredIntimacyStyle: PreferredIntimacyStyle;
  carePolicy: CarePolicy;
}

export interface CompanionshipPhaseEventPayload {
  eventType: 'companionship_phase_event';
  characterId: string;
  userId?: string;
  phase: CompanionshipPhase;
  style?: CompanionshipStyle;
  evidence?: string[];
  reason?: string;
  initiatedBy?: 'user' | 'character' | 'mutual' | 'system';
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipCareTopicEventPayload {
  eventType: 'companionship_care_topic';
  characterId: string;
  userId?: string;
  topicId: string;
  topicText: string;
  action: 'opened' | 'closed' | 'blocked' | 'stale';
  urgency: PendingCareTopic['urgency'];
  reason?: string;
  evidence?: string;
  dueAt?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CharacterCompanionshipState {
  actorId: string;
  targetId: string;
  style: 'close_friend' | 'sibling_like' | 'romantic_tension' | 'mentor_protege' | 'partner' | 'rival_with_care';
  closeness: number;
  protectiveness: number;
  reliance: number;
  sharedSecrets: string[];
  sharedRituals: string[];
  unresolvedCareTopics: string[];
  lastCareAt?: number;
}

export interface SharedMemoryAnchor {
  id: string;
  kind: 'first_time' | 'confession' | 'conflict' | 'repair' | 'inside_joke' | 'shared_secret' | 'promise' | 'milestone';
  participantIds: string[];
  title: string;
  text: string;
  salience: number;
  confidence: number;
  source: 'layered_memory' | 'relationship_note';
  sourceId?: string;
  evidence?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CompanionshipProjection {
  userBond: UserBondState | null;
  evidence: string[];
  promptLines: string[];
}

export interface CompanionshipRuntimeTrace {
  style: CompanionshipStyle;
  phase: CompanionshipPhase;
  currentAddress: string;
  sharedAnchors: string[];
  pendingCareTopics: string[];
  rememberedUserPlans: string[];
  boundaries: string[];
  boundaryReasons: string[];
  carePolicy: Pick<CarePolicy, 'dailyInitiationBudget' | 'triggerSensitivity' | 'silenceAnxietyThresholdHours' | 'expressionIntensity' | 'allowGoodMorning' | 'allowGoodNight' | 'allowMissYou'>;
  evidence: string[];
  intimacy: IntimacyProjection;
  userProfileConfidence: number;
}

export interface CompanionshipStatusSignature {
  text: string;
  tone: 'distant' | 'curious' | 'warm' | 'ambiguous' | 'restrained' | 'crisis';
  chips: string[];
  debugLines: string[];
  addressing?: AddressingState;
  offlineTrace?: string;
  unsentDraft?: string;
  updatedAt: number;
}
