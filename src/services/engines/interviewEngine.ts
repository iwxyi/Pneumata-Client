import type { ConversationPhase, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema, SessionEngineDefinition } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';

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

function buildGenerationPromptContext(params: { conversation: GroupChat; speaker: AICharacter }) {
  const isInterviewer = params.conversation.memberIds[0] === params.speaker.id;
  return {
    promptPrefix: isInterviewer
      ? 'You are currently driving a structured interview. Ask concise, targeted questions that move evaluation forward.'
      : 'You are replying inside a structured interview. Answer concretely, stay on topic, and avoid group-chat drift.',
    additionalConstraints: [isInterviewer ? 'Prefer one high-signal question or follow-up.' : 'Prefer a compact answer with one concrete supporting detail.'],
  };
}

function resolveTurnPolicy(params: { conversation: GroupChat }) {
  const phase = params.conversation.worldState.phase;
  return {
    runChat: phase !== 'idle',
    runAction: phase === 'idle' || phase === 'aligned',
    interleaveAction: phase === 'debating',
  };
}

function createStructuredInterviewEvent(conversationId: string, kind: RuntimeEventV2['kind'], summary: string, actorIds?: string[], payload: RuntimeEventV2['payload'] = {}) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    kind,
    createdAt: Date.now(),
    actorIds,
    summary,
    visibility: 'moderator_only' as const,
    visibleToRoles: ['interviewer'],
    payload,
  } satisfies RuntimeEventV2;
}

function inferInterviewTurnMetadata(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'>;
  speakerRole: 'interviewer' | 'candidate' | 'participant';
}) {
  const round = params.speakerRole === 'interviewer'
    ? ((params.conversation.runtimeEventsV2 || []).filter((event) => event.kind === 'message_generated' && (event.payload as { speakerRole?: string }).speakerRole === 'interviewer').length + 1)
    : ((params.conversation.runtimeEventsV2 || []).filter((event) => event.kind === 'message_generated' && (event.payload as { speakerRole?: string }).speakerRole === 'candidate').length + 1);
  const isFollowUp = params.speakerRole === 'interviewer' && /追问|展开|具体说|细一点|为什么|怎么做的/i.test(params.message.content);
  const stageLabel = params.speakerRole === 'interviewer' ? (isFollowUp ? 'follow_up' : 'question') : 'answer';
  return { round, isFollowUp, stageLabel };
}

function buildInterviewRoomShiftPayload(speakerRole: 'interviewer' | 'candidate' | 'participant', isFollowUp: boolean) {
  return {
    heat: speakerRole === 'interviewer' ? (isFollowUp ? 24 : 18) : 12,
    cohesion: speakerRole === 'candidate' ? 62 : 54,
    topicDrift: isFollowUp ? 2 : 6,
    delta: {
      heat: speakerRole === 'interviewer' ? (isFollowUp ? 5 : 4) : 2,
      cohesion: speakerRole === 'candidate' ? 4 : 1,
      topicDrift: isFollowUp ? -1 : 0,
    },
  };
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
  const { round, isFollowUp, stageLabel } = inferInterviewTurnMetadata({ conversation: params.conversation, message: params.message, speakerRole });
  const roomShiftPayload = buildInterviewRoomShiftPayload(speakerRole, isFollowUp);
  const runtimeEventsV2 = [
    ...(params.conversation.runtimeEventsV2 || []),
    createStructuredInterviewEvent(params.conversation.id, 'message_generated', summary, [params.message.senderId], { text: summary, speakerRole, round, stageLabel }),
    createStructuredInterviewEvent(params.conversation.id, 'room_shift', `${speakerRole === 'interviewer' ? (isFollowUp ? '面试追问推进' : '面试提问推进') : '候选人回答推进'}：${summary}`, [params.message.senderId], roomShiftPayload),
  ].slice(-120);
  return {
    chatPatch: {
      worldState: {
        ...params.conversation.worldState,
        phase: nextPhase,
        mood: speakerRole === 'candidate' ? 'focused' : (isFollowUp ? 'probing' : params.conversation.worldState.mood || 'evaluating'),
        focus: speakerRole === 'candidate' ? '回答当前问题' : (isFollowUp ? '深挖细节' : '推进问答'),
        recentEvent: `${speakerRole === 'interviewer' ? (isFollowUp ? '面试追问' : '面试提问') : '候选人作答'}：${summary}${params.message.content.trim().length > 56 ? '…' : ''}`,
      },
      runtimeEventsV2,
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: speakerRole === 'interviewer' ? (isFollowUp ? 'interview_follow_up' : 'interview_turn') : 'interview_answer',
      title: speakerRole === 'interviewer' ? (isFollowUp ? '进入追问轮次' : '进入提问轮次') : '进入回答轮次',
      summary,
      metrics: { round, speakerRole, stageLabel, runtimeEvent: runtimeEventsV2.at(-1) },
    }],
  };
}

void inferInterviewTurnMetadata;
void buildInterviewRoomShiftPayload;

export const INTERVIEW_ENGINE: SessionEngineDefinition = {
  key: 'interview',
  createInitialConfig: () => ({ structuredTurns: true, mode: 'panel_interview' }),
  createInitialState: () => ({ phase: 'idle' }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => buildInterviewActionSchema(conversation),
  buildGenerationPromptContext,
  resolveTurnPolicy,
  onMessageCommitted,
};
