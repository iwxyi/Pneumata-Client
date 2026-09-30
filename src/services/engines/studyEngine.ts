import type { ConversationPhase, GroupChat, LearningScenarioState } from '../../types/chat';
import { applyGovernanceToParticipant, mergeGovernanceActionSchema, type SessionEngineActionContext, type SessionEngineDefinition, type SessionGenerationPromptContext, type SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message } from '../../types/message';
import { deriveLearningNextStep } from '../learningNextStep';

function stableKnowledgeId(title: string) {
  let hash = 2166136261;
  for (const character of title.toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `knowledge:model:${(hash >>> 0).toString(36)}`;
}

function applyModelStudyUpdate(base: LearningScenarioState, message: Pick<Message, 'metadata'>): LearningScenarioState {
  const update = message.metadata?.studyUpdate;
  if (!base || !update?.knowledgeObservations?.length) return base;
  const rank = { unknown: 0, exposed: 1, learning: 2, practicing: 3, usable: 4, verified: 5, stale: 2 } as const;
  const now = Date.now();
  const byTitle = new Map(base.knowledgeItems.map((item) => [item.title.toLocaleLowerCase(), item] as const));
  const byId = new Map(base.knowledgeItems.map((item) => [item.id, item] as const));
  const evidence = [...(base.evidence || [])];
  let changed = false;
  for (const observation of update.knowledgeObservations) {
    const key = observation.title.toLocaleLowerCase();
    const previous = (observation.knowledgeItemId && byId.get(observation.knowledgeItemId)) || byTitle.get(key);
    const status = previous && observation.status !== 'stale' && rank[previous.status] > rank[observation.status]
      ? previous.status
      : observation.status;
    const hasPerformanceEvidence = Boolean(observation.evidenceSummary && ['practicing', 'usable', 'verified'].includes(status));
    const next = {
      ...(previous || { id: stableKnowledgeId(observation.title), title: observation.title, evidenceCount: 0 }),
      status,
      confidence: observation.confidence ?? previous?.confidence,
      notes: observation.evidenceSummary || previous?.notes,
      ...(hasPerformanceEvidence ? {
        evidenceCount: (previous?.evidenceCount || 0) + 1,
        lastReviewedAt: now,
      } : {}),
    };
    if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) changed = true;
    byTitle.set(next.title.toLocaleLowerCase(), next);
    byId.set(next.id, next);
    if (hasPerformanceEvidence) {
      evidence.push({
        id: `observed-${now}-${next.id}`,
        kind: 'conversation',
        summary: observation.evidenceSummary || '',
        knowledgeItemIds: [next.id],
        createdAt: now,
      });
    }
  }
  if (!changed) return base;
  const nextLearning = {
    ...base,
    knowledgeItems: Array.from(byTitle.values()).slice(0, 120),
    evidence: evidence.slice(-240),
    lastStudyAction: 'note' as const,
    lastStudyActionAt: now,
  };
  return { ...nextLearning, nextStepSuggestion: deriveLearningNextStep(nextLearning, now) };
}

const STUDY_PHASES = [
  { key: 'mapping', label: '目标拆解', allowedActions: ['speak', 'send_message', 'assign_task'] as string[] },
  { key: 'learning', label: '学习练习', allowedActions: ['speak', 'send_message', 'assign_task'] as string[] },
  { key: 'review', label: '复习反馈', allowedActions: ['speak', 'send_message', 'summarize'] as string[] },
];

function resolveTurnPolicy(context: { messages: Message[] }) {
  const latestVisible = context.messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .reduce<Message | undefined>((latest, message) => (
      !latest || message.timestamp > latest.timestamp ? message : latest
    ), undefined);
  // Learning rooms are learner-triggered: one user turn unlocks one teacher
  // response, then the room waits for the next learner message.
  return {
    runChat: latestVisible?.type === 'user' || latestVisible?.type === 'god',
    runAction: false,
    interleaveAction: false,
  };
}

function buildParticipants(conversation: GroupChat) {
  return conversation.memberIds.map((memberId, index) => applyGovernanceToParticipant(conversation, {
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: memberId === 'user' ? 'user' as const : 'ai' as const,
    entityRefId: memberId,
    seatIndex: index,
    displayName: memberId === 'user' ? '我' : undefined,
    title: memberId === 'user' ? '学习者' : '教师',
    roleKey: memberId === 'user' ? 'student' : 'teacher',
    canSpeak: true,
    canAct: true,
    flags: { actorRefKind: memberId === 'user' ? 'user_persona' : 'ai_character', studyRole: memberId === 'user' ? 'student' : 'teacher' },
  }));
}

function getActionSchema(conversation: GroupChat) {
  const goal = conversation.scenarioState?.learning?.goal || conversation.topic || '当前学习目标';
  return {
    title: '学习动作',
    actions: [
      { type: 'map_learning_goal', label: '整理知识点', description: '把总目标拆成可学习、可复习的知识点。', visibility: 'public' as const, fields: [{ key: 'goal', label: '目标范围', type: 'textarea' as const, required: true, placeholder: goal }] },
      { type: 'create_learning_practice', label: '生成练习', description: '根据知识点和薄弱项生成资料、试卷或 HTML 练习。', visibility: 'public' as const, fields: [{ key: 'focus', label: '练习重点', type: 'textarea' as const, placeholder: '例如：只练习最近不稳定的部分' }] },
      { type: 'submit_learning_attempt', label: '提交练习', description: '提交试卷或 HTML 练习的答案，等待批改。', visibility: 'public' as const, fields: [{ key: 'artifactId', label: '练习产物', type: 'text' as const, required: true }, { key: 'answer', label: '答案', type: 'textarea' as const, required: true }] },
      { type: 'grade_learning_attempt', label: '批改练习', description: '根据提交内容记录分数、反馈和知识点证据。', visibility: 'public' as const, fields: [{ key: 'attemptId', label: '提交记录', type: 'text' as const, required: true }, { key: 'feedback', label: '反馈', type: 'textarea' as const }] },
      { type: 'review_learning_progress', label: '复盘学习', description: '基于学习记录总结已会、未稳和下一步。', visibility: 'public' as const, fields: [{ key: 'focus', label: '复盘重点', type: 'textarea' as const, placeholder: '例如：最近错题和下周安排' }] },
    ],
  };
}

export const STUDY_ENGINE: SessionEngineDefinition = {
  key: 'classroom',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'classroom', sessionFamily: 'study', scenarioId: 'learning-progress' }),
  createInitialState: () => ({ phase: 'mapping', round: 0 }),
  buildParticipants,
  getPhaseDefinitions: () => STUDY_PHASES.map((phase) => ({ ...phase })),
  getVisiblePanels: () => [
    { key: 'members', title: '参与者', type: 'members' as const, tabKey: 'members' as const },
    { key: 'world', title: '学习进步', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: '学习动作', type: 'actions' as const, tabKey: 'world' as const },
  ],
  getAvailableActions: () => [{ type: 'map_learning_goal' }, { type: 'create_learning_practice' }, { type: 'submit_learning_attempt' }, { type: 'grade_learning_attempt' }, { type: 'review_learning_progress' }],
  resolveTurnPolicy,
  getActionSchema: (context: SessionEngineActionContext) => mergeGovernanceActionSchema(getActionSchema(context.conversation), context),
  buildGenerationPromptContext: ({ conversation }): SessionGenerationPromptContext => {
    const phase = conversation.scenarioState?.phase || 'mapping';
    const teachingMode = conversation.scenarioState?.learning?.teachingMode || 'casual';
    return {
      responseStyle: teachingMode === 'entertainment' ? 'chat' : 'professional',
      allowMarkdown: true,
      styleProfile: 'task_room',
      additionalConstraints: [
        `This is a learning-progress room in phase ${phase}. Teaching mode: ${teachingMode}.`,
        phase === 'mapping' ? 'Break the broad goal into a useful knowledge map before prescribing a long curriculum.' : 'Give one concrete next step and distinguish observed evidence from assumptions about mastery.',
        'Never pretend that a single score fully measures an open-ended learning goal.',
      ],
    };
  },
  buildRuntimeContextBundle: ({ conversation, speaker }): SessionRuntimeContextBundle => {
    const phase = conversation.scenarioState?.phase || 'mapping';
    const moveClass = phase === 'review' ? 'resolve' : phase === 'mapping' ? 'deepen' : 'perform';
    return {
      turnPlan: { speakerId: speaker.id, obligation: 'should', moveClass, targetScope: 'task', depth: 'deep', channelId: 'public', reason: `learning-progress:${phase}` },
      expressionPlan: { surface: 'task', texture: 'rich', rhythm: 'back_and_forth', allowMarkdown: true },
      realizationPlan: { moveClass, targetScope: 'task', noveltyGoal: phase === 'mapping' ? 'new_angle' : 'new_evidence', surfaceDepth: 'deep', emotionalPosture: 'warm' },
      trace: { policyHits: [`study_phase:${phase}`, `teaching_mode:${conversation.scenarioState?.learning?.teachingMode || 'casual'}`] },
    };
  },
  onMessageCommitted: ({ conversation, message }) => {
    const summary = message.content.trim().slice(0, 120);
    const baseLearning: LearningScenarioState = conversation.scenarioState?.learning || {
      goal: conversation.topic || '学习目标',
      knowledgeItems: [],
    };
    const learning = applyModelStudyUpdate(baseLearning, message);
    const learningChanged = learning !== baseLearning;
    const phase = message.metadata?.studyUpdate?.phase
      || (learning.lastStudyAction === 'map' ? 'learning' : learning.lastStudyAction === 'review' ? 'review' : (conversation.scenarioState?.phase || 'mapping'));
    const verifiedKnowledgeCount = learning.knowledgeItems.filter((item) => item.status === 'verified').length;
    return {
      chatPatch: {
        scenarioState: {
          ...(conversation.scenarioState || {}),
          phase,
          learning: { ...learning, lastStudyActionAt: Date.now(), nextStepSuggestion: learning.nextStepSuggestion || deriveLearningNextStep(learning) },
          goals: conversation.scenarioState?.goals?.length ? conversation.scenarioState.goals : [{ goalId: 'study-goal', label: learning.goal, status: 'active' as const }],
          progress: learning.knowledgeItems.length
            ? [{ key: 'study-progress', label: '已验证知识点', value: verifiedKnowledgeCount, target: learning.knowledgeItems.length }]
            : [],
        },
        worldState: { ...conversation.worldState, phase: (phase === 'review' ? 'aligned' : 'warming') as ConversationPhase, focus: learning.goal, recentEvent: `学习进步：${summary}${message.content.trim().length > 120 ? '…' : ''}`, mood: phase === 'review' ? 'reflective' : 'focused' },
      },
      characterPatches: [],
      runtimeEvents: [{
        eventType: learningChanged ? 'study_progress' : 'study_guidance',
        title: learningChanged ? '学习记录已更新' : '学习推进',
        summary,
        eventClass: 'phase',
        visibilityScope: 'public',
        channelId: 'public',
      }],
    };
  },
};
