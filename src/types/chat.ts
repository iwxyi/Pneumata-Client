import type { AICharacter } from './character';
import type { Message } from './message';
import { updateCharacterRelationship } from '../services/relationshipEngine';
import { derivePersonalityDrift } from '../services/personalityDrift';
import { accumulateChatRuntime } from '../services/chatRuntime';
import { accumulateCharacterRuntime } from '../services/characterRuntime';
import { extractMemoryCandidate } from '../services/memoryEngine';

export type ChatStyle = 'free' | 'debate' | 'brainstorm' | 'roleplay';
export type ConversationType = 'group' | 'direct' | 'ai_direct';
export type ConversationMode = 'open_chat';
export type ConversationPhase = 'idle' | 'warming' | 'debating' | 'aligned' | 'chaotic';

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
  muted?: boolean;
  canSpeak?: boolean;
  canAct?: boolean;
  flags: Record<string, boolean | number | string | null>;
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

export interface DriverMessageCommitResult {
  chatPatch: Partial<GroupChat>;
  characterPatches: DriverCharacterPatch[];
  eventMessages: DriverEventPayload[];
}

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

export const OPEN_CHAT_MODE_DRIVER: OpenChatModeDriver = {
  key: 'open_chat',
  createInitialConfig: () => DEFAULT_OPEN_CHAT_MODE_CONFIG,
  createInitialState: () => DEFAULT_OPEN_CHAT_MODE_STATE,
  buildParticipants: (conversation) => conversation.memberIds.map((memberId, index) => ({
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: 'ai',
    entityRefId: memberId,
    seatIndex: index,
    canSpeak: true,
    canAct: true,
    flags: {},
  })),
  getAvailableActions: () => [
    { type: 'send_message' },
    { type: 'director_intervention' },
    { type: 'start_private_thread' },
  ],
  getVisiblePanels: (context) => [
    { key: 'members', title: context.conversation.type === 'group' ? '成员' : context.conversation.type === 'ai_direct' ? 'AI私聊信息' : '单聊信息', type: 'members', tabKey: 'members' },
    { key: 'runtime', title: '运行态', type: 'runtime', tabKey: 'world' },
  ],
  onMessageCommitted: ({ conversation, characters, message, previousAiMessage }) => {
    const eventMessages: DriverEventPayload[] = [];
    const characterPatches: DriverCharacterPatch[] = [];
    const memoryCandidate = message.type === 'ai' ? extractMemoryCandidate(message.content) : null;
    const chatPatch: Partial<GroupChat> = {
      ...accumulateChatRuntime(conversation, message, memoryCandidate ? { kind: memoryCandidate.kind, text: memoryCandidate.text } : null),
    };

    if (conversation.type === 'group' && message.type === 'ai' && previousAiMessage && previousAiMessage.senderId !== message.senderId) {
      const speaker = characters.find((item) => item.id === message.senderId);
      const target = characters.find((item) => item.id === previousAiMessage.senderId);
      if (speaker && target) {
        const updatedSpeaker = updateCharacterRelationship(speaker, target.id, message.content, 0.45);
        const speakerDrift = derivePersonalityDrift(speaker, message.content);
        const driftEntries = Object.keys(speakerDrift).length ? [
          {
            type: 'drift' as const,
            text: `受到互动影响，性格出现漂移：${Object.entries(speakerDrift).map(([key, value]) => `${key}${value > 0 ? '+' : ''}${value}`).join('，')}`,
            createdAt: Date.now(),
          },
        ] : [];

        characterPatches.push({
          characterId: speaker.id,
          patch: {
            relationships: updatedSpeaker.relationships,
            personalityDrift: speakerDrift,
            runtimeTimeline: accumulateCharacterRuntime(speaker, {
              type: 'relationship',
              text: `对 ${target.name} 的态度发生变化：${message.content.slice(0, 48)}`,
            }).concat(driftEntries).slice(-20),
          },
        });

        eventMessages.push({
          eventType: 'group_relationship_shift',
          title: `${speaker.name} 对 ${target.name} 的态度发生变化`,
          summary: message.content.slice(0, 48),
          pair: [speaker.name, target.name],
          metrics: updatedSpeaker.relationships.find((item) => item.characterId === target.id) || null,
        });
      }
    }

    return { chatPatch, characterPatches, eventMessages };
  },
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

export interface ConversationWorldState {
  phase: ConversationPhase;
  mood: string;
  focus: string;
  recentEvent: string;
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
  runtimeTimeline?: Array<{ type: 'note' | 'artifact' | 'relationship'; text: string; createdAt: number }>;
  governance: ConversationGovernance;
  dramaRules: ConversationDramaRules;
  worldState: ConversationWorldState;
  directorControls: ConversationDirectorControls;
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
};

export const DEFAULT_CONVERSATION_DIRECTOR_CONTROLS: ConversationDirectorControls = {
  allowSpeakAs: true,
  allowDirectorMode: true,
  allowEventInjection: true,
  allowForcedReply: true,
};

export function normalizeConversation(input: Omit<GroupChat, 'type' | 'governance' | 'dramaRules' | 'worldState' | 'directorControls'> & Partial<Pick<GroupChat, 'type' | 'governance' | 'dramaRules' | 'worldState' | 'directorControls'>>): GroupChat {
  return {
    ...input,
    type: input.type || 'group',
    mode: input.mode || 'open_chat',
    modeConfig: input.modeConfig || DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: input.modeState || DEFAULT_OPEN_CHAT_MODE_STATE,
    sourceChatId: input.sourceChatId || null,
    sourceMemberIds: input.sourceMemberIds || [],
    runtimeNotes: input.runtimeNotes || [],
    runtimeArtifacts: input.runtimeArtifacts || [],
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
    },
    directorControls: {
      ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
      ...(input.directorControls || {}),
    },
  };
}
