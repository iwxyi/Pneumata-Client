import type { GroupChat } from '../../types/chat';
import type { SessionEngineDefinition } from '../../types/sessionEngine';
import type { Message } from '../../types/message';
import { INTERVIEW_PHASES, buildInterviewActionSchema, buildInterviewGenerationPromptContext, buildInterviewParticipants, buildInterviewRoomShiftPayload, buildInterviewScenarioPatch, buildInterviewScenarioState, createStructuredInterviewEvent, getCandidateIds, getInterviewAvailableActions, getInterviewScenarioRole, getInterviewVisiblePanels, getInterviewerId, inferInterviewTurnMetadata, resolveInterviewTurnPolicy } from '../sessionScenarios/interviewScenario';

function getPhaseDefinitions() {
  return INTERVIEW_PHASES;
}

function buildGenerationPromptContext(params: Parameters<typeof buildInterviewGenerationPromptContext>[0]) {
  return buildInterviewGenerationPromptContext(params);
}

function resolveTurnPolicy(params: { conversation: GroupChat }) {
  return resolveInterviewTurnPolicy(params);
}

function buildParticipants(conversation: GroupChat) {
  return buildInterviewParticipants(conversation);
}

function getVisiblePanels(context: Parameters<typeof getInterviewVisiblePanels>[0]) {
  return getInterviewVisiblePanels(context);
}

function getAvailableActions(context: { conversation: GroupChat }) {
  return getInterviewAvailableActions(context);
}

function buildScenarioPatch(conversation: GroupChat) {
  return buildInterviewScenarioPatch(conversation);
}

function getScenarioRole(conversation: GroupChat, memberId: string) {
  return getInterviewScenarioRole(conversation, memberId);
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
}) {
  const speakerRole = getScenarioRole(params.conversation, params.message.senderId) as 'interviewer' | 'candidate' | 'participant';
  const summary = params.message.content.trim().slice(0, 56);
  const nextPhase: GroupChat['worldState']['phase'] = speakerRole === 'interviewer' ? 'debating' : 'aligned';
  const { round, isFollowUp, stageLabel } = inferInterviewTurnMetadata({ conversation: params.conversation, message: params.message, speakerRole });
  const roomShiftPayload = buildInterviewRoomShiftPayload(speakerRole, isFollowUp);
  const runtimeEventsV2 = [
    ...(params.conversation.runtimeEventsV2 || []),
    createStructuredInterviewEvent(params.conversation.id, 'message_generated', summary, [params.message.senderId], { text: summary, speakerRole, round, stageLabel }),
    createStructuredInterviewEvent(params.conversation.id, 'room_shift', `${speakerRole === 'interviewer' ? (isFollowUp ? '面试追问推进' : '面试提问推进') : '候选人回答推进'}：${summary}`, [params.message.senderId], roomShiftPayload),
  ].slice(-120);

  return {
    chatPatch: {
      ...buildScenarioPatch(params.conversation),
      scenarioState: {
        ...buildInterviewScenarioState(params.conversation),
        currentTurnActorId: speakerRole === 'interviewer' ? getCandidateIds(params.conversation)[0] || null : getInterviewerId(params.conversation),
      },
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
      eventClass: 'phase',
      visibilityScope: 'moderator_only',
      visibleToRoles: ['interviewer'],
      channelId: 'moderator',
    }],
  };
}

export const INTERVIEW_ENGINE: SessionEngineDefinition = {
  key: 'interview',
  createInitialConfig: () => ({ structuredTurns: true, mode: 'panel_interview', sessionFamily: 'interview', scenarioId: 'panel-interview' }),
  createInitialState: () => ({ phase: 'idle', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => buildInterviewActionSchema(conversation),
  buildGenerationPromptContext,
  resolveTurnPolicy,
  onMessageCommitted,
};
