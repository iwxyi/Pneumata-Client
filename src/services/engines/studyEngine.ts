import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';

const STUDY_PHASES = [
  { key: 'learning', label: 'Learning', allowedActions: ['speak', 'send_message', 'assign_task'] as string[] },
  { key: 'review', label: 'Review', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
];
function getPhaseDefinitions() {
  return [...STUDY_PHASES];
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
    { key: 'world', title: 'Study', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Tasks', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'assign_study_task' },
    { type: 'review_progress' },
  ];
}

function buildGenerationPromptContext(params: { conversation: GroupChat }): SessionGenerationPromptContext {
  const phase = params.conversation.scenarioState?.phase || 'learning';
  return {
    responseStyle: 'professional',
    allowMarkdown: true,
    styleProfile: 'task_room',
    additionalConstraints: phase === 'review'
      ? ['Review progress concretely and close the loop on what improved, what still blocks, and what to do next.']
      : ['Teach or coach directly, with practical next steps before extra chatter.'],
  };
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const phase = params.conversation.scenarioState?.phase || 'learning';
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'should',
      moveClass: phase === 'review' ? 'resolve' : 'deepen',
      targetScope: 'task',
      depth: 'deep',
      channelId: 'public',
      reason: `study:${phase}`,
    },
    expressionPlan: {
      surface: 'task',
      texture: 'rich',
      rhythm: 'back_and_forth',
      allowMarkdown: true,
    },
    realizationPlan: {
      moveClass: phase === 'review' ? 'resolve' : 'deepen',
      targetScope: 'task',
      noveltyGoal: phase === 'review' ? 'resolve' : 'new_angle',
      surfaceDepth: 'deep',
      emotionalPosture: 'warm',
    },
    trace: {
      policyHits: [`study_phase:${phase}`],
    },
  };
}

function getActionSchema(conversation: GroupChat) {
  return {
    title: '教学动作',
    actions: [
      {
        type: 'assign_study_task',
        label: '布置任务',
        description: '布置一个新的学习任务。',
        visibility: 'public' as const,
        fields: [
          { key: 'task', label: '任务内容', type: 'textarea' as const, required: true, placeholder: '例如：完成一轮口语 Part 2 练习' },
        ],
      },
      {
        type: 'review_progress',
        label: '复盘进度',
        description: '总结当前学习进展。',
        visibility: 'public' as const,
        fields: [
          { key: 'focus', label: '复盘重点', type: 'textarea' as const, placeholder: '例如：发音、流利度、结构表达' },
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
  const currentProgress = params.conversation.scenarioState?.progress?.find((item) => item.key === 'study-progress')?.value || 0;
  const nextProgress = Math.min(100, currentProgress + 12);
  const nextPhase = nextProgress >= 72 ? 'review' : 'learning';
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: nextPhase,
        goals: params.conversation.scenarioState?.goals?.length
          ? params.conversation.scenarioState.goals.map((goal) => ({ ...goal, progress: nextProgress / 100 }))
          : [{ goalId: 'study-goal', label: params.conversation.topic || '学习目标', status: 'active' as const, progress: nextProgress / 100 }],
        progress: [{ key: 'study-progress', label: '学习进度', value: nextProgress, target: 100 }],
      },
      worldState: {
        ...params.conversation.worldState,
        phase: (nextPhase === 'review' ? 'aligned' : 'warming') as ConversationPhase,
        focus: params.conversation.scenarioState?.goals?.[0]?.label || params.conversation.topic || '学习目标',
        recentEvent: `学习推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: nextPhase === 'review' ? 'reflective' : 'focused',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: nextPhase === 'review' ? 'study_review' : 'study_progress',
      title: nextPhase === 'review' ? '进入复盘阶段' : '学习推进',
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const STUDY_ENGINE: SessionEngineDefinition = {
  key: 'classroom',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'classroom', sessionFamily: 'study', scenarioId: 'ielts-coach' }),
  createInitialState: () => ({ phase: 'learning', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => getActionSchema(conversation),
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
