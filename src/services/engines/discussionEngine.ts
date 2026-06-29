import type { ConversationPhase, DiscussionMode, GroupChat } from '../../types/chat';
import { applyGovernanceToParticipant, mergeGovernanceActionSchema, type SessionEngineActionContext, type SessionEngineDefinition, type SessionGenerationPromptContext, type SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';
import { isChatMemberMuted } from '../scheduler';

const DISCUSSION_PHASES = [
  { key: 'discussion', label: '开放讨论', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
  { key: 'roundtable', label: '圆桌发言', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
  { key: 'debate', label: '观点攻防', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
  { key: 'brainstorm', label: '创意发散', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
  { key: 'retrospective', label: '复盘改进', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
  { key: 'synthesis', label: '总结收束', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
];
function getPhaseDefinitions() {
  return [...DISCUSSION_PHASES];
}

function getDiscussionMode(conversation: GroupChat): DiscussionMode {
  if (conversation.scenarioState?.discussionMode) return conversation.scenarioState.discussionMode;
  if (conversation.sessionKind?.scenarioId === 'roundtable-discussion' || conversation.mode === 'roundtable') return 'roundtable';
  if (conversation.sessionKind?.scenarioId === 'debate-arena') return 'debate';
  if (conversation.sessionKind?.scenarioId === 'brainstorm-workshop') return 'brainstorm';
  if (conversation.sessionKind?.scenarioId === 'retrospective-room') return 'retrospective';
  return 'open';
}

function isOrderedDiscussion(conversation: GroupChat) {
  const mode = getDiscussionMode(conversation);
  return mode === 'roundtable' || mode === 'debate';
}

function getActiveDiscussionPhase(conversation: GroupChat) {
  const phase = conversation.scenarioState?.phase || '';
  if (phase === 'synthesis') return 'synthesis';
  return getDiscussionMode(conversation) === 'open' ? 'discussion' : getDiscussionMode(conversation);
}

function getDiscussionModeLabel(mode: DiscussionMode) {
  if (mode === 'roundtable') return '圆桌议题';
  if (mode === 'debate') return '辩论命题';
  if (mode === 'brainstorm') return '创意主题';
  if (mode === 'retrospective') return '复盘对象';
  return '讨论议题';
}

function getProgressLabel(mode: DiscussionMode) {
  if (mode === 'roundtable') return '圆桌发言';
  if (mode === 'debate') return '攻防轮次';
  if (mode === 'brainstorm') return '点子轮次';
  if (mode === 'retrospective') return '复盘轮次';
  return '发言轮次';
}

function getRuntimeEventType(mode: DiscussionMode, shouldSynthesize: boolean) {
  if (shouldSynthesize) return 'discussion_synthesis';
  if (mode === 'roundtable') return 'roundtable_turn';
  if (mode === 'debate') return 'debate_turn';
  if (mode === 'brainstorm') return 'brainstorm_turn';
  if (mode === 'retrospective') return 'retrospective_turn';
  return 'discussion_turn';
}

function getRuntimeEventTitle(mode: DiscussionMode, shouldSynthesize: boolean) {
  if (shouldSynthesize) return '进入收束阶段';
  if (mode === 'roundtable') return '圆桌发言推进';
  if (mode === 'debate') return '观点攻防推进';
  if (mode === 'brainstorm') return '创意生成推进';
  if (mode === 'retrospective') return '复盘改进推进';
  return '讨论推进';
}

function getMoodForMode(mode: DiscussionMode, shouldSynthesize: boolean) {
  if (shouldSynthesize) return 'converging';
  if (mode === 'debate') return 'contested';
  if (mode === 'brainstorm') return 'generative';
  if (mode === 'retrospective') return 'reflective';
  return 'engaged';
}

function getDebateRoleLabel(conversation: GroupChat, speakerId: string | null | undefined) {
  if (!speakerId) return '';
  const roleId = conversation.scenarioState?.roleAssignments?.find((role) => role.actorId === speakerId)?.roleId;
  if (roleId === 'affirmative') return 'affirmative / supporting side';
  if (roleId === 'negative') return 'negative / opposing side';
  if (roleId === 'reviewer') return 'reviewer / weighing criteria';
  return '';
}

function getDiscussionGoal(conversation: GroupChat) {
  return conversation.scenarioState?.goals?.[0]?.label?.trim()
    || conversation.topic?.trim()
    || getDiscussionModeLabel(getDiscussionMode(conversation));
}

function getSpeechProgress(conversation: GroupChat) {
  return conversation.scenarioState?.progress?.find((item) => item.key === 'speeches')
    || conversation.scenarioState?.progress?.find((item) => item.key === 'analysis-progress');
}

function getTargetSpeeches(conversation: GroupChat) {
  const progressTarget = getSpeechProgress(conversation)?.target;
  if (typeof progressTarget === 'number' && Number.isFinite(progressTarget) && progressTarget > 0) return progressTarget;
  return isOrderedDiscussion(conversation)
    ? Math.max(1, conversation.memberIds.length)
    : Math.max(4, conversation.memberIds.length);
}

function getCommittedSpeechCount(conversation: GroupChat) {
  const value = getSpeechProgress(conversation)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getNextRoundtableSpeakerId(conversation: GroupChat, committedCount = getCommittedSpeechCount(conversation)) {
  if (!isOrderedDiscussion(conversation)) return null;
  const turnOrder = (conversation.scenarioState?.turnOrder?.length ? conversation.scenarioState.turnOrder : conversation.memberIds)
    .filter((id) => id && id !== 'user' && !isChatMemberMuted(conversation, id));
  if (!turnOrder.length) return null;
  return turnOrder[committedCount % turnOrder.length] || null;
}

function getSpeakerName(params: {
  conversation: GroupChat;
  characters: Parameters<NonNullable<SessionEngineDefinition['buildGenerationPromptContext']>>[0]['characters'];
  speakerId: string | null | undefined;
}) {
  if (!params.speakerId) return '';
  return params.characters.find((character) => character.id === params.speakerId)?.name || params.speakerId;
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
  })).map((participant) => applyGovernanceToParticipant(conversation, participant));
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

function getActionSchema(context: SessionEngineActionContext) {
  return mergeGovernanceActionSchema(null, context);
}

function buildGenerationPromptContext(params: Parameters<NonNullable<SessionEngineDefinition['buildGenerationPromptContext']>>[0]): SessionGenerationPromptContext {
  const mode = getDiscussionMode(params.conversation);
  const ordered = isOrderedDiscussion(params.conversation);
  const phase = getActiveDiscussionPhase(params.conversation);
  const goal = getDiscussionGoal(params.conversation);
  const currentCount = getCommittedSpeechCount(params.conversation);
  const targetSpeeches = getTargetSpeeches(params.conversation);
  const nextSpeakerId = getNextRoundtableSpeakerId(params.conversation);
  const nextSpeakerName = getSpeakerName({ conversation: params.conversation, characters: params.characters, speakerId: nextSpeakerId });
  const debateRole = mode === 'debate' ? getDebateRoleLabel(params.conversation, params.speaker.id) : '';
  const recentSpeakers = params.messages
    .filter((message) => message.type === 'ai' && !message.isDeleted)
    .slice(-6)
    .map((message) => getSpeakerName({ conversation: params.conversation, characters: params.characters, speakerId: message.senderId }) || message.senderName || message.senderId)
    .filter(Boolean);
  return {
    promptPrefix: [
      mode === 'roundtable'
        ? 'You are participating in a moderated roundtable discussion, not a casual group chat.'
        : mode === 'debate'
          ? 'You are participating in a structured debate. Argue from the assigned side, test claims, and avoid casual small talk.'
          : mode === 'brainstorm'
            ? 'You are participating in a brainstorming workshop. Generate concrete options, variations, and combinations before judging too early.'
            : mode === 'retrospective'
              ? 'You are participating in a retrospective. Separate facts, causes, lessons, and next actions.'
              : 'You are participating in an open analytical group discussion, not casual small talk.',
      `Discussion goal: ${goal}.`,
      `Current phase: ${phase}. Progress: ${currentCount}/${targetSpeeches} speaking turns.`,
      ordered && nextSpeakerName ? `Structured turn order says the current turn belongs to: ${nextSpeakerName}.` : '',
      debateRole ? `Your debate role: ${debateRole}.` : '',
      recentSpeakers.length ? `Recent speakers: ${recentSpeakers.join(' -> ')}.` : '',
    ].filter(Boolean).join('\n'),
    responseStyle: 'professional',
    allowMarkdown: true,
    styleProfile: 'analytical_room',
    additionalConstraints: phase === 'synthesis'
      ? ['Synthesize the strongest points and move toward a clear takeaway instead of reopening the full debate.']
      : mode === 'roundtable'
        ? [
          'Speak from this character only, make one focused contribution, and hand the floor forward instead of debating every prior point.',
          'Respect the roundtable format: add a distinct angle, concrete criterion, objection, or synthesis step without interrupting the turn order.',
        ]
        : mode === 'debate'
          ? [
            'Make one clear claim, support it with a reason or example, and directly address the strongest opposing point.',
            'Do not collapse into consensus yet; preserve productive disagreement until synthesis.',
          ]
          : mode === 'brainstorm'
            ? [
              'Contribute at least two concrete ideas, variants, or combinations; defer harsh evaluation unless it improves the idea.',
              'Build on prior ideas with "combine", "extend", "reverse", or "constraint" moves instead of repeating them.',
            ]
            : mode === 'retrospective'
              ? [
                'Name one observable fact, one likely cause, and one practical follow-up action.',
                'Avoid blame-heavy phrasing; focus on evidence, responsibility, and future process changes.',
              ]
        : ['Add one materially new distinction, tradeoff, counterpoint, or synthesis step instead of restating agreement.'],
  };
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const mode = getDiscussionMode(params.conversation);
  const phase = getActiveDiscussionPhase(params.conversation);
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'should',
      moveClass: phase === 'synthesis' ? 'resolve' : 'deepen',
      targetScope: 'topic',
      depth: 'deep',
      channelId: 'public',
      reason: `${mode}:${phase}`,
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
      noveltyGoal: phase === 'synthesis' ? 'resolve' : mode === 'brainstorm' ? 'new_example' : mode === 'retrospective' ? 'repair' : 'new_angle',
      surfaceDepth: 'deep',
    },
    trace: {
      policyHits: [`discussion_phase:${phase}`, `discussion_mode:${mode}`],
    },
  };
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
}) {
  const summary = params.message.content.trim().slice(0, 72);
  const mode = getDiscussionMode(params.conversation);
  const nextCount = getCommittedSpeechCount(params.conversation) + 1;
  const targetSpeeches = getTargetSpeeches(params.conversation);
  const shouldSynthesize = nextCount >= targetSpeeches;
  const nextSpeakerId = shouldSynthesize ? null : getNextRoundtableSpeakerId(params.conversation, nextCount);
  const goalLabel = getDiscussionGoal(params.conversation);
  const nextPhase = shouldSynthesize ? 'synthesis' : getActiveDiscussionPhase(params.conversation);
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: nextPhase,
        discussionMode: mode,
        currentTurnActorId: nextSpeakerId,
        goals: params.conversation.scenarioState?.goals?.length
          ? params.conversation.scenarioState?.goals
          : [{ goalId: 'discussion-goal', label: goalLabel, status: 'active' as const, progress: shouldSynthesize ? 0.9 : Math.min(0.75, nextCount / targetSpeeches) }],
        progress: [
          { key: 'speeches', label: getProgressLabel(mode), value: nextCount, target: targetSpeeches },
        ],
        turnOrder: params.conversation.scenarioState?.turnOrder?.length ? params.conversation.scenarioState.turnOrder : params.conversation.memberIds,
      },
      worldState: {
        ...params.conversation.worldState,
        phase: (shouldSynthesize ? 'aligned' : 'debating') as ConversationPhase,
        focus: goalLabel,
        recentEvent: `讨论推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: getMoodForMode(mode, shouldSynthesize),
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: getRuntimeEventType(mode, shouldSynthesize),
      title: getRuntimeEventTitle(mode, shouldSynthesize),
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
      metrics: { speechCount: nextCount, targetSpeeches, nextSpeakerId, discussionMode: mode },
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
  getActionSchema,
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
