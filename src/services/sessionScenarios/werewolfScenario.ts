import type { ConversationPhase, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';
import { buildDirectorInterventionFields } from '../../types/directorInterventionAction';

export const WEREWOLF_PHASES: Array<{ key: ConversationPhase; label: string; allowedActions: string[] }> = [
  { key: 'idle', label: 'Lobby', allowedActions: ['director_intervention'] },
  { key: 'warming', label: 'Night', allowedActions: ['wolf_vote', 'inspect_player', 'director_intervention'] },
  { key: 'debating', label: 'Day Discussion', allowedActions: ['send_message', 'vote_player', 'director_intervention'] },
  { key: 'aligned', label: 'Vote Resolution', allowedActions: ['director_intervention'] },
  { key: 'chaotic', label: 'Last Words', allowedActions: ['send_message', 'director_intervention'] },
];

export function pickWerewolfRole(index: number, total: number) {
  if (index === 0 && total >= 4) return 'seer';
  if (index >= total - Math.max(1, Math.floor(total / 4))) return 'werewolf';
  return 'villager';
}

export function buildWerewolfScenarioState(conversation: GroupChat) {
  const total = conversation.memberIds.length;
  const turnOrder = conversation.memberIds;
  return {
    ...(conversation.scenarioState || {}),
    turnOrder,
    currentTurnActorId: conversation.scenarioState?.currentTurnActorId || turnOrder[0] || null,
    board: null,
    factions: [
      { factionId: 'villagers', label: '村民阵营' },
      { factionId: 'werewolves', label: '狼人阵营' },
    ],
    seats: turnOrder.map((memberId, index) => {
      const roleId = pickWerewolfRole(index, total);
      return { seatId: `seat-${index + 1}`, seatIndex: index, actorId: memberId, roleId, teamId: roleId === 'werewolf' ? 'werewolves' : 'villagers' };
    }),
    roleAssignments: turnOrder.map((memberId, index) => {
      const roleId = pickWerewolfRole(index, total);
      return { actorId: memberId, roleId, factionId: roleId === 'werewolf' ? 'werewolves' : 'villagers', summary: roleId === 'werewolf' ? '负责夜晚协同行动与白天伪装' : roleId === 'seer' ? '负责夜晚查验与白天引导' : '负责白天讨论与投票' };
    }),
  };
}

export function buildWerewolfScenarioPatch(conversation: GroupChat) {
  return {
    sessionKind: { topology: 'table' as const, family: 'deduction' as const, scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid' as const },
    scenarioPackage: { scenarioId: 'werewolf-classic', label: 'werewolf-classic' },
    scenarioState: buildWerewolfScenarioState(conversation),
    channels: [
      { channelId: 'public', visibility: 'public' as const, label: 'Public' },
      { channelId: 'moderator', visibility: 'moderator_only' as const, label: 'Moderator' },
      { channelId: 'wolf-private', visibility: 'pair_private' as const, label: 'Werewolves', roleIds: ['werewolf'] },
      { channelId: 'seer-private', visibility: 'role_private' as const, label: 'Seer', roleIds: ['seer'] },
    ],
    layoutState: { slots: conversation.memberIds.map((memberId, index) => ({ slotId: `slot-${index + 1}`, x: index, y: 0, actorId: memberId })) },
    judgeAgent: { enabled: false, style: 'assistive' as const },
    modeStateSummary: { family: 'deduction' as const, scenarioId: 'werewolf-classic' },
    memoryLayerSummary: { characterCore: true, relationship: true, conversation: true, scenario: true },
    scenarioMemorySummary: { conversationId: conversation.id, summary: '当前会话按狼人杀场景运行。' },
    roleMemorySummaries: buildWerewolfScenarioState(conversation).roleAssignments.map((item) => ({ actorId: item.actorId, roleId: item.roleId, summary: item.summary })),
    growthSnapshots: conversation.memberIds.map((memberId, index) => ({ actorId: memberId, conversationSummary: `在该群内承担 ${pickWerewolfRole(index, conversation.memberIds.length)} 职责` })),
    topologySummary: { topology: 'table' as const, description: 'table:deduction:werewolf-classic' },
  };
}

export function getWerewolfScenarioRole(conversation: GroupChat, memberId: string) {
  return (conversation.scenarioState?.roleAssignments || []).find((item) => item.actorId === memberId)?.roleId
    || pickWerewolfRole(conversation.memberIds.indexOf(memberId), conversation.memberIds.length);
}

export function buildWerewolfParticipants(conversation: GroupChat) {
  const scenarioState = buildWerewolfScenarioState(conversation);
  return conversation.memberIds.map((memberId, index) => {
    const seat = scenarioState.seats?.find((item) => item.actorId === memberId);
    const role = getWerewolfScenarioRole(conversation, memberId);
    return {
      participantId: `${conversation.id}:${memberId}`,
      conversationId: conversation.id,
      entityType: 'ai' as const,
      entityRefId: memberId,
      seatIndex: seat?.seatIndex ?? index,
      canSpeak: true,
      canAct: true,
      roleKey: role,
      faction: seat?.teamId || null,
      flags: { role, alive: true },
    };
  });
}

export function buildWerewolfActionSchema(conversation: GroupChat): SessionActionSchema {
  const targetOptions = conversation.memberIds.map((id, index) => ({ label: `玩家 ${index + 1}`, value: id }));
  return {
    title: '狼人杀动作',
    actions: [
      { type: 'wolf_vote', label: '夜晚袭击', description: '狼人夜晚选择一名目标作为刀口。', visibility: 'pair_private', fields: [{ key: 'targetId', label: '袭击目标', type: 'single_select', required: true, options: targetOptions, targetSource: 'participants' }, { key: 'prompt', label: '协商备注', type: 'textarea', placeholder: '例如：优先处理发言最强势的玩家' }] },
      { type: 'inspect_player', label: '夜晚查验', description: '预言家夜晚查验一名玩家的阵营。', visibility: 'role_private', fields: [{ key: 'targetId', label: '查验目标', type: 'single_select', required: true, options: targetOptions, targetSource: 'participants' }] },
      { type: 'vote_player', label: '白天投票', description: '白天公投一名嫌疑目标。', visibility: 'public', fields: [{ key: 'targetId', label: '投票目标', type: 'single_select', required: true, options: targetOptions, targetSource: 'participants' }, { key: 'prompt', label: '投票理由', type: 'textarea', placeholder: '例如：他的站边前后矛盾' }] },
      { type: 'director_intervention', label: '主持推进', description: '切换昼夜、结算结果或推动发言。', visibility: 'moderator_only', fields: buildDirectorInterventionFields({ preset: 'deduction', targetLabel: '影响玩家', targetOptions, promptPlaceholder: '例如：天亮了，昨夜是平安夜，进入白天讨论' }) },
    ],
  };
}

export function getWerewolfVisiblePanels(_context: RuntimeContext) {
  return [
    { key: 'members', title: '玩家', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: '局势', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: '夜晚/白天动作', type: 'actions' as const },
  ];
}

export function getWerewolfAvailableActions(context: { conversation: GroupChat }) {
  return buildWerewolfActionSchema(context.conversation).actions.map((action) => ({ type: action.type }));
}

export function buildWerewolfGenerationPromptContext(params: { conversation: GroupChat; speaker: AICharacter }) {
  const role = getWerewolfScenarioRole(params.conversation, params.speaker.id);
  return {
    promptPrefix: `You are speaking inside a werewolf social deduction game as ${role}. Preserve hidden-role incentives and public plausibility.`,
    additionalConstraints: [params.conversation.worldState.phase === 'warming' ? 'Night-phase speech should stay covert and implication-heavy.' : 'Day-phase speech should sound accusatory, defensive, or analytical in-character.'],
  };
}

export function resolveWerewolfTurnPolicy(params: { conversation: GroupChat }) {
  const phase = params.conversation.worldState.phase;
  return { runChat: phase !== 'idle' && phase !== 'aligned', runAction: phase === 'warming' || phase === 'aligned' || phase === 'idle', interleaveAction: phase === 'debating' };
}

export function createStructuredWerewolfEvent(params: { conversationId: string; kind: RuntimeEventV2['kind']; summary: string; actorIds?: string[]; payload?: RuntimeEventV2['payload']; visibility?: RuntimeEventV2['visibility']; visibleToRoles?: string[] }) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: params.conversationId,
    kind: params.kind,
    createdAt: Date.now(),
    actorIds: params.actorIds,
    summary: params.summary,
    channelId: params.visibility === 'pair_private' ? 'wolf-private' : params.visibility === 'role_private' ? 'seer-private' : 'public',
    eventClass: params.kind === 'artifact' ? 'artifact' : params.kind === 'room_shift' ? 'phase' : 'message',
    visibility: params.visibility || 'public',
    visibleToRoles: params.visibleToRoles,
    payload: params.payload || {},
  } satisfies RuntimeEventV2;
}
