import type { AICharacter } from './character';
import type { Message } from './message';
import type { MemoryItem } from '../services/memoryTypes';
import type { ParticipantPrivateState, ParticipantPublicState } from './participantRole';

export type ChatStyle = 'free' | 'debate' | 'brainstorm' | 'roleplay';
export type ConversationType = 'group' | 'direct' | 'ai_direct';
export type ConversationMode = 'open_chat' | 'interview' | 'group_discussion' | 'roundtable' | 'classroom' | 'bargaining' | 'service_roleplay' | 'board_game' | 'scripted_play' | 'werewolf' | 'murder_mystery';
export type ConversationPhase = 'idle' | 'warming' | 'debating' | 'aligned' | 'chaotic';
export type RuntimeEvolutionIntensity = 'slow' | 'balanced' | 'fast';

export interface OpenChatModeConfig {
  freeSpeaking: boolean;
  allowInterruptions: boolean;
  allowPrivateThreads: boolean;
  allowDirectorInterventions: boolean;
  showRoleActions: boolean;
}

export interface OpenChatModeState {
  phase: 'free';
  currentSpeakerId?: string | null;
  currentTopicFocus?: string;
  lastRelationshipEventAt?: number | null;
}

export interface ParticipantInstance {
  participantId: string;
  conversationId: string;
  entityType: 'ai' | 'user' | 'system_agent';
  entityRefId: string;
  seatIndex?: number;
  displayName?: string;
  title?: string;
  roleKey?: string | null;
  faction?: string | null;
  muted?: boolean;
  canSpeak?: boolean;
  canAct?: boolean;
  flags: Record<string, boolean | number | string | null>;
  privateState?: ParticipantPrivateState;
  publicState?: ParticipantPublicState;
}

export interface RuntimeAction {
  type: string;
  actorId?: string;
  targetIds?: string[];
  payload?: Record<string, unknown>;
}

export interface RuntimePanelDefinition {
  key: string;
  title: string;
  type: 'members' | 'runtime' | 'actions' | 'custom';
  tabKey?: 'members' | 'world';
}

export interface RuntimeContext {
  conversation: GroupChat;
  participants: ParticipantInstance[];
}

export interface RuntimeTransition {
  nextConversationState?: Partial<GroupChat>;
  participantPatches?: Array<{ participantId: string; patch: Partial<ParticipantInstance> }>;
}

export interface DriverCharacterPatch {
  characterId: string;
  patch: Partial<AICharacter>;
}

export interface DriverEventPayload {
  eventType: string;
  title: string;
  summary: string;
  pair?: [string, string];
  metrics?: unknown;
}

export interface DriverMessageCommitTransition {
  chatPatch: Partial<GroupChat>;
  characterPatches: DriverCharacterPatch[];
  runtimeEvents: DriverEventPayload[];
}

export interface DriverMessageCommitResult extends DriverMessageCommitTransition {}

export interface OpenChatModeDriver {
  key: ConversationMode;
  createInitialConfig: () => OpenChatModeConfig;
  createInitialState: (config: OpenChatModeConfig) => OpenChatModeState;
  buildParticipants: (conversation: GroupChat) => ParticipantInstance[];
  getAvailableActions: (context: RuntimeContext) => RuntimeAction[];
  getVisiblePanels: (context: RuntimeContext) => RuntimePanelDefinition[];
  onMessageCommitted: (params: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage?: Pick<Message, 'senderId'> | null;
  }) => DriverMessageCommitResult;
}

export interface SessionKernelCompatibility {
  buildParticipants: (conversation: GroupChat) => ParticipantInstance[];
  getAvailableActions: (context: RuntimeContext) => RuntimeAction[];
  getVisiblePanels: (context: RuntimeContext) => RuntimePanelDefinition[];
}

export const DEFAULT_OPEN_CHAT_MODE_CONFIG: OpenChatModeConfig = {
  freeSpeaking: true,
  allowInterruptions: true,
  allowPrivateThreads: true,
  allowDirectorInterventions: true,
  showRoleActions: true,
};

export const DEFAULT_OPEN_CHAT_MODE_STATE: OpenChatModeState = {
  phase: 'free',
  currentSpeakerId: null,
  currentTopicFocus: '',
  lastRelationshipEventAt: null,
};

export interface ConversationGovernance {
  ownerCharacterId: string | null;
  adminCharacterIds: string[];
  autoModeration: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
}

export interface ConversationDramaRules {
  allowCliques: boolean;
  allowMockery: boolean;
  allowAlliances: boolean;
  allowContempt: boolean;
}

export interface ConversationConflictAxis {
  title: string;
  poles: [string, string];
  currentTilt?: number;
}

export interface ConversationWorldState {
  phase: ConversationPhase;
  mood: string;
  focus: string;
  recentEvent: string;
  conflictAxes?: ConversationConflictAxis[];
}

export interface ConversationDirectorControls {
  allowSpeakAs: boolean;
  allowDirectorMode: boolean;
  allowEventInjection: boolean;
  allowForcedReply: boolean;
}

export interface GroupChat {
  id: string;
  type: ConversationType;
  mode: ConversationMode;
  modeConfig: OpenChatModeConfig;
  modeState: OpenChatModeState;
  name: string;
  topic: string;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  memberIds: string[];
  speed: number;
  isActive: boolean;
  allowIntervention: boolean;
  showRoleActions?: boolean;
  topicSeed: string;
  sourceChatId?: string | null;
  sourceMemberIds?: string[];
  runtimeNotes?: string[];
  runtimeArtifacts?: string[];
  layeredMemories?: MemoryItem[];
  runtimeTimeline?: Array<{ type: 'note' | 'artifact' | 'relationship'; text: string; createdAt: number }>;
  governance: ConversationGovernance;
  dramaRules: ConversationDramaRules;
  worldState: ConversationWorldState;
  directorControls: ConversationDirectorControls;
  deletedAt?: number | null;
  fieldVersions?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
}

export const DEFAULT_CONVERSATION_GOVERNANCE: ConversationGovernance = {
  ownerCharacterId: null,
  adminCharacterIds: [],
  autoModeration: false,
  allowMute: true,
  allowPrivateThreads: true,
};

export const DEFAULT_CONVERSATION_DRAMA_RULES: ConversationDramaRules = {
  allowCliques: false,
  allowMockery: false,
  allowAlliances: true,
  allowContempt: false,
};

export const DEFAULT_CONVERSATION_WORLD_STATE: ConversationWorldState = {
  phase: 'idle',
  mood: '',
  focus: '',
  recentEvent: '',
  conflictAxes: [],
};

export const DEFAULT_CONVERSATION_DIRECTOR_CONTROLS: ConversationDirectorControls = {
  allowSpeakAs: true,
  allowDirectorMode: true,
  allowEventInjection: true,
  allowForcedReply: true,
};

export const DEFAULT_RUNTIME_EVOLUTION_INTENSITY: RuntimeEvolutionIntensity = 'balanced';

export function normalizeConversation(input: Omit<GroupChat, 'type' | 'governance' | 'dramaRules' | 'worldState' | 'directorControls' | 'runtimeEvolutionIntensity'> & Partial<Pick<GroupChat, 'type' | 'governance' | 'dramaRules' | 'worldState' | 'directorControls' | 'runtimeEvolutionIntensity'>>): GroupChat {
  return {
    ...input,
    type: input.type || 'group',
    mode: input.mode || 'open_chat',
    modeConfig: input.modeConfig || DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: input.modeState || DEFAULT_OPEN_CHAT_MODE_STATE,
    runtimeEvolutionIntensity: input.runtimeEvolutionIntensity || DEFAULT_RUNTIME_EVOLUTION_INTENSITY,
    sourceChatId: input.sourceChatId || null,
    sourceMemberIds: input.sourceMemberIds || [],
    runtimeNotes: input.runtimeNotes || [],
    runtimeArtifacts: input.runtimeArtifacts || [],
    layeredMemories: input.layeredMemories || [],
    runtimeTimeline: input.runtimeTimeline || [],
    governance: {
      ...DEFAULT_CONVERSATION_GOVERNANCE,
      ...(input.governance || {}),
      adminCharacterIds: input.governance?.adminCharacterIds || [],
    },
    dramaRules: {
      ...DEFAULT_CONVERSATION_DRAMA_RULES,
      ...(input.dramaRules || {}),
    },
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(input.worldState || {}),
      conflictAxes: input.worldState?.conflictAxes || [],
    },
    directorControls: {
      ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
      ...(input.directorControls || {}),
    },
  };
}
