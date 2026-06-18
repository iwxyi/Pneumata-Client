import { describe, expect, it } from 'vitest';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import { buildNarrativeTurnFromStoryEvents, buildStoryEventsVisibleText, getStoryChoicesFromEvents, normalizeStoryEvents } from './narrativeRuntime';

const characters = [
  { id: 'lin', name: '林医生' },
  { id: 'nurse', name: '护士' },
] as AICharacter[];

const chat = normalizeConversation({
  id: 'story-1',
  type: 'group',
  mode: 'scripted_play',
  sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
  modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
  modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
  name: '故事房',
  topic: '旧医院',
  style: 'roleplay',
  runtimeEvolutionIntensity: 'balanced',
  memberIds: ['lin', 'nurse'],
  speed: 1,
  isActive: true,
  allowIntervention: true,
  topicSeed: '',
  scenarioState: { phase: 'scene' },
  worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
  governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
  dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
  directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
  createdAt: 1,
  updatedAt: 1,
  lastMessageAt: 1,
});

describe('narrativeRuntime', () => {
  it('normalizes story events into visible narrative blocks and concrete choices', () => {
    const events = normalizeStoryEvents([
      { type: 'narration', text: '雨水顺着旧楼铁门往下流。' },
      { type: 'speech', characterId: 'lin', text: '不要开那扇门。' },
      {
        type: 'choice_point',
        choices: [
          { label: '让林医生去地下档案室查被撕掉的病历', prompt: '林医生进入地下档案室' },
          { label: '让护士追问昨晚停电记录', prompt: '护士追问停电记录' },
        ],
      },
    ]);

    expect(buildStoryEventsVisibleText(events, characters)).toContain('林医生：“不要开那扇门。”');
    expect(getStoryChoicesFromEvents(events)).toHaveLength(2);

    const turn = buildNarrativeTurnFromStoryEvents({ conversation: chat, events, characters });
    expect(turn?.povActorId).toBe('narrator');
    expect(turn?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorKind: 'narrator', displayMode: 'paragraph', text: '雨水顺着旧楼铁门往下流。' }),
      expect.objectContaining({ actorKind: 'character', displayMode: 'bubble', characterId: 'lin', text: '不要开那扇门。' }),
    ]));
  });

  it('rejects abstract template choices before they reach storyChoices metadata', () => {
    const events = normalizeStoryEvents([
      {
        type: 'choice_point',
        choices: [
          { label: '追查线索', prompt: '泛化选项' },
          { label: '推进剧情', prompt: '泛化选项' },
          { label: '追问林医生为什么隐瞒昨晚的停电记录', prompt: '林医生解释停电记录' },
          { label: '去地下档案室查那份被撕掉的病历', prompt: '进入地下档案室' },
        ],
      },
    ]);

    expect(getStoryChoicesFromEvents(events).map((choice) => choice.label)).toEqual([
      '追问林医生为什么隐瞒昨晚的停电记录',
      '去地下档案室查那份被撕掉的病历',
    ]);
  });
});
