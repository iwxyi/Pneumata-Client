import { describe, expect, it } from 'vitest';
import { buildGroupChatDraft } from './chatDraftBuilder';
import { STORY_ENGINE } from './engines/storyEngine';
import { buildRoomTemplatePreview, getRoomTemplate } from './roomTemplates';
import type { RoomTemplateKey } from './roomTemplates';

const storyTemplateKeys: RoomTemplateKey[] = ['story_reader', 'campus_story', 'romance_story', 'palace_intrigue_story'];

function buildStoryDraft(key: RoomTemplateKey, topic: string, memberIds = ['lin', 'nurse']) {
  const template = getRoomTemplate(key);
  return buildGroupChatDraft({
    type: 'group',
    name: template.label,
    topic,
    style: template.style,
    runtimeEvolutionIntensity: template.runtimeEvolutionIntensity,
    sessionKind: template.sessionKind,
    storyBranchMode: template.defaults?.storyBranchMode,
    storyBackground: template.defaults?.storyBackground,
    storyDirection: template.defaults?.storyDirection,
    storyOutline: template.defaults?.storyOutline,
    memberIds,
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
}

function materializeDraft(draft: ReturnType<typeof buildStoryDraft>) {
  return {
    ...draft,
    id: 'story-template-test',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  };
}

describe('roomTemplates story seeds', () => {
  it('provides editable story seeds for every story-room template', () => {
    for (const key of storyTemplateKeys) {
      const template = getRoomTemplate(key);
      expect(template.sessionKind.scenarioId).toBe('story-reader');
      expect(template.sellingPoints?.length).toBeGreaterThanOrEqual(3);
      expect(template.sellingPoints?.join(' / ')).toMatch(/选择|线索|章节|关系|信任|试探|代价|回看|站队|旧账/);
      expect(template.defaults?.storyBackground?.trim().length).toBeGreaterThan(20);
      expect(template.defaults?.storyDirection?.trim().length).toBeGreaterThan(20);
      expect(template.defaults?.storyOutline?.trim().length).toBeGreaterThan(20);
    }
  });

  it('builds a compact first-impression preview for every story template', () => {
    for (const key of storyTemplateKeys) {
      const template = getRoomTemplate(key);
      const preview = buildRoomTemplatePreview(template);

      expect(preview).toEqual(expect.objectContaining({
        hook: expect.any(String),
        direction: expect.any(String),
        trackedAssets: expect.any(Array),
      }));
      expect(preview?.hook.length).toBeGreaterThan(20);
      expect(preview?.hook.length).toBeLessThanOrEqual(86);
      expect(preview?.direction.length).toBeGreaterThan(20);
      expect(preview?.direction.length).toBeLessThanOrEqual(86);
      expect(preview?.trackedAssets).toHaveLength(3);
      expect(`${preview?.hook}\n${preview?.direction}\n${preview?.trackedAssets.join(' / ')}`).toMatch(/选择|线索|章节|关系|信任|试探|代价|回看|站队|旧账|名单|照片|语音|毒剑/);
    }
  });

  it('turns every story template into a concrete opening with pressure, clues, and hooks', () => {
    for (const key of storyTemplateKeys) {
      const template = getRoomTemplate(key);
      const draft = buildStoryDraft(key, template.topicPlaceholder.replace(/^例如：/, '').split('、')[0] || template.label);
      const state = draft.scenarioState;
      const seedText = [
        state?.storyGoal,
        state?.storySituation,
        state?.currentScene?.summary,
        ...(state?.openQuestions || []),
        ...(state?.clues || []),
        ...(state?.stakes || []),
        ...(state?.relationshipShifts || []),
        state?.chapterMemory,
      ].filter(Boolean).join('\n');

      expect(state).toEqual(expect.objectContaining({
        phase: 'scene',
        storyBeatKind: 'establish',
        storyChoicePolicy: 'forbid',
        choiceHistory: [],
        branches: [],
      }));
      expect(state?.storyGoal?.trim().length).toBeGreaterThan(20);
      expect(state?.storySituation?.trim().length).toBeGreaterThan(20);
      expect(state?.currentScene?.summary?.trim().length).toBeGreaterThan(20);
      expect(state?.currentScene?.visibleThreat || state?.stakes?.[0]).toBeTruthy();
      expect(state?.openQuestions?.length).toBeGreaterThanOrEqual(2);
      expect(state?.clues?.length).toBeGreaterThanOrEqual(1);
      expect(state?.stakes?.length).toBeGreaterThanOrEqual(1);
      expect(seedText).toMatch(/秘密|真相|停电|失踪|匿名|误发|照片|语音|名单|压力|暴露|裂缝|竞争|误会|分手|太后|侯府|毒剑|密诏|旧账/);
    }
  });

  it('feeds every story template into an opening prompt that starts in-scene instead of summarizing settings', () => {
    for (const key of storyTemplateKeys) {
      const template = getRoomTemplate(key);
      const draft = buildStoryDraft(key, template.topicPlaceholder.replace(/^例如：/, '').split('、')[0] || template.label);
      const prompt = STORY_ENGINE.buildGenerationPromptContext?.({
        conversation: materializeDraft(draft),
        characters: [],
        messages: [],
        speaker: { id: 'narrator', name: '旁白' } as never,
      });
      const constraints = prompt?.additionalConstraints?.join('\n') || '';

      expect(prompt?.promptPrefix).toContain('storyEvents as the authoritative visible story body');
      expect(prompt?.promptPrefix).toContain('Story background:');
      expect(prompt?.promptPrefix).toContain('Current story direction');
      expect(prompt?.promptPrefix).toContain('Story outline:');
      expect(constraints).toContain('beatKind=establish; choicePolicy=forbid');
      expect(constraints).toContain('Do not output storyEvents.choice_point');
      expect(constraints).toContain('Opening beat: start inside the current scene');
      expect(constraints).toContain('include at least one spoken line');
      expect(constraints).toContain('specific unresolved hook');
      expect(constraints).toContain('Current chapter goal:');
      expect(constraints).toContain('Current scene:');
      expect(constraints).toContain('Open questions to preserve or answer deliberately:');
    }
  });

  it('turns the default story seed into initial narrative assets', () => {
    const draft = buildStoryDraft('story_reader', '雨夜旧医院');

    expect(draft.scenarioState?.storyGoal).toContain('雨夜旧医院');
    expect(draft.scenarioState?.storySituation).toContain('旧医院');
    expect(draft.scenarioState?.currentScene).toEqual(expect.objectContaining({
      location: '旧医院',
      time: '雨夜',
      visibleThreat: expect.stringContaining('停电'),
      summary: expect.stringContaining('旧医院'),
    }));
    expect(draft.scenarioState?.openQuestions).toEqual(expect.arrayContaining([
      '失踪名单上不该存在的名字来自哪里？',
      '停电期间到底是谁改变了现场？',
    ]));
    expect(draft.scenarioState?.clues).toEqual(expect.arrayContaining([
      expect.stringContaining('失踪名单'),
    ]));
    expect(draft.scenarioState?.stakes).toEqual(expect.arrayContaining([
      expect.stringContaining('秘密'),
    ]));
    expect(draft.scenarioState?.chapterMemory).toContain('雨夜旧医院');
  });

  it('derives concrete opening hooks for campus and romance story templates', () => {
    const campus = buildStoryDraft('campus_story', '匿名告白墙', ['student-a', 'student-b']);
    const romance = buildStoryDraft('romance_story', '重逢晚宴', ['ex', 'current']);

    expect(campus.scenarioState?.openQuestions).toEqual(expect.arrayContaining([
      '匿名照片是谁发出来的，又想逼谁暴露？',
      '匿名告白墙里最先暴露的秘密会牵连谁？',
    ]));
    expect(campus.scenarioState?.clues).toEqual(expect.arrayContaining([
      expect.stringContaining('匿名照片'),
    ]));
    expect(campus.scenarioState?.relationshipShifts).toEqual(expect.arrayContaining([
      expect.stringContaining('友情裂缝'),
    ]));

    expect(romance.scenarioState?.openQuestions).toEqual(expect.arrayContaining([
      '误发语音为什么会把旧真相重新翻出来？',
      '重逢晚宴里最先暴露的秘密会牵连谁？',
    ]));
    expect(romance.scenarioState?.stakes).toEqual(expect.arrayContaining([
      expect.stringContaining('分手真相'),
    ]));
    expect(romance.scenarioState?.relationshipShifts).toEqual(expect.arrayContaining([
      expect.stringContaining('误会'),
    ]));
  });

  it('derives concrete opening hooks for palace intrigue story template', () => {
    const intrigue = buildStoryDraft('palace_intrigue_story', '太后密诏', ['bride', 'maid']);

    expect(intrigue.scenarioState?.storySituation).toContain('侯府');
    expect(intrigue.scenarioState?.currentScene).toEqual(expect.objectContaining({
      location: expect.stringMatching(/侯府|喜房|新婚房/),
      visibleThreat: expect.stringMatching(/太后|毒|试探|侯府/),
    }));
    expect(intrigue.scenarioState?.openQuestions).toEqual(expect.arrayContaining([
      '太后和侯府各自在试探谁，又想逼谁先露底？',
      '枕下毒剑到底是谁放进去的？',
    ]));
    expect(intrigue.scenarioState?.clues).toEqual(expect.arrayContaining([
      expect.stringMatching(/密诏|军器监|毒剑|烙印/),
    ]));
    expect(intrigue.scenarioState?.stakes).toEqual(expect.arrayContaining([
      expect.stringMatching(/太后|侯府|名声|毒/),
    ]));
    expect(intrigue.scenarioState?.relationshipShifts).toEqual(expect.arrayContaining([
      expect.stringMatching(/试探|顾家|丫鬟|太后/),
    ]));
  });
});
