import type { GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';
import { WEREWOLF_PHASES, buildWerewolfActionSchema, buildWerewolfGenerationPromptContext, buildWerewolfParticipants, buildWerewolfScenarioPatch, buildWerewolfScenarioState, createStructuredWerewolfEvent, getWerewolfAvailableActions, getWerewolfScenarioRole, getWerewolfVisiblePanels, resolveWerewolfTurnPolicy } from '../sessionScenarios/werewolfScenario';

function getPhaseDefinitions() {
  return WEREWOLF_PHASES;
}

function buildParticipants(conversation: GroupChat) {
  return buildWerewolfParticipants(conversation);
}

function getVisiblePanels(context: Parameters<typeof getWerewolfVisiblePanels>[0]) {
  return getWerewolfVisiblePanels(context);
}

function getAvailableActions(context: { conversation: GroupChat }) {
  return getWerewolfAvailableActions(context);
}

function buildGenerationPromptContext(params: Parameters<typeof buildWerewolfGenerationPromptContext>[0]) {
  return buildWerewolfGenerationPromptContext(params);
}

function resolveTurnPolicy(params: { conversation: GroupChat }) {
  return resolveWerewolfTurnPolicy(params);
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const role = getWerewolfScenarioRole(params.conversation, params.speaker.id);
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'must',
      moveClass: 'perform',
      targetScope: params.conversation.worldState.phase === 'warming' ? 'scene' : 'person',
      depth: 'normal',
      channelId: params.conversation.worldState.phase === 'warming' ? 'role-private' : 'public',
      reason: `werewolf:${role}`,
    },
    expressionPlan: {
      surface: 'dramatic',
      texture: 'ordinary',
      rhythm: 'scene_beat',
      allowMarkdown: false,
    },
    realizationPlan: {
      moveClass: 'perform',
      targetScope: params.conversation.worldState.phase === 'warming' ? 'scene' : 'person',
      noveltyGoal: 'none',
      surfaceDepth: 'normal',
      emotionalPosture: 'tense',
    },
    trace: {
      policyHits: [`werewolf_role:${role}`],
    },
  };
}

function buildScenarioPatch(conversation: GroupChat) {
  return buildWerewolfScenarioPatch(conversation);
}

function getScenarioRole(conversation: GroupChat, memberId: string) {
  return getWerewolfScenarioRole(conversation, memberId);
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
}) {
  const speaker = params.characters.find((character) => character.id === params.message.senderId);
  const speakerName = speaker?.name || '玩家';
  const summary = params.message.content.trim().slice(0, 56);
  const nextPhase: GroupChat['worldState']['phase'] = params.conversation.worldState.phase === 'warming' ? 'debating' : params.conversation.worldState.phase;
  const speakerRole = getScenarioRole(params.conversation, params.message.senderId);
  const scenarioState = buildWerewolfScenarioState(params.conversation);
  const runtimeEventsV2 = [
    ...(params.conversation.runtimeEventsV2 || []),
    createStructuredWerewolfEvent({ conversationId: params.conversation.id, kind: 'message_generated', summary, actorIds: [params.message.senderId], payload: { text: summary, phase: params.conversation.worldState.phase, role: speakerRole } }),
    createStructuredWerewolfEvent({ conversationId: params.conversation.id, kind: 'room_shift', summary: `局势变化：${speakerName} 发言推进了白天讨论`, actorIds: [params.message.senderId], payload: { heat: params.conversation.worldState.phase === 'debating' ? 34 : 18, cohesion: -8, topicDrift: 8, delta: { heat: 4, cohesion: -1, topicDrift: 0 } } }),
    ...(params.conversation.worldState.phase === 'warming'
      ? [createStructuredWerewolfEvent({
          conversationId: params.conversation.id,
          kind: 'artifact',
          summary: `${speakerName} 的夜晚身份相关动作仅私有可见`,
          actorIds: [params.message.senderId],
          visibility: speakerRole === 'werewolf' ? 'pair_private' : 'role_private',
          visibleToRoles: speakerRole === 'werewolf' ? ['werewolf'] : [speakerRole],
          payload: { role: speakerRole, nightOnly: true },
        })]
      : []),
  ].slice(-120);

  return {
    chatPatch: {
      ...buildScenarioPatch(params.conversation),
      scenarioState: {
        ...scenarioState,
        currentTurnActorId: nextPhase === 'debating' ? scenarioState.turnOrder?.[0] || null : params.message.senderId,
      },
      worldState: {
        ...params.conversation.worldState,
        phase: nextPhase,
        mood: params.conversation.worldState.mood || 'suspecting',
        focus: params.conversation.scenarioState?.werewolfRoleConfig || params.conversation.worldState.focus || '找出狼人',
        recentEvent: `${speakerName} 发言：${summary}${params.message.content.trim().length > 56 ? '…' : ''}`,
      },
      runtimeEventsV2,
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: 'werewolf_discussion',
      title: '狼人杀发言推进',
      summary: `${speakerName}：${summary}`,
      metrics: runtimeEventsV2.at(-1),
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const WEREWOLF_ENGINE: SessionEngineDefinition = {
  key: 'werewolf',
  createInitialConfig: () => ({ hiddenRoles: true, moderatorControls: true, sessionFamily: 'deduction', scenarioId: 'werewolf-classic' }),
  createInitialState: () => ({ phase: 'idle', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => buildWerewolfActionSchema(conversation),
  buildGenerationPromptContext,
  resolveTurnPolicy,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
