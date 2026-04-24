import type { ConversationPhase, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema, SessionEngineDefinition } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';

function buildParticipants(conversation: GroupChat) {
  return conversation.memberIds.map((memberId, index) => ({
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: 'ai' as const,
    entityRefId: memberId,
    seatIndex: index,
    canSpeak: true,
    canAct: true,
    flags: { role: index === 0 ? 'interviewer' : 'candidate' },
  }));
}

function buildInterviewActionSchema(conversation: GroupChat): SessionActionSchema {
  const candidateOptions = conversation.memberIds.slice(1).map((id, index) => ({ label: `候选人 ${index + 1}`, value: id }));
  return {
    title: '面试动作',
    actions: [
      {
        type: 'ask_question',
        label: '发起提问',
        description: '由面试官抛出一个结构化问题。',
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
        fields: [
          { key: 'prompt', label: '推进说明', type: 'textarea', required: true, placeholder: '例如：进入追问轮次，要求回答更具体' },
        ],
      },
    ],
  };
}

function getVisiblePanels(_context: RuntimeContext) {
  return [
    { key: 'members', title: '参与者', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: '面试状态', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: '面试动作', type: 'actions' as const },
  ];
}

function getPhaseDefinitions() {
  return [
    { key: 'idle', label: 'Idle', allowedActions: ['ask_question', 'director_intervention'] },
    { key: 'warming', label: 'Intro', allowedActions: ['ask_question'] },
    { key: 'debating', label: 'Question Round', allowedActions: ['ask_question', 'director_intervention'] },
    { key: 'aligned', label: 'Evaluation', allowedActions: ['director_intervention'] },
  ];
}

function getAvailableActions(context: { conversation: GroupChat }) {
  return buildInterviewActionSchema(context.conversation).actions.map((action) => ({ type: action.type }));
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
}) {
  const speaker = params.characters.find((character) => character.id === params.message.senderId);
  const speakerRole = speaker ? (params.conversation.memberIds[0] === speaker.id ? 'interviewer' : 'candidate') : 'participant';
  const summary = params.message.content.trim().slice(0, 56);
  const nextPhase: ConversationPhase = speakerRole === 'interviewer' ? 'debating' : 'aligned';
  return {
    chatPatch: {
      worldState: {
        ...params.conversation.worldState,
        phase: nextPhase,
        recentEvent: `${speakerRole === 'interviewer' ? '面试提问' : '候选人作答'}：${summary}${params.message.content.trim().length > 56 ? '…' : ''}`,
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: 'interview_turn',
      title: speakerRole === 'interviewer' ? '进入提问轮次' : '进入回答轮次',
      summary,
    }],
  };
}

export const INTERVIEW_ENGINE: SessionEngineDefinition = {
  key: 'interview',
  createInitialConfig: () => ({ structuredTurns: true, mode: 'panel_interview' }),
  createInitialState: () => ({ phase: 'idle' }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => buildInterviewActionSchema(conversation),
  onMessageCommitted,
};
