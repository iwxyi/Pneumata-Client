import type { AICharacter } from './character';
import type { GroupChat, ParticipantInstance, RuntimeAction, RuntimePanelDefinition } from './chat';
import type { Message } from './message';

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
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
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
  onMessageCommitted: (context: SessionCommitContext) => {
    chatPatch: Partial<GroupChat>;
    characterPatches: Array<{ characterId: string; patch: Partial<AICharacter> }>;
    runtimeEvents: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }>;
  };
}
