import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import { DISCUSSION_ENGINE } from './discussionEngine';

function buildCharacter(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

function buildChat(overrides: Record<string, unknown> = {}) {
  return normalizeConversation({
    id: 'discussion-1',
    type: 'group',
    mode: 'group_discussion',
    sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
    modeConfig: {} as never,
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    scenarioState: {
      phase: 'deliberation',
      turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
      currentTurnActorId: null,
      goals: [{ goalId: 'discussion-goal', label: '是否要重构推荐系统', status: 'active', progress: 0 }],
      progress: [{ key: 'speeches', label: '审议发言', value: 0, target: 3 }],
    },
    name: '观点审议',
    topic: '是否要重构推荐系统',
    style: 'brainstorm',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['analyst-a', 'analyst-b', 'analyst-c'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: false, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  });
}

describe('DISCUSSION_ENGINE', () => {
  it('builds open deliberation prompt context around a concrete goal', () => {
    const chat = buildChat();
    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      messages: [],
      speaker: buildCharacter('analyst-a', '分析师A'),
    });

    expect(context?.promptPrefix).toContain('open deliberation');
    expect(context?.promptPrefix).toContain('是否要重构推荐系统');
    expect(context?.styleProfile).toBe('analytical_room');
    expect(context?.additionalConstraints?.join('\n')).toContain('materially new stance');
  });

  it('keeps open deliberation active even when legacy progress target is reached', async () => {
    const chat = buildChat({
      scenarioState: {
        phase: 'deliberation',
        turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
        goals: [{ goalId: 'discussion-goal', label: '是否要重构推荐系统', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '审议发言', value: 2, target: 3 }],
      },
    });

    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-c', '分析师C')],
      message: { type: 'ai', senderId: 'analyst-c', content: '我建议先拆召回层，因为它的风险最低。' },
      previousAiMessage: null,
    });

    expect(result.chatPatch.scenarioState?.phase).toBe('deliberation');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '审议发言', value: 3, target: 0 },
    ]);
    expect(result.chatPatch.worldState?.phase).toBe('debating');
    expect(result.runtimeEvents[0]?.eventType).toBe('discussion_turn');
  });

  it('keeps deliberation open-ended until the user manually shifts phase', async () => {
    const chat = buildChat({
      scenarioState: {
        phase: 'deliberation',
        turnOrder: ['analyst-a', 'analyst-b'],
        goals: [{ goalId: 'discussion-goal', label: '是否要长期讨论推荐系统', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '审议发言', value: 12, target: 0 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      messages: [],
      speaker: buildCharacter('analyst-a', '分析师A'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      message: { type: 'ai', senderId: 'analyst-a', content: '我继续补一个长期演进的角度。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('open-ended deliberation; synthesis is manual');
    expect(result.chatPatch.scenarioState?.phase).toBe('deliberation');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '审议发言', value: 13, target: 0 },
    ]);
    expect(result.chatPatch.worldState?.phase).toBe('debating');
    expect(result.runtimeEvents[0]?.eventType).toBe('discussion_turn');
  });

  it('records visible deliberation artifacts from committed messages', async () => {
    const chat = buildChat({
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'role-debate', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'debate',
        discussionMode: 'debate',
        goals: [{ goalId: 'discussion-goal', label: '是否重构推荐系统', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '攻防进度', value: 0, target: 0 }],
        roleAssignments: [
          { actorId: 'analyst-a', roleId: 'affirmative' },
          { actorId: 'analyst-b', roleId: 'negative' },
        ],
      },
    });

    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      message: {
        type: 'ai',
        senderId: 'analyst-a',
        content: '我支持重构。证据是最近日志显示召回层接口延迟，为什么还要把排序风险后置？',
        metadata: { branching: { nodeId: 'msg-claim-1' } },
      },
      previousAiMessage: null,
    });

    expect(result.chatPatch.scenarioState?.deliberationClaims?.[0]).toMatchObject({
      actorId: 'analyst-a',
      stance: 'support',
      sourceMessageId: 'msg-claim-1',
    });
    expect(result.chatPatch.scenarioState?.deliberationEvidence?.[0]?.text).toContain('证据');
    expect(result.chatPatch.scenarioState?.deliberationIssues?.[0]?.text).toContain('为什么');
    expect(result.chatPatch.scenarioState?.deliberationMomentum).toMatchObject({
      support: 1,
      oppose: 0,
      inquiry: 0,
    });
  });

  it('keeps roundtable turn order and moves to the next speaker', async () => {
    const chat = buildChat({
      mode: 'roundtable',
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'roundtable-review', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'roundtable',
        turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
        currentTurnActorId: 'analyst-b',
        goals: [{ goalId: 'discussion-goal', label: '是否要重构推荐系统', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '圆桌发言', value: 1, target: 4 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A'), buildCharacter('analyst-b', '分析师B'), buildCharacter('analyst-c', '分析师C')],
      messages: [],
      speaker: buildCharacter('analyst-b', '分析师B'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-b', '分析师B')],
      message: { type: 'ai', senderId: 'analyst-b', content: '我先补充用户迁移成本，不建议一次性替换。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('moderated roundtable deliberation');
    expect(context?.promptPrefix).toContain('current turn belongs to: 分析师B');
    expect(result.chatPatch.scenarioState?.phase).toBe('roundtable');
    expect(result.chatPatch.scenarioState?.currentTurnActorId).toBe('analyst-c');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '圆桌发言', value: 2, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('roundtable_turn');
  });

  it('skips muted seats in roundtable turn order', async () => {
    const chat = buildChat({
      mode: 'roundtable',
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'roundtable-review', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'roundtable',
        turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
        currentTurnActorId: 'analyst-b',
        seats: [
          { seatId: 'seat-a', seatIndex: 0, actorId: 'analyst-a' },
          { seatId: 'seat-b', seatIndex: 1, actorId: 'analyst-b', muted: true },
          { seatId: 'seat-c', seatIndex: 2, actorId: 'analyst-c' },
        ],
        goals: [{ goalId: 'discussion-goal', label: '是否要重构推荐系统', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '圆桌发言', value: 1, target: 4 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A'), buildCharacter('analyst-b', '分析师B'), buildCharacter('analyst-c', '分析师C')],
      messages: [],
      speaker: buildCharacter('analyst-c', '分析师C'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-c', '分析师C')],
      message: { type: 'ai', senderId: 'analyst-c', content: '我接着从迁移风险角度说。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('current turn belongs to: 分析师C');
    expect(result.chatPatch.scenarioState?.currentTurnActorId).toBe('analyst-a');
  });

  it('projects muted participants and exposes governance actions without triggering them automatically', () => {
    const chat = buildChat({
      scenarioState: {
        phase: 'deliberation',
        seats: [
          { seatId: 'seat-a', seatIndex: 0, actorId: 'analyst-a' },
          { seatId: 'seat-b', seatIndex: 1, actorId: 'analyst-b', muted: true },
          { seatId: 'seat-c', seatIndex: 2, actorId: 'analyst-c' },
        ],
        progress: [{ key: 'speeches', label: '审议发言', value: 0, target: 3 }],
      },
    });

    const participants = DISCUSSION_ENGINE.buildParticipants(chat);
    const schema = DISCUSSION_ENGINE.getActionSchema?.({ conversation: chat, participants });

    expect(participants.find((participant) => participant.entityRefId === 'analyst-b')?.canSpeak).toBe(false);
    expect(schema?.actions.map((action) => action.type)).toEqual(['question_member', 'submit_evidence', 'record_verdict', 'summarize_discussion', 'shift_to_synthesis', 'mute_member', 'unmute_member']);
    expect(schema?.actions.find((action) => action.type === 'question_member')?.fields?.map((field) => field.key)).toEqual(['targetId', 'prompt']);
    expect(schema?.actions.find((action) => action.type === 'submit_evidence')?.fields?.map((field) => field.key)).toEqual(['evidenceText']);
    expect(schema?.actions.find((action) => action.type === 'record_verdict')?.fields?.map((field) => field.key)).toEqual(['verdictText']);
    expect(schema?.actions.find((action) => action.type === 'mute_member')?.fields?.find((field) => field.key === 'targetId')?.options?.map((option) => option.value)).toEqual(['analyst-a', 'analyst-c']);
    expect(schema?.actions.find((action) => action.type === 'unmute_member')?.fields?.find((field) => field.key === 'targetId')?.options?.map((option) => option.value)).toEqual(['analyst-b']);
  });

  it('exposes deliberation actions and hides phase shift after synthesis', () => {
    const chat = buildChat();
    const participants = DISCUSSION_ENGINE.buildParticipants(chat);
    const schema = DISCUSSION_ENGINE.getActionSchema?.({ conversation: chat, participants });
    const synthesisChat = buildChat({
      scenarioState: {
        phase: 'synthesis',
        discussionMode: 'open',
        progress: [{ key: 'speeches', label: '审议发言', value: 3, target: 3 }],
      },
    });
    const synthesisSchema = DISCUSSION_ENGINE.getActionSchema?.({
      conversation: synthesisChat,
      participants: DISCUSSION_ENGINE.buildParticipants(synthesisChat),
    });

    expect(DISCUSSION_ENGINE.getPhaseDefinitions?.(chat).find((phase) => phase.key === 'deliberation')?.allowedActions).toContain('question_member');
    expect(schema?.title).toBe('审议动作');
    expect(schema?.actions.map((action) => action.type)).toEqual(['question_member', 'submit_evidence', 'record_verdict', 'summarize_discussion', 'shift_to_synthesis', 'mute_member']);
    expect(schema?.actions.find((action) => action.type === 'summarize_discussion')?.autoRun).toBe(false);
    expect(schema?.actions.find((action) => action.type === 'shift_to_synthesis')?.autoRun).toBe(false);
    expect(schema?.actions.find((action) => action.type === 'question_member')?.autoRun).toBe(false);
    expect(schema?.actions.find((action) => action.type === 'summarize_discussion')?.fields?.[0]?.key).toBe('focus');
    expect(synthesisSchema?.actions.map((action) => action.type)).toEqual(['submit_evidence', 'record_verdict', 'summarize_discussion', 'mute_member']);
  });

  it('runs debate as ordered argument turns with assigned roles', async () => {
    const chat = buildChat({
      mode: 'roundtable',
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'role-debate', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'debate',
        discussionMode: 'debate',
        turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
        currentTurnActorId: 'analyst-a',
        roleAssignments: [
          { actorId: 'analyst-a', roleId: 'affirmative', factionId: 'pro' },
          { actorId: 'analyst-b', roleId: 'negative', factionId: 'con' },
          { actorId: 'analyst-c', roleId: 'reviewer', factionId: 'review' },
        ],
        goals: [{ goalId: 'discussion-goal', label: 'AI 是否应拥有法律人格', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '攻防进度', value: 0, target: 3 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A'), buildCharacter('analyst-b', '分析师B'), buildCharacter('analyst-c', '分析师C')],
      messages: [],
      speaker: buildCharacter('analyst-a', '分析师A'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      message: { type: 'ai', senderId: 'analyst-a', content: '我支持有限法律人格，因为责任归属需要可执行的主体。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('structured character debate');
    expect(context?.promptPrefix).toContain('affirmative / supporting side');
    expect(context?.additionalConstraints?.join('\n')).toContain('strongest opposing point');
    expect(result.chatPatch.scenarioState?.phase).toBe('debate');
    expect(result.chatPatch.scenarioState?.discussionMode).toBe('debate');
    expect(result.chatPatch.scenarioState?.currentTurnActorId).toBe('analyst-b');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '攻防进度', value: 1, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('debate_turn');
  });

  it('runs courtroom deliberation with legal roles, evidence constraints, and ordered turns', async () => {
    const chat = buildChat({
      mode: 'roundtable',
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'courtroom-deliberation', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'courtroom',
        discussionMode: 'courtroom',
        turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
        currentTurnActorId: 'analyst-a',
        roleAssignments: [
          { actorId: 'analyst-a', roleId: 'plaintiff', factionId: 'claim' },
          { actorId: 'analyst-b', roleId: 'defendant', factionId: 'defense' },
          { actorId: 'analyst-c', roleId: 'judge', factionId: 'adjudication' },
        ],
        goals: [{ goalId: 'discussion-goal', label: '谁该为项目延期负责', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '质询进度', value: 0, target: 0 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '原告'), buildCharacter('analyst-b', '被告'), buildCharacter('analyst-c', '法官')],
      messages: [],
      speaker: buildCharacter('analyst-a', '原告'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '原告')],
      message: { type: 'ai', senderId: 'analyst-a', content: '延期责任首先来自接口契约没有按期冻结，这是可验证的流程事实。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('courtroom-style deliberation');
    expect(context?.promptPrefix).toContain('claimant / presenting the case');
    expect(context?.additionalConstraints?.join('\n')).toContain('evidence quality');
    expect(result.chatPatch.scenarioState?.phase).toBe('courtroom');
    expect(result.chatPatch.scenarioState?.currentTurnActorId).toBe('analyst-b');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '质询进度', value: 1, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('courtroom_deliberation_turn');
  });

  it('runs expert review as open review with criteria and revision constraints', async () => {
    const chat = buildChat({
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'expert-review', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'expert_review',
        discussionMode: 'expert_review',
        goals: [{ goalId: 'discussion-goal', label: '评审新版创作工坊 MVP', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '评审进度', value: 1, target: 0 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '产品评审')],
      messages: [],
      speaker: buildCharacter('analyst-a', '产品评审'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '产品评审')],
      message: { type: 'ai', senderId: 'analyst-a', content: '按留存和产出质量两个标准看，最大风险是产物没有沉淀面板。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('expert review');
    expect(context?.additionalConstraints?.join('\n')).toContain('explicit criteria');
    expect(result.chatPatch.scenarioState?.phase).toBe('expert_review');
    expect(result.chatPatch.scenarioState?.currentTurnActorId).toBeNull();
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '评审进度', value: 2, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('expert_review_turn');
  });

  it('runs public inquiry as focused questioning without ordered seats', async () => {
    const chat = buildChat({
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'public-inquiry', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'public_inquiry',
        discussionMode: 'public_inquiry',
        goals: [{ goalId: 'discussion-goal', label: '质询项目负责人延期原因', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '质询进度', value: 0, target: 0 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '质询人')],
      messages: [],
      speaker: buildCharacter('analyst-a', '质询人'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '质询人')],
      message: { type: 'ai', senderId: 'analyst-a', content: '请直接说明接口冻结延迟是谁批准的，以及当时有没有替代方案。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('public inquiry');
    expect(context?.additionalConstraints?.join('\n')).toContain('unresolved contradictions');
    expect(result.chatPatch.scenarioState?.phase).toBe('public_inquiry');
    expect(result.chatPatch.scenarioState?.currentTurnActorId).toBeNull();
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '质询进度', value: 1, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('public_inquiry_turn');
  });

  it('uses brainstorming constraints and progress labels', async () => {
    const chat = buildChat({
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'brainstorm-workshop', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'brainstorm',
        discussionMode: 'brainstorm',
        goals: [{ goalId: 'discussion-goal', label: '设计未来校园产品', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '点子进展', value: 1, target: 4 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      messages: [],
      speaker: buildCharacter('analyst-a', '分析师A'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      message: { type: 'ai', senderId: 'analyst-a', content: '可以做一个把课程表、社团活动和心理支持合并的校园助手。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('brainstorming workshop');
    expect(context?.additionalConstraints?.join('\n')).toContain('at least two concrete ideas');
    expect(result.chatPatch.scenarioState?.phase).toBe('brainstorm');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '点子进展', value: 2, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('brainstorm_turn');
  });

  it('uses retrospective constraints and keeps synthesis manual', async () => {
    const chat = buildChat({
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'task-retrospective', surfaceProfile: 'text' },
      scenarioState: {
        phase: 'retrospective',
        discussionMode: 'retrospective',
        goals: [{ goalId: 'discussion-goal', label: '复盘上次发布延期', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '复盘进展', value: 2, target: 3 }],
      },
    });

    const context = DISCUSSION_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      messages: [],
      speaker: buildCharacter('analyst-a', '分析师A'),
    });
    const result = await DISCUSSION_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('analyst-a', '分析师A')],
      message: { type: 'ai', senderId: 'analyst-a', content: '事实是联调开始太晚，原因是接口契约没有提前冻结，行动项是下次先做契约评审。' },
      previousAiMessage: null,
    });

    expect(context?.promptPrefix).toContain('retrospective');
    expect(context?.additionalConstraints?.join('\n')).toContain('observable fact');
    expect(result.chatPatch.scenarioState?.phase).toBe('retrospective');
    expect(result.chatPatch.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '复盘进展', value: 3, target: 0 },
    ]);
    expect(result.runtimeEvents[0]?.eventType).toBe('retrospective_turn');
  });
});
