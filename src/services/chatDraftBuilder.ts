import type { ChatStyle, GroupChat, RuntimeEvolutionIntensity, SessionKind } from '../types/chat';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  DEFAULT_OPEN_CHAT_MODE_CONFIG,
  DEFAULT_OPEN_CHAT_MODE_STATE,
  createDefaultSessionKind,
} from '../types/chat';
import { getRoomTemplateDefaultsBySessionKind, hasTemplateDefault } from './roomTemplates';
import { normalizeRuntimeSeedLines } from './runtimeSeed';

export interface ChatDraftInput {
  type: 'group' | 'direct';
  name: string;
  topic: string;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  sessionKind?: SessionKind;
  discussionRoundsTarget?: number;
  storyBranchMode?: 'guided' | 'open';
  storyBackground?: string;
  storyDirection?: string;
  storyOutline?: string;
  studyGoalLabel?: string;
  agentGoalLabel?: string;
  boardColumns?: number;
  werewolfRoleConfig?: string;
  werewolfPostGameMode?: string;
  mysteryScript?: string;
  mysteryRoleMappingMode?: string;
  boardRows?: number;
  deductionFactionCount?: number;
  mysteryClueCount?: number;
  memberIds: string[];
  operatorIds?: string[];
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

export function composeGroupMemberIds(memberIds: string[], includeUserAsMember: boolean) {
  const normalized = stripUserMemberId(memberIds);
  if (!includeUserAsMember) return normalized;
  return Array.from(new Set([...normalized, 'user']));
}

export function stripUserMemberId(memberIds: string[]) {
  return Array.from(new Set(memberIds.filter((id) => id && id !== 'user')));
}

export interface OperatorIdsNormalizationResult {
  normalizedIds: string[];
  effectiveIds: string[];
  filteredCount: number;
}

export function normalizeOperatorIdsInput(rawValue: string, memberIds: string[]): OperatorIdsNormalizationResult {
  const normalizedMemberIds = new Set(Array.from(new Set(memberIds.filter(Boolean))));
  const normalizedIds = Array.from(new Set(
    rawValue
      .split(/[,\n，]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
  const effectiveIds = normalizedIds.filter((id) => id !== 'user' && !normalizedMemberIds.has(id));
  return {
    normalizedIds,
    effectiveIds,
    filteredCount: normalizedIds.length - effectiveIds.length,
  };
}

function buildRuntimeSeed(input: Pick<ChatDraftInput, 'seedMemoryText' | 'seedArtifactText'>) {
  return {
    notes: normalizeRuntimeSeedLines(input.seedMemoryText, 'note'),
    artifacts: normalizeRuntimeSeedLines(input.seedArtifactText, 'artifact'),
  };
}

export function buildGroupChatDraft(input: ChatDraftInput): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const sessionKind = input.sessionKind || createDefaultSessionKind('group', 'open_chat');
  const templateDefaults = getRoomTemplateDefaultsBySessionKind(sessionKind);
  const isStoryReader = sessionKind.scenarioId === 'story-reader';
  const mode = sessionKind.scenarioId === 'group-discussion'
    ? 'group_discussion'
    : sessionKind.scenarioId === 'roundtable-discussion'
      ? 'roundtable'
      : sessionKind.scenarioId === 'story-reader'
        ? 'scripted_play'
        : sessionKind.scenarioId === 'ielts-coach'
          ? 'classroom'
          : sessionKind.scenarioId === 'single-agent-workflow' || sessionKind.scenarioId === 'multi-agent-workflow'
            ? 'agent_workflow'
            : sessionKind.scenarioId === 'board-game'
              ? 'board_game'
              : sessionKind.scenarioId === 'werewolf-classic'
                ? 'werewolf'
                : sessionKind.scenarioId === 'murder-mystery'
                  ? 'murder_mystery'
                  : 'open_chat';
  return {
    type: 'group',
    mode,
    sessionKind,
    modeConfig: {
      ...DEFAULT_OPEN_CHAT_MODE_CONFIG,
      showRoleActions: isStoryReader ? false : input.showRoleActions,
    },
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    scenarioPackage: {
      scenarioId: sessionKind.scenarioId,
      label: sessionKind.scenarioId,
    },
    scenarioState: {
      turnOrder: input.memberIds,
      currentTurnActorId: null,
      board: sessionKind.scenarioId === 'board-game'
        ? { schema: { kind: 'grid', columns: input.boardColumns || 8, rows: input.boardRows || 8 }, pieces: [] }
        : null,
      factions: sessionKind.scenarioId === 'werewolf-classic'
        ? Array.from({ length: Math.max(2, input.deductionFactionCount || 2) }, (_, index) => ({ factionId: `faction-${index + 1}`, label: `阵营${index + 1}` }))
        : [],
      phase: templateDefaults.initialPhase
        || (sessionKind.scenarioId === 'roundtable-discussion'
          ? 'roundtable'
          : sessionKind.scenarioId === 'board-game'
            ? 'board'
            : sessionKind.scenarioId === 'werewolf-classic'
              ? 'night'
              : sessionKind.scenarioId === 'murder-mystery'
                ? 'investigation'
                : undefined),
      goals: templateDefaults.goalLabel || sessionKind.scenarioId === 'werewolf-classic' || sessionKind.scenarioId === 'murder-mystery' || sessionKind.scenarioId === 'board-game'
        ? [{
            goalId: `${sessionKind.family}-goal`,
            label: templateDefaults.goalLabel
              || (sessionKind.scenarioId === 'board-game'
                ? input.topic.trim() || input.name.trim()
                : sessionKind.scenarioId === 'werewolf-classic'
                  ? input.topic.trim() || '找出对手阵营'
                  : sessionKind.scenarioId === 'murder-mystery'
                    ? input.topic.trim() || '还原案件真相'
                    : input.studyGoalLabel?.trim() || input.agentGoalLabel?.trim() || input.topic.trim() || input.name.trim()),
            status: 'active',
            progress: 0,
          }]
        : [],
      progress: templateDefaults.progressLabel
        ? [{ key: `${sessionKind.family}-progress`, label: templateDefaults.progressLabel, value: 0, target: templateDefaults.progressTarget || (input.discussionRoundsTarget || 100) }]
        : sessionKind.scenarioId === 'werewolf-classic'
          ? [{ key: 'deduction-progress', label: '推理进度', value: 0, target: 100 }]
          : sessionKind.scenarioId === 'murder-mystery'
            ? [{ key: 'mystery-progress', label: '搜证进度', value: 0, target: input.mysteryClueCount || 6 }]
            : [],
      branches: isStoryReader
        ? []
        : hasTemplateDefault(templateDefaults, 'mysteryClueCount')
          ? Array.from({ length: Math.max(1, input.mysteryClueCount || templateDefaults.mysteryClueCount || 6) }, (_, index) => ({ branchId: `clue-${index + 1}`, label: `线索${index + 1}`, status: index === 0 ? 'available' : 'locked' }))
          : [],
      seats: input.memberIds.map((memberId, index) => ({ seatId: `seat-${index + 1}`, seatIndex: index, actorId: memberId })),
      roleAssignments: [],
      storyBackground: input.storyBackground || '',
      storyDirection: input.storyDirection || '',
      storyOutline: input.storyOutline || '',
      storyBeatKind: isStoryReader ? 'establish' : undefined,
      storyChoicePolicy: isStoryReader ? 'forbid' : undefined,
      storyBeatReason: isStoryReader ? 'establish scene before choices' : undefined,
      openQuestions: isStoryReader ? [] : undefined,
      clues: isStoryReader ? [] : undefined,
      stakes: isStoryReader ? [] : undefined,
      relationshipShifts: isStoryReader ? [] : undefined,
      choiceHistory: isStoryReader ? [] : undefined,
      chapterMemory: isStoryReader ? '' : undefined,
      werewolfRoleConfig: input.werewolfRoleConfig || '',
      werewolfPostGameMode: input.werewolfPostGameMode || 'free_talk',
      mysteryScript: input.mysteryScript || '',
      mysteryRoleMappingMode: input.mysteryRoleMappingMode || 'alias',
    },
    channels: [{ channelId: 'public', visibility: 'public', label: 'Public' }],
    layoutState: { slots: input.memberIds.map((memberId, index) => ({ slotId: `slot-${index + 1}`, x: index, y: 0, actorId: memberId })) },
    judgeAgent: { enabled: false, style: 'assistive' },
    name: input.name.trim(),
    topic: input.topic.trim(),
    style: input.style,
    runtimeEvolutionIntensity: input.runtimeEvolutionIntensity,
    memberIds: input.memberIds,
    operatorIds: input.operatorIds || [],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: isStoryReader ? false : input.showRoleActions,
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
