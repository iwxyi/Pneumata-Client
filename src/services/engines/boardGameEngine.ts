import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition } from '../../types/sessionEngine';
import type { Message } from '../../types/message';

const BOARD_PHASES = [
  { key: 'board', label: 'Board', allowedActions: ['speak', 'send_message', 'board_move'] as string[] },
];
function getPhaseDefinitions() {
  return [...BOARD_PHASES];
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
    { key: 'members', title: 'Players', type: 'members' as const, tabKey: 'members' as const },
    { key: 'world', title: 'Board', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Moves', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'board_move' },
  ];
}

function getActionSchema(conversation: GroupChat) {
  return {
    title: '棋盘动作',
    actions: [
      {
        type: 'board_move',
        label: '落子 / 移动',
        description: '提交一个棋盘动作。',
        visibility: 'public' as const,
        fields: [
          { key: 'pieceId', label: '棋子ID', type: 'text' as const, required: false, placeholder: '例如：piece-1' },
          { key: 'position', label: '目标位置', type: 'text' as const, required: true, placeholder: `例如：A3（${conversation.scenarioState?.board?.schema?.columns || 8}×${conversation.scenarioState?.board?.schema?.rows || 8}）` },
          { key: 'move', label: '动作说明', type: 'text' as const, required: false, placeholder: '例如：advance' },
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
  const progress = params.conversation.scenarioState?.progress?.find((item) => item.key === 'board-progress')?.value || 0;
  const nextProgress = Math.min(100, progress + 10);
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: 'board',
        turnOrder: params.conversation.memberIds,
        currentTurnActorId: params.conversation.memberIds[nextProgress % Math.max(1, params.conversation.memberIds.length)] || null,
        progress: [{ key: 'board-progress', label: '对局进度', value: nextProgress, target: 100 }],
      },
      worldState: {
        ...params.conversation.worldState,
        phase: 'debating' as ConversationPhase,
        focus: params.conversation.topic || '棋盘对局',
        recentEvent: `对局推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: 'strategic',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: 'board_turn',
      title: '棋盘推进',
      summary,
      eventClass: 'board',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const BOARD_GAME_ENGINE: SessionEngineDefinition = {
  key: 'board_game',
  createInitialConfig: () => ({ structuredTurns: true, mode: 'board_game', sessionFamily: 'board_game', scenarioId: 'board-game' }),
  createInitialState: () => ({ phase: 'board', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => getActionSchema(conversation),
  onMessageCommitted,
};
