import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition } from '../../types/sessionEngine';
import type { Message } from '../../types/message';

const AGENT_PHASES = [
  { key: 'planning', label: 'Planning', allowedActions: ['speak', 'send_message', 'assign_task'] as string[] },
  { key: 'executing', label: 'Executing', allowedActions: ['speak', 'send_message', 'assign_task'] as string[] },
  { key: 'review', label: 'Review', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
];
function getPhaseDefinitions() {
  return [...AGENT_PHASES];
}

function buildParticipants(conversation: GroupChat) {
  return conversation.memberIds.map((memberId, index) => ({
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: memberId === 'user' ? 'user' as const : 'ai' as const,
    entityRefId: memberId,
    seatIndex: index,
    displayName: memberId === 'user' ? '我' : undefined,
    canSpeak: true,
    canAct: true,
    flags: { actorRefKind: memberId === 'user' ? 'user_persona' : 'ai_character' },
  }));
}

function getVisiblePanels() {
  return [
    { key: 'members', title: 'Members', type: 'members' as const, tabKey: 'members' as const },
    { key: 'world', title: 'Workflow', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Tasks', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'assign_agent_task' },
    { type: 'summarize_workflow' },
  ];
}

function paramsGoal(conversation: GroupChat) {
  return conversation.scenarioState?.goals?.[0]?.label || '例如：先整理需求，再拆分执行步骤';
}

function getActionSchema(conversation: GroupChat) {
  return {
    title: 'Agent动作',
    actions: [
      {
        type: 'assign_agent_task',
        label: '分配任务',
        description: '给当前工作流分配下一步任务。',
        visibility: 'public' as const,
        fields: [
          { key: 'task', label: '任务内容', type: 'textarea' as const, required: true, placeholder: paramsGoal(conversation) },
        ],
      },
      {
        type: 'summarize_workflow',
        label: '总结流程',
        description: '汇总当前进展与产出。',
        visibility: 'public' as const,
        fields: [
          { key: 'focus', label: '总结重点', type: 'textarea' as const, placeholder: '例如：已完成项、阻塞项、下一步' },
        ],
      },
    ],
  };
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
}) {
  const summary = params.message.content.trim().slice(0, 72);
  const currentProgress = params.conversation.scenarioState?.progress?.find((item) => item.key === 'agent-progress')?.value || 0;
  const nextProgress = Math.min(100, currentProgress + 15);
  const nextPhase = nextProgress >= 80 ? 'review' : nextProgress >= 25 ? 'executing' : 'planning';
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: nextPhase,
        goals: params.conversation.scenarioState?.goals?.length
          ? params.conversation.scenarioState.goals.map((goal) => ({ ...goal, progress: nextProgress / 100 }))
          : [{ goalId: 'agent-goal', label: params.conversation.topic || '任务目标', status: 'active' as const, progress: nextProgress / 100 }],
        turnOrder: params.conversation.memberIds,
        currentTurnActorId: params.conversation.memberIds[nextProgress % Math.max(1, params.conversation.memberIds.length)] || null,
        progress: [{ key: 'agent-progress', label: '任务进度', value: nextProgress, target: 100 }],
      },
      worldState: {
        ...params.conversation.worldState,
        phase: (nextPhase === 'review' ? 'aligned' : nextPhase === 'executing' ? 'debating' : 'warming') as ConversationPhase,
        focus: params.conversation.scenarioState?.goals?.[0]?.label || params.conversation.topic || '任务目标',
        recentEvent: `任务推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: nextPhase === 'review' ? 'reviewing' : nextPhase === 'executing' ? 'active' : 'planning',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: `agent_${nextPhase}`,
      title: nextPhase === 'planning' ? '规划阶段' : nextPhase === 'executing' ? '执行阶段' : '复盘阶段',
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const AGENT_WORKFLOW_ENGINE: SessionEngineDefinition = {
  key: 'agent_workflow',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'open_chat', sessionFamily: 'agent', scenarioId: 'multi-agent-workflow' }),
  createInitialState: () => ({ phase: 'planning', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => getActionSchema(conversation),
  onMessageCommitted,
};
