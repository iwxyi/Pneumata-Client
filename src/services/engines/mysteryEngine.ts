import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';

const MYSTERY_PHASES = [
  { key: 'investigation', label: 'Investigation', allowedActions: ['speak', 'send_message', 'search_clue'] as string[] },
  { key: 'reconstruction', label: 'Reconstruction', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
];
function getPhaseDefinitions() {
  return [...MYSTERY_PHASES];
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
    { key: 'world', title: 'Mystery', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Clues', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'search_clue' },
    { type: 'reconstruct_case' },
  ];
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const phase = params.conversation.scenarioState?.phase || 'investigation';
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'should',
      moveClass: phase === 'reconstruction' ? 'resolve' : 'challenge',
      targetScope: 'scene',
      depth: 'deep',
      channelId: 'public',
      reason: `mystery:${phase}`,
    },
    expressionPlan: {
      surface: 'dramatic',
      texture: 'rich',
      rhythm: 'scene_beat',
      allowMarkdown: true,
    },
    realizationPlan: {
      moveClass: phase === 'reconstruction' ? 'resolve' : 'challenge',
      targetScope: 'scene',
      noveltyGoal: phase === 'reconstruction' ? 'resolve' : 'new_evidence',
      surfaceDepth: 'deep',
      emotionalPosture: 'tense',
    },
    trace: {
      policyHits: [`mystery_phase:${phase}`],
    },
  };
}

function paramsPlaceholder(conversation: GroupChat, fallback: string) {
  return conversation.scenarioState?.mysteryScript || fallback;
}

function getActionSchema(conversation: GroupChat) {
  const clueOptions = (conversation.scenarioState?.branches || []).map((branch) => ({ label: branch.label, value: branch.branchId }));
  return {
    title: '剧本动作',
    actions: [
      {
        type: 'search_clue',
        label: '搜证',
        description: '选择一条线索继续推进。',
        visibility: 'public' as const,
        fields: [
          { key: 'clueId', label: '线索', type: 'single_select' as const, required: clueOptions.length > 0, options: clueOptions },
          { key: 'prompt', label: '搜证说明', type: 'textarea' as const, placeholder: paramsPlaceholder(conversation, '重点查看案发现场附近的血迹') },
        ],
      },
      {
        type: 'reconstruct_case',
        label: '还原案件',
        description: '进入案件复盘与还原。',
        visibility: 'public' as const,
        fields: [
          { key: 'hypothesis', label: '还原思路', type: 'textarea' as const, required: true, placeholder: '例如：凶手先制造不在场证明，再伪造线索' },
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
  const currentProgress = params.conversation.scenarioState?.progress?.find((item) => item.key === 'mystery-progress')?.value || 0;
  const target = params.conversation.scenarioState?.progress?.find((item) => item.key === 'mystery-progress')?.target || 6;
  const nextProgress = Math.min(target, currentProgress + 1);
  const nextPhase = nextProgress >= target ? 'reconstruction' : 'investigation';
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: nextPhase,
        goals: params.conversation.scenarioState?.goals?.length
          ? params.conversation.scenarioState.goals.map((goal) => ({ ...goal, progress: target > 0 ? nextProgress / target : 0 }))
          : params.conversation.scenarioState?.goals,
        progress: [{ key: 'mystery-progress', label: '搜证进度', value: nextProgress, target }],
      },
      worldState: {
        ...params.conversation.worldState,
        phase: (nextPhase === 'reconstruction' ? 'aligned' : 'debating') as ConversationPhase,
        focus: params.conversation.scenarioState?.mysteryScript || params.conversation.topic || '案件真相',
        recentEvent: `搜证推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: nextPhase === 'reconstruction' ? 'revealing' : 'tense',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: nextPhase === 'reconstruction' ? 'mystery_reconstruction' : 'mystery_clue_progress',
      title: nextPhase === 'reconstruction' ? '进入还原阶段' : '搜证推进',
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const MYSTERY_ENGINE: SessionEngineDefinition = {
  key: 'mystery_engine',
  createInitialConfig: () => ({ structuredTurns: true, mode: 'murder_mystery', sessionFamily: 'mystery', scenarioId: 'murder-mystery' }),
  createInitialState: () => ({ phase: 'investigation', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => getActionSchema(conversation),
  buildRuntimeContextBundle,
  onMessageCommitted,
};
