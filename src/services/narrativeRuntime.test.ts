import { describe, expect, it } from 'vitest';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import {
  buildChapterRecap,
  buildNarrativeTurnFromStoryEvents,
  buildSelectedChoiceConsequencePrompt,
  buildStoryAssetPrompt,
  buildStoryEventsVisibleText,
  appendStoryReadingPanelBlock,
  extractStoryAssets,
  getStoryChoicesFromEvents,
  normalizeStoryBranches,
  normalizeStoryEvents,
  resolveStoryBeatPlan,
  updateChoiceHistoryOutcome,
} from './narrativeRuntime';

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
          { label: '让林医生去地下档案室查被撕掉的病历', prompt: '林医生进入地下档案室', intent: '探索', risk: '被锁在地下室', reward: '找到病历' },
          { label: '让护士追问昨晚停电记录', prompt: '护士追问停电记录' },
        ],
      },
    ]);

    expect(buildStoryEventsVisibleText(events, characters)).toContain('林医生：“不要开那扇门。”');
    expect(getStoryChoicesFromEvents(events)).toEqual([
      { label: '让林医生去地下档案室查被撕掉的病历', prompt: '林医生进入地下档案室', intent: '探索', risk: '被锁在地下室', reward: '找到病历' },
      { label: '让护士追问昨晚停电记录', prompt: '护士追问停电记录' },
    ]);

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

  it('keeps speech visible when the model returns an unknown character id', () => {
    const events = normalizeStoryEvents([
      { type: 'narration', text: '走廊尽头的灯忽然灭了。' },
      { type: 'speech', characterId: 'unknown-actor', text: '别往前走。' },
    ]);

    const turn = buildNarrativeTurnFromStoryEvents({ conversation: chat, events, characters });
    expect(turn?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorKind: 'character',
        displayMode: 'bubble',
        actorName: 'unknown-actor',
        characterId: 'unknown-actor',
        text: '别往前走。',
      }),
    ]));
  });

  it('drops near-duplicate story event text within one model response', () => {
    const events = normalizeStoryEvents([
      { type: 'narration', text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好。' },
      { type: 'narration', text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上摆好，才慢慢回过身来。' },
      { type: 'speech', characterId: 'nurse', text: '回小姐，奴婢铺床的时候，没觉得有什么不平整的。' },
      { type: 'speech', characterId: 'nurse', text: '回小姐……奴婢铺床的时候，没觉得有什么不平整的。' },
      { type: 'narration', text: '窗外传来扫院子的沙沙声，天光已经从青白变成了淡金。' },
    ]);

    expect(events).toEqual([
      { type: 'narration', text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好。' },
      { type: 'speech', characterId: 'nurse', speakerName: undefined, text: '回小姐，奴婢铺床的时候，没觉得有什么不平整的。' },
      { type: 'narration', text: '窗外传来扫院子的沙沙声，天光已经从青白变成了淡金。' },
    ]);
  });

  it('drops repeated branch consequence rewrites even when wording changes', () => {
    const events = normalizeStoryEvents([
      { type: 'narration', text: '月奴正转身要退出去，沈清婉的声音从妆台前传来，不重，却让月奴的步子顿住了。月奴没有立刻转身，而是先把手里的托盘轻轻放在门边的春凳上。' },
      { type: 'speech', speakerName: '沈清婉', text: '月奴，你昨晚铺床的时候，可觉得枕头底下有什么不平整的地方？' },
      { type: 'narration', text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好，才慢慢回过身来。' },
      { type: 'narration', text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好，才慢慢回过身来，目光低垂，落在沈清婉肩头那件还没换下的嫁衣上。' },
      { type: 'speech', speakerName: '林月奴', text: '回小姐，枕头底下奴婢都用手抚平了的，席子也重新铺过一遍，没有什么硌手的东西。' },
      { type: 'narration', text: '窗外传来扫院子的沙沙声，天光已经从青白变成了淡金，新的一天开始了。' },
    ]);

    expect(events.map((event) => event.type === 'narration' ? event.text : `${event.speakerName}:${event.text}`)).toEqual([
      '月奴正转身要退出去，沈清婉的声音从妆台前传来，不重，却让月奴的步子顿住了。月奴没有立刻转身，而是先把手里的托盘轻轻放在门边的春凳上。',
      '沈清婉:月奴，你昨晚铺床的时候，可觉得枕头底下有什么不平整的地方？',
      '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好，才慢慢回过身来。',
      '林月奴:回小姐，枕头底下奴婢都用手抚平了的，席子也重新铺过一遍，没有什么硌手的东西。',
      '窗外传来扫院子的沙沙声，天光已经从青白变成了淡金，新的一天开始了。',
    ]);
  });

  it('plans story beats and normalizes choices as reusable narrative runtime state', () => {
    const decisionChat = normalizeConversation({
      ...chat,
      scenarioState: { phase: 'scene', sceneBeatCount: 3, choiceEpoch: 1, branches: [] },
    });
    expect(resolveStoryBeatPlan(decisionChat)).toEqual(expect.objectContaining({
      beatKind: 'decision',
      choicePolicy: 'require',
    }));

    const normalized = normalizeStoryBranches(decisionChat, [
      { label: '让林医生追问昨晚停电记录', prompt: '追问停电记录', intent: '逼问', risk: '激怒护士', reward: '得到线索' },
      { label: '让护士检查墙上的血迹', prompt: '检查血迹', intent: '探索', risk: '暴露位置', reward: '找到证据' },
    ]);
    expect(normalized).toEqual(expect.objectContaining({ hasOpenChoice: true, openedChoice: true }));
    expect(normalized.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '让林医生追问昨晚停电记录', choiceEpoch: 2, status: 'available', description: '意图：逼问；风险：激怒护士；收益：得到线索' }),
    ]));
  });

  it('adds a visible reading panel when a story beat opens choices', () => {
    const turn = buildNarrativeTurnFromStoryEvents({
      conversation: normalizeConversation({
        ...chat,
        scenarioState: {
          phase: 'scene',
          chapterMemory: '林医生在旧医院发现被撕掉的病历。',
          stakes: ['激怒护士'],
        },
      }),
      events: [{ type: 'narration', text: '门锁轻轻弹开。' }],
      characters,
    });
    const enriched = appendStoryReadingPanelBlock({
      conversation: normalizeConversation({
        ...chat,
        scenarioState: {
          phase: 'scene',
          chapterMemory: '林医生在旧医院发现被撕掉的病历。',
          stakes: ['激怒护士'],
        },
      }),
      narrativeTurn: turn,
      choices: [
        { label: '让林医生追问昨晚停电记录', prompt: '追问停电记录', risk: '激怒护士', reward: '得到线索' },
        { label: '让护士检查墙上的血迹', prompt: '检查血迹', risk: '暴露位置', reward: '找到证据' },
      ],
    });

    expect(enriched?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorKind: 'system',
        kind: 'system_note',
        displayMode: 'system_panel',
        text: expect.stringContaining('新的抉择点'),
      }),
    ]));
    expect(enriched?.blocks.at(-1)?.text).toContain('前情：林医生在旧医院发现被撕掉的病历。');
    expect(enriched?.blocks.at(-1)?.text).toContain('取舍：激怒护士');
  });

  it('extracts assets, builds recaps, and records the selected branch outcome', () => {
    const choiceChat = normalizeConversation({
      ...chat,
      scenarioState: {
        phase: 'branch',
        storyDirection: '查清旧医院停电真相',
        storyGoal: '查清旧医院失踪案',
        storySituation: '林医生刚进入旧医院',
        selectedChoice: { branchId: 'ask', label: '追问停电记录', prompt: '逼护士说出停电期间谁进过档案室', choiceEpoch: 2 },
        selectedChoiceEpoch: 2,
        choiceHistory: [{ branchId: 'ask', label: '追问停电记录', risk: '激怒护士', reward: '得到线索', choiceEpoch: 2 }],
        openQuestions: ['旧医院为什么停电？'],
        clues: [],
        stakes: [],
        relationshipShifts: [],
      },
    });
    const assets = extractStoryAssets({
      conversation: choiceChat,
      choices: [{ label: '让护士检查血迹', prompt: '检查血迹', risk: '暴露位置', reward: '发现证据' }],
      summary: '护士承认停电时有人进入档案室。',
      message: {
        content: '护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。',
        metadata: {},
      },
    });
    expect(assets).toEqual(expect.objectContaining({
      openQuestions: expect.arrayContaining(['旧医院为什么停电？']),
      clues: expect.arrayContaining(['护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。']),
      stakes: expect.arrayContaining(['暴露位置', '发现证据']),
      relationshipShifts: expect.arrayContaining(['护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。']),
      storyGoal: '逼护士说出停电期间谁进过档案室',
      storySituation: '护士承认停电时有人进入档案室。',
    }));

    const recap = buildChapterRecap({
      conversation: choiceChat,
      storyAssets: assets,
      summary: '护士承认停电时有人进入档案室。',
      openedChoice: false,
      nextSceneBeatCount: 4,
    });
    expect(recap).toEqual(expect.objectContaining({
      title: '阶段回顾',
      discoveredClues: expect.arrayContaining(['护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。']),
      lastChoiceLabels: ['追问停电记录'],
    }));

    const updatedHistory = updateChoiceHistoryOutcome(choiceChat, '护士承认停电时有人进入档案室。');
    expect(updatedHistory[0]).toEqual(expect.objectContaining({ outcome: '护士承认停电时有人进入档案室。' }));

    const prompt = buildStoryAssetPrompt(normalizeConversation({
      ...choiceChat,
      scenarioState: { ...(choiceChat.scenarioState || {}), ...assets, choiceHistory: updatedHistory, chapterRecap: recap },
    }));
    expect(prompt).toEqual(expect.arrayContaining([
      expect.stringContaining('Use these story assets as continuity anchors'),
      expect.stringContaining('Current chapter goal: 逼护士说出停电期间谁进过档案室'),
      expect.stringContaining('Current situation: 护士承认停电时有人进入档案室。'),
      expect.stringContaining('outcome=护士承认停电时有人进入档案室。'),
    ]));
  });

  it('builds a concrete consequence prompt for the selected story choice', () => {
    const prompt = buildSelectedChoiceConsequencePrompt(normalizeConversation({
      ...chat,
      scenarioState: {
        phase: 'branch',
        selectedChoice: {
          branchId: 'ask',
          label: '让林医生追问护士昨晚去向',
          prompt: '林医生逼问护士说出停电时的真相',
          intent: '逼问',
          risk: '激怒护士',
          reward: '得到停电线索',
          choiceEpoch: 2,
        },
      },
    }));

    expect(prompt).toEqual(expect.arrayContaining([
      expect.stringContaining('immediate consequence of the user choice'),
      expect.stringContaining('Selected choice: 让林医生追问护士昨晚去向'),
      expect.stringContaining('Choice promise to resolve: 林医生逼问护士说出停电时的真相'),
      expect.stringContaining('Risk that should become visible or start to cost something: 激怒护士'),
      expect.stringContaining('Reward/opportunity that should become visible or be partially earned: 得到停电线索'),
    ]));
  });
});
