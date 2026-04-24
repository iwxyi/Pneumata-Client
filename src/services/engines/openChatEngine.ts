import type { DriverMessageCommitResult, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema, SessionEngineDefinition } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../../types/chat';
import { buildChatPatch, buildNextWorldState, buildRelationshipTransition, buildWorldRuntimeEvents } from '../chatRuntimeTransitionBuilder';
import { resolveRuntimeEvolutionConfig } from '../runtimeEvolutionConfig';

function buildParticipants(conversation: GroupChat) {
  return conversation.memberIds.map((memberId, index) => ({
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: 'ai' as const,
    entityRefId: memberId,
    seatIndex: index,
    canSpeak: true,
    canAct: true,
    flags: {},
  }));
}

function buildOpenChatActionSchema(conversation: GroupChat): SessionActionSchema {
  return {
    title: '会话动作',
    actions: [
      {
        type: 'ask_question',
        label: '提问动作',
        description: '推进一个问题、追问点或讨论环节。',
        fields: [
          { key: 'prompt', label: '问题内容', type: 'textarea', required: true, placeholder: '例如：请每个人用一句话表明立场' },
        ],
      },
      {
        type: 'director_intervention',
        label: '导演干预',
        description: '由主持/导演推动群聊节奏。',
        fields: [
          { key: 'prompt', label: '干预内容', type: 'textarea', required: true, placeholder: '例如：先别跑题，回到核心争议' },
        ],
      },
      ...(conversation.type === 'group'
        ? [{ type: 'start_private_thread', label: '发起私聊', description: '派生局部私聊或双边互动。' }]
        : []),
    ],
  };
}

function getAvailableActions(context: { conversation: GroupChat }) {
  return buildOpenChatActionSchema(context.conversation).actions.map((action) => ({ type: action.type }));
}

function getVisiblePanels(context: RuntimeContext) {
  return [
    { key: 'members', title: context.conversation.type === 'group' ? '成员' : context.conversation.type === 'ai_direct' ? 'AI私聊信息' : '单聊信息', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: '运行态', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: '动作', type: 'actions' as const },
  ];
}

function getPhaseDefinitions() {
  return [
    { key: 'idle', label: 'Idle', allowedActions: ['send_message', 'director_intervention', 'start_private_thread', 'ask_question'] },
    { key: 'warming', label: 'Warming', allowedActions: ['send_message', 'director_intervention', 'ask_question'] },
    { key: 'debating', label: 'Debating', allowedActions: ['send_message', 'director_intervention'] },
    { key: 'aligned', label: 'Aligned', allowedActions: ['send_message', 'ask_question'] },
    { key: 'chaotic', label: 'Chaotic', allowedActions: ['send_message', 'director_intervention', 'start_private_thread'] },
  ];
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
}): DriverMessageCommitResult {
  const config = resolveRuntimeEvolutionConfig(params.conversation.runtimeEvolutionIntensity);
  const { worldState, nextConflictAxes } = buildNextWorldState(params.conversation, params.message, config);
  const relationshipTransition = buildRelationshipTransition({ ...params, config });
  const runtimeEvents = [
    ...relationshipTransition.runtimeEvents,
    ...buildWorldRuntimeEvents(params.message, worldState, nextConflictAxes, config),
  ];
  const chatPatch = buildChatPatch(params.conversation, params.message, worldState, runtimeEvents, config);

  return {
    chatPatch,
    characterPatches: relationshipTransition.characterPatches,
    runtimeEvents,
  };
}

export const OPEN_CHAT_ENGINE: SessionEngineDefinition = {
  key: 'open_chat',
  createInitialConfig: () => DEFAULT_OPEN_CHAT_MODE_CONFIG,
  createInitialState: () => DEFAULT_OPEN_CHAT_MODE_STATE,
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => buildOpenChatActionSchema(conversation),
  onMessageCommitted,
};
