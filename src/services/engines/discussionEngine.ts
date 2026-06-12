import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';

const DISCUSSION_PHASES = [
  { key: 'discussion', label: 'Discussion', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
  { key: 'synthesis', label: 'Synthesis', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
];
function getPhaseDefinitions() {
  return [...DISCUSSION_PHASES];
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
    { key: 'world', title: 'Discussion', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Actions', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'summarize_discussion' },
    { type: 'shift_to_synthesis' },
  ];
}

function buildGenerationPromptContext(params: { conversation: GroupChat }): SessionGenerationPromptContext {
  const phase = params.conversation.scenarioState?.phase || 'discussion';
  return {
    responseStyle: 'professional',
    allowMarkdown: true,
    styleProfile: 'analytical_room',
    additionalConstraints: phase === 'synthesis'
      ? ['Synthesize the strongest points and move toward a clear takeaway instead of reopening the full debate.']
      : ['Add one materially new distinction, tradeoff, counterpoint, or synthesis step instead of restating agreement.'],
  };
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const phase = params.conversation.scenarioState?.phase || 'discussion';
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'should',
      moveClass: phase === 'synthesis' ? 'resolve' : 'deepen',
      targetScope: 'topic',
      depth: 'deep',
      channelId: 'public',
      reason: `discussion:${phase}`,
    },
    expressionPlan: {
      surface: 'analytical',
      texture: 'rich',
      rhythm: 'back_and_forth',
      allowMarkdown: true,
    },
    realizationPlan: {
      moveClass: phase === 'synthesis' ? 'resolve' : 'deepen',
      targetScope: 'topic',
      noveltyGoal: phase === 'synthesis' ? 'resolve' : 'new_angle',
      surfaceDepth: 'deep',
    },
    trace: {
      policyHits: [`discussion_phase:${phase}`],
    },
  };
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
}) {
  const summary = params.message.content.trim().slice(0, 72);
  const nextCount = (params.conversation.scenarioState?.progress?.find((item) => item.key === 'speeches')?.value || 0) + 1;
  const shouldSynthesize = nextCount >= Math.max(4, params.conversation.memberIds.length);
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: shouldSynthesize ? 'synthesis' : 'discussion',
        goals: params.conversation.scenarioState?.goals?.length
          ? params.conversation.scenarioState?.goals
          : [{ goalId: 'discussion-goal', label: params.conversation.topic || '小组讨论', status: 'active' as const, progress: shouldSynthesize ? 0.9 : Math.min(0.75, nextCount / 6) }],
        progress: [
          { key: 'speeches', label: '发言轮次', value: nextCount, target: Math.max(4, params.conversation.memberIds.length) },
        ],
      },
      worldState: {
        ...params.conversation.worldState,
        phase: (shouldSynthesize ? 'aligned' : 'debating') as ConversationPhase,
        focus: params.conversation.scenarioState?.goals?.[0]?.label || params.conversation.topic || '讨论议题',
        recentEvent: `讨论推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: shouldSynthesize ? 'converging' : 'engaged',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: shouldSynthesize ? 'discussion_synthesis' : 'discussion_turn',
      title: shouldSynthesize ? '进入收束阶段' : '讨论推进',
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const DISCUSSION_ENGINE: SessionEngineDefinition = {
  key: 'group_discussion',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'group_discussion', sessionFamily: 'analysis', scenarioId: 'group-discussion' }),
  createInitialState: () => ({ phase: 'discussion', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
