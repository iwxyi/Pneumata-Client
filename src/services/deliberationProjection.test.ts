import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import { projectDeliberationSidebarRows } from './deliberationProjection';

function member(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

describe('deliberationProjection', () => {
  it('projects deliberation seats, current speaker, inquiry, progress, and summary', () => {
    const rawId = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
    const chat = normalizeConversation({
      id: 'deliberation-1',
      type: 'group',
      mode: 'roundtable',
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'courtroom-deliberation', surfaceProfile: 'text' },
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '法庭攻防',
      topic: `${rawId} 谁该为项目延期负责`,
      style: 'debate',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['a', 'b', 'c'],
      speed: 1,
      isActive: true,
      allowIntervention: true,
      topicSeed: '',
      governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
      dramaRules: { allowCliques: true, allowMockery: false, allowAlliances: false, allowContempt: false },
      scenarioState: {
        phase: 'courtroom',
        discussionMode: 'courtroom',
        goals: [{ goalId: 'discussion-goal', label: `${rawId} 谁该为项目延期负责`, status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '质询进度', value: 2, target: 5 }],
        deliberationClaims: [
          { id: 'claim-1', actorId: 'a', stance: 'support', text: `${rawId} 支持拆分责任链，接口冻结延迟是关键。` },
          { id: 'claim-2', actorId: 'b', stance: 'oppose', text: '排序链路风险不能被后置。' },
        ],
        deliberationEvidence: [
          { id: 'evidence-1', actorId: 'a', text: `证据显示 ${rawId} 的接口冻结晚于计划。` },
        ],
        deliberationIssues: [
          { id: 'issue-1', targetActorId: 'b', text: '为什么排序链路风险不能后置？', status: 'open' },
        ],
        deliberationVerdicts: [
          { id: 'verdict-1', actorId: 'c', text: '阶段判断：先采信接口冻结延迟，排序风险继续追问。', tendency: 'mixed' },
        ],
        deliberationMomentum: { support: 1, oppose: 1, inquiry: 1, review: 1, label: '势均力敌' },
        roleAssignments: [
          { actorId: 'a', roleId: 'plaintiff', factionId: 'claim' },
          { actorId: 'b', roleId: 'defendant', factionId: 'defense' },
          { actorId: 'c', roleId: 'judge', factionId: 'adjudication' },
        ],
        currentTurnActorId: 'b',
        summaryText: `${rawId} 证据集中在接口冻结延迟。`,
      },
      runtimeEventsV2: [{
        id: 'evt-1',
        conversationId: 'deliberation-1',
        kind: 'director_intervention',
        createdAt: 1,
        targetIds: ['b'],
        summary: `审议质询 → 对象：${rawId} 请回应接口冻结延迟`,
        visibility: 'public',
        payload: {},
      }],
      worldState: { phase: 'debating', mood: 'adjudicating', focus: '', recentEvent: '', conflictAxes: [] },
      directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
    });

    const rows = projectDeliberationSidebarRows(chat, [member('a', '原告'), member('b', '被告'), member('c', '法官')]);
    expect(rows).toEqual(expect.arrayContaining([
      '阶段 法庭攻防',
      '审议席位 原告：主张方 / 被告：回应方 / 法官：法官',
      '当前发言 被告',
      '质询进度 2/5',
    ]));
    expect(rows.join('\n')).toContain('最新质询 被告');
    expect(rows.join('\n')).toContain('成员 请回应接口冻结延迟');
    expect(rows.join('\n')).toContain('论点树');
    expect(rows.join('\n')).toContain('证据 原告');
    expect(rows.join('\n')).toContain('待回应漏洞 被告');
    expect(rows.join('\n')).toContain('裁决记录 法官');
    expect(rows.join('\n')).toContain('审议势头 势均力敌');
    expect(rows.join('\n')).not.toContain(rawId);
  });

  it('shows open-ended deliberation progress without a fixed target', () => {
    const chat = normalizeConversation({
      id: 'deliberation-open',
      type: 'group',
      mode: 'roundtable',
      sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'role-debate', surfaceProfile: 'text' },
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '角色辩论',
      topic: '是否应该重构推荐系统',
      style: 'debate',
      runtimeEvolutionIntensity: 'fast',
      memberIds: ['a', 'b'],
      speed: 1,
      isActive: true,
      allowIntervention: true,
      topicSeed: '',
      governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
      dramaRules: { allowCliques: true, allowMockery: true, allowAlliances: false, allowContempt: false },
      scenarioState: {
        phase: 'debate',
        discussionMode: 'debate',
        goals: [{ goalId: 'discussion-goal', label: '是否应该重构推荐系统', status: 'active', progress: 0 }],
        progress: [{ key: 'speeches', label: '攻防进度', value: 2, target: 0 }],
        currentTurnActorId: 'b',
      },
      worldState: { phase: 'debating', mood: 'contested', focus: '', recentEvent: '', conflictAxes: [] },
      directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
    });

    expect(projectDeliberationSidebarRows(chat, [member('a', '正方'), member('b', '反方')])).toEqual(expect.arrayContaining([
      '攻防进度 2',
      '当前发言 反方',
    ]));
  });

  it('returns no rows for non-analysis rooms', () => {
    const chat = normalizeConversation({
      id: 'chat-1',
      type: 'group',
      mode: 'open_chat',
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '自由群聊',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['a'],
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
    });

    expect(projectDeliberationSidebarRows(chat, [member('a', '甲')])).toEqual([]);
  });
});
