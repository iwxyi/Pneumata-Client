import type { ConversationPhase, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';
import { buildDirectorInterventionFields } from '../../types/directorInterventionAction';

export const INTERVIEW_PHASES: Array<{ key: ConversationPhase; label: string; allowedActions: string[] }> = [
  { key: 'idle', label: 'Idle', allowedActions: ['ask_question', 'director_intervention'] },
  { key: 'warming', label: 'Intro', allowedActions: ['ask_question'] },
  { key: 'debating', label: 'Question Round', allowedActions: ['ask_question', 'director_intervention'] },
  { key: 'aligned', label: 'Evaluation', allowedActions: ['director_intervention'] },
];

export function buildInterviewScenarioState(conversation: GroupChat) {
  const turnOrder = conversation.memberIds;
  return {
    ...(conversation.scenarioState || {}),
    turnOrder,
    currentTurnActorId: conversation.scenarioState?.currentTurnActorId || turnOrder[0] || null,
    board: null,
    factions: [
      { factionId: 'panel', label: '面试方' },
      { factionId: 'candidate-pool', label: '候选方' },
    ],
    seats: turnOrder.map((memberId, index) => ({
      seatId: `seat-${index + 1}`,
      seatIndex: index,
      actorId: memberId,
      roleId: index === 0 ? 'interviewer' : 'candidate',
      teamId: index === 0 ? 'panel' : 'candidate-pool',
    })),
    roleAssignments: turnOrder.map((memberId, index) => ({
      actorId: memberId,
      roleId: index === 0 ? 'interviewer' : 'candidate',
      factionId: index === 0 ? 'panel' : 'candidate-pool',
      summary: index === 0 ? '负责提问与推进' : '负责回答与展示',
    })),
  };
}

export function buildInterviewScenarioPatch(conversation: GroupChat) {
  return {
    sessionKind: { topology: 'group' as const, family: 'interview' as const, scenarioId: 'panel-interview', surfaceProfile: 'form' as const },
    scenarioPackage: { scenarioId: 'panel-interview', label: 'panel-interview' },
    scenarioState: buildInterviewScenarioState(conversation),
    channels: [
      { channelId: 'public', visibility: 'public' as const, label: 'Public' },
      { channelId: 'moderator', visibility: 'moderator_only' as const, label: 'Moderator' },
      { channelId: 'role-interviewer', visibility: 'role_private' as const, label: 'Interviewer' },
    ],
    layoutState: { slots: conversation.memberIds.map((memberId, index) => ({ slotId: `slot-${index + 1}`, x: index, y: 0, actorId: memberId })) },
    judgeAgent: { enabled: false, style: 'assistive' as const },
    modeStateSummary: { family: 'interview' as const, scenarioId: 'panel-interview' },
    memoryLayerSummary: { characterCore: true, relationship: true, conversation: true, scenario: true },
    scenarioMemorySummary: { conversationId: conversation.id, summary: '当前会话按结构化面试场景运行。' },
    roleMemorySummaries: conversation.memberIds.map((memberId, index) => ({ actorId: memberId, roleId: index === 0 ? 'interviewer' : 'candidate', summary: index === 0 ? '负责提问与阶段推进' : '负责回答与展示能力' })),
    growthSnapshots: conversation.memberIds.map((memberId, index) => ({ actorId: memberId, conversationSummary: index === 0 ? '在该群内承担面试官职责' : '在该群内承担候选人职责' })),
    topologySummary: { topology: 'group' as const, description: 'group:interview:panel-interview' },
  };
}

export function getInterviewScenarioRole(conversation: GroupChat, memberId: string) {
  return (conversation.scenarioState?.roleAssignments || []).find((item) => item.actorId === memberId)?.roleId
    || (conversation.memberIds[0] === memberId ? 'interviewer' : 'candidate');
}

export function getInterviewerId(conversation: GroupChat) {
  return (conversation.scenarioState?.roleAssignments || []).find((item) => item.roleId === 'interviewer')?.actorId
    || conversation.memberIds[0]
    || null;
}

export function getCandidateIds(conversation: GroupChat) {
  const roleAssigned = (conversation.scenarioState?.roleAssignments || []).filter((item) => item.roleId === 'candidate').map((item) => item.actorId).filter(Boolean);
  return roleAssigned.length ? roleAssigned : conversation.memberIds.slice(1);
}

export function buildInterviewParticipants(conversation: GroupChat) {
  const seats = conversation.scenarioState?.seats || [];
  return conversation.memberIds.map((memberId, index) => {
    const seat = seats.find((item) => item.actorId === memberId);
    const role = getInterviewScenarioRole(conversation, memberId);
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
      flags: { role },
    };
  });
}

export function buildInterviewActionSchema(conversation: GroupChat): SessionActionSchema {
  const candidateOptions = getCandidateIds(conversation).map((id, index) => ({ label: `候选人 ${index + 1}`, value: id }));
  const interviewerId = getInterviewerId(conversation);
  return {
    title: '面试动作',
    actions: [
      {
        type: 'ask_question',
        label: '发起提问',
        description: '由面试官抛出一个结构化问题。',
        actorId: interviewerId || undefined,
        fields: [
          { key: 'targetId', label: '提问对象', type: 'single_select', required: true, options: candidateOptions, targetSource: 'participants' },
          { key: 'round', label: '轮次', type: 'number', required: true, placeholder: '1' },
          { key: 'prompt', label: '问题内容', type: 'textarea', required: true, placeholder: '例如：请用一分钟介绍一个你主导解决的复杂问题' },
        ],
      },
      {
        type: 'director_intervention',
        label: '推进轮次',
        description: '推进到追问、评价或总结阶段。',
        actorId: interviewerId || undefined,
        fields: buildDirectorInterventionFields({
          preset: 'interview',
          targetLabel: '影响对象',
          targetOptions: candidateOptions,
          promptPlaceholder: '例如：进入追问轮次，要求回答更具体',
        }),
      },
    ],
  };
}

export function getInterviewVisiblePanels(_context: RuntimeContext) {
  return [
    { key: 'members', title: '参与者', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: '面试状态', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: '面试动作', type: 'actions' as const },
  ];
}

export function getInterviewAvailableActions(context: { conversation: GroupChat }) {
  return buildInterviewActionSchema(context.conversation).actions.map((action) => ({ type: action.type, actorId: action.actorId }));
}

export function buildInterviewGenerationPromptContext(params: { conversation: GroupChat; speaker: AICharacter }) {
  const role = getInterviewScenarioRole(params.conversation, params.speaker.id);
  return {
    promptPrefix: role === 'interviewer'
      ? 'You are currently driving a structured interview. Ask concise, targeted questions that move evaluation forward.'
      : 'You are replying inside a structured interview. Answer concretely, stay on topic, and avoid group-chat drift.',
    additionalConstraints: [role === 'interviewer' ? 'Prefer one high-signal question or follow-up.' : 'Prefer a compact answer with one concrete supporting detail.'],
  };
}

export function resolveInterviewTurnPolicy(params: { conversation: GroupChat }) {
  const phase = params.conversation.worldState.phase;
  return { runChat: phase !== 'idle', runAction: phase === 'idle' || phase === 'aligned', interleaveAction: phase === 'debating' };
}

export function createStructuredInterviewEvent(conversationId: string, kind: RuntimeEventV2['kind'], summary: string, actorIds?: string[], payload: RuntimeEventV2['payload'] = {}) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    kind,
    createdAt: Date.now(),
    actorIds,
    summary,
    channelId: kind === 'room_shift' ? 'public' : 'moderator',
    eventClass: kind === 'room_shift' ? 'phase' : 'message',
    visibility: 'moderator_only' as const,
    visibleToRoles: ['interviewer'],
    payload,
  } satisfies RuntimeEventV2;
}

export function inferInterviewTurnMetadata(params: { conversation: GroupChat; message: Pick<Message, 'content' | 'senderId'>; speakerRole: 'interviewer' | 'candidate' | 'participant' }) {
  const round = params.speakerRole === 'interviewer'
    ? ((params.conversation.runtimeEventsV2 || []).filter((event) => event.kind === 'message_generated' && (event.payload as { speakerRole?: string }).speakerRole === 'interviewer').length + 1)
    : ((params.conversation.runtimeEventsV2 || []).filter((event) => event.kind === 'message_generated' && (event.payload as { speakerRole?: string }).speakerRole === 'candidate').length + 1);
  const isFollowUp = params.speakerRole === 'interviewer' && /追问|展开|具体说|细一点|为什么|怎么做的/i.test(params.message.content);
  const stageLabel = params.speakerRole === 'interviewer' ? (isFollowUp ? 'follow_up' : 'question') : 'answer';
  return { round, isFollowUp, stageLabel };
}

export function buildInterviewRoomShiftPayload(speakerRole: 'interviewer' | 'candidate' | 'participant', isFollowUp: boolean) {
  return {
    heat: speakerRole === 'interviewer' ? (isFollowUp ? 24 : 18) : 12,
    cohesion: speakerRole === 'candidate' ? 62 : 54,
    topicDrift: isFollowUp ? 2 : 6,
    delta: { heat: speakerRole === 'interviewer' ? (isFollowUp ? 5 : 4) : 2, cohesion: speakerRole === 'candidate' ? 4 : 1, topicDrift: isFollowUp ? -1 : 0 },
  };
}
