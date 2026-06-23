import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation } from '../../types/chat';
import { runOneRound } from '../chatEngine';
import { generateResponse } from '../aiClient';
import { runSessionActionExecutor } from '../sessionActionExecutors/sessionActionExecutorRegistry';
import { STORY_ENGINE } from './storyEngine';

vi.mock('../aiClient', () => ({
  generateResponse: vi.fn(async () => JSON.stringify({
    content: '',
    extraMessages: null,
    storyEvents: [
      { type: 'narration', text: '旁白正文推进到新的线索。雨声顺着侯府后檐往下落，偏院门口的青苔被踩出一道深色的痕。她没有立刻往前，而是先把灯笼举高，让光从门缝里探进去；那点光没有照见人，只照见地上拖过的水印，像有人刚从后院井边回来。风从廊下穿过，带出一股潮湿的药味，和袖口残留的艾草味搅在一起。她想起方才窗纸上那道影子退开时的停顿，忽然明白对方不是逃走，而是在等她做出判断。门内又响了一声，很轻，像指甲碰到木盒边缘。她的手指压住门环，没有推开，只让铁环在掌心里冷下去。这个停顿让院子里的每一处声音都变得清楚：远处巡夜人的梆子、墙根积水里落下的瓦灰、还有屋里某个人刻意压低的呼吸。等到那呼吸终于乱了一拍，她才知道自己已经逼近了答案。她往后退了半步，故意让鞋底擦过碎瓦，给门里的人一个可以误判的声音。屋内果然有布料掠过桌角的窸窣，随后是一件硬物被仓促放回盒中的轻响。她没有急着拆穿，只把灯笼移向门轴，照见那里新蹭掉的一点漆皮；漆皮下面的木色很浅，说明这扇门刚被人从里面用力抵过。她伸手摸了摸门框，指腹沾到一点细粉，凉而干，不像墙灰，更像药柜里磨碎后没来得及收净的石灰。院外的梆子敲到第三下时，她终于把这些零散的线索拼在一起：屋里那个人不是被困住的受害者，而是在销毁某件能指向后院井口的东西。她把灯笼挂到门侧铁钩上，空出右手去按袖中的短刀。刀柄被雨气浸得发冷，她握住它时，才发现掌心也全是冷汗。' },
    ],
  })),
}));

function buildStoryChat() {
  return normalizeConversation({
    id: 'story-1',
    type: 'group',
    mode: 'scripted_play',
    sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: 'story',
    topic: '主线',
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    memberIds: ['a'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    scenarioState: {
      phase: 'branch',
      choiceEpoch: 1,
      selectedChoiceEpoch: 1,
      branches: [
        { branchId: 'main', label: '主线', status: 'available', choiceEpoch: 1 },
        { branchId: 'hidden', label: '暗线', status: 'chosen', choiceEpoch: 1 },
      ],
    },
    worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('STORY_ENGINE', () => {
  it('keeps running after a selected story branch resolves', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = { ...(chat.scenarioState || {}), phase: 'branch' };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: { content: '暗线继续推进', type: 'ai', senderId: 'a' },
    });
    const scenarioState = result.chatPatch.scenarioState;
    expect(scenarioState).toEqual(expect.objectContaining({ phase: 'scene', choiceEpoch: 1, selectedChoiceEpoch: undefined, sceneBeatCount: 1 }));
    expect(scenarioState?.branches?.filter((branch) => branch.status === 'available' && branch.choiceEpoch === 2)).toHaveLength(0);
  });

  it('opens a fresh choice only when the message carries story choices', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = { ...(chat.scenarioState || {}), phase: 'scene', sceneBeatCount: 3 };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        content: '冲突终于逼近门口',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '主角推门进入旧宅', prompt: '主角推门进入旧宅' },
            { label: '同伴低声劝阻主角', prompt: '同伴低声劝阻主角' },
          ],
        },
      },
    });
    const scenarioState = result.chatPatch.scenarioState;
    expect(scenarioState).toEqual(expect.objectContaining({ phase: 'choice', choiceEpoch: 2, selectedChoiceEpoch: undefined, sceneBeatCount: 0 }));
    expect(scenarioState?.branches?.filter((branch) => branch.status === 'available' && branch.choiceEpoch === 2)).toHaveLength(2);
    expect(scenarioState).toEqual(expect.objectContaining({
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
      storyBeatReason: 'runtime is waiting for user decision',
    }));
  });

  it('uses chapter_update events as the chapter index title source', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = { phase: 'scene', sceneBeatCount: 0, choiceEpoch: 1, branches: [] };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        id: 'chapter-start',
        timestamp: 100,
        content: '红烛烧到一半，枕下的寒意还留在她指尖。',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyEvents: [
            { type: 'chapter_update', title: '枕下长剑', summary: '沈清婉发现枕下长剑。', status: 'active' },
            { type: 'narration', text: '红烛烧到一半，枕下的寒意还留在她指尖。' },
          ],
        },
      } as never,
    });
    expect(result.chatPatch.scenarioState?.storyChapters).toEqual([
      expect.objectContaining({
        index: 1,
        title: '枕下长剑',
        summary: '沈清婉发现枕下长剑。',
        status: 'active',
        startMessageId: 'chapter-start',
        openedAt: 100,
      }),
    ]);
    expect(result.chatPatch.scenarioState?.storyProtocolDiagnostics?.map((item) => item.code)).not.toContain('chapter_title_missing');
  });

  it('records a protocol error when a required decision beat has no valid model choices', async () => {
    const chat = buildStoryChat();
    chat.memberIds = ['a', 'b'];
    chat.scenarioState = {
      phase: 'scene',
      sceneBeatCount: 3,
      choiceEpoch: 1,
      branches: [],
      currentScene: { location: '旧医院走廊', presentActorIds: ['a', 'b'], visibleThreat: '护士开始隐瞒停电记录' },
      openQuestions: ['停电记录是谁改过的？'],
      clues: ['墙边的新鲜血迹'],
      stakes: ['护士可能反咬一口'],
    };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [{ id: 'a', name: '林医生' }, { id: 'b', name: '护士' }] as never,
      message: {
        content: '冲突已经逼到走廊尽头，但模型没有给出选项。',
        type: 'ai',
        senderId: 'narrator',
      },
    });
    const scenarioState = result.chatPatch.scenarioState;
    expect(scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      choiceEpoch: 1,
      sceneBeatCount: 4,
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));
    expect(scenarioState?.branches).toEqual([]);
    expect(scenarioState?.storyProtocolDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'choice_required_missing', level: 'error' }),
    ]));
  });

  it('records a protocol error when explicit director choices use internal let wording', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      phase: 'scene',
      sceneBeatCount: 3,
      choiceEpoch: 1,
      branches: [],
      readerRole: 'director',
      currentScene: { location: '旧医院走廊', visibleThreat: '护士开始隐瞒停电记录' },
      openQuestions: ['停电记录是谁改过的？'],
      clues: ['墙边的新鲜血迹'],
      stakes: ['护士可能反咬一口'],
    };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [{ id: 'a', name: '林医生' }, { id: 'b', name: '护士' }] as never,
      message: {
        content: '冲突逼近选择点。',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
            { label: '让主角检查墙上的血迹', prompt: '主角检查血迹', intent: '探索', risk: '暴露位置', reward: '发现新证据' },
          ],
        },
      },
    });
    expect(result.chatPatch.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      choiceEpoch: 1,
      readerRole: 'director',
    }));
    expect(result.chatPatch.scenarioState?.branches).toEqual([]);
    expect(result.chatPatch.scenarioState?.storyProtocolDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'choice_subject_mismatch', level: 'error' }),
      expect.objectContaining({ code: 'choice_required_missing', level: 'error' }),
    ]));
  });

  it('suppresses model choices during establish beats', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = { phase: 'scene', sceneBeatCount: 0, choiceEpoch: 1, branches: [] };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        content: '刚开场模型误给了选项',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '立刻进入地下室', prompt: '进入地下室' },
            { label: '立刻质问院长', prompt: '质问院长' },
          ],
        },
      },
    });

    expect(result.chatPatch.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      choiceEpoch: 1,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
      storyBeatReason: 'build visible pressure before choices',
    }));
    expect(result.chatPatch.scenarioState?.branches).toEqual([]);
  });

  it('does not create a new choice after every ordinary scene beat', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = { phase: 'scene', choiceEpoch: 1, branches: [] };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: { content: '雨声沿着屋檐落下，众人继续向旧宅深处走去。', type: 'ai', senderId: 'narrator' },
    });
    const scenarioState = result.chatPatch.scenarioState;
    expect(scenarioState).toEqual(expect.objectContaining({ phase: 'scene', choiceEpoch: 1, selectedChoiceEpoch: undefined }));
    expect(scenarioState?.branches).toEqual([]);
  });

  it('does not reopen legacy branches when the committed message has no story choices', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      phase: 'scene',
      choiceEpoch: 1,
      branches: [
        { branchId: 'legacy-1', label: '旧分支一', status: 'available', choiceEpoch: 1 },
        { branchId: 'legacy-2', label: '旧分支二', status: 'available', choiceEpoch: 1 },
      ],
    };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: { content: '旁白继续推进，没有新选择。', type: 'ai', senderId: 'narrator' },
    });

    expect(result.chatPatch.scenarioState).toEqual(expect.objectContaining({ phase: 'scene', choiceEpoch: 1 }));
  });

  it('normalizes concrete character action and dialogue choices from message metadata', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = { ...(chat.scenarioState || {}), phase: 'scene', sceneBeatCount: 3 };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        content: '暗线继续推进',
        type: 'ai',
        senderId: 'a',
        metadata: {
          storyChoices: [
            { label: ' 让角色追上黑衣人 ', prompt: '角色追上黑衣人' },
            { label: '让角色追上黑衣人', prompt: '重复选项' },
            { label: '说出钥匙藏在哪里', prompt: '角色说出钥匙藏在哪里', intent: '逼问', risk: '暴露钥匙线索', reward: '知道钥匙位置' },
          ],
        },
      },
    });
    const labels = result.chatPatch.scenarioState?.branches?.filter((branch) => branch.choiceEpoch === 2).map((branch) => branch.label);
    expect(labels).toEqual(['让角色追上黑衣人', '说出钥匙藏在哪里']);
    expect(result.chatPatch.scenarioState?.branches?.find((branch) => branch.label === '说出钥匙藏在哪里')).toEqual(expect.objectContaining({
      intent: '逼问',
      risk: '暴露钥匙线索',
      reward: '知道钥匙位置',
      description: '意图：逼问；风险：暴露钥匙线索；收益：知道钥匙位置',
    }));
  });

  it('extracts story assets and feeds them into future prompt context', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      ...(chat.scenarioState || {}),
      phase: 'scene',
      sceneBeatCount: 3,
      openQuestions: ['旧医院为什么停电？'],
      clues: [],
      stakes: [],
      relationshipShifts: [],
    };
    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        content: '门后到底是谁？墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
            { label: '让主角检查墙上的血迹', prompt: '主角检查血迹', intent: '探索', risk: '暴露位置', reward: '发现新证据' },
          ],
        },
      },
    });

    const scenarioState = result.chatPatch.scenarioState;
    expect(scenarioState?.openQuestions).toEqual(expect.arrayContaining([
      '旧医院为什么停电？',
      '门后到底是谁？',
      '墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。',
    ]));
    expect(scenarioState?.clues).toEqual(expect.arrayContaining(['墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。']));
    expect(scenarioState?.stakes).toEqual(expect.arrayContaining(['激怒护士', '得到停电线索', '暴露位置', '发现新证据']));
    expect(scenarioState?.relationshipShifts).toEqual(expect.arrayContaining(['墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。']));
    expect(scenarioState?.currentScene).toEqual(expect.objectContaining({
      visibleThreat: expect.stringContaining('血迹'),
      summary: expect.stringContaining('门后到底是谁'),
    }));
    expect(scenarioState?.currentScene?.location).toBeUndefined();
    expect(scenarioState?.chapterMemory).toContain('门后到底是谁');
    expect(scenarioState?.chapterRecap).toEqual(expect.objectContaining({
      title: '新的抉择点',
      discoveredClues: expect.arrayContaining(['墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。']),
      unresolvedQuestions: expect.arrayContaining(['门后到底是谁？']),
      stakes: expect.arrayContaining(['激怒护士', '得到停电线索']),
      beatCount: 0,
    }));

    const prompt = STORY_ENGINE.buildGenerationPromptContext?.({
      conversation: { ...chat, scenarioState },
      characters: [],
      messages: [],
      speaker: { id: 'narrator', name: '旁白' } as never,
    });
    expect(prompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('Use these story assets as continuity anchors'),
      expect.stringContaining('Current scene:'),
      expect.stringContaining('Latest chapter recap'),
      expect.stringContaining('Open questions to preserve or answer deliberately'),
      expect.stringContaining('Known clues to reuse or reframe'),
      expect.stringContaining('Current stakes'),
    ]));
  });

  it('keeps the full story-room loop coherent from choice opening to branch consequence', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      ...(chat.scenarioState || {}),
      phase: 'scene',
      sceneBeatCount: 3,
      choiceEpoch: 1,
      branches: [],
      openQuestions: [],
      clues: [],
      stakes: [],
      relationshipShifts: [],
      choiceHistory: [],
    };

    const choiceResult = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        content: '门后到底是谁？墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
            { label: '让主角检查墙上的血迹', prompt: '主角检查血迹', intent: '探索', risk: '暴露位置', reward: '发现新证据' },
          ],
        },
      },
    });
    const choiceState = choiceResult.chatPatch.scenarioState;
    expect(choiceState).toEqual(expect.objectContaining({
      phase: 'choice',
      choiceEpoch: 2,
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));
    expect(choiceState?.branches?.filter((branch) => branch.status === 'available' && branch.choiceEpoch === 2)).toHaveLength(2);

    const choiceChat = normalizeConversation({
      ...chat,
      scenarioState: { ...(chat.scenarioState || {}), ...(choiceState || {}) },
      worldState: { ...chat.worldState, ...(choiceResult.chatPatch.worldState || {}) },
    });
    const selectedBranch = choiceChat.scenarioState?.branches?.find((branch) => branch.label === '让林医生追问护士昨晚去向');
    expect(selectedBranch?.branchId).toBeTruthy();
    const branchResult = runSessionActionExecutor(choiceChat, {
      type: 'choose_story_branch',
      actorId: 'user',
      payload: { branchId: selectedBranch?.branchId, prompt: selectedBranch?.prompt },
    });
    expect(branchResult).toBeTruthy();
    expect(branchResult?.chatPatch).toBeTruthy();
    const branchPatch = branchResult?.chatPatch;
    if (!branchPatch) throw new Error('Expected story branch action to return a chat patch');
    expect(branchPatch.scenarioState).toEqual(expect.objectContaining({
      phase: 'branch',
      storyBeatKind: 'consequence',
      storyChoicePolicy: 'forbid',
      selectedChoiceEpoch: 2,
      selectedChoice: expect.objectContaining({
        label: '让林医生追问护士昨晚去向',
        prompt: '林医生逼问护士',
        risk: '激怒护士',
        reward: '得到停电线索',
      }),
      choiceHistory: [expect.objectContaining({
        label: '让林医生追问护士昨晚去向',
        risk: '激怒护士',
        reward: '得到停电线索',
      })],
      branches: expect.arrayContaining([
        expect.objectContaining({ label: '让林医生追问护士昨晚去向', status: 'chosen', choiceEpoch: 2 }),
        expect.objectContaining({ label: '让主角检查墙上的血迹', status: 'completed', choiceEpoch: 2 }),
      ]),
    }));

    const branchChat = normalizeConversation({
      ...choiceChat,
      scenarioState: { ...(choiceChat.scenarioState || {}), ...(branchPatch.scenarioState || {}) },
      worldState: { ...choiceChat.worldState, ...(branchPatch.worldState || {}) },
    });
    const consequencePrompt = STORY_ENGINE.buildGenerationPromptContext?.({ conversation: branchChat, characters: [], messages: [], speaker: { id: 'narrator', name: '旁白' } as never });
    expect(consequencePrompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('This turn is the immediate consequence of the user choice'),
      expect.stringContaining('Selected choice: 让林医生追问护士昨晚去向'),
      expect.stringContaining('Risk that should become visible or start to cost something: 激怒护士'),
      expect.stringContaining('Reward/opportunity that should become visible or be partially earned: 得到停电线索'),
    ]));
    const consequenceResult = await STORY_ENGINE.onMessageCommitted({
      conversation: branchChat,
      characters: [],
      message: {
        content: '林医生逼问护士后，护士承认停电时有人进入档案室，代价是她开始拒绝继续同行。',
        type: 'ai',
        senderId: 'narrator',
      },
    });
    expect(consequenceResult.chatPatch.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      choiceEpoch: 2,
      selectedChoiceEpoch: undefined,
      selectedChoice: null,
      sceneBeatCount: 1,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
    }));
    expect(consequenceResult.chatPatch.scenarioState?.choiceHistory).toHaveLength(1);
    expect(consequenceResult.chatPatch.scenarioState?.choiceHistory?.[0]).toEqual(expect.objectContaining({
      label: '让林医生追问护士昨晚去向',
      outcome: expect.stringContaining('护士承认停电时有人进入档案室'),
      impact: expect.stringContaining('关系变化：林医生逼问护士后'),
    }));
    expect(consequenceResult.chatPatch.scenarioState?.chapterRecap?.choiceImpacts).toEqual([
      expect.stringContaining('关系变化：林医生逼问护士后'),
    ]);
    expect(consequenceResult.chatPatch.scenarioState?.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '让主角检查墙上的血迹', status: 'completed', choiceEpoch: 2 }),
    ]));
    expect(consequenceResult.chatPatch.scenarioState?.chapterMemory).toContain('护士承认停电时有人进入档案室');

    const followupPrompt = STORY_ENGINE.buildGenerationPromptContext?.({
      conversation: normalizeConversation({
        ...branchChat,
        scenarioState: { ...(branchChat.scenarioState || {}), ...(consequenceResult.chatPatch.scenarioState || {}) },
      }),
      characters: [],
      messages: [],
      speaker: { id: 'narrator', name: '旁白' } as never,
    });
    expect(followupPrompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('outcome=林医生逼问护士后'),
    ]));
  });

  it('consumes the selected branch once and records a diagnostic when the consequence is unresolved', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      phase: 'branch',
      choiceEpoch: 2,
      selectedChoiceEpoch: 2,
      selectedChoice: {
        branchId: 'ask',
        label: '让林医生追问护士昨晚去向',
        prompt: '林医生逼问护士说出停电时的真相',
        risk: '激怒护士',
        reward: '得到停电线索',
        choiceEpoch: 2,
      },
      storyDirection: '林医生逼问护士说出停电时的真相',
      choiceHistory: [{
        branchId: 'ask',
        label: '让林医生追问护士昨晚去向',
        prompt: '林医生逼问护士说出停电时的真相',
        risk: '激怒护士',
        reward: '得到停电线索',
        choiceEpoch: 2,
      }],
      branches: [
        { branchId: 'ask', label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士说出停电时的真相', status: 'chosen', choiceEpoch: 2 },
      ],
    };

    const result = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [],
      message: {
        content: '雨声沿着屋檐落下，走廊里的灯光轻轻晃了一下。',
        type: 'ai',
        senderId: 'narrator',
      },
    });

    expect(result.chatPatch.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      sceneBeatCount: 1,
      selectedChoiceEpoch: undefined,
      selectedChoice: null,
      storyDirection: undefined,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
    }));
    expect(result.chatPatch.scenarioState?.choiceHistory?.[0]).not.toHaveProperty('outcome');
    expect(result.chatPatch.scenarioState?.storyProtocolDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'choice_consequence_unresolved',
        level: 'error',
      }),
    ]));
  });

  it('does not append duplicate choice history when the same epoch is selected again before state catches up', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      phase: 'choice',
      choiceEpoch: 2,
      branches: [
        { branchId: 'ask', label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', status: 'available', choiceEpoch: 2 },
        { branchId: 'blood', label: '让主角检查墙上的血迹', prompt: '主角检查血迹', status: 'available', choiceEpoch: 2 },
      ],
      choiceHistory: [
        { branchId: 'ask', label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', choiceEpoch: 2, chosenAt: 10 },
      ],
    };

    const duplicate = runSessionActionExecutor(chat, {
      type: 'choose_story_branch',
      actorId: 'user',
      payload: { branchId: 'ask', prompt: '林医生逼问护士' },
    });

    if (!duplicate?.chatPatch) throw new Error('Expected duplicate branch action to produce a chat patch');
    expect(duplicate?.runtimeEvents?.[0]?.metrics).toEqual(expect.objectContaining({ duplicate: true }));
    expect(duplicate.chatPatch.scenarioState).toBeUndefined();
  });

  it('runs a readable long story rhythm from consequence to pressure before the next decision', async () => {
    const choiceChat = buildStoryChat();
    choiceChat.memberIds = ['lin', 'nurse'];
    choiceChat.scenarioState = {
      phase: 'choice',
      sceneBeatCount: 0,
      choiceEpoch: 2,
      branches: [
        { branchId: 'ask', label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', status: 'available', choiceEpoch: 2, risk: '激怒护士', reward: '得到停电线索' },
        { branchId: 'blood', label: '让主角检查墙上的血迹', prompt: '主角检查血迹', status: 'available', choiceEpoch: 2, risk: '暴露位置', reward: '发现新证据' },
      ],
      openQuestions: ['旧医院为什么停电？'],
      clues: ['墙上的新鲜血迹'],
      stakes: ['护士可能反咬一口'],
      relationshipShifts: [],
      choiceHistory: [],
    };
    const branchResult = runSessionActionExecutor(choiceChat, {
      type: 'choose_story_branch',
      actorId: 'user',
      payload: { branchId: 'ask', prompt: '林医生逼问护士' },
    });
    if (!branchResult?.chatPatch) throw new Error('Expected story branch action to return a chat patch');
    const branchChat = normalizeConversation({
      ...choiceChat,
      scenarioState: { ...(choiceChat.scenarioState || {}), ...(branchResult.chatPatch.scenarioState || {}) },
      worldState: { ...choiceChat.worldState, ...(branchResult.chatPatch.worldState || {}) },
    });

    const consequenceResult = await STORY_ENGINE.onMessageCommitted({
      conversation: branchChat,
      characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
      message: {
        content: '林医生逼问护士后，护士承认停电时有人进入档案室，代价是她开始拒绝继续同行。',
        type: 'ai',
        senderId: 'narrator',
      },
    });
    const afterConsequence = normalizeConversation({
      ...branchChat,
      scenarioState: { ...(branchChat.scenarioState || {}), ...(consequenceResult.chatPatch.scenarioState || {}) },
    });
    expect(afterConsequence.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      sceneBeatCount: 1,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
      selectedChoice: null,
    }));

    const pressureResult = await STORY_ENGINE.onMessageCommitted({
      conversation: afterConsequence,
      characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
      message: {
        content: '旧医院走廊忽然再次停电，档案室门缝里露出新鲜血迹，护士的手指攥紧袖口，像还在隐瞒另一个名字。',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '让林医生立刻打开档案室门', prompt: '林医生打开档案室门', risk: '暴露自己已经掌握停电线索', reward: '直接确认血迹来源' },
            { label: '让护士说出袖口里藏着什么', prompt: '护士交代袖口里的东西', risk: '激怒护士彻底沉默', reward: '得到她隐瞒的名字' },
          ],
        },
      },
    });
    const afterPressure = normalizeConversation({
      ...afterConsequence,
      scenarioState: { ...(afterConsequence.scenarioState || {}), ...(pressureResult.chatPatch.scenarioState || {}) },
    });
    expect(afterPressure.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      sceneBeatCount: 2,
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));
    expect(afterPressure.scenarioState?.branches?.filter((branch) => branch.choiceEpoch === 3)).toHaveLength(0);

    const decisionResult = await STORY_ENGINE.onMessageCommitted({
      conversation: afterPressure,
      characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
      message: {
        content: '走廊尽头传来第二个人的脚步声，档案室门锁却从里面轻轻响了一下，林医生必须决定先抓住哪条线。',
        type: 'ai',
        senderId: 'narrator',
        metadata: {
          storyChoices: [
            { label: '让林医生推开档案室门查看里面的人', prompt: '林医生推门查看档案室', risk: '惊动门内的人', reward: '确认谁进入过档案室' },
            { label: '让护士守住走廊尽头拦下脚步声', prompt: '护士守住走廊尽头', risk: '护士可能趁机传递消息', reward: '阻止第二个人逃走' },
          ],
        },
      },
    });
    expect(decisionResult.chatPatch.scenarioState).toEqual(expect.objectContaining({
      phase: 'choice',
      choiceEpoch: 3,
      sceneBeatCount: 0,
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));
    expect(decisionResult.chatPatch.scenarioState?.branches?.filter((branch) => branch.choiceEpoch === 3).map((branch) => branch.label)).toEqual([
      '让林医生推开档案室门查看里面的人',
      '让护士守住走廊尽头拦下脚步声',
    ]);

    const secondChoiceChat = normalizeConversation({
      ...afterPressure,
      scenarioState: { ...(afterPressure.scenarioState || {}), ...(decisionResult.chatPatch.scenarioState || {}) },
    });
    const secondBranch = secondChoiceChat.scenarioState?.branches?.find((branch) => branch.label === '让护士守住走廊尽头拦下脚步声');
    expect(secondBranch?.branchId).toBeTruthy();
    const secondBranchResult = runSessionActionExecutor(secondChoiceChat, {
      type: 'choose_story_branch',
      actorId: 'user',
      payload: { branchId: secondBranch?.branchId, prompt: secondBranch?.prompt },
    });
    if (!secondBranchResult?.chatPatch) throw new Error('Expected second story branch action to return a chat patch');
    const secondConsequenceChat = normalizeConversation({
      ...secondChoiceChat,
      scenarioState: { ...(secondChoiceChat.scenarioState || {}), ...(secondBranchResult.chatPatch.scenarioState || {}) },
      worldState: { ...secondChoiceChat.worldState, ...(secondBranchResult.chatPatch.worldState || {}) },
    });
    expect(secondConsequenceChat.scenarioState).toEqual(expect.objectContaining({
      phase: 'branch',
      selectedChoice: expect.objectContaining({
        label: '让护士守住走廊尽头拦下脚步声',
        risk: '护士可能趁机传递消息',
        reward: '阻止第二个人逃走',
      }),
    }));

    const secondConsequenceResult = await STORY_ENGINE.onMessageCommitted({
      conversation: secondConsequenceChat,
      characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
      message: {
        content: '护士守住走廊尽头时，果然有人想趁黑逃走。她拦住那个人，却也露出自己袖口里藏着的纸条，林医生终于确认有人在传递停电名单。',
        type: 'ai',
        senderId: 'narrator',
      },
    });
    const finalState = secondConsequenceResult.chatPatch.scenarioState;
    expect(finalState).toEqual(expect.objectContaining({
      phase: 'scene',
      choiceEpoch: 3,
      selectedChoice: null,
      selectedChoiceEpoch: undefined,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
    }));
    expect(finalState?.choiceHistory).toHaveLength(2);
    expect(finalState?.choiceHistory?.[0]).toEqual(expect.objectContaining({
      label: '让林医生追问护士昨晚去向',
      outcome: expect.stringContaining('护士承认停电时有人进入档案室'),
      impact: expect.any(String),
    }));
    expect(finalState?.choiceHistory?.[1]).toEqual(expect.objectContaining({
      label: '让护士守住走廊尽头拦下脚步声',
      outcome: expect.stringContaining('有人想趁黑逃走'),
      impact: expect.stringContaining('新线索'),
    }));
    expect(finalState?.chapterRecap?.lastChoiceLabels).toEqual([
      '让林医生追问护士昨晚去向',
      '让护士守住走廊尽头拦下脚步声',
    ]);
    expect(finalState?.chapterRecap?.choiceImpacts).toEqual(expect.arrayContaining([
      expect.stringContaining('新线索'),
    ]));
  });

  it('marks choice phase as branch-only', () => {
    const choicePhase = STORY_ENGINE.getPhaseDefinitions?.(buildStoryChat()).find((phase) => phase.key === 'choice');
    expect(choicePhase?.allowedActions).toEqual(['branch_choose']);
  });

  it('keeps story actions out of the action panel', () => {
    const schema = STORY_ENGINE.getActionSchema?.({ conversation: buildStoryChat(), participants: [] });
    expect(schema?.actions).toEqual([]);
  });

  it('prefers chat-driven story beats over narrator-only prose', () => {
    const sceneChat = buildStoryChat();
    sceneChat.scenarioState = { ...(sceneChat.scenarioState || {}), phase: 'scene' };
    const scenePrompt = STORY_ENGINE.buildGenerationPromptContext?.({ conversation: sceneChat, characters: [], messages: [], speaker: { id: 'narrator', name: '旁白' } as never });
    expect(scenePrompt?.promptPrefix).toContain('chat-driven scene');
    expect(scenePrompt?.promptPrefix).toContain('main visible rhythm should be character chat bubbles');
    expect(scenePrompt?.promptPrefix).toContain('Never let a character inherit another character');
    expect(scenePrompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('beatKind=establish; choicePolicy=forbid'),
      expect.stringContaining('Do not output storyEvents.choice_point'),
      expect.stringContaining('2-5 short character chat bubbles'),
      expect.stringContaining('Do not output alternate rewrites of the same moment'),
      expect.stringContaining('End the beat with at least one trackable hook'),
      expect.stringContaining('Prefer spoken tension'),
    ]));

    const branchChat = buildStoryChat();
    branchChat.scenarioState = { ...(branchChat.scenarioState || {}), phase: 'branch' };
    const branchPrompt = STORY_ENGINE.buildGenerationPromptContext?.({ conversation: branchChat, characters: [], messages: [], speaker: { id: 'narrator', name: '旁白' } as never });
    expect(branchPrompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('beatKind=consequence; choicePolicy=forbid'),
      expect.stringContaining('Do not output alternate rewrites of the same consequence'),
      expect.stringContaining('1 short narrator setup block followed by 2-5 character chat bubbles'),
      expect.stringContaining('End the beat with at least one trackable hook'),
      expect.stringContaining('Each character bubble should be 1-3 sentences'),
    ]));

    const decisionChat = buildStoryChat();
    decisionChat.scenarioState = { ...(decisionChat.scenarioState || {}), phase: 'scene', sceneBeatCount: 3 };
    const decisionPrompt = STORY_ENGINE.buildGenerationPromptContext?.({ conversation: decisionChat, characters: [], messages: [], speaker: { id: 'narrator', name: '旁白' } as never });
    expect(decisionPrompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('beatKind=decision; choicePolicy=require'),
      expect.stringContaining('must reach a real decision point'),
    ]));
  });

  it('injects latest story-node continuity into narrator generation', () => {
    const sceneChat = buildStoryChat();
    sceneChat.scenarioState = {
      ...(sceneChat.scenarioState || {}),
      phase: 'scene',
      currentScene: { location: '侯府新房', visibleThreat: '门外有人偷听' },
    };
    const prompt = STORY_ENGINE.buildGenerationPromptContext?.({
      conversation: sceneChat,
      characters: [],
      messages: [{
        id: 'node-1',
        chatId: sceneChat.id,
        type: 'ai',
        senderId: 'narrator',
        senderName: '旁白',
        content: '',
        timestamp: 1,
        isDeleted: false,
        emotion: 0,
        metadata: {
          narrativeTurn: {
            turnId: 'node-1',
            turnKind: 'narrative_beat',
            povActorId: 'narrator',
            blocks: [{
              id: 'last',
              actorId: 'narrator',
              actorKind: 'narrator',
              kind: 'prose',
              displayMode: 'paragraph',
              text: '月奴的手停在门闩上，门外那道影子终于从窗纸上退开。',
            }],
          },
        },
      }],
      speaker: { id: 'narrator', name: '旁白' } as never,
    });

    const continuityPrompt = prompt?.additionalConstraints?.join('\n') || '';
    expect(prompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('Novel-continuity mode'),
      expect.stringContaining('The previous visible beat is already in the transcript'),
      expect.stringContaining('Start after that final moment'),
      expect.stringContaining('location=侯府新房'),
    ]));
    expect(continuityPrompt).not.toContain('Previous visible beat ended at');
    expect(continuityPrompt).not.toContain('门外那道影子终于从窗纸上退开');
  });

  it('allows speaking when choice phase has no visible story choices', () => {
    const chat = buildStoryChat();
    chat.scenarioState = { phase: 'choice', choiceEpoch: 1, branches: [] };
    expect(STORY_ENGINE.resolveTurnPolicy?.({ conversation: chat, characters: [], messages: [] })).toEqual({ runChat: true, runAction: false, interleaveAction: false });
    expect(STORY_ENGINE.resolveTurnPolicy?.({
      conversation: chat,
      characters: [],
      messages: [{ id: 'm1', chatId: 'story-1', type: 'ai', senderId: 'narrator', senderName: '旁白', content: '选择', timestamp: 1, isDeleted: false, emotion: 0, metadata: { storyChoices: [{ label: '进入旧楼', prompt: '进入旧楼' }, { label: '留在门口追问护士', prompt: '留在门口追问护士' }] } }],
    })).toEqual({ runChat: false, runAction: false, interleaveAction: false });
  });

  it('does not wait for branch-only choices when no message storyChoices exist', () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      phase: 'choice',
      choiceEpoch: 2,
      branches: [
        { branchId: 'fallback-a', label: '让林医生追问护士', status: 'available', choiceEpoch: 2 },
        { branchId: 'fallback-b', label: '让林医生检查血迹', status: 'available', choiceEpoch: 2 },
      ],
    };
    expect(STORY_ENGINE.resolveTurnPolicy?.({
      conversation: chat,
      characters: [],
      messages: [{ id: 'm1', chatId: 'story-1', type: 'ai', senderId: 'narrator', senderName: '旁白', content: '必须选择下一步。', timestamp: 1, isDeleted: false, emotion: 0 }],
    })).toEqual({ runChat: true, runAction: false, interleaveAction: false });
  });

  it('keeps waiting for a story choice when later event messages follow the choice prompt', () => {
    const chat = buildStoryChat();
    chat.scenarioState = { ...(chat.scenarioState || {}), phase: 'choice' };
    expect(STORY_ENGINE.resolveTurnPolicy?.({
      conversation: chat,
      characters: [],
      messages: [
        { id: 'choice-message', chatId: 'story-1', type: 'ai', senderId: 'narrator', senderName: '旁白', content: '选择', timestamp: 1, isDeleted: false, emotion: 0, metadata: { storyChoices: [{ label: '进入旧楼', prompt: '进入旧楼' }, { label: '留在门口追问护士', prompt: '留在门口追问护士' }] } },
        { id: 'event-after-choice', chatId: 'story-1', type: 'event', senderId: 'system', senderName: 'System', content: 'runtime event', timestamp: 2, isDeleted: false, emotion: 0 },
      ],
    })).toEqual({ runChat: false, runAction: false, interleaveAction: false });
  });

  it('only creates narrative turn metadata for the narrator actor', () => {
    const chat = buildStoryChat();
    expect(STORY_ENGINE.buildNarrativeTurnMetadata?.({ conversation: chat, characters: [], messages: [], speaker: { id: 'a', name: '角色' } as never, content: '角色消息' })).toBeNull();
    expect(STORY_ENGINE.buildNarrativeTurnMetadata?.({ conversation: chat, characters: [], messages: [], speaker: { id: 'narrator', name: '旁白' } as never, content: '旁白正文' })?.povActorId).toBe('narrator');
  });

  it('allows the story narrator to drive a round even when not in memberIds', async () => {
    const selected: Array<{ id: string; name: string }> = [];
    await runOneRound(
      buildStoryChat(),
      [],
      [{ id: 'msg-1', chatId: 'story-1', type: 'user', senderId: 'user', senderName: '我', content: '让暗线继续', timestamp: Date.now(), isDeleted: false, emotion: 0, metadata: {} }],
      { provider: 'openai', apiKey: 'test', baseUrl: 'https://example.invalid', model: 'test' },
      {
        onMessageChunk: () => {},
        onMessageComplete: async () => {},
        onSpeakerSelected: (speakerId, speaker) => selected.push({ id: speakerId, name: speaker?.name || '' }),
        onError: (error) => { throw error; },
      },
      [],
    );
    expect(selected).toEqual([{ id: 'narrator', name: '旁白' }]);
  });

  it('does not rotate story-reader generation from narrator to a character after protocol failure', async () => {
    vi.mocked(generateResponse).mockResolvedValue('这是一段没有 storyEvents 的普通正文。');
    const character = {
      id: 'a',
      name: '角色A',
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
    const selected: Array<{ id: string; name: string }> = [];
    await runOneRound(
      buildStoryChat(),
      [character],
      [{ id: 'msg-1', chatId: 'story-1', type: 'user', senderId: 'user', senderName: '我', content: '继续', timestamp: Date.now(), isDeleted: false, emotion: 0, metadata: {} }],
      { provider: 'openai', apiKey: 'test', baseUrl: 'https://example.invalid', model: 'test' },
      {
        onMessageChunk: () => {},
        onMessageComplete: async () => {},
        onSpeakerSelected: (speakerId, speaker) => selected.push({ id: speakerId, name: speaker?.name || '' }),
        onError: () => {},
      },
      [],
    );

    expect(selected).toEqual([{ id: 'narrator', name: '旁白' }]);
  });

});
