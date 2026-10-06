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

function getOrderedTurnOrder(conversation: GroupChat) {
  const baseOrder = conversation.scenarioState?.turnOrder?.length ? conversation.scenarioState.turnOrder : conversation.memberIds;
  return baseOrder.filter((id) => id && id !== 'user' && !isChatMemberMuted(conversation, id));
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

function appendCappedMany<T extends { text: string }>(items: T[] | undefined, nextItems: T[], limit = 8) {
  if (!nextItems.length) return (items || []).slice(-limit);
  return [...(items || []), ...nextItems.filter((item) => item.text)].slice(-limit);
}

function normalizeArtifactConfidence(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function normalizeArtifactText(value: string | undefined, max = 96) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) return '';
  return compactDeliberationText(normalized, max);
}

function buildModelDeliberationArtifacts(params: {
  conversation: GroupChat;
  message: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['message'];
  nextCount: number;
  sourceMessageId?: string;
  createdAt?: number;
}) {
  const artifacts = params.message.metadata?.deliberationArtifacts || null;
  const actorId = params.message.senderId;
  const sourceMessageId = params.sourceMessageId;
  const createdAt = params.createdAt;
  const prefix = sourceMessageId || `${params.nextCount}-${actorId || 'unknown'}`;
  const validMemberIds = new Set(params.conversation.memberIds);
  return {
    claims: (artifacts?.claims || []).flatMap((item, index) => {
      const text = normalizeArtifactText(item.text, 96);
      return text ? [{
        id: `claim-${prefix}-${index}`,
        actorId,
        stance: item.stance || 'neutral',
        text,
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: normalizeArtifactConfidence(item.confidence),
        sourceMessageId,
        createdAt,
      }] : [];
    }),
    evidence: (artifacts?.evidence || []).flatMap((item, index) => {
      const text = normalizeArtifactText(item.text, 96);
      return text ? [{
        id: `evidence-${prefix}-${index}`,
        actorId,
        text,
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: normalizeArtifactConfidence(item.confidence),
        sourceMessageId,
        createdAt,
      }] : [];
    }),
    issues: (artifacts?.issues || []).flatMap((item, index) => {
      const text = normalizeArtifactText(item.text, 96);
      return text ? [{
        id: `issue-${prefix}-${index}`,
        targetActorId: item.targetActorId && validMemberIds.has(item.targetActorId) ? item.targetActorId : null,
        text,
        status: 'open' as const,
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: normalizeArtifactConfidence(item.confidence),
        sourceMessageId,
        createdAt,
      }] : [];
    }),
    verdicts: (artifacts?.verdicts || []).flatMap((item, index) => {
      const text = normalizeArtifactText(item.text, 110);
      return text ? [{
        id: `verdict-${prefix}-${index}`,
        actorId,
        text,
        tendency: item.tendency || 'mixed',
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: normalizeArtifactConfidence(item.confidence),
        sourceMessageId,
        createdAt,
      }] : [];
    }),
    summaryText: normalizeArtifactText(artifacts?.summary?.text, 220),
  };
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
  const turnOrder = getOrderedTurnOrder(conversation);
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

function resolveTurnPolicy(context: Parameters<NonNullable<SessionEngineDefinition['resolveTurnPolicy']>>[0]) {
  const latestVisible = context.messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .at(-1);
  return {
    runChat: !latestVisible || latestVisible.type === 'user' || latestVisible.type === 'god',
    runAction: false,
    interleaveAction: false,
  };
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
  const structuralCounts = {
    claims: params.conversation.scenarioState?.deliberationClaims?.length || 0,
    evidence: params.conversation.scenarioState?.deliberationEvidence?.length || 0,
    issues: params.conversation.scenarioState?.deliberationIssues?.length || 0,
    verdicts: params.conversation.scenarioState?.deliberationVerdicts?.length || 0,
    hasSummary: Boolean(params.conversation.scenarioState?.summaryText?.trim()),
  };
  const structuralPrompt = [
    `Structured materials so far: claims=${structuralCounts.claims}, evidence=${structuralCounts.evidence}, issues=${structuralCounts.issues}, verdicts=${structuralCounts.verdicts}, summary=${structuralCounts.hasSummary ? 'present' : 'absent'}.`,
    structuralCounts.claims + structuralCounts.evidence + structuralCounts.issues >= 3 && structuralCounts.verdicts === 0 && !structuralCounts.hasSummary
      ? 'The room has enough material for an interim judgment if your own visible reply can honestly make one; otherwise identify the exact missing evidence or unresolved issue.'
      : '',
  ].filter(Boolean).join('\n');
  const modeInstruction = mode === 'roundtable'
    ? 'Roundtable: one distinct angle, criterion, objection, or synthesis step; hand the floor forward.'
    : mode === 'debate'
      ? 'Debate: make a claim from your side and answer the strongest opposing point without collapsing into consensus.'
      : mode === 'courtroom'
        ? 'Courtroom: focus on evidence, testimony, responsibility, contradiction, or interim ruling.'
        : mode === 'expert_review'
          ? 'Expert review: evaluate by criteria, risk, tradeoff, and concrete revision.'
          : mode === 'public_inquiry'
            ? 'Public inquiry: close a concrete gap with a focused question or direct answer.'
            : mode === 'brainstorm'
              ? 'Brainstorm: offer concrete options or combinations, then defer evaluation unless it improves the idea.'
              : mode === 'retrospective'
                ? 'Retrospective: separate observable fact, likely cause, lesson, and next action.'
                : 'Open deliberation: advance a claim, evidence check, unresolved issue, counterexample, boundary, tradeoff, or interim judgment.';
  const phaseInstruction = phase === 'synthesis'
    ? 'Synthesis phase: organize strongest points and unresolved disagreements into a clear takeaway.'
    : 'Deliberation phase: keep the room on the goal; do not drift into pure social closure or decorative banter.';
  return {
    promptPrefix: [
      'Deliberation protocol: this is a structured analysis room, not ordinary group chat.',
      `Goal: ${goal}.`,
      `Phase: ${phase}. Progress: ${progressText}.`,
      structuralPrompt,
      modeInstruction,
      phaseInstruction,
      'Every visible reply should move the deliberation forward when there is substance to add; return deliberationArtifacts only when the visible reply creates durable claims, evidence, issues, verdicts, or summary material.',
      ordered && nextSpeakerName ? `Structured turn order says the current turn belongs to: ${nextSpeakerName}.` : '',
      debateRole ? `Your assigned role: ${debateRole}.` : '',
      recentSpeakers.length ? `Recent speakers: ${recentSpeakers.join(' -> ')}.` : '',
    ].filter(Boolean).join('\n'),
    responseStyle: 'professional',
    allowMarkdown: true,
    styleProfile: 'analytical_room',
    additionalConstraints: [
      'If the next natural thing would only be praise, farewell, or decorative banter, instead ask a useful question, name a boundary, give a counterexample, or briefly state that no new claim follows from this point. Do not represent pause or silence with empty content.',
    ],
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
  const nextSpeakerId = shouldSynthesize ? null : isOrderedDiscussion(params.conversation) ? getNextRoundtableSpeakerId(params.conversation, nextCount) : null;
  const goalLabel = getDiscussionGoal(params.conversation);
  const nextPhase = currentPhase;
  const goalProgress = 0.75;
  const sourceMessageId = params.message.metadata?.branching?.nodeId || params.message.metadata?.branching?.revisionRootId || undefined;
  const createdAt = undefined;
  const modelArtifacts = buildModelDeliberationArtifacts({ conversation: params.conversation, message: params.message, nextCount, sourceMessageId, createdAt });
  const nextClaims = appendCappedMany(params.conversation.scenarioState?.deliberationClaims, modelArtifacts.claims);
  const nextEvidence = appendCappedMany(params.conversation.scenarioState?.deliberationEvidence, modelArtifacts.evidence);
  const nextIssues = appendCappedMany(params.conversation.scenarioState?.deliberationIssues, modelArtifacts.issues);
  const nextVerdicts = appendCappedMany(params.conversation.scenarioState?.deliberationVerdicts, modelArtifacts.verdicts, 6);
  const projectedCounts = {
    claims: nextClaims.length,
    evidence: nextEvidence.length,
    issues: nextIssues.length,
    verdicts: nextVerdicts.length,
    summaries: modelArtifacts.summaryText
      ? 1
      : params.conversation.scenarioState?.summaryText ? 1 : 0,
  };
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
        deliberationArtifactCounts: projectedCounts,
        deliberationMomentum: buildDeliberationMomentum(nextClaims),
        summaryText: modelArtifacts.summaryText || params.conversation.scenarioState?.summaryText,
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
  resolveTurnPolicy,
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  onMessageCommitted,
};
