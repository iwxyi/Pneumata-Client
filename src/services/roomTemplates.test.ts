import { describe, expect, it } from 'vitest';
import { buildGroupChatDraft } from './chatDraftBuilder';
import { getRoomTemplate } from './roomTemplates';
import type { RoomTemplateKey } from './roomTemplates';

const storyTemplateKeys: RoomTemplateKey[] = ['story_reader', 'campus_story', 'romance_story'];

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
    const template = getRoomTemplate('story_reader');
    const draft = buildGroupChatDraft({
      type: 'group',
      name: '默认故事房',
      topic: '雨夜旧医院',
      style: template.style,
      runtimeEvolutionIntensity: template.runtimeEvolutionIntensity,
      sessionKind: template.sessionKind,
      storyBranchMode: template.defaults?.storyBranchMode,
      storyBackground: template.defaults?.storyBackground,
      storyDirection: template.defaults?.storyDirection,
      storyOutline: template.defaults?.storyOutline,
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

    expect(draft.scenarioState?.storyGoal).toContain('雨夜旧医院');
    expect(draft.scenarioState?.storySituation).toContain('旧医院');
    expect(draft.scenarioState?.currentScene).toEqual(expect.objectContaining({
      location: '雨夜旧医院',
      summary: expect.stringContaining('旧医院'),
    }));
    expect(draft.scenarioState?.openQuestions).toEqual(['雨夜旧医院背后真正隐藏着什么？']);
    expect(draft.scenarioState?.chapterMemory).toContain('雨夜旧医院');
  });
});
