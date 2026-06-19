import { describe, expect, it } from 'vitest';
import { buildGroupChatDraft } from './chatDraftBuilder';
import { getRoomTemplate } from './roomTemplates';
import type { RoomTemplateKey } from './roomTemplates';

const storyTemplateKeys: RoomTemplateKey[] = ['story_reader', 'campus_story', 'romance_story'];

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

describe('roomTemplates story seeds', () => {
  it('provides editable story seeds for every story-room template', () => {
    for (const key of storyTemplateKeys) {
      const template = getRoomTemplate(key);
      expect(template.sessionKind.scenarioId).toBe('story-reader');
      expect(template.defaults?.storyBackground?.trim().length).toBeGreaterThan(20);
      expect(template.defaults?.storyDirection?.trim().length).toBeGreaterThan(20);
      expect(template.defaults?.storyOutline?.trim().length).toBeGreaterThan(20);
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
});
