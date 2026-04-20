import type { AICharacter } from '../types/character';
import type { DriverMessageCommitResult, GroupChat, OpenChatModeDriver, RuntimeContext } from '../types/chat';
import type { Message } from '../types/message';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../types/chat';
import { buildChatPatch, buildNextWorldState, buildRelationshipTransition, buildWorldRuntimeEvents } from './chatRuntimeTransitionBuilder';

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

function getAvailableActions() {
  return [
    { type: 'send_message' },
    { type: 'director_intervention' },
    { type: 'start_private_thread' },
  ];
}

function getVisiblePanels(context: RuntimeContext) {
  return [
    { key: 'members', title: context.conversation.type === 'group' ? '成员' : context.conversation.type === 'ai_direct' ? 'AI私聊信息' : '单聊信息', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: '运行态', type: 'runtime' as const, tabKey: 'world' as const },
  ];
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
}): DriverMessageCommitResult {
  const { worldState, nextConflictAxes } = buildNextWorldState(params.conversation, params.message);
  const relationshipTransition = buildRelationshipTransition(params);
  const runtimeEvents = [
    ...relationshipTransition.runtimeEvents,
    ...buildWorldRuntimeEvents(params.message, worldState, nextConflictAxes),
  ];
  const chatPatch = buildChatPatch(params.conversation, params.message, worldState, runtimeEvents);

  return {
    chatPatch,
    characterPatches: relationshipTransition.characterPatches,
    runtimeEvents,
  };
}

export const OPEN_CHAT_MODE_DRIVER: OpenChatModeDriver = {
  key: 'open_chat',
  createInitialConfig: () => DEFAULT_OPEN_CHAT_MODE_CONFIG,
  createInitialState: () => DEFAULT_OPEN_CHAT_MODE_STATE,
  buildParticipants,
  getAvailableActions,
  getVisiblePanels,
  onMessageCommitted,
};
