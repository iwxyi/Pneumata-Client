import type { ConversationPhase, DiscussionMode, GroupChat } from '../../types/chat';
import { applyGovernanceToParticipant, mergeGovernanceActionSchema, type SessionEngineActionContext, type SessionEngineDefinition, type SessionGenerationPromptContext, type SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';
import { isChatMemberMuted } from '../scheduler';

const DISCUSSION_PHASES = [
  { key: 'deliberation', label: '观点审议', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'roundtable', label: '圆桌审议', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'debate', label: '角色辩论', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'courtroom', label: '法庭攻防', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'expert_review', label: '专家评审', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'public_inquiry', label: '公开质询', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'brainstorm', label: '创意发散', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'retrospective', label: '复盘改进', allowedActions: ['speak', 'send_message', 'question_member', 'summarize_discussion', 'shift_to_synthesis'] as string[] },
  { key: 'synthesis', label: '结论整理', allowedActions: ['speak', 'send_message', 'summarize_discussion'] as string[] },
];
function getPhaseDefinitions() {
  return [...DISCUSSION_PHASES];
}

function getDiscussionMode(conversation: GroupChat): DiscussionMode {
  if (conversation.scenarioState?.discussionMode) return conversation.scenarioState.discussionMode;
  if (conversation.sessionKind?.scenarioId === 'roundtable-review' || conversation.mode === 'roundtable') return 'roundtable';
  if (conversation.sessionKind?.scenarioId === 'role-debate') return 'debate';
  if (conversation.sessionKind?.scenarioId === 'courtroom-deliberation') return 'courtroom';
  if (conversation.sessionKind?.scenarioId === 'expert-review') return 'expert_review';
  if (conversation.sessionKind?.scenarioId === 'public-inquiry') return 'public_inquiry';
  if (conversation.sessionKind?.scenarioId === 'brainstorm-workshop') return 'brainstorm';
  if (conversation.sessionKind?.scenarioId === 'task-retrospective') return 'retrospective';
  return 'open';
}

function isOrderedDiscussion(conversation: GroupChat) {
  const mode = getDiscussionMode(conversation);
  return mode === 'roundtable' || mode === 'debate' || mode === 'courtroom';
}

function getActiveDiscussionPhase(conversation: GroupChat) {
  const phase = conversation.scenarioState?.phase || '';
  if (phase === 'synthesis') return 'synthesis';
  return getDiscussionMode(conversation) === 'open' ? 'deliberation' : getDiscussionMode(conversation);
}

function getDiscussionModeLabel(mode: DiscussionMode) {
  if (mode === 'roundtable') return '圆桌审议议题';
  if (mode === 'debate') return '辩论命题';
  if (mode === 'courtroom') return '案件争议';
  if (mode === 'expert_review') return '评审对象';
  if (mode === 'public_inquiry') return '质询对象';
  if (mode === 'brainstorm') return '创意主题';
  if (mode === 'retrospective') return '复盘对象';
  return '审议议题';
}

function getProgressLabel(mode: DiscussionMode) {
  if (mode === 'roundtable') return '圆桌发言';
  if (mode === 'debate') return '攻防进度';
  if (mode === 'courtroom') return '质询进度';
  if (mode === 'expert_review') return '评审进度';
  if (mode === 'public_inquiry') return '质询进度';
  if (mode === 'brainstorm') return '点子进展';
  if (mode === 'retrospective') return '复盘进展';
  return '审议发言';
}

function getRuntimeEventType(mode: DiscussionMode, shouldSynthesize: boolean) {
  if (shouldSynthesize) return 'discussion_synthesis';
  if (mode === 'roundtable') return 'roundtable_turn';
  if (mode === 'debate') return 'debate_turn';
  if (mode === 'courtroom') return 'courtroom_deliberation_turn';
  if (mode === 'expert_review') return 'expert_review_turn';
  if (mode === 'public_inquiry') return 'public_inquiry_turn';
  if (mode === 'brainstorm') return 'brainstorm_turn';
  if (mode === 'retrospective') return 'retrospective_turn';
  return 'discussion_turn';
}

function getRuntimeEventTitle(mode: DiscussionMode, shouldSynthesize: boolean) {
  if (shouldSynthesize) return '进入结论整理';
  if (mode === 'roundtable') return '圆桌审议推进';
  if (mode === 'debate') return '角色辩论推进';
  if (mode === 'courtroom') return '法庭攻防推进';
  if (mode === 'expert_review') return '专家评审推进';
  if (mode === 'public_inquiry') return '公开质询推进';
  if (mode === 'brainstorm') return '创意生成推进';
  if (mode === 'retrospective') return '复盘改进推进';
  return '讨论推进';
}

function getMoodForMode(mode: DiscussionMode, shouldSynthesize: boolean) {
  if (shouldSynthesize) return 'converging';
  if (mode === 'debate') return 'contested';
  if (mode === 'courtroom') return 'adjudicating';
  if (mode === 'expert_review') return 'reviewing';
  if (mode === 'public_inquiry') return 'questioning';
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
  if (roleId === 'plaintiff') return 'claimant / presenting the case';
  if (roleId === 'defendant') return 'respondent / defending against claims';
  if (roleId === 'witness') return 'witness / supplying evidence and contradictions';
  if (roleId === 'judge') return 'judge / weighing evidence and issuing interim rulings';
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
  void conversation;
  return null;
}

function getCommittedSpeechCount(conversation: GroupChat) {
  const value = getSpeechProgress(conversation)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function compactDeliberationText(value: string, max = 80) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function appendCapped<T extends { text: string }>(items: T[] | undefined, item: T | null, limit = 8) {
  if (!item?.text) return (items || []).slice(-limit);
  const next = [...(items || []), item];
  return next.slice(-limit);
}

function classifyDeliberationStance(conversation: GroupChat, speakerId: string | null | undefined, content: string) {
  const roleId = conversation.scenarioState?.roleAssignments?.find((role) => role.actorId === speakerId)?.roleId;
  if (roleId === 'affirmative' || roleId === 'plaintiff') return 'support' as const;
  if (roleId === 'negative' || roleId === 'defendant') return 'oppose' as const;
  if (roleId === 'reviewer' || roleId === 'judge' || roleId === 'witness') return 'review' as const;
  if (/质询|追问|漏洞|矛盾|为什么|如何证明|证据不足|责任/.test(content)) return 'inquiry' as const;
  if (/反对|不赞成|风险|不能|不可|问题/.test(content)) return 'oppose' as const;
  if (/支持|赞成|应该|建议|可行|有必要/.test(content)) return 'support' as const;
  return 'neutral' as const;
}

function extractDeliberationEvidence(content: string) {
  if (!/(证据|事实|数据显示|记录|案例|因为|依据|材料|日志|责任链|证词)/.test(content)) return '';
  return compactDeliberationText(content, 86);
}

function extractDeliberationIssue(content: string) {
  if (!/(？|\?|漏洞|矛盾|待回应|没有回应|证据不足|风险|责任不清|为什么|如何证明|谁负责)/.test(content)) return '';
  return compactDeliberationText(content, 86);
}

function extractDeliberationVerdict(mode: DiscussionMode, phase: string, content: string) {
  if (phase !== 'synthesis' && mode !== 'courtroom' && mode !== 'expert_review') return '';
  if (!/(结论|裁决|判断|建议|倾向|评分|修改|下一步|责任|采信|不采信)/.test(content)) return '';
  return compactDeliberationText(content, 96);
}

function buildDeliberationMomentum(claims: NonNullable<GroupChat['scenarioState']>['deliberationClaims'] = []) {
  const support = claims.filter((item) => item.stance === 'support').length;
  const oppose = claims.filter((item) => item.stance === 'oppose').length;
  const inquiry = claims.filter((item) => item.stance === 'inquiry').length;
  const review = claims.filter((item) => item.stance === 'review' || item.stance === 'neutral').length;
  const label = support === oppose
    ? '势均力敌'
    : support > oppose
      ? '支持方占优'
      : '反对方占优';
  return { support, oppose, inquiry, review, label };
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
    { key: 'world', title: '运行态', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Actions', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'question_member' },
    { type: 'submit_evidence' },
    { type: 'record_verdict' },
    { type: 'summarize_discussion' },
    { type: 'shift_to_synthesis' },
  ];
}

function getActionSchema(context: SessionEngineActionContext) {
  const phase = getActiveDiscussionPhase(context.conversation);
  const targetOptions = context.participants
    .filter((participant) => participant.entityType === 'ai' && participant.canSpeak !== false)
    .map((participant, index) => ({ label: participant.displayName || `成员 ${index + 1}`, value: participant.entityRefId || '' }))
    .filter((option) => option.value);
  const actions = [
    ...(phase === 'synthesis' || !targetOptions.length
      ? []
      : [{
          type: 'question_member',
          label: '质询成员',
          description: '指定一名成员回应漏洞、证据或责任问题，并影响下一轮发言压力。',
          visibility: 'public' as const,
          autoRun: false,
          fields: [
            { key: 'targetId', label: '质询对象', type: 'single_select' as const, required: true, options: targetOptions, targetSource: 'participants' as const },
            { key: 'prompt', label: '质询问题', type: 'textarea' as const, required: true, placeholder: '例如：请直接回应刚才证据链里最薄弱的一环' },
          ],
        }]),
    {
      type: 'submit_evidence',
      label: '提交证据',
      description: '把用户补充的材料、事实或依据加入审议证据区，并影响后续发言。',
      visibility: 'public' as const,
      autoRun: false,
      fields: [
        {
          key: 'evidenceText',
          label: '证据内容',
          type: 'textarea' as const,
          required: true,
          placeholder: '例如：过去三次推荐事故都发生在召回层补丁后',
        },
      ],
    },
    {
      type: 'record_verdict',
      label: '记录裁决',
      description: '记录当前阶段的判断、倾向或需要继续追问的问题。',
      visibility: 'public' as const,
      autoRun: false,
      fields: [
        {
          key: 'verdictText',
          label: '裁决内容',
          type: 'textarea' as const,
          required: true,
          placeholder: '例如：暂不做最终裁决，先要求反方补充迁移成本量化',
        },
      ],
    },
    {
      type: 'summarize_discussion',
      label: phase === 'synthesis' ? '更新审议总结' : '总结审议',
      description: phase === 'synthesis'
        ? '补充或更新当前审议的阶段结论。'
        : '把当前审议的主要观点、证据、分歧和下一步整理成总结。',
      visibility: 'public' as const,
      autoRun: false,
      fields: [
        {
          key: 'focus',
          label: '总结重点',
          type: 'textarea' as const,
          placeholder: '例如：保留三条强论点、两个待回应漏洞和一个下一步行动',
        },
      ],
    },
    ...(phase === 'synthesis'
      ? []
      : [{
          type: 'shift_to_synthesis',
          label: '结论整理',
          description: '手动把当前发散、攻防或质询切到结论整理。',
          visibility: 'public' as const,
          autoRun: false,
        }]),
  ];
  return mergeGovernanceActionSchema({ title: '审议动作', actions }, context);
}

function buildGenerationPromptContext(params: Parameters<NonNullable<SessionEngineDefinition['buildGenerationPromptContext']>>[0]): SessionGenerationPromptContext {
  const mode = getDiscussionMode(params.conversation);
  const ordered = isOrderedDiscussion(params.conversation);
  const phase = getActiveDiscussionPhase(params.conversation);
  const goal = getDiscussionGoal(params.conversation);
  const currentCount = getCommittedSpeechCount(params.conversation);
  const progressText = `${currentCount} speaking turns, open-ended deliberation; synthesis is manual`;
  const nextSpeakerId = getNextRoundtableSpeakerId(params.conversation);
  const nextSpeakerName = getSpeakerName({ conversation: params.conversation, characters: params.characters, speakerId: nextSpeakerId });
  const debateRole = (mode === 'debate' || mode === 'courtroom') ? getDebateRoleLabel(params.conversation, params.speaker.id) : '';
  const recentSpeakers = params.messages
    .filter((message) => message.type === 'ai' && !message.isDeleted)
    .slice(-6)
    .map((message) => getSpeakerName({ conversation: params.conversation, characters: params.characters, speakerId: message.senderId }) || message.senderName || message.senderId)
    .filter(Boolean);
  return {
    promptPrefix: [
      mode === 'roundtable'
        ? 'You are participating in a moderated roundtable deliberation, not a casual group chat.'
        : mode === 'debate'
          ? 'You are participating in a structured character debate. Argue from the assigned side, test claims, and avoid casual small talk.'
          : mode === 'courtroom'
            ? 'You are participating in a courtroom-style deliberation. Examine claims, evidence, testimony, responsibility, and interim rulings.'
          : mode === 'expert_review'
            ? 'You are participating in an expert review. Evaluate the proposal through explicit criteria, risks, tradeoffs, and revision suggestions.'
          : mode === 'public_inquiry'
            ? 'You are participating in a public inquiry. Ask focused questions, expose unresolved holes, and require direct answers.'
          : mode === 'brainstorm'
            ? 'You are participating in a brainstorming workshop. Generate concrete options, variations, and combinations before judging too early.'
            : mode === 'retrospective'
              ? 'You are participating in a retrospective. Separate facts, causes, lessons, and next actions.'
              : 'You are participating in an open deliberation. Establish positions, test assumptions, question weak evidence, and preserve unresolved disagreements.',
      `Deliberation goal: ${goal}.`,
      `Current phase: ${phase}. Progress: ${progressText}.`,
      ordered && nextSpeakerName ? `Structured turn order says the current turn belongs to: ${nextSpeakerName}.` : '',
      debateRole ? `Your assigned role: ${debateRole}.` : '',
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
          : mode === 'courtroom'
            ? [
              'State the claim, evidence, contradiction, or interim ruling from your assigned role.',
              'Do not invent a final verdict unless the phase is synthesis; focus on evidence quality, responsibility, and unanswered questions.',
            ]
          : mode === 'expert_review'
            ? [
              'Evaluate against explicit criteria and name at least one concrete risk or revision.',
              'Avoid generic praise; make the review actionable and tied to the stated goal.',
            ]
          : mode === 'public_inquiry'
            ? [
              'Ask or answer one focused question that closes a concrete gap in the inquiry.',
              'Keep pressure on unresolved contradictions, responsibility, and missing evidence.',
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
        : ['Add one materially new stance, evidence check, tradeoff, counterpoint, or synthesis step instead of restating agreement.'],
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
      policyHits: [`deliberation_phase:${phase}`, `deliberation_mode:${mode}`],
    },
  };
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['message'];
}) {
  const summary = params.message.content.trim().slice(0, 72);
  const mode = getDiscussionMode(params.conversation);
  const currentPhase = getActiveDiscussionPhase(params.conversation);
  const nextCount = getCommittedSpeechCount(params.conversation) + 1;
  const shouldSynthesize = currentPhase === 'synthesis';
  const nextSpeakerId = shouldSynthesize ? null : getNextRoundtableSpeakerId(params.conversation, nextCount);
  const goalLabel = getDiscussionGoal(params.conversation);
  const nextPhase = currentPhase;
  const goalProgress = 0.75;
  const compactSummary = compactDeliberationText(params.message.content, 86);
  const sourceMessageId = params.message.metadata?.branching?.nodeId || params.message.metadata?.branching?.revisionRootId || undefined;
  const createdAt = undefined;
  const claim = compactSummary ? {
    id: sourceMessageId || `claim-${nextCount}-${params.message.senderId || 'unknown'}`,
    actorId: params.message.senderId,
    stance: classifyDeliberationStance(params.conversation, params.message.senderId, params.message.content),
    text: compactSummary,
    sourceMessageId,
    createdAt,
  } : null;
  const evidenceText = extractDeliberationEvidence(params.message.content);
  const issueText = extractDeliberationIssue(params.message.content);
  const verdictText = extractDeliberationVerdict(mode, currentPhase, params.message.content);
  const nextClaims = appendCapped(params.conversation.scenarioState?.deliberationClaims, claim);
  const nextEvidence = appendCapped(params.conversation.scenarioState?.deliberationEvidence, evidenceText ? {
    id: sourceMessageId ? `evidence-${sourceMessageId}` : `evidence-${nextCount}-${params.message.senderId || 'unknown'}`,
    actorId: params.message.senderId,
    text: evidenceText,
    sourceMessageId,
    createdAt,
  } : null);
  const nextIssues = appendCapped(params.conversation.scenarioState?.deliberationIssues, issueText ? {
    id: sourceMessageId ? `issue-${sourceMessageId}` : `issue-${nextCount}-${params.message.senderId || 'unknown'}`,
    targetActorId: params.message.senderId,
    text: issueText,
    status: 'open' as const,
    sourceMessageId,
    createdAt,
  } : null);
  const nextVerdicts = appendCapped(params.conversation.scenarioState?.deliberationVerdicts, verdictText ? {
    id: sourceMessageId ? `verdict-${sourceMessageId}` : `verdict-${nextCount}-${params.message.senderId || 'unknown'}`,
    actorId: params.message.senderId,
    text: verdictText,
    tendency: claim?.stance === 'support' || claim?.stance === 'oppose' ? claim.stance : 'mixed',
    sourceMessageId,
    createdAt,
  } : null, 6);
  return {
    chatPatch: {
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        phase: nextPhase,
        discussionMode: mode,
        currentTurnActorId: nextSpeakerId,
        goals: params.conversation.scenarioState?.goals?.length
          ? params.conversation.scenarioState?.goals
          : [{ goalId: 'discussion-goal', label: goalLabel, status: 'active' as const, progress: shouldSynthesize ? 0.9 : goalProgress }],
        progress: [
          { key: 'speeches', label: getProgressLabel(mode), value: nextCount, target: 0 },
        ],
        turnOrder: params.conversation.scenarioState?.turnOrder?.length ? params.conversation.scenarioState.turnOrder : params.conversation.memberIds,
        deliberationClaims: nextClaims,
        deliberationEvidence: nextEvidence,
        deliberationIssues: nextIssues,
        deliberationVerdicts: nextVerdicts,
        deliberationMomentum: buildDeliberationMomentum(nextClaims),
      },
      worldState: {
        ...params.conversation.worldState,
        phase: (shouldSynthesize ? 'aligned' : 'debating') as ConversationPhase,
        focus: goalLabel,
        recentEvent: `审议推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
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
      metrics: { speechCount: nextCount, targetSpeeches: null, nextSpeakerId, discussionMode: mode },
    }],
  };
}

export const DISCUSSION_ENGINE: SessionEngineDefinition = {
  key: 'group_discussion',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'group_discussion', sessionFamily: 'analysis', scenarioId: 'opinion-review' }),
  createInitialState: () => ({ phase: 'deliberation', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema,
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
