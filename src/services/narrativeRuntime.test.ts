import { describe, expect, it } from 'vitest';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import {
  buildChapterRecap,
  evaluateStoryContinuationQuality,
  evaluateStoryEventQuality,
  buildNarrativeTurnFromStoryEvents,
  buildSelectedChoiceConsequencePrompt,
  buildStoryAssetPrompt,
  buildStoryContinuationPrompt,
  buildStoryContinuationState,
  buildStoryEventsVisibleText,
  buildStoryReadingPanelBlock,
  appendStoryReadingPanelBlock,
  extractStoryAssets,
  getStoryChapterUpdateFromEvents,
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

  it('does not truncate valid story events to a fixed paragraph count', () => {
    const rawEvents = Array.from({ length: 18 }, (_, index) => {
      const sceneNumber = index + 1;
      if (index % 3 === 1) {
        return {
          type: 'speech',
          characterId: index % 2 === 0 ? 'lin' : 'nurse',
          text: `第${sceneNumber}句对白把旧医院第${sceneNumber}处新线索说清楚，语义独立且不会复用前文措辞。`,
        };
      }
      return {
        type: 'narration',
        text: `第${sceneNumber}段叙事推进到旧医院第${sceneNumber}个房间，窗边留下新的纸灰、脚印和灯影变化。`,
      };
    });

    const events = normalizeStoryEvents(rawEvents);

    expect(events).toHaveLength(rawEvents.length);
    expect(buildStoryEventsVisibleText(events, characters)).toContain('第18段叙事推进到旧医院第18个房间');
  });

  it('uses current scene pressure instead of old chapter-memory prefix in choice panels', () => {
    const story = normalizeConversation({
      ...chat,
      scenarioState: {
        ...(chat.scenarioState || {}),
        chapterMemory: '开局时林医生在旧医院门口听见第一声脚步，雨水打湿了病历袋。',
        chapterRecap: {
          title: '新的抉择点',
          summary: '开局时林医生在旧医院门口听见第一声脚步。',
          discoveredClues: [],
          unresolvedQuestions: [],
          changedRelationships: [],
          stakes: [],
          lastChoiceLabels: [],
          updatedAt: 1,
          beatCount: 1,
        },
        currentScene: {
          summary: '护士刚承认停电前有人进过地下档案室。',
          visibleThreat: '门外的脚步正在靠近病房。',
          updatedAt: 2,
        },
        openQuestions: ['谁拿走了被撕掉的病历？'],
        clues: ['钥匙孔里有新鲜铁锈粉末'],
        stakes: ['继续追问可能惊动门外的人'],
      },
    });
    const block = buildStoryReadingPanelBlock({
      conversation: story,
      choices: [
        { label: '林医生追问护士昨晚停电前的去向', prompt: '林医生追问护士昨晚停电前的去向', risk: '惊动门外来人', reward: '确认档案室线索' },
        { label: '顾凌霄封住后窗退路', prompt: '顾凌霄封住后窗退路', risk: '暴露他已经察觉异常', reward: '截住传信的人' },
      ],
    });

    expect(block?.text).toContain('护士刚承认停电前有人进过地下档案室');
    expect(block?.text).not.toContain('开局时林医生在旧医院门口');
  });

  it('keeps chapter_update as structured metadata instead of visible story text', () => {
    const events = normalizeStoryEvents([
      { type: 'chapter_update', title: '枕下长剑', summary: '沈清婉发现枕下长剑。', status: 'active' },
      { type: 'narration', text: '红烛烧到一半，枕下的寒意还留在她指尖。' },
    ]);

    expect(getStoryChapterUpdateFromEvents(events)).toEqual({
      title: '枕下长剑',
      summary: '沈清婉发现枕下长剑。',
      status: 'active',
      startNewChapter: false,
      keyChoices: [],
    });
    expect(buildStoryEventsVisibleText(events, characters)).toBe('红烛烧到一半，枕下的寒意还留在她指尖。');
    const turn = buildNarrativeTurnFromStoryEvents({ conversation: chat, events, characters });
    expect(turn?.blocks).toEqual([
      expect.objectContaining({ actorKind: 'narrator', displayMode: 'paragraph', text: '红烛烧到一半，枕下的寒意还留在她指尖。' }),
    ]);
  });

  it('scores story event quality with hooks, concrete scene detail, speech, and choice tradeoffs', () => {
    const strong = evaluateStoryEventQuality([
      { type: 'narration', text: '雨水顺着旧医院走廊的窗缝往下流，墙上的新鲜血迹还没有干，门后的脚步声忽然停住。' },
      { type: 'speech', characterId: 'lin', text: '不要碰那道血迹，先看护士的反应。' },
      {
        type: 'choice_point',
        choices: [
          { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', risk: '激怒护士', reward: '得到停电线索' },
          { label: '让主角检查墙上的新鲜血迹', prompt: '主角检查血迹', risk: '暴露位置', reward: '发现新证据' },
        ],
      },
    ]);
    const weak = evaluateStoryEventQuality([
      { type: 'narration', text: '他们继续往前走。' },
      { type: 'choice_point', choices: [{ label: '推进剧情', prompt: '推进剧情' }] },
    ]);

    expect(strong.score).toBeGreaterThan(80);
    expect(strong.labels).toEqual(expect.arrayContaining([
      'has_narration',
      'has_speech',
      'has_choice_point',
      'concrete_scene',
      'has_story_hook',
      'choices_have_tradeoffs',
    ]));
    expect(strong.gaps).not.toContain('missing_story_hook');
    expect(weak.score).toBeLessThan(strong.score);
    expect(weak.gaps).toEqual(expect.arrayContaining(['weak_concrete_scene', 'missing_story_hook', 'no_character_speech']));
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
        actorKind: 'narrator',
        displayMode: 'paragraph',
        text: '别往前走。',
      }),
    ]));
  });

  it('drops author-note narration while keeping visible scene execution', () => {
    const events = normalizeStoryEvents([
      { type: 'narration', text: '接下来剧情将围绕护士的隐瞒展开，并安排用户在追问和搜证之间做选择。' },
      { type: 'narration', text: '本轮需要先承接用户选择，随后展示风险和收益。' },
      { type: 'narration', text: '月奴把托盘放在门边，指尖在袖口里轻轻攥了一下。' },
      { type: 'narration', text: '接下来他伸手推开档案室的门，门轴发出一声低哑的响。' },
    ]);

    expect(events).toEqual([
      { type: 'narration', text: '月奴把托盘放在门边，指尖在袖口里轻轻攥了一下。' },
      { type: 'narration', text: '接下来他伸手推开档案室的门，门轴发出一声低哑的响。' },
    ]);
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

  it('drops near-duplicate story text from previous narrative messages while keeping new progress', () => {
    const previousMessages = [{
      id: 'previous-story',
      chatId: 'story-1',
      type: 'ai' as const,
      senderId: 'narrator',
      senderName: '旁白',
      content: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好。',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'previous-turn',
          turnKind: 'narrative_beat' as const,
          povActorId: 'narrator',
          blocks: [
            {
              id: 'previous-prose',
              actorId: 'narrator',
              actorKind: 'narrator' as const,
              kind: 'prose' as const,
              displayMode: 'paragraph' as const,
              text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把手里的粥碗在矮几上端端正正地摆好。',
            },
            {
              id: 'previous-speech',
              actorId: 'nurse',
              actorKind: 'character' as const,
              kind: 'dialogue' as const,
              displayMode: 'bubble' as const,
              characterId: 'nurse',
              text: '回小姐，奴婢铺床的时候，没觉得有什么不平整的。',
            },
          ],
        },
      },
    }];

    const events = normalizeStoryEvents([
      { type: 'narration', text: '月奴的脊背在听见这句话的瞬间僵了一下，像一根被突然拉紧的琴弦。她没有立刻转身，而是先把粥碗端端正正搁在矮几上。' },
      { type: 'speech', characterId: 'nurse', text: '回小姐……奴婢铺床的时候，没觉得有什么不平整的。' },
      { type: 'narration', text: '门外忽然响起第二个人的脚步声，月奴的脸色终于变了。' },
      { type: 'speech', characterId: 'lin', text: '外面还有人。' },
    ], { previousMessages });

    expect(events).toEqual([
      { type: 'narration', text: '门外忽然响起第二个人的脚步声，月奴的脸色终于变了。' },
      { type: 'speech', characterId: 'lin', speakerName: undefined, text: '外面还有人。' },
    ]);
  });

  it('drops delayed selected-choice echoes and short repeated dialogue from story events', () => {
    const previousMessages = [{
      id: 'selected-choice',
      chatId: 'story-1',
      type: 'user' as const,
      senderId: 'user',
      senderName: '我',
      content: '我选择：追问月奴：你避开了，还是那个人避开了你？',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      metadata: {
        storyChoiceSelection: {
          branchId: 'ask',
          label: '追问月奴：你避开了，还是那个人避开了你？',
          prompt: '你避开了，还是那个人避开了你？',
          choiceEpoch: 2,
        },
      },
    }, {
      id: 'previous-line',
      chatId: 'story-1',
      type: 'ai' as const,
      senderId: 'narrator',
      senderName: '旁白',
      content: '',
      emotion: 0,
      timestamp: 2,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'previous-turn',
          turnKind: 'narrative_beat' as const,
          povActorId: 'narrator',
          blocks: [{
            id: 'old-speech',
            actorId: 'nurse',
            actorKind: 'character' as const,
            kind: 'dialogue' as const,
            displayMode: 'bubble' as const,
            characterId: 'nurse',
            text: '小姐说是梳子，那就是梳子吧。',
          }],
        },
      },
    }];

    const events = normalizeStoryEvents([
      { type: 'narration', text: '沈清婉的声音落进烛火里，月奴的呼吸明显顿了一下。' },
      { type: 'speech', characterId: 'nurse', text: '小姐，那个人比我快。我还没看清他的脸，他已经拐过廊角了。' },
      { type: 'speech', speakerName: '沈清婉', text: '你避开了，还是那个人避开了你？' },
      { type: 'speech', characterId: 'nurse', text: '小姐说是梳子，那就是梳子吧。' },
      { type: 'speech', characterId: 'nurse', text: '奴婢遇见了人。那个人没有避开奴婢，奴婢也没有避开那个人。' },
    ], { previousMessages });

    expect(events).toEqual([
      { type: 'narration', text: '沈清婉的声音落进烛火里，月奴的呼吸明显顿了一下。' },
      { type: 'speech', characterId: 'nurse', speakerName: undefined, text: '小姐，那个人比我快。我还没看清他的脸，他已经拐过廊角了。' },
      { type: 'speech', characterId: 'nurse', speakerName: undefined, text: '奴婢遇见了人。那个人没有避开奴婢，奴婢也没有避开那个人。' },
    ]);
  });

  it('builds a novel-continuity writing state from the latest story node', () => {
    const messages = [{
      id: 'story-node-1',
      chatId: 'story-1',
      type: 'ai' as const,
      senderId: 'narrator',
      senderName: '旁白',
      content: '',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'turn-1',
          turnKind: 'narrative_beat' as const,
          povActorId: 'narrator',
          blocks: [
            {
              id: 'p1',
              actorId: 'narrator',
              actorKind: 'narrator' as const,
              kind: 'prose' as const,
              displayMode: 'paragraph' as const,
              text: '烛火跳了一下，月奴的指尖在袖口里攥紧。她看向门外，像是在等那个人再敲第二声。',
            },
            {
              id: 's1',
              actorId: 'nurse',
              actorKind: 'character' as const,
              kind: 'dialogue' as const,
              displayMode: 'bubble' as const,
              characterId: 'nurse',
              text: '小姐，奴婢不是不肯说，是不能在这里说。',
            },
            {
              id: 'p2',
              actorId: 'narrator',
              actorKind: 'narrator' as const,
              kind: 'prose' as const,
              displayMode: 'paragraph' as const,
              text: '烛火又跳了一下，门外那道影子终于从窗纸上退开。',
            },
          ],
        },
      },
    }];
    const conversation = normalizeConversation({
      ...chat,
      scenarioState: {
        phase: 'scene',
        currentScene: { location: '侯府新房', visibleThreat: '门外有人偷听', time: '新婚夜' },
      },
    });

    const state = buildStoryContinuationState({ conversation, messages });
    const prompt = buildStoryContinuationPrompt({ conversation, messages }).join('\n');

    expect(state).toEqual(expect.objectContaining({
      lastVisibleBeat: expect.stringContaining('门外那道影子终于从窗纸上退开'),
      lastSpokenLine: '小姐，奴婢不是不肯说，是不能在这里说。',
      rhythmNotes: expect.arrayContaining([expect.stringContaining('烛火')]),
    }));
    expect(prompt).toContain('next page of one continuous novel');
    expect(prompt).toContain('Previous visible beat ended at');
    expect(prompt).toContain('Start after this moment');
    expect(prompt).not.toContain('Begin from the last visible beat');
    expect(prompt).toContain('Latest spoken line still in the air');
    expect(prompt).toContain('location=侯府新房');
    expect(prompt).toContain('Do not restate the previous transcript');
  });

  it('flags story continuations that restart with recap framing', () => {
    const state = {
      lastVisibleBeat: '烛火又跳了一下，门外那道影子终于从窗纸上退开。',
      lastSpokenLine: '小姐，奴婢不是不肯说，是不能在这里说。',
      entryInstruction: '',
      rhythmNotes: [],
    };

    const quality = evaluateStoryContinuationQuality([
      { type: 'narration', text: '前情：沈清婉发现枕下长剑，月奴站在门边等待她的命令。' },
      { type: 'narration', text: '她重新抬起眼，望向那扇半掩的门。' },
    ], state);

    expect(quality.ok).toBe(false);
    expect(quality.gaps).toContain('starts_with_recap_or_reset');
  });

  it('flags continuations that copy the last visible beat instead of advancing it', () => {
    const state = {
      lastVisibleBeat: '烛火又跳了一下，门外那道影子终于从窗纸上退开。',
      lastSpokenLine: '小姐，奴婢不是不肯说，是不能在这里说。',
      entryInstruction: '',
      rhythmNotes: [],
    };

    const repeated = evaluateStoryContinuationQuality([
      { type: 'narration', text: '烛火又跳了一下，门外那道影子终于从窗纸上退开。沈清婉这才把手从剑柄上移开。' },
    ], state);
    const advanced = evaluateStoryContinuationQuality([
      { type: 'narration', text: '影子退开后，门槛外反而传来一声极轻的衣料摩擦。沈清婉把剑柄压回袖中。' },
    ], state);

    expect(repeated.ok).toBe(false);
    expect(repeated.gaps).toContain('repeats_last_visible_beat');
    expect(advanced.ok).toBe(true);
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

  it('opens a decision early when visible pressure already has clues, stakes, and relationship tension', () => {
    const pressureReadyChat = normalizeConversation({
      ...chat,
      scenarioState: {
        phase: 'scene',
        sceneBeatCount: 2,
        currentScene: { location: '旧医院走廊', visibleThreat: '护士开始隐瞒停电记录', presentActorIds: ['lin', 'nurse'] },
        openQuestions: ['停电记录是谁改过的？'],
        clues: ['墙边的新鲜血迹'],
        stakes: ['护士可能反咬一口'],
        relationshipShifts: ['林医生开始怀疑护士'],
      },
    });
    const pressureThinChat = normalizeConversation({
      ...chat,
      scenarioState: {
        phase: 'scene',
        sceneBeatCount: 2,
        currentScene: { location: '旧医院走廊', visibleThreat: '走廊尽头传来脚步声' },
      },
    });

    expect(resolveStoryBeatPlan(pressureReadyChat)).toEqual(expect.objectContaining({
      beatKind: 'decision',
      choicePolicy: 'require',
      reason: 'visible story pressure is ready for a meaningful choice',
    }));
    expect(resolveStoryBeatPlan(pressureThinChat)).toEqual(expect.objectContaining({
      beatKind: 'new_pressure',
      choicePolicy: 'allow',
    }));
  });

  it('adds a visible reading panel when a story beat opens choices', () => {
    const turn = buildNarrativeTurnFromStoryEvents({
      conversation: normalizeConversation({
        ...chat,
        scenarioState: {
          phase: 'scene',
          currentScene: {
            summary: '林医生在旧医院发现被撕掉的病历。',
            updatedAt: 1,
          },
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
          currentScene: {
            summary: '林医生在旧医院发现被撕掉的病历。',
            updatedAt: 1,
          },
          stakes: ['激怒护士'],
        },
      }),
      narrativeTurn: turn,
      choices: [
        { label: '林医生追问昨晚停电记录', prompt: '林医生追问昨晚停电记录', risk: '激怒护士', reward: '得到线索' },
        { label: '顾凌霄封住后窗退路', prompt: '顾凌霄封住后窗退路', risk: '暴露位置', reward: '找到证据' },
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
        branches: [
          { branchId: 'ask', label: '追问停电记录', status: 'chosen', choiceEpoch: 2 },
          { branchId: 'blood', label: '检查墙上的新鲜血迹', status: 'completed', choiceEpoch: 2 },
        ],
        openQuestions: ['旧医院为什么停电？'],
        clues: [],
        stakes: [],
        relationshipShifts: [],
      },
    });
    const assets = extractStoryAssets({
      conversation: choiceChat,
      characters,
      choices: [{ label: '让护士检查血迹', prompt: '检查血迹', risk: '暴露位置', reward: '发现证据' }],
      summary: '护士承认停电时有人进入档案室。',
      message: {
        content: '清晨的旧医院走廊里，护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。',
        metadata: {},
      },
    });
    expect(assets).toEqual(expect.objectContaining({
      openQuestions: expect.arrayContaining(['旧医院为什么停电？']),
      clues: expect.arrayContaining(['清晨的旧医院走廊里，护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。']),
      stakes: expect.arrayContaining(['暴露位置', '发现证据']),
      relationshipShifts: expect.arrayContaining(['清晨的旧医院走廊里，护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。']),
      storyGoal: '查清旧医院失踪案',
      storySituation: '护士承认停电时有人进入档案室。',
      currentScene: expect.objectContaining({
        location: '旧医院走廊',
        time: '清晨',
        visibleThreat: expect.stringContaining('停电'),
        presentActorIds: expect.arrayContaining(['lin', 'nurse']),
      }),
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
      discoveredClues: expect.arrayContaining(['清晨的旧医院走廊里，护士承认停电时有人进入档案室，她开始怀疑林医生隐瞒真相。']),
      lastChoiceLabels: ['追问停电记录'],
    }));

    const updatedHistory = updateChoiceHistoryOutcome(choiceChat, '护士承认停电时有人进入档案室。', assets);
    expect(updatedHistory[0]).toEqual(expect.objectContaining({
      outcome: '护士承认停电时有人进入档案室。',
      impact: expect.stringContaining('关系变化：清晨的旧医院走廊里，护士承认停电时有人进入档案室'),
    }));
    expect(updateChoiceHistoryOutcome(choiceChat, '雨声沿着屋檐落下，众人沉默地望向窗外。', {
      ...assets,
      clues: [],
      stakes: [],
      relationshipShifts: [],
      openQuestions: [],
    })).toEqual(choiceChat.scenarioState?.choiceHistory);
    const recapWithImpact = buildChapterRecap({
      conversation: normalizeConversation({
        ...choiceChat,
        scenarioState: { ...(choiceChat.scenarioState || {}), choiceHistory: updatedHistory },
      }),
      storyAssets: assets,
      summary: '护士承认停电时有人进入档案室。',
      openedChoice: false,
      nextSceneBeatCount: 4,
    });
    expect(recapWithImpact?.choiceImpacts).toEqual([
      expect.stringContaining('关系变化：清晨的旧医院走廊里，护士承认停电时有人进入档案室'),
    ]);

    const prompt = buildStoryAssetPrompt(normalizeConversation({
      ...choiceChat,
      scenarioState: { ...(choiceChat.scenarioState || {}), ...assets, choiceHistory: updatedHistory, chapterRecap: recap },
    }));
    expect(prompt).toEqual(expect.arrayContaining([
      expect.stringContaining('Use these story assets as continuity anchors'),
      expect.stringContaining('Before inventing an unrelated new clue'),
      expect.stringContaining('Respect the user-selected path as canon'),
      expect.stringContaining('Make the next beat visibly inherit at least one prior choice outcome'),
      expect.stringContaining('Current chapter goal: 查清旧医院失踪案'),
      expect.stringContaining('Current scene:'),
      expect.stringContaining('Current situation: 护士承认停电时有人进入档案室。'),
      expect.stringContaining('outcome=护士承认停电时有人进入档案室。'),
      expect.stringContaining('impact=关系变化：清晨的旧医院走廊里，护士承认停电时有人进入档案室'),
      expect.stringContaining('Unchosen branches for continuity only: epoch 2 unchosen=检查墙上的新鲜血迹'),
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
