import type { AICharacter } from './character';
import type { GroupChat, ParticipantInstance, RuntimeAction, RuntimePanelDefinition } from './chat';
import type { Message } from './message';
import type { APIConfig } from './settings';

export type SessionFamily = 'conversation' | 'interview' | 'deduction' | 'mystery' | 'study' | 'analysis' | 'board_game';
export type SessionSurfaceProfile = 'text' | 'form' | 'board' | 'hybrid';
export type SessionTopology = 'group' | 'direct' | 'thread' | 'team' | 'table';
export type SessionActorKind = 'ai_agent' | 'human_user' | 'system_agent' | 'moderator_agent' | 'observer';
export type SessionViewerCapability = 'speak' | 'guide' | 'moderate' | 'judge' | 'observe' | 'speak_as';
export type SessionIntentType = 'message_intent' | 'action_intent' | 'board_intent' | 'form_intent' | 'system_intent';
export type SessionInputSurfaceType = 'text' | 'form' | 'board' | 'hybrid';

export interface SessionKind {
  topology: SessionTopology;
  family: SessionFamily;
  scenarioId: string;
  surfaceProfile: SessionSurfaceProfile;
}

export interface SessionActor {
  actorId: string;
  kind: SessionActorKind;
  entityRefId?: string | null;
  seatId?: string | null;
  roleId?: string | null;
  teamId?: string | null;
  displayName?: string;
}

export interface SessionInputFieldOption {
  label: string;
  value: string;
}

export interface SessionInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'single_select' | 'number' | 'multi_select';
  required?: boolean;
  options?: SessionInputFieldOption[];
  placeholder?: string;
}

export interface SessionInputSurfaceDefinition {
  key: string;
  type: SessionInputSurfaceType;
  label?: string;
  actorId?: string;
  capability?: SessionViewerCapability;
  placeholder?: string;
  mode?: 'guide' | 'speakAs';
  fields?: SessionInputField[];
}

export interface SessionIntent {
  type: SessionIntentType;
  actorId?: string;
  channelId?: string;
  targetIds?: string[];
  payload: Record<string, unknown>;
}

export interface SessionComposerContext {
  conversation: GroupChat;
  participants: ParticipantInstance[];
  viewerId?: string | null;
  viewerRole?: string | null;
}

export interface SessionNormalizedIntentResult {
  intent: SessionIntent;
}

export interface SessionFamilyDefinition {
  key: SessionFamily;
  label: string;
}

export interface ScenarioSeat {
  seatId: string;
  seatIndex: number;
  roleId?: string | null;
  teamId?: string | null;
  actorId?: string | null;
  displayName?: string;
}

export interface PersistentCharacterCore {
  characterId: string;
  summary?: string;
}

export interface ConversationCharacterState {
  characterId: string;
  summary?: string;
}

export interface SessionScenarioDefinition {
  scenarioId: string;
  label: string;
}

export interface SessionResolvedDefinition {
  kind: SessionKind;
  family: SessionFamilyDefinition;
  scenario: SessionScenarioDefinition;
}

export interface SessionTopologySummary {
  topology: SessionTopology;
  description: string;
}

export interface SessionChannelDefinition {
  channelId: string;
  visibility: VisibilityScope;
  label?: string;
  actorIds?: string[];
  roleIds?: string[];
}

export interface SessionBoardSchema {
  kind: string;
  columns?: number;
  rows?: number;
  nodes?: Array<{ id: string; x: number; y: number }>;
  edges?: Array<{ from: string; to: string }>;
}

export interface SessionBoardState {
  schema: SessionBoardSchema;
  pieces?: Array<{ id: string; type: string; actorId?: string; teamId?: string; position: string }>;
}

export interface SessionBoardRendererDefinition {
  kind: string;
  schema: SessionBoardSchema;
}

export interface SessionJudgeAgentDefinition {
  actorId?: string;
  enabled: boolean;
  style?: 'strict' | 'assistive';
}

export interface SessionScenarioPackage {
  scenarioId: string;
  label: string;
  seats?: ScenarioSeat[];
  channels?: SessionChannelDefinition[];
  board?: SessionBoardSchema | null;
}

export interface SessionMemoryLayerSummary {
  characterCore: boolean;
  relationship: boolean;
  conversation: boolean;
  scenario: boolean;
}

export interface SessionTurnOrderState {
  actorIds: string[];
  currentIndex: number;
}

export interface SessionFactionDefinition {
  factionId: string;
  label: string;
}

export interface SessionLayoutSlot {
  slotId: string;
  x: number;
  y: number;
  actorId?: string | null;
}

export interface SessionRefereeDecision {
  allowed: boolean;
  reason?: string;
}

export interface SessionFamilyRuntimeSummary {
  family: SessionFamily;
  scenarioId: string;
}

export interface SessionGrowthSnapshot {
  actorId: string;
  conversationSummary?: string;
  persistentSummary?: string;
}

export interface SessionRoleMemorySummary {
  actorId: string;
  roleId?: string | null;
  summary?: string;
}

export interface SessionScenarioMemorySummary {
  conversationId: string;
  summary?: string;
}

export interface SessionBoardIntentPayload {
  position?: string;
  pieceId?: string;
  move?: string;
}

export interface SessionFormIntentPayload {
  fields: Record<string, unknown>;
}

export interface SessionTextComposerSubmission {
  content: string;
  actorId?: string;
}

export interface SessionSurfaceProjection {
  surfaces: SessionInputSurfaceDefinition[];
}

export function createDefaultSessionKind(type: GroupChat['type'], mode: GroupChat['mode']): SessionKind {
  if (mode === 'board_game') {
    return { topology: type === 'group' ? 'table' : 'direct', family: 'board_game', scenarioId: 'board-game', surfaceProfile: 'board' };
  }
  if (mode === 'interview') {
    return { topology: type === 'group' ? 'group' : 'direct', family: 'interview', scenarioId: 'panel-interview', surfaceProfile: 'form' };
  }
  if (mode === 'werewolf') {
    return { topology: 'table', family: 'deduction', scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid' };
  }
  if (mode === 'murder_mystery') {
    return { topology: 'table', family: 'mystery', scenarioId: 'murder-mystery', surfaceProfile: 'hybrid' };
  }
  return {
    topology: type === 'group' ? 'group' : type === 'ai_direct' ? 'thread' : 'direct',
    family: 'conversation',
    scenarioId: type === 'group' ? 'open-chat' : type === 'ai_direct' ? 'ai-private-thread' : 'direct-chat',
    surfaceProfile: 'text',
  };
}

export function createDefaultSessionFamilyDefinition(kind: SessionKind): SessionFamilyDefinition {
  return { key: kind.family, label: kind.family };
}

export function createDefaultSessionScenarioDefinition(kind: SessionKind): SessionScenarioDefinition {
  return { scenarioId: kind.scenarioId, label: kind.scenarioId };
}

export function resolveSessionDefinition(conversation: GroupChat): SessionResolvedDefinition {
  const kind = conversation.sessionKind || createDefaultSessionKind(conversation.type, conversation.mode);
  return {
    kind,
    family: createDefaultSessionFamilyDefinition(kind),
    scenario: createDefaultSessionScenarioDefinition(kind),
  };
}

export function createDefaultTextInputSurface(params: { key?: string; label?: string; mode?: 'guide' | 'speakAs'; actorId?: string; placeholder?: string; capability?: SessionViewerCapability } = {}): SessionInputSurfaceDefinition {
  return {
    key: params.key || 'main-text',
    type: 'text',
    label: params.label,
    mode: params.mode || 'guide',
    actorId: params.actorId,
    placeholder: params.placeholder,
    capability: params.capability || 'guide',
  };
}

export function normalizeTextSurfaceSubmission(surface: SessionInputSurfaceDefinition, submission: SessionTextComposerSubmission): SessionNormalizedIntentResult {
  return {
    intent: {
      type: 'message_intent',
      actorId: submission.actorId || surface.actorId,
      payload: {
        content: submission.content,
        surfaceKey: surface.key,
        mode: surface.mode || 'guide',
      },
    },
  };
}

export function defaultInputSurfacesForConversation(conversation: GroupChat): SessionInputSurfaceDefinition[] {
  const definition = resolveSessionDefinition(conversation);
  if (definition.kind.surfaceProfile === 'form') {
    return [createDefaultTextInputSurface({ key: 'fallback-text', label: 'Text fallback' })];
  }
  if (definition.kind.surfaceProfile === 'hybrid') {
    return [
      createDefaultTextInputSurface({ key: 'hybrid-text', label: 'Chat' }),
      { key: 'hybrid-actions', type: 'form', label: 'Actions' },
    ];
  }
  if (definition.kind.surfaceProfile === 'board') {
    return [
      { key: 'board-surface', type: 'board', label: 'Board' },
      createDefaultTextInputSurface({ key: 'board-chat', label: 'Chat' }),
    ];
  }
  return [createDefaultTextInputSurface()];
}

export function defaultTopologySummary(conversation: GroupChat): SessionTopologySummary {
  const definition = resolveSessionDefinition(conversation);
  return {
    topology: definition.kind.topology,
    description: `${definition.kind.topology}:${definition.kind.family}:${definition.kind.scenarioId}`,
  };
}

export function supportsBoardSurface(conversation: GroupChat) {
  return resolveSessionDefinition(conversation).kind.surfaceProfile === 'board';
}

export function supportsHybridSurface(conversation: GroupChat) {
  return resolveSessionDefinition(conversation).kind.surfaceProfile === 'hybrid';
}

export function deriveSessionMemoryLayerSummary(conversation: GroupChat): SessionMemoryLayerSummary {
  return {
    characterCore: true,
    relationship: true,
    conversation: true,
    scenario: conversation.mode !== 'open_chat',
  };
}

export function buildDefaultScenarioPackage(conversation: GroupChat): SessionScenarioPackage {
  const definition = resolveSessionDefinition(conversation);
  return {
    scenarioId: definition.kind.scenarioId,
    label: definition.scenario.label,
    board: definition.kind.family === 'board_game' ? { kind: 'grid', columns: 8, rows: 8 } : null,
  };
}

export function buildDefaultSessionSurfaceProjection(conversation: GroupChat): SessionSurfaceProjection {
  return {
    surfaces: defaultInputSurfacesForConversation(conversation),
  };
}

export function deriveDefaultTurnOrder(actorIds: string[]): SessionTurnOrderState {
  return {
    actorIds,
    currentIndex: 0,
  };
}

export function createBoardIntentPayload(position: string, pieceId?: string): SessionBoardIntentPayload {
  return { position, pieceId };
}

export function createFormIntentPayload(fields: Record<string, unknown>): SessionFormIntentPayload {
  return { fields };
}

export function defaultJudgeAgent(enabled = false): SessionJudgeAgentDefinition {
  return {
    enabled,
    style: 'assistive',
  };
}

export function allowRefereeDecision(): SessionRefereeDecision {
  return { allowed: true };
}

export function denyRefereeDecision(reason: string): SessionRefereeDecision {
  return { allowed: false, reason };
}

export function buildSessionGrowthSnapshot(actorId: string, conversationSummary?: string, persistentSummary?: string): SessionGrowthSnapshot {
  return { actorId, conversationSummary, persistentSummary };
}

export function buildSessionRoleMemorySummary(actorId: string, roleId?: string | null, summary?: string): SessionRoleMemorySummary {
  return { actorId, roleId, summary };
}

export function buildSessionScenarioMemorySummary(conversationId: string, summary?: string): SessionScenarioMemorySummary {
  return { conversationId, summary };
}

export function buildSessionFactionDefinition(factionId: string, label: string): SessionFactionDefinition {
  return { factionId, label };
}

export function buildSessionLayoutSlot(slotId: string, x: number, y: number, actorId?: string | null): SessionLayoutSlot {
  return { slotId, x, y, actorId };
}

export type VisibilityScope = 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public';

export interface SessionPhaseDefinition {
  key: string;
  label: string;
  allowedActions: string[];
  hiddenInfo?: boolean;
}

export interface SessionActionField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'single_select' | 'number' | 'multi_select';
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  targetSource?: 'participants';
}

export interface SessionActionDefinition {
  type: string;
  label?: string;
  description?: string;
  actorId?: string;
  targetIds?: string[];
  payload?: Record<string, unknown>;
  visibility?: VisibilityScope;
  fields?: SessionActionField[];
}

export interface SessionActionSchema {
  title: string;
  actions: SessionActionDefinition[];
}

export interface SessionActionExecutionResult {
  chatPatch?: Partial<GroupChat>;
  runtimeEvents?: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }>;
}

export interface SessionProjectionContext {
  conversation: GroupChat;
  participants: ParticipantInstance[];
  viewerId?: string | null;
  viewerRole?: string | null;
  conversationType?: GroupChat['type'];
}

export interface SessionViewProjection {
  visiblePanels: RuntimePanelDefinition[];
  availableActions: RuntimeAction[];
}

export interface SessionCommitContext {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: import('./runtimeEvent').InteractionEventPayload | null };
  previousAiMessage?: Pick<Message, 'senderId'> | null;
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}

export interface SessionGenerationContext {
  conversation: GroupChat;
  characters: AICharacter[];
  messages: Message[];
}

export interface SessionGenerationPromptContext {
  promptPrefix?: string;
  promptSuffix?: string;
  additionalConstraints?: string[];
}

export interface SessionTurnPolicy {
  runChat: boolean;
  runAction: boolean;
  interleaveAction?: boolean;
}

export interface SessionEngineActionContext {
  conversation: GroupChat;
  participants: ParticipantInstance[];
  characters?: AICharacter[];
}

export interface SessionEngineDefinition {
  key: string;
  createInitialConfig: () => unknown;
  createInitialState: (config: unknown) => unknown;
  buildParticipants: (conversation: GroupChat) => ParticipantInstance[];
  getPhaseDefinitions?: (conversation: GroupChat) => SessionPhaseDefinition[];
  getVisiblePanels: (context: SessionProjectionContext) => RuntimePanelDefinition[];
  getAvailableActions: (context: SessionProjectionContext) => RuntimeAction[];
  getActionSchema?: (context: SessionEngineActionContext) => SessionActionSchema | null;
  buildGenerationPromptContext?: (context: SessionGenerationContext & { speaker: AICharacter }) => SessionGenerationPromptContext;
  resolveTurnPolicy?: (context: SessionGenerationContext) => SessionTurnPolicy;
  onMessageCommitted: (context: SessionCommitContext) => Promise<{
    chatPatch: Partial<GroupChat>;
    characterPatches: Array<{ characterId: string; patch: Partial<AICharacter> }>;
    runtimeEvents: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }>;
  }> | {
    chatPatch: Partial<GroupChat>;
    characterPatches: Array<{ characterId: string; patch: Partial<AICharacter> }>;
    runtimeEvents: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }>;
  };
}
