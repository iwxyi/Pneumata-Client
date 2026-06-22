import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { buildStoryRoomOpeningPreview } from './storyRoomOpeningPreview';

function character(id: string, name: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const members: AICharacter[] = [
  character('char-a', '林医生'),
  character('550e8400-e29b-41d4-a716-446655440000', '护士'),
];

function buildStoryChat(overrides: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'story-1',
    name: '雨夜旧医院',
    type: 'group',
    mode: 'scripted_play',
    topic: '雨夜旧医院',
    memberIds: members.map((member) => member.id),
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
    scenarioState: {
      phase: 'scene',
      storyGoal: '围绕失踪名单和停电记录推进，让用户在追问、搜证和保护之间做关键选择。',
      storyOutline: '开场从旧医院失踪名单切入；第一轮让停电和脚步声形成压力。',
      storySituation: '旧医院停电后仍有一层楼亮着灯，失踪名单上多出一个不该存在的名字。',
      currentScene: {
        location: '旧医院',
        time: '雨夜',
        visibleThreat: '停电后的脚步声正在靠近',
        summary: '雨夜旧医院停电后，走廊尽头仍有灯光，失踪名单被人翻到最后一页。',
      },
      openQuestions: ['失踪名单上不该存在的名字来自哪里？', '停电期间到底是谁改变了现场？'],
      clues: ['失踪名单最后一页被重新装订。'],
      stakes: ['如果继续追查，角色的秘密可能暴露。'],
      relationshipShifts: ['char-a 开始怀疑 550e8400-e29b-41d4-a716-446655440000 隐瞒了停电记录。'],
    },
    ...overrides,
  } as GroupChat;
}

describe('buildStoryRoomOpeningPreview', () => {
  it('projects opening assets from story-room scenario state', () => {
    const preview = buildStoryRoomOpeningPreview(buildStoryChat(), members);

    expect(preview).toEqual(expect.objectContaining({
      title: '雨夜 · 旧医院',
      goal: expect.stringContaining('关键选择'),
      scene: expect.stringContaining('失踪名单'),
      firstChapterGoal: expect.stringContaining('旧医院失踪名单'),
      readerPromise: expect.stringMatching(/选择.*章节回看/),
    }));
    expect(preview?.items.map((item) => item.label)).toEqual(expect.arrayContaining(['悬念', '线索', '风险', '关系']));
  });

  it('does not create a story opening preview for normal chats', () => {
    expect(buildStoryRoomOpeningPreview(buildStoryChat({
      sessionKind: { family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text', topology: 'group' },
    }), members)).toBeNull();
  });

  it('sanitizes member ids from visible relationship pressure', () => {
    const preview = buildStoryRoomOpeningPreview(buildStoryChat(), members);
    const text = [
      preview?.goal,
      preview?.scene,
      preview?.firstChapterGoal,
      preview?.readerPromise,
      ...(preview?.items.map((item) => item.text) || []),
    ].filter(Boolean).join('\n');

    expect(text).toContain('林医生');
    expect(text).toContain('护士');
    expect(text).not.toContain('char-a');
    expect(text).not.toContain('550e8400-e29b-41d4-a716-446655440000');
  });
});
