import { describe, expect, it } from 'vitest';
import {
  buildGroupChatDraft,
  composeGroupMemberIds,
  normalizeOperatorIdsInput,
  stripUserMemberId,
} from './chatDraftBuilder';
import { getRoomTemplate } from './roomTemplates';

describe('chatDraftBuilder composeGroupMemberIds', () => {
  it('adds user as participant when includeUserAsMember is enabled', () => {
    expect(composeGroupMemberIds(['a', 'b'], true)).toEqual(['a', 'b', 'user']);
  });

  it('removes duplicates and strips user from ai member list before composing', () => {
    expect(composeGroupMemberIds(['a', 'user', 'a', '', 'b'], true)).toEqual(['a', 'b', 'user']);
  });

  it('keeps only ai members when includeUserAsMember is disabled', () => {
    expect(composeGroupMemberIds(['a', 'user', 'b'], false)).toEqual(['a', 'b']);
  });

  it('strips user marker from ai member selections while keeping order and uniqueness', () => {
    expect(stripUserMemberId(['user', 'a', 'a', '', 'b', 'user'])).toEqual(['a', 'b']);
  });

  it('persists operatorIds in group chat draft', () => {
    const draft = buildGroupChatDraft({
      type: 'group',
      name: '测试群',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['a', 'user'],
      operatorIds: ['host_moderator', 'topic_guide_bot'],
      showRoleActions: true,
      seedMemoryText: '',
      seedArtifactText: '',
      ownerCharacterId: null,
      adminCharacterIds: [],
      autoModeration: false,
      allowMute: true,
      allowPrivateThreads: true,
      allowCliques: false,
      allowMockery: false,
      mood: '',
      focus: '',
      recentEvent: '',
      allowSpeakAs: true,
      allowDirectorMode: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });
    expect(draft.operatorIds).toEqual(['host_moderator', 'topic_guide_bot']);
  });

  it('starts story reader rooms without legacy branches or visible role actions', () => {
    const draft = buildGroupChatDraft({
      type: 'group',
      name: '旧医院故事',
      topic: '雨夜旧医院',
      style: 'roleplay',
      runtimeEvolutionIntensity: 'slow',
      sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
      storyBranchMode: 'guided',
      storyBackground: '旧医院连续有人失踪。',
      storyDirection: '悬疑探索',
      storyOutline: '',
      memberIds: ['lin', 'nurse'],
      operatorIds: [],
      showRoleActions: true,
      seedMemoryText: '',
      seedArtifactText: '',
      ownerCharacterId: null,
      adminCharacterIds: [],
      autoModeration: false,
      allowMute: true,
      allowPrivateThreads: false,
      allowCliques: false,
      allowMockery: false,
      mood: '',
      focus: '',
      recentEvent: '',
      allowSpeakAs: true,
      allowDirectorMode: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });

    expect(draft.mode).toBe('scripted_play');
    expect(draft.scenarioState?.phase).toBe('scene');
    expect(draft.scenarioState?.storyBeatKind).toBe('establish');
    expect(draft.scenarioState?.storyChoicePolicy).toBe('forbid');
    expect(draft.scenarioState?.storyBeatReason).toBe('establish scene before choices');
    expect(draft.scenarioState?.openQuestions).toEqual([
      '失踪名单上不该存在的名字来自哪里？',
      '雨夜旧医院背后真正隐藏着什么？',
    ]);
    expect(draft.scenarioState?.clues).toEqual([]);
    expect(draft.scenarioState?.stakes).toEqual(['旧医院连续有人失踪。']);
    expect(draft.scenarioState?.relationshipShifts).toEqual([]);
    expect(draft.scenarioState?.choiceHistory).toEqual([]);
    expect(draft.scenarioState?.chapterMemory).toBe('开场：雨夜旧医院');
    expect(draft.scenarioState?.chapterRecap).toBeNull();
    expect(draft.scenarioState?.branches).toEqual([]);
    expect(draft.showRoleActions).toBe(false);
    expect(draft.modeConfig.showRoleActions).toBe(false);
    expect(draft.scenarioState?.storyBackground).toBe('旧医院连续有人失踪。');
    expect(draft.scenarioState?.storyDirection).toBe('悬疑探索');
    expect(draft.scenarioState?.storyGoal).toBe('围绕「雨夜旧医院」推进：悬疑探索');
    expect(draft.scenarioState?.storySituation).toBe('旧医院连续有人失踪。 / 当前开场：雨夜旧医院');
    expect(draft.scenarioState?.currentScene).toEqual(expect.objectContaining({
      location: '旧医院',
      time: '雨夜',
      visibleThreat: '旧医院连续有人失踪。',
      summary: '旧医院连续有人失踪。 / 当前开场：雨夜旧医院',
    }));
  });

  it('initializes roundtable review with open-ended speech progress and first speaker', () => {
    const draft = buildGroupChatDraft({
      type: 'group',
      name: '圆桌审议',
      topic: '是否要重构推荐系统',
      style: 'debate',
      runtimeEvolutionIntensity: 'balanced',
      sessionKind: { family: 'analysis', scenarioId: 'roundtable-review', surfaceProfile: 'text', topology: 'table' },
      memberIds: ['analyst-a', 'analyst-b', 'user'],
      operatorIds: [],
      showRoleActions: true,
      seedMemoryText: '',
      seedArtifactText: '',
      ownerCharacterId: null,
      adminCharacterIds: [],
      autoModeration: false,
      allowMute: true,
      allowPrivateThreads: false,
      allowCliques: false,
      allowMockery: false,
      mood: '',
      focus: '',
      recentEvent: '',
      allowSpeakAs: true,
      allowDirectorMode: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });

    expect(draft.mode).toBe('roundtable');
    expect(draft.scenarioState?.phase).toBe('roundtable');
    expect(draft.scenarioState?.currentTurnActorId).toBe('analyst-a');
    expect(draft.scenarioState?.goals?.[0]).toEqual(expect.objectContaining({
      goalId: 'discussion-goal',
      label: '是否要重构推荐系统',
    }));
    expect(draft.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '圆桌发言', value: 0, target: 0 },
    ]);
  });

  it('keeps deliberation rooms open-ended by default', () => {
    const template = getRoomTemplate('opinion_review');
    const draft = buildGroupChatDraft({
      type: 'group',
      name: template.label,
      topic: '长期讨论推荐系统演进',
      style: template.style,
      runtimeEvolutionIntensity: template.runtimeEvolutionIntensity,
      sessionKind: template.sessionKind,
      memberIds: ['analyst-a', 'analyst-b'],
      operatorIds: [],
      showRoleActions: true,
      seedMemoryText: '',
      seedArtifactText: '',
      ownerCharacterId: null,
      adminCharacterIds: [],
      autoModeration: false,
      allowMute: true,
      allowPrivateThreads: true,
      allowCliques: true,
      allowMockery: false,
      mood: '',
      focus: '',
      recentEvent: '',
      allowSpeakAs: true,
      allowDirectorMode: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });

    expect(draft.scenarioState?.progress).toEqual([
      { key: 'speeches', label: '审议发言', value: 0, target: 0 },
    ]);
  });

  it('materializes deliberation variants with distinct runtime state', () => {
    const cases = [
      { key: 'role_debate', mode: 'roundtable', scenarioId: 'role-debate', discussionMode: 'debate', phase: 'debate', progressLabel: '攻防进度' },
      { key: 'courtroom_deliberation', mode: 'roundtable', scenarioId: 'courtroom-deliberation', discussionMode: 'courtroom', phase: 'courtroom', progressLabel: '质询进度' },
      { key: 'expert_review', mode: 'group_discussion', scenarioId: 'expert-review', discussionMode: 'expert_review', phase: 'expert_review', progressLabel: '评审进度' },
      { key: 'public_inquiry', mode: 'group_discussion', scenarioId: 'public-inquiry', discussionMode: 'public_inquiry', phase: 'public_inquiry', progressLabel: '质询进度' },
      { key: 'brainstorm_workshop', mode: 'group_discussion', scenarioId: 'brainstorm-workshop', discussionMode: 'brainstorm', phase: 'brainstorm', progressLabel: '点子进展' },
      { key: 'retrospective_room', mode: 'group_discussion', scenarioId: 'task-retrospective', discussionMode: 'retrospective', phase: 'retrospective', progressLabel: '复盘进展' },
    ] as const;

    for (const item of cases) {
      const template = getRoomTemplate(item.key);
      const draft = buildGroupChatDraft({
        type: 'group',
        name: template.label,
        topic: '是否应该重构推荐系统',
        style: template.style,
        runtimeEvolutionIntensity: template.runtimeEvolutionIntensity,
        sessionKind: template.sessionKind,
        memberIds: ['analyst-a', 'analyst-b', 'analyst-c'],
        operatorIds: [],
        showRoleActions: true,
        seedMemoryText: '',
        seedArtifactText: '',
        ownerCharacterId: null,
        adminCharacterIds: [],
        autoModeration: false,
        allowMute: true,
        allowPrivateThreads: false,
        allowCliques: false,
        allowMockery: false,
        mood: '',
        focus: '',
        recentEvent: '',
        allowSpeakAs: true,
        allowDirectorMode: true,
        allowEventInjection: true,
        allowForcedReply: true,
      });

      expect(draft.mode).toBe(item.mode);
      expect(draft.sessionKind?.scenarioId).toBe(item.scenarioId);
      expect(draft.scenarioState?.discussionMode).toBe(item.discussionMode);
      expect(draft.scenarioState?.phase).toBe(item.phase);
      expect(draft.scenarioState?.progress?.[0]?.label).toBe(item.progressLabel);
      expect(draft.scenarioState?.progress?.[0]?.target).toBe(0);
    }
  });

  it('assigns stable debate roles by seat order', () => {
    const template = getRoomTemplate('role_debate');
    const draft = buildGroupChatDraft({
      type: 'group',
      name: template.label,
      topic: 'AI 是否应拥有法律人格',
      style: template.style,
      runtimeEvolutionIntensity: template.runtimeEvolutionIntensity,
      sessionKind: template.sessionKind,
      memberIds: ['a', 'b', 'c', 'user'],
      operatorIds: [],
      showRoleActions: true,
      seedMemoryText: '',
      seedArtifactText: '',
      ownerCharacterId: null,
      adminCharacterIds: [],
      autoModeration: false,
      allowMute: true,
      allowPrivateThreads: false,
      allowCliques: true,
      allowMockery: true,
      mood: '',
      focus: '',
      recentEvent: '',
      allowSpeakAs: true,
      allowDirectorMode: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });

    expect(draft.scenarioState?.currentTurnActorId).toBe('a');
    expect(draft.scenarioState?.roleAssignments?.map((item) => [item.actorId, item.roleId, item.factionId])).toEqual([
      ['a', 'affirmative', 'pro'],
      ['b', 'negative', 'con'],
      ['c', 'reviewer', 'review'],
    ]);
  });

  it('normalizes operator ids and filters user/member duplicates', () => {
    const result = normalizeOperatorIdsInput('host_moderator, user, a,\n topic_guide_bot，a', ['a', 'b']);
    expect(result.normalizedIds).toEqual(['host_moderator', 'user', 'a', 'topic_guide_bot']);
    expect(result.effectiveIds).toEqual(['host_moderator', 'topic_guide_bot']);
    expect(result.filteredCount).toBe(2);
  });
});
