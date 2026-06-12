import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';

const STORY_PHASES = [
  { key: 'scene', label: 'Scene', allowedActions: ['speak', 'send_message', 'branch_choose'] as string[] },
  { key: 'branch', label: 'Branch', allowedActions: ['speak', 'send_message', 'branch_choose'] as string[] },
];
function getPhaseDefinitions() {
  return [...STORY_PHASES];
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
    { key: 'world', title: 'Story', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Branches', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'choose_story_branch' },
    { type: 'advance_story_scene' },
  ];
}

function buildGenerationPromptContext(params: { conversation: GroupChat }): SessionGenerationPromptContext {
  const phase = params.conversation.scenarioState?.phase || 'scene';
  return {
    responseStyle: 'creative',
    allowMarkdown: true,
    styleProfile: 'dramatic_room',
    additionalConstraints: phase === 'branch'
      ? ['Push the current branch to a clear decision or reveal instead of lingering in neutral scene description.']
      : ['Advance the scene with concrete atmosphere, implication, or character pressure instead of plain exposition.'],
  };
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const phase = params.conversation.scenarioState?.phase || 'scene';
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'should',
      moveClass: phase === 'branch' ? 'resolve' : 'perform',
      targetScope: phase === 'branch' ? 'scene' : 'room',
      depth: 'normal',
      channelId: 'public',
      reason: `story:${phase}`,
    },
    expressionPlan: {
      surface: 'dramatic',
      texture: 'rich',
      rhythm: 'scene_beat',
      allowMarkdown: true,
    },
    realizationPlan: {
      moveClass: phase === 'branch' ? 'resolve' : 'perform',
      targetScope: phase === 'branch' ? 'scene' : 'room',
      noveltyGoal: phase === 'branch' ? 'resolve' : 'new_angle',
      surfaceDepth: 'normal',
      emotionalPosture: 'tense',
    },
    trace: {
      policyHits: [`story_phase:${phase}`],
    },
  };
}

function paramsPlaceholder(conversation: GroupChat, fallback: string) {
  return conversation.scenarioState?.storyDirection || fallback;
}

function getActionSchema(conversation: GroupChat) {
  const branchOptions = (conversation.scenarioState?.branches || [{ branchId: 'main', label: conversation.topic || '主线剧情', status: 'available' }]).map((branch) => ({
    label: branch.label,
    value: branch.branchId,
  }));
  return {
    title: '故事动作',
    actions: [
      {
        type: 'choose_story_branch',
        label: '选择分支',
        description: '推进当前故事分支。',
        visibility: 'public' as const,
        fields: [
          { key: 'branchId', label: '分支', type: 'single_select' as const, required: true, options: branchOptions },
          { key: 'prompt', label: '推进方式', type: 'textarea' as const, placeholder: paramsPlaceholder(conversation, '让角色沿着这条线继续推进') },
        ],
      },
      {
        type: 'advance_story_scene',
        label: '推进场景',
        description: '推动剧情进入下一段。',
        visibility: 'public' as const,
        fields: [
          { key: 'prompt', label: '场景变化', type: 'textarea' as const, required: true, placeholder: '例如：夜幕降临，所有人来到旧宅门前' },
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
  const currentBranch = params.conversation.scenarioState?.branches?.[0];
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: currentBranch?.status === 'chosen' ? 'branch' : 'scene',
        branches: params.conversation.scenarioState?.branches?.length
          ? params.conversation.scenarioState.branches
          : [{ branchId: 'main', label: params.conversation.topic || '主线剧情', status: 'available' as const }],
      },
      worldState: {
        ...params.conversation.worldState,
        phase: 'warming' as ConversationPhase,
        focus: params.conversation.scenarioState?.storyDirection || params.conversation.topic || '剧情推进',
        recentEvent: `剧情推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: params.conversation.scenarioState?.storyBackground ? 'immersive' : 'warming',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: 'story_scene_progress',
      title: '剧情推进',
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const STORY_ENGINE: SessionEngineDefinition = {
  key: 'scripted_play',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'scripted_play', sessionFamily: 'conversation', scenarioId: 'story-reader' }),
  createInitialState: () => ({ phase: 'scene', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => getActionSchema(conversation),
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
