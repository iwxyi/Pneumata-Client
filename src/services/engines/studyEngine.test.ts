import { describe, expect, it } from 'vitest';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, normalizeConversation } from '../../types/chat';
import { DEFAULT_PERSONALITY, normalizeCharacter } from '../../types/character';
import { STUDY_ENGINE } from './studyEngine';

function buildChat() {
  return normalizeConversation({
    id: 'study-engine', type: 'group', mode: 'classroom', modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG, modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    name: '学习进步', topic: '掌握数据库索引', style: 'free', runtimeEvolutionIntensity: 'slow',
    memberIds: ['user', 'teacher'], speed: 1, isActive: true, allowIntervention: false,
    topicSeed: '', createdAt: 1, updatedAt: 1, lastMessageAt: 1,
    sessionKind: { topology: 'group', family: 'study', scenarioId: 'learning-progress', surfaceProfile: 'hybrid' },
    scenarioState: { phase: 'mapping', learning: { goal: '掌握数据库索引', teachingMode: 'casual', knowledgeItems: [] } },
  });
}

describe('study progress engine', () => {
  it('uses learning-progress defaults and exposes learning actions', () => {
    expect(STUDY_ENGINE.createInitialConfig()).toMatchObject({ scenarioId: 'learning-progress', sessionFamily: 'study' });
    expect(STUDY_ENGINE.getAvailableActions?.({ conversation: buildChat(), participants: [] }).map((action) => action.type)).toEqual(['map_learning_goal', 'create_learning_practice', 'submit_learning_attempt', 'grade_learning_attempt', 'review_learning_progress']);
  });

  it('keeps teacher and student roles distinct in the group container', () => {
    const participants = STUDY_ENGINE.buildParticipants(buildChat());
    expect(participants.map((participant) => participant.roleKey)).toEqual(['student', 'teacher']);
  });

  it('does not require a new exercise after every learner question', () => {
    const conversation = buildChat();
    conversation.scenarioState!.phase = 'learning';
    const speaker = normalizeCharacter({ id: 'teacher', name: '老师', avatar: '', personality: DEFAULT_PERSONALITY, expertise: [], speakingStyle: '', background: '', isPreset: false, createdAt: 1, updatedAt: 1 });
    const context = STUDY_ENGINE.buildGenerationPromptContext?.({ conversation, characters: [speaker], messages: [], speaker });
    expect(context?.additionalConstraints?.join(' ')).toContain('A clear explanation may finish the turn without another exercise');
    expect(context?.additionalConstraints?.join(' ')).not.toContain('Give one concrete next step');
  });

  it('does not bind an ambiguous shortened reference to either existing point', async () => {
    const conversation = buildChat();
    conversation.scenarioState!.learning!.knowledgeItems = [
      { id: 'knowledge:first:basics', title: '索引', status: 'exposed', evidenceCount: 0 },
      { id: 'knowledge:second:basics', title: '事务', status: 'exposed', evidenceCount: 0 },
    ];
    const result = await STUDY_ENGINE.onMessageCommitted?.({
      conversation, characters: [],
      message: { type: 'ai', senderId: 'teacher', content: '整理查询计划。', metadata: {
        studyUpdate: { knowledgeObservations: [{ knowledgeItemId: 'basics', title: '查询计划', status: 'exposed' }] },
      } },
    });
    const items = result?.chatPatch.scenarioState?.learning?.knowledgeItems;
    expect(items).toHaveLength(3);
    expect(items?.slice(0, 2)).toEqual(conversation.scenarioState!.learning!.knowledgeItems);
  });

  it('does not manufacture progress when a turn has no model-authored learning evidence', async () => {
    const result = await STUDY_ENGINE.onMessageCommitted?.({ conversation: buildChat(), characters: [], message: { type: 'user', senderId: 'user', content: '先列出知识点' } });
    expect(result?.chatPatch.scenarioState?.progress).toEqual([]);
    expect(result?.runtimeEvents[0]).toMatchObject({ eventType: 'study_guidance', title: '学习推进' });
  });

  it('applies structured model observations without guessing from message keywords', async () => {
    const result = await STUDY_ENGINE.onMessageCommitted?.({
      conversation: buildChat(),
      characters: [],
      message: {
        type: 'ai',
        senderId: 'teacher',
        content: '你已经独立区分了这两个时态。',
        metadata: {
          studyUpdate: {
            phase: 'learning',
            knowledgeObservations: [{ title: '过去时与现在完成时', status: 'verified', evidenceSummary: '学习者独立改正例句并解释了时间标记。', confidence: 0.92 }],
          },
        },
      },
    });
    expect(result?.chatPatch.scenarioState?.phase).toBe('learning');
    expect(result?.chatPatch.scenarioState?.learning?.knowledgeItems[0]).toMatchObject({
      title: '过去时与现在完成时', status: 'verified', evidenceCount: 1,
    });
    expect(result?.chatPatch.scenarioState?.progress?.[0]).toMatchObject({ label: '已验证知识点', value: 1, target: 1 });
    expect(result?.runtimeEvents[0]).toMatchObject({ eventType: 'study_progress', title: '学习记录已更新' });
  });

  it('updates a known point by its explicit identity even when the model rephrases its title', async () => {
    const conversation = buildChat();
    conversation.scenarioState!.learning!.knowledgeItems = [{
      id: 'knowledge:index-basics', title: '索引与全表扫描', status: 'practicing', evidenceCount: 1,
    }];
    const result = await STUDY_ENGINE.onMessageCommitted?.({
      conversation, characters: [],
      message: { type: 'ai', senderId: 'teacher', content: '这次你找到了索引的作用。', metadata: {
        studyUpdate: { phase: 'learning', knowledgeObservations: [{
          knowledgeItemId: 'knowledge:index-basics', title: '什么时候使用索引', status: 'usable',
          evidenceSummary: '学习者根据查询条件选择了索引。',
        }] },
      } },
    });
    expect(result?.chatPatch.scenarioState?.learning?.knowledgeItems).toMatchObject([
      { id: 'knowledge:index-basics', title: '索引与全表扫描', status: 'usable', evidenceCount: 2 },
    ]);
    expect(result?.chatPatch.scenarioState?.progress?.[0]).toMatchObject({ value: 0, target: 1 });
  });

  it.each(['index-basics', 'knowledge:index-basics: 索引与全表扫描'])(
    'normalizes an unambiguous model reference %s without creating a new knowledge point',
    async (knowledgeItemId) => {
      const conversation = buildChat();
      conversation.scenarioState!.learning!.knowledgeItems = [{
        id: 'knowledge:index-basics', title: '索引与全表扫描', status: 'exposed', evidenceCount: 0,
      }];
      const result = await STUDY_ENGINE.onMessageCommitted?.({
        conversation, characters: [],
        message: { type: 'ai', senderId: 'teacher', content: '换一个角度看索引。', metadata: {
          studyUpdate: { phase: 'learning', knowledgeObservations: [{
            knowledgeItemId, title: '什么时候使用索引', status: 'practicing',
            evidenceSummary: '学习者尝试根据查询条件判断是否需要索引。',
          }] },
        } },
      });

      expect(result?.chatPatch.scenarioState?.learning?.knowledgeItems).toMatchObject([
        { id: 'knowledge:index-basics', title: '索引与全表扫描', status: 'practicing' },
      ]);
      expect(result?.chatPatch.scenarioState?.progress?.[0]).toMatchObject({ target: 1 });
    },
  );

  it('does not attach an unknown model-supplied identity to an existing point', async () => {
    const conversation = buildChat();
    conversation.scenarioState!.learning!.knowledgeItems = [{ id: 'known', title: '索引原理', status: 'exposed' }];
    const result = await STUDY_ENGINE.onMessageCommitted?.({
      conversation, characters: [],
      message: { type: 'ai', senderId: 'teacher', content: '接下来讨论事务。', metadata: {
        studyUpdate: { knowledgeObservations: [{ knowledgeItemId: 'missing', title: '事务隔离', status: 'exposed' }] },
      } },
    });
    expect(result?.chatPatch.scenarioState?.learning?.knowledgeItems).toHaveLength(2);
    expect(result?.chatPatch.scenarioState?.learning?.knowledgeItems[1]?.id).not.toBe('missing');
  });
});
