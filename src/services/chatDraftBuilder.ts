import type { ChatStyle, GroupChat, RuntimeEvolutionIntensity } from '../types/chat';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  DEFAULT_OPEN_CHAT_MODE_CONFIG,
  DEFAULT_OPEN_CHAT_MODE_STATE,
  createDefaultSessionKind,
} from '../types/chat';

export interface ChatDraftInput {
  type: 'group' | 'direct';
  name: string;
  topic: string;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  memberIds: string[];
  showRoleActions: boolean;
  seedMemoryText: string;
  seedArtifactText: string;
  ownerCharacterId: string | null;
  adminCharacterIds: string[];
  autoModeration: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
  allowCliques: boolean;
  allowMockery: boolean;
  mood: string;
  focus: string;
  recentEvent: string;
  allowSpeakAs: boolean;
  allowDirectorMode: boolean;
  allowEventInjection: boolean;
  allowForcedReply: boolean;
}

function buildRuntimeSeed(input: Pick<ChatDraftInput, 'seedMemoryText' | 'seedArtifactText'>) {
  return {
    notes: input.seedMemoryText.split('\n').map((item) => item.trim()).filter(Boolean),
    artifacts: input.seedArtifactText.split('\n').map((item) => item.trim()).filter(Boolean),
  };
}

export function buildGroupChatDraft(input: ChatDraftInput): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const sessionKind = createDefaultSessionKind('group', 'open_chat');
  return {
    type: 'group',
    mode: 'open_chat',
    sessionKind,
    modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    scenarioPackage: { scenarioId: sessionKind.scenarioId, label: sessionKind.scenarioId },
    scenarioState: {
      turnOrder: input.memberIds,
      currentTurnActorId: null,
      board: null,
      factions: [],
      seats: input.memberIds.map((memberId, index) => ({ seatId: `seat-${index + 1}`, seatIndex: index, actorId: memberId })),
      roleAssignments: [],
    },
    channels: [{ channelId: 'public', visibility: 'public', label: 'Public' }],
    layoutState: { slots: input.memberIds.map((memberId, index) => ({ slotId: `slot-${index + 1}`, x: index, y: 0, actorId: memberId })) },
    judgeAgent: { enabled: false, style: 'assistive' },
    name: input.name.trim(),
    topic: input.topic.trim(),
    style: input.style,
    runtimeEvolutionIntensity: input.runtimeEvolutionIntensity,
    memberIds: input.memberIds,
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: input.showRoleActions,
    topicSeed: '',
    runtimeSeed: buildRuntimeSeed(input),
    governance: {
      ...DEFAULT_CONVERSATION_GOVERNANCE,
      ownerCharacterId: input.ownerCharacterId,
      adminCharacterIds: input.adminCharacterIds,
      autoModeration: input.autoModeration,
      allowMute: input.allowMute,
      allowPrivateThreads: input.allowPrivateThreads,
    },
    dramaRules: {
      ...DEFAULT_CONVERSATION_DRAMA_RULES,
      allowCliques: input.allowCliques,
      allowMockery: input.allowMockery,
    },
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      mood: input.mood,
      focus: input.focus,
      recentEvent: input.recentEvent,
    },
    directorControls: {
      ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
      allowSpeakAs: input.allowSpeakAs,
      allowDirectorMode: input.allowDirectorMode,
      allowEventInjection: input.allowEventInjection,
      allowForcedReply: input.allowForcedReply,
    },
  };
}

export function buildDirectChatDraft(characterId: string, characterName: string): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const sessionKind = createDefaultSessionKind('direct', 'open_chat');
  return {
    type: 'direct',
    mode: 'open_chat',
    sessionKind,
    modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    scenarioPackage: { scenarioId: sessionKind.scenarioId, label: sessionKind.scenarioId },
    scenarioState: {
      turnOrder: [characterId],
      currentTurnActorId: null,
      board: null,
      factions: [],
      seats: [{ seatId: 'seat-1', seatIndex: 0, actorId: characterId }],
      roleAssignments: [],
    },
    channels: [{ channelId: 'public', visibility: 'public', label: 'Public' }],
    layoutState: { slots: [{ slotId: 'slot-1', x: 0, y: 0, actorId: characterId }] },
    judgeAgent: { enabled: false, style: 'assistive' },
    name: characterName,
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: [characterId],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    governance: { ...DEFAULT_CONVERSATION_GOVERNANCE, allowMute: false, allowPrivateThreads: false },
    dramaRules: { ...DEFAULT_CONVERSATION_DRAMA_RULES, allowCliques: false, allowMockery: false },
    worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood: 'private', focus: '', recentEvent: '' },
    directorControls: { ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, allowEventInjection: false, allowForcedReply: false },
  };
}
