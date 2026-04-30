import type { ConversationPhase, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema, SessionEngineDefinition } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';

const WEREWOLF_PHASES: Array<{ key: ConversationPhase; label: string; allowedActions: string[] }> = [
  { key: 'idle', label: 'Lobby', allowedActions: ['director_intervention'] },
  { key: 'warming', label: 'Night', allowedActions: ['wolf_vote', 'inspect_player', 'director_intervention'] },
  { key: 'debating', label: 'Day Discussion', allowedActions: ['send_message', 'vote_player', 'director_intervention'] },
  { key: 'aligned', label: 'Vote Resolution', allowedActions: ['director_intervention'] },
  { key: 'chaotic', label: 'Last Words', allowedActions: ['send_message', 'director_intervention'] },
];

function pickWerewolfRole(index: number, total: number) {
  if (index === 0 && total >= 4) return 'seer';
  if (index >= total - Math.max(1, Math.floor(total / 4))) return 'werewolf';
  return 'villager';
}

function buildParticipants(conversation: GroupChat) {
  const total = conversation.memberIds.length;
  return conversation.memberIds.map((memberId, index) => ({
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: 'ai' as const,
    entityRefId: memberId,
    seatIndex: index,
    canSpeak: true,
    canAct: true,
    flags: {
      role: pickWerewolfRole(index, total),
      alive: true,
    },
  }));
}

function buildWerewolfActionSchema(conversation: GroupChat): SessionActionSchema {
  const targetOptions = conversation.memberIds.map((id, index) => ({ label: `玩家 ${index + 1}`, value: id }));
  return {
    title: '狼人杀动作',
    actions: [
      {
        type: 'wolf_vote',
        label: '夜晚袭击',
        description: '狼人夜晚选择一名目标作为刀口。',
        visibility: 'pair_private',
        fields: [
          { key: 'targetId', label: '袭击目标', type: 'single_select', required: true, options: targetOptions, targetSource: 'participants' },
          { key: 'prompt', label: '协商备注', type: 'textarea', placeholder: '例如：优先处理发言最强势的玩家' },
        ],
      },
      {
        type: 'inspect_player',
        label: '夜晚查验',
        description: '预言家夜晚查验一名玩家的阵营。',
        visibility: 'role_private',
        fields: [
          { key: 'targetId', label: '查验目标', type: 'single_select', required: true, options: targetOptions, targetSource: 'participants' },
        ],
      },
      {
        type: 'vote_player',
        label: '白天投票',
        description: '白天公投一名嫌疑目标。',
        visibility: 'public',
        fields: [
          { key: 'targetId', label: '投票目标', type: 'single_select', required: true, options: targetOptions, targetSource: 'participants' },
          { key: 'prompt', label: '投票理由', type: 'textarea', placeholder: '例如：他的站边前后矛盾' },
        ],
      },
      {
        type: 'director_intervention',
        label: '主持推进',
        description: '切换昼夜、结算结果或推动发言。',
        visibility: 'moderator_only',
        fields: [
          { key: 'prompt', label: '推进说明', type: 'textarea', required: true, placeholder: '例如：天亮了，昨夜是平安夜，进入白天讨论' },
        ],
      },
    ],
  };
}

function getVisiblePanels(_context: RuntimeContext) {
  return [
    { key: 'members', title: '玩家', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: '局势', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: '夜晚/白天动作', type: 'actions' as const },
  ];
}

function getPhaseDefinitions() {
  return WEREWOLF_PHASES;
}

function getAvailableActions(context: { conversation: GroupChat }) {
  return buildWerewolfActionSchema(context.conversation).actions.map((action) => ({ type: action.type }));
}

function getNextPhase(currentPhase: ConversationPhase): ConversationPhase {
  if (currentPhase === 'idle') return 'warming';
  if (currentPhase === 'warming') return 'debating';
  if (currentPhase === 'debating') return 'aligned';
  if (currentPhase === 'aligned') return 'chaotic';
  return 'warming';
}

function buildGenerationPromptContext(params: { conversation: GroupChat; speaker: AICharacter }) {
  const seatIndex = params.conversation.memberIds.indexOf(params.speaker.id);
  const role = pickWerewolfRole(seatIndex, params.conversation.memberIds.length);
  return {
    promptPrefix: `You are speaking inside a werewolf social deduction game as ${role}. Preserve hidden-role incentives and public plausibility.`,
    additionalConstraints: [
      params.conversation.worldState.phase === 'warming'
        ? 'Night-phase speech should stay covert and implication-heavy.'
        : 'Day-phase speech should sound accusatory, defensive, or analytical in-character.',
    ],
  };
}

function resolveTurnPolicy(params: { conversation: GroupChat }) {
  const phase = params.conversation.worldState.phase;
  return {
    runChat: phase !== 'idle' && phase !== 'aligned',
    runAction: phase === 'warming' || phase === 'aligned' || phase === 'idle',
    interleaveAction: phase === 'debating',
  };
}

function createStructuredWerewolfEvent(params: { conversationId: string; kind: RuntimeEventV2['kind']; summary: string; actorIds?: string[]; payload?: RuntimeEventV2['payload']; visibility?: RuntimeEventV2['visibility']; visibleToRoles?: string[] }) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: params.conversationId,
    kind: params.kind,
    createdAt: Date.now(),
    actorIds: params.actorIds,
    summary: params.summary,
    visibility: params.visibility || 'public',
    visibleToRoles: params.visibleToRoles,
    payload: params.payload || {},
  } satisfies RuntimeEventV2;
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
}) {
  const speaker = params.characters.find((character) => character.id === params.message.senderId);
  const speakerName = speaker?.name || '玩家';
  const summary = params.message.content.trim().slice(0, 56);
  const nextPhase = params.conversation.worldState.phase === 'warming' ? 'debating' : params.conversation.worldState.phase;
  const speakerRole = speaker ? pickWerewolfRole(params.conversation.memberIds.indexOf(speaker.id), params.conversation.memberIds.length) : 'villager';
  const runtimeEventsV2 = [
    ...(params.conversation.runtimeEventsV2 || []),
    createStructuredWerewolfEvent({ conversationId: params.conversation.id, kind: 'message_generated', summary, actorIds: [params.message.senderId], payload: { text: summary, phase: params.conversation.worldState.phase } }),
    createStructuredWerewolfEvent({ conversationId: params.conversation.id, kind: 'room_shift', summary: `局势变化：${speakerName} 发言推进了白天讨论`, actorIds: [params.message.senderId], payload: { heat: params.conversation.worldState.phase === 'debating' ? 34 : 18, cohesion: 42, topicDrift: 8, delta: { heat: 4, cohesion: -1, topicDrift: 0 } } }),
    ...(params.conversation.worldState.phase === 'warming' ? [createStructuredWerewolfEvent({ conversationId: params.conversation.id, kind: 'artifact', summary: `${speakerName} 的夜晚身份相关动作仅私有可见`, actorIds: [params.message.senderId], visibility: speakerRole === 'werewolf' ? 'pair_private' : 'role_private', visibleToRoles: speakerRole === 'werewolf' ? ['werewolf'] : [speakerRole], payload: { role: speakerRole, nightOnly: true } })] : []),
  ].slice(-120);
  return {
    chatPatch: {
      worldState: {
        ...params.conversation.worldState,
        phase: nextPhase,
        mood: params.conversation.worldState.mood || 'suspecting',
        focus: params.conversation.worldState.focus || '找出狼人',
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
    }],
  };
}

export const WEREWOLF_ENGINE: SessionEngineDefinition = {
  key: 'werewolf',
  createInitialConfig: () => ({ hiddenRoles: true, moderatorControls: true }),
  createInitialState: () => ({ phase: 'idle', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => buildWerewolfActionSchema(conversation),
  buildGenerationPromptContext,
  resolveTurnPolicy,
  onMessageCommitted,
};
