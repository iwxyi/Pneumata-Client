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

export type IntimateConflictKind =
  | 'cold_war'
  | 'silent_treatment'
  | 'testing'
  | 'accusation'
  | 'withdrawal'
  | 'vulnerability_burst'
  | 'repair_attempt'
  | 'reconciliation';

export interface IntimateConflictState {
  kind: IntimateConflictKind;
  severity: number;
  repairReadiness: number;
  summary: string;
  evidence: string[];
  participantIds: string[];
  sourceEventIds: string[];
  updatedAt: number;
}

export interface IntimateConflictHistoryEntry {
  id: string;
  action: CompanionshipIntimateConflictEventPayload['action'];
  kind: IntimateConflictKind;
  severity: number;
  repairReadiness: number;
  summary: string;
  evidence: string[];
  sourceEventIds: string[];
  decisionSource?: 'model' | 'local_fallback';
  confidence?: number;
  occurredAt: number;
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

export interface PendingPromise {
  id: string;
  text: string;
  participantIds: string[];
  source: 'shared_anchor' | 'user_profile' | 'recent_message' | 'runtime_event' | 'manual';
  kind: 'shared_activity' | 'user_followup' | 'emotional_commitment' | 'boundary_agreement' | 'repair_agreement' | 'ritual' | 'other';
  status: 'open' | 'fulfilled' | 'stale' | 'blocked' | 'revoked';
  evidence?: string;
  dueAt?: number;
  reminderPolicy: {
    shouldRemind: boolean;
    tone: 'gentle' | 'playful' | 'serious' | 'apologetic' | 'none';
    maxFollowUps: number;
    seedIntent: string;
    boundaryReasons: string[];
  };
  relationshipEffects: {
    fulfilled: Partial<IntimacyProjection>;
    missed: Partial<IntimacyProjection>;
    notes: string[];
  };
  lifecycleEvidence: string[];
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

export interface UserAttachmentProfile {
  inferredStyle: 'secure' | 'anxious' | 'avoidant' | 'disorganized';
  confidence: number;
  evidence: string[];
  adaptations: string[];
}

export interface AttachmentProfileHistoryEntry {
  id: string;
  action: NonNullable<CompanionshipAttachmentProfileEventPayload['action']>;
  inferredStyle?: UserAttachmentProfile['inferredStyle'];
  confidence: number;
  evidence: string[];
  adaptations: string[];
  reason?: string;
  decisionSource?: 'model' | 'local_fallback';
  occurredAt: number;
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
  cues: UserProfileMemoryEventItem[];
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

export interface UserProfileMemoryHistoryEntry {
  id: string;
  action: UserProfileMemoryEventPayload['action'];
  items: UserProfileMemoryEventItem[];
  reason?: string;
  evidence: string[];
  decisionSource?: UserProfileMemoryEventPayload['decisionSource'];
  confidence?: number;
  occurredAt: number;
}

export interface AddressingHistoryEntry {
  id: string;
  action: 'update' | 'set_current' | 'set_private' | 'set_public' | 'forbid' | 'unforbid' | 'revoke';
  currentAddress?: string;
  privateAddress?: string;
  publicAddress?: string;
  forbiddenAddresses: string[];
  reason?: string;
  evidence: string[];
  initiatedBy?: AddressingState['addressHistory'][number]['initiatedBy'];
  decisionSource?: 'model' | 'local_fallback';
  confidence?: number;
  occurredAt: number;
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
  pendingPromises: PendingPromise[];
  rememberedUserPlans: string[];
  unresolvedTensions: string[];
  intimateConflict?: IntimateConflictState;
  addressing: AddressingState;
  userProfile: UserProfileMemoryProjection;
  attachmentProfile: UserAttachmentProfile;
  preferredIntimacyStyle: PreferredIntimacyStyle;
  carePolicy: CarePolicy;
}

export interface PhaseHistoryEntry {
  id: string;
  action: 'set' | 'revoked' | 'inferred';
  phase?: CompanionshipPhase;
  style?: CompanionshipStyle;
  evidence: string[];
  reason?: string;
  initiatedBy?: 'user' | 'character' | 'mutual' | 'system';
  decisionSource?: 'model' | 'local_fallback';
  confidence?: number;
  occurredAt: number;
}

export interface CompanionshipPhaseEventPayload {
  eventType: 'companionship_phase_event';
  characterId: string;
  userId?: string;
  action?: 'set' | 'revoked';
  phase?: CompanionshipPhase;
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

export interface CompanionshipPromiseEventPayload {
  eventType: 'companionship_promise';
  characterId: string;
  userId?: string;
  promiseId: string;
  promiseText: string;
  action: 'opened' | 'fulfilled' | 'blocked' | 'stale' | 'revoked';
  supersedesText?: string;
  participantIds?: string[];
  promiseKind?: PendingPromise['kind'];
  reminderPolicy?: Partial<PendingPromise['reminderPolicy']>;
  relationshipEffects?: Partial<PendingPromise['relationshipEffects']>;
  lifecycleEvidence?: string[];
  reason?: string;
  evidence?: string;
  dueAt?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CareTopicHistoryEntry {
  id: string;
  topicId: string;
  topicText: string;
  action: CompanionshipCareTopicEventPayload['action'];
  urgency: PendingCareTopic['urgency'];
  reason?: string;
  evidence: string[];
  dueAt?: number;
  decisionSource?: 'model' | 'local_fallback';
  confidence?: number;
  occurredAt: number;
}

export interface PromiseHistoryEntry {
  id: string;
  promiseId: string;
  promiseText: string;
  action: CompanionshipPromiseEventPayload['action'];
  promiseKind?: PendingPromise['kind'];
  participantIds: string[];
  supersedesText?: string;
  lifecycleEvidence: string[];
  reason?: string;
  evidence: string[];
  dueAt?: number;
  decisionSource?: 'model' | 'local_fallback';
  confidence?: number;
  occurredAt: number;
}

export interface CompanionshipRitualEventPayload {
  eventType: 'companionship_ritual';
  characterId: string;
  userId?: string;
  ritualId: string;
  kind: RitualRegistryEntry['kind'];
  action: 'performed' | 'suppressed' | 'skipped' | 'restored' | 'updated';
  participantIds: string[];
  content?: string;
  evolution?: string[];
  reason?: string;
  evidence?: string;
  nextAvailableAt?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipIntimateConflictEventPayload {
  eventType: 'companionship_intimate_conflict';
  characterId: string;
  userId?: string;
  action: 'opened' | 'updated' | 'repair_attempted' | 'resolved' | 'reopened' | 'dismissed';
  kind: IntimateConflictKind;
  severity?: number;
  repairReadiness?: number;
  summary?: string;
  evidence?: string[];
  participantIds?: string[];
  sourceEventIds?: string[];
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipAttachmentProfileEventPayload {
  eventType: 'companionship_attachment_profile';
  characterId: string;
  userId?: string;
  action?: 'inferred' | 'corrected' | 'disabled' | 'enabled';
  inferredStyle?: UserAttachmentProfile['inferredStyle'];
  confidence: number;
  evidence?: string[];
  adaptations?: string[];
  reason?: string;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipAddressingEventPayload {
  eventType: 'companionship_addressing';
  characterId: string;
  userId?: string;
  action: 'update' | 'set_current' | 'set_private' | 'set_public' | 'forbid' | 'unforbid' | 'revoke';
  currentAddress?: string;
  privateAddress?: string;
  publicAddress?: string;
  forbiddenAddresses?: string[];
  reason?: string;
  evidence?: string;
  initiatedBy?: AddressingState['addressHistory'][number]['initiatedBy'];
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipOnlineReturnEventPayload {
  eventType: 'companionship_online_return';
  characterId: string;
  userId?: string;
  action: 'projected' | 'shown' | 'suppressed' | 'dismissed';
  text?: string;
  reason?: string;
  evidence?: string;
  availableAt?: number;
  expiresAt?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipUnsentDraftEventPayload {
  eventType: 'companionship_unsent_draft';
  characterId: string;
  userId?: string;
  action: 'drafted' | 'shown' | 'suppressed' | 'dismissed' | 'expired';
  text?: string;
  reason?: string;
  evidence?: string;
  availableAt?: number;
  expiresAt?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipSharedSecretEventPayload {
  eventType: 'companionship_shared_secret';
  characterId: string;
  userId?: string;
  secretId: string;
  action: 'recorded' | 'hinted_publicly' | 'leaked' | 'confessed' | 'revoked';
  consequenceKind?: SharedSecret['consequenceKind'];
  participantIds: string[];
  privateText: string;
  publicMask?: string;
  reason?: string;
  evidence?: string;
  emotionalWeight?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipSharedPhraseEventPayload {
  eventType: 'companionship_shared_phrase';
  characterId: string;
  userId?: string;
  phraseId: string;
  action: 'upsert' | 'reused' | 'suppressed' | 'revoked';
  text: string;
  kind?: SharedPhrase['kind'];
  participantIds: string[];
  visibility?: SharedPhrase['visibility'];
  firstSaidBy?: string;
  reason?: string;
  evidence?: string;
  emotionalWeight?: number;
  reuseCount?: number;
  confidence?: number;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipSharedAnchorEventPayload {
  eventType: 'companionship_shared_anchor';
  characterId: string;
  userId?: string;
  anchorId: string;
  action: 'upsert' | 'merge' | 'archive' | 'revoke';
  kind?: SharedMemoryAnchor['kind'];
  participantIds?: string[];
  title?: string;
  text?: string;
  salience?: number;
  confidence?: number;
  evidence?: string;
  mergedAnchorIds?: string[];
  sourceEventIds?: string[];
  reason?: string;
  decisionSource?: 'model' | 'local_fallback';
}

export interface CompanionshipDiaryReflectionEventPayload {
  eventType: 'companionship_diary_reflection';
  characterId: string;
  userId?: string;
  reflectionId: string;
  diaryEntryId: string;
  dateKey?: string | null;
  reflectionType: 'care' | 'promise' | 'shared_secret' | 'ritual' | 'shared_anchor' | 'shared_phrase';
  participantIds: string[];
  text: string;
  sourceSeed?: string;
  diaryExcerpt?: string;
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
  sharedPromises: string[];
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
  source: 'layered_memory' | 'relationship_note' | 'runtime_event';
  sourceId?: string;
  evidence?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SharedSecret {
  id: string;
  participantIds: string[];
  privateText: string;
  publicMask: string;
  leakState: 'sealed' | 'hinted_publicly' | 'leaked' | 'confessed';
  consequenceKind?: 'none' | 'misunderstanding' | 'accidental_leak' | 'intentional_breach' | 'protective_confession' | 'voluntary_confession';
  emotionalWeight: number;
  sourceAnchorId: string;
  sourceEventIds: string[];
  updatedAt: number;
}

export interface SharedPhrase {
  id: string;
  text: string;
  kind: 'pet_name' | 'inside_joke' | 'promise_line' | 'comfort_line' | 'confession_line' | 'secret_code' | 'other';
  participantIds: string[];
  visibility: 'private' | 'between_actors' | 'public_hint';
  firstSaidBy?: string;
  emotionalWeight: number;
  reuseCount: number;
  sourceAnchorId?: string;
  sourceEventIds: string[];
  evidence?: string;
  updatedAt: number;
}

export interface RitualRegistryEntry {
  id: string;
  kind: 'daily_greeting' | 'anniversary' | 'inside_joke' | 'pet_name' | 'reconciliation' | 'milestone';
  participantIds: string[];
  trigger: 'time' | 'date' | 'keyword' | 'phase_change' | 'conflict_resolved';
  content: string;
  evolution: string[];
  cooldownHours: number;
  boundaryReasons: string[];
  sourceAnchorId?: string;
  lastPerformedAt?: number;
  nextAvailableAt?: number;
  executionState?: 'available' | 'cooldown' | 'suppressed';
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
  sharedPhrases: string[];
  sharedSecrets: string[];
  rituals: string[];
  intimateConflict?: Pick<IntimateConflictState, 'kind' | 'severity' | 'repairReadiness' | 'summary'>;
  pendingCareTopics: string[];
  pendingPromises: string[];
  rememberedUserPlans: string[];
  boundaries: string[];
  boundaryReasons: string[];
  userProfileCues: UserProfileMemoryEventItem[];
  addressingHistory: AddressingHistoryEntry[];
  careTopicHistory: CareTopicHistoryEntry[];
  promiseHistory: PromiseHistoryEntry[];
  carePolicy: Pick<CarePolicy, 'dailyInitiationBudget' | 'triggerSensitivity' | 'silenceAnxietyThresholdHours' | 'expressionIntensity' | 'allowGoodMorning' | 'allowGoodNight' | 'allowMissYou'>;
  attachmentProfile?: UserAttachmentProfile;
  phaseHistory: PhaseHistoryEntry[];
  userProfileHistory: UserProfileMemoryHistoryEntry[];
  conflictHistory: IntimateConflictHistoryEntry[];
  attachmentHistory: AttachmentProfileHistoryEntry[];
  diagnostics: string[];
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
  onlineReturn?: string;
  updatedAt: number;
}
