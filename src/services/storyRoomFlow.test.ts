import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { buildChatRenderItems } from '../components/chat/chatRenderModel';
import { getNarrativeDisplayBlocks, getNarrativeParagraphBlocks } from '../components/chat/messageBubblePresentation';
import { buildVisibleStoryBranchOptions, findVisibleStoryChoiceSourceMessage, getStoryTailStatus } from '../pages/ChatDetailPage';
import { buildStoryBranchOptions } from './storyChoices';
import { runSessionActionExecutor } from './sessionActionExecutors/sessionActionExecutorRegistry';
import { STORY_ENGINE } from './engines/storyEngine';
import { buildNarrativeTurnFromStoryEvents, buildStoryAssetPrompt, buildStoryEventsVisibleText, evaluateStoryEventQuality, getStoryChoicesFromEvents, normalizeStoryEvents } from './narrativeRuntime';
import type { GroupChat } from '../types/chat';
import type { Message, StoryEvent } from '../types/message';

function buildStoryChat(): GroupChat {
  return normalizeConversation({
    id: 'story-flow',
    type: 'group',
    mode: 'scripted_play',
    sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: false },
    modeState: { phase: 'free' },
    name: '旧医院故事',
    topic: '雨夜旧医院',
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    memberIds: ['lin', 'nurse'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    scenarioState: {
      phase: 'scene',
      sceneBeatCount: 3,
      choiceEpoch: 1,
      branches: [],
      openQuestions: ['旧医院为什么停电？'],
      clues: [],
      stakes: [],
      relationshipShifts: [],
      choiceHistory: [],
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

function message(overrides: Partial<Message>): Message {
  return {
    id: 'message-1',
    chatId: 'story-flow',
    type: 'ai',
    senderId: 'narrator',
    senderName: '旁白',
    content: '',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    ...overrides,
  };
}

function storyEventMessage(
  chat: GroupChat,
  overrides: Partial<Message> & { metadata?: Message['metadata'] },
  events: StoryEvent[],
): Message {
  const normalizedEvents = normalizeStoryEvents(events);
  const visibleText = buildStoryEventsVisibleText(normalizedEvents, [
    { id: 'lin', name: '林医生' },
    { id: 'nurse', name: '护士' },
  ] as never);
  const narrativeTurn = buildNarrativeTurnFromStoryEvents({
    conversation: chat,
    events: normalizedEvents,
    characters: [
      { id: 'lin', name: '林医生' },
      { id: 'nurse', name: '护士' },
    ] as never,
  });
  return message({
    ...overrides,
    content: overrides.content ?? visibleText,
    metadata: {
      ...(overrides.metadata || {}),
      storyEvents: normalizedEvents,
      storyChoices: getStoryChoicesFromEvents(normalizedEvents),
      narrativeTurn: narrativeTurn || undefined,
    },
  });
}

async function commitStoryMessage(chat: GroupChat, message: Message): Promise<GroupChat> {
  const commit = await STORY_ENGINE.onMessageCommitted({
    conversation: chat,
    characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
    message,
  });
  return normalizeConversation({
    ...chat,
    scenarioState: { ...(chat.scenarioState || {}), ...(commit.chatPatch.scenarioState || {}) },
    worldState: { ...chat.worldState, ...(commit.chatPatch.worldState || {}) },
  });
}

function chooseStoryBranch(chat: GroupChat, branchLabel: string): GroupChat {
  const branch = chat.scenarioState?.branches?.find((item) => item.label === branchLabel);
  if (!branch) throw new Error(`Expected story branch: ${branchLabel}`);
  const action = runSessionActionExecutor(chat, {
    type: 'choose_story_branch',
    actorId: 'user',
    payload: { branchId: branch.branchId, prompt: branch.prompt },
  });
  if (!action?.chatPatch) throw new Error(`Expected branch action to produce a patch: ${branchLabel}`);
  return normalizeConversation({
    ...chat,
    scenarioState: { ...(chat.scenarioState || {}), ...(action.chatPatch.scenarioState || {}) },
    worldState: { ...chat.worldState, ...(action.chatPatch.worldState || {}) },
  });
}

function assertReadableStoryTurn(events: StoryEvent[], options: { minScore?: number; requireChoices?: boolean } = {}) {
  const quality = evaluateStoryEventQuality(events);
  expect(quality.score).toBeGreaterThanOrEqual(options.minScore ?? 72);
  expect(quality.labels).toEqual(expect.arrayContaining(['has_narration', 'has_speech', 'concrete_scene', 'has_story_hook']));
  expect(quality.gaps).not.toContain('missing_narration');
  expect(quality.gaps).not.toContain('no_character_speech');
  expect(quality.gaps).not.toContain('weak_concrete_scene');
  expect(quality.gaps).not.toContain('missing_story_hook');
  if (options.requireChoices) {
    expect(quality.labels).toEqual(expect.arrayContaining(['has_choice_point', 'choices_have_tradeoffs']));
    expect(quality.gaps).not.toContain('choice_tradeoff_missing');
  }
}

function normalizedVisibleText(events: StoryEvent[]) {
  return buildStoryEventsVisibleText(normalizeStoryEvents(events), [
    { id: 'lin', name: '林医生' },
    { id: 'nurse', name: '护士' },
  ] as never).replace(/\s+/g, '');
}

describe('story room user flow', () => {
  it('keeps choices, selection, consequence, auto-run readiness, and story assets coherent', async () => {
    const chat = buildStoryChat();
    const choiceMessage = storyEventMessage(chat, {
      id: 'choice-source',
      timestamp: 10,
    }, [
      { type: 'narration', text: '门后到底是谁？墙上留下新鲜血迹，林医生开始怀疑护士隐瞒真相。' },
      { type: 'speech', characterId: 'lin', text: '你昨晚停电时，到底去了哪里？' },
      {
        type: 'choice_point',
        choices: [
          { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士', intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
          { label: '让主角检查墙上的血迹', prompt: '主角检查血迹', intent: '探索', risk: '暴露位置', reward: '发现新证据' },
        ],
      },
    ]);

    const choiceCommit = await STORY_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
      message: choiceMessage,
    });
    const choiceChat = normalizeConversation({
      ...chat,
      scenarioState: { ...(chat.scenarioState || {}), ...(choiceCommit.chatPatch.scenarioState || {}) },
      worldState: { ...chat.worldState, ...(choiceCommit.chatPatch.worldState || {}) },
    });
    const options = buildStoryBranchOptions({
      storyChoices: choiceMessage.metadata?.storyChoices,
      branches: choiceChat.scenarioState?.branches,
      choiceEpoch: choiceChat.scenarioState?.choiceEpoch,
      sourceId: choiceMessage.id,
    });

    expect(options.map((option) => option.label)).toEqual([
      '让林医生追问护士昨晚去向',
      '让主角检查墙上的血迹',
    ]);
    const choiceBlocks = getNarrativeDisplayBlocks(choiceMessage);
    expect(choiceBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayMode: 'paragraph', text: expect.stringContaining('墙上留下新鲜血迹') }),
      expect.objectContaining({ displayMode: 'bubble', characterId: 'lin', text: '你昨晚停电时，到底去了哪里？' }),
    ]));
    const selected = options[0];
    const selectionMessage = message({
      id: 'choice-selection',
      type: 'user',
      senderId: 'user',
      senderName: '我',
      content: `我选择：${selected.label}`,
      timestamp: 20,
      metadata: {
        storyChoiceSelection: {
          branchId: selected.value,
          sourceMessageId: choiceMessage.id,
          label: selected.label,
          prompt: selected.prompt,
          intent: selected.intent,
          risk: selected.risk,
          reward: selected.reward,
          choiceEpoch: choiceChat.scenarioState?.choiceEpoch,
        },
      },
    });
    const branchAction = runSessionActionExecutor(choiceChat, {
      type: 'choose_story_branch',
      actorId: 'user',
      payload: { branchId: selected.value, prompt: selected.prompt },
    });
    if (!branchAction?.chatPatch) throw new Error('Expected story branch action to produce a chat patch');
    const branchChat = normalizeConversation({
      ...choiceChat,
      scenarioState: { ...(choiceChat.scenarioState || {}), ...(branchAction.chatPatch.scenarioState || {}) },
      worldState: { ...choiceChat.worldState, ...(branchAction.chatPatch.worldState || {}) },
    });

    expect(branchChat.scenarioState?.phase).toBe('branch');
    expect(branchChat.scenarioState?.selectedChoice).toEqual(expect.objectContaining({
      label: selected.label,
      risk: '激怒护士',
      reward: '得到停电线索',
    }));
    expect(findVisibleStoryChoiceSourceMessage({
      isStoryRoom: true,
      phase: branchChat.scenarioState?.phase,
      messages: [choiceMessage],
    })).toBeNull();
    expect(buildVisibleStoryBranchOptions({
      isStoryRoom: true,
      chat: branchChat,
      sourceMessage: choiceMessage,
    })).toEqual([]);

    const consequenceMessage = storyEventMessage(branchChat, {
      id: 'consequence',
      timestamp: 30,
    }, [
      { type: 'narration', text: '清晨的旧医院走廊里，林医生逼问护士后，护士承认停电时有人进入档案室，代价是她开始拒绝继续同行。' },
      { type: 'speech', characterId: 'nurse', text: '我只看见有人拿着钥匙进去，别再逼我了。' },
    ]);
    const consequenceCommit = await STORY_ENGINE.onMessageCommitted({
      conversation: branchChat,
      characters: [{ id: 'lin', name: '林医生' }, { id: 'nurse', name: '护士' }] as never,
      message: consequenceMessage,
    });
    const sceneChat = normalizeConversation({
      ...branchChat,
      scenarioState: { ...(branchChat.scenarioState || {}), ...(consequenceCommit.chatPatch.scenarioState || {}) },
      worldState: { ...branchChat.worldState, ...(consequenceCommit.chatPatch.worldState || {}) },
    });

    expect(sceneChat.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      selectedChoice: null,
      selectedChoiceEpoch: undefined,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
    }));
    expect(sceneChat.scenarioState?.choiceHistory?.[0]).toEqual(expect.objectContaining({
      label: selected.label,
      outcome: expect.stringContaining('护士承认停电时有人进入档案室'),
    }));
    expect(sceneChat.scenarioState?.currentScene).toEqual(expect.objectContaining({
      location: '旧医院走廊',
      time: '清晨',
      presentActorIds: expect.arrayContaining(['lin', 'nurse']),
      visibleThreat: expect.stringContaining('代价'),
    }));
    const consequenceBlocks = getNarrativeDisplayBlocks(consequenceMessage);
    expect(consequenceBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayMode: 'paragraph', text: expect.stringContaining('护士承认停电时有人进入档案室') }),
      expect.objectContaining({ displayMode: 'bubble', characterId: 'nurse', text: '我只看见有人拿着钥匙进去，别再逼我了。' }),
    ]));

    const renderItems = buildChatRenderItems([choiceMessage, consequenceMessage, selectionMessage]);
    expect(renderItems.map((item) => item.message.id)).toEqual(['choice-source', 'choice-selection', 'consequence']);
    expect(getNarrativeParagraphBlocks(selectionMessage)[0]).toEqual(expect.objectContaining({
      displayMode: 'choice_card',
      text: selected.label,
    }));
    expect(getStoryTailStatus({
      hasRunLoopStatus: false,
      isStoryChoiceSubmitting: false,
    })).toBeNull();
  });

  it('keeps a multi-choice long flow readable, remembered, and non-repetitive', async () => {
    let chat = buildStoryChat();
    const visibleTexts = new Set<string>();
    const recordTurn = (events: StoryEvent[], options?: { minScore?: number; requireChoices?: boolean }) => {
      assertReadableStoryTurn(events, options);
      const text = normalizedVisibleText(events);
      expect(text.length).toBeGreaterThan(30);
      expect(visibleTexts.has(text)).toBe(false);
      visibleTexts.add(text);
    };

    const firstChoiceEvents: StoryEvent[] = [
      { type: 'narration', text: '雨夜的旧医院走廊里，档案室门缝透出一线冷光，墙上的新鲜血迹还没有干。护士站在灯影边缘，手指一直压着袖口，像在藏一把钥匙。' },
      { type: 'speech', characterId: 'lin', text: '停电那十分钟，只有你能进档案室。告诉我，失踪名单到底少了谁？' },
      {
        type: 'choice_point',
        choices: [
          { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士说出停电时谁进过档案室', intent: '逼问', risk: '激怒护士并让她拒绝同行', reward: '得到停电线索' },
          { label: '让主角检查墙上的新鲜血迹', prompt: '主角检查墙上的血迹来源', intent: '搜证', risk: '暴露自己已经发现血迹', reward: '确认血迹是否通向档案室' },
        ],
      },
    ];
    recordTurn(firstChoiceEvents, { requireChoices: true });
    const firstChoiceMessage = storyEventMessage(chat, { id: 'first-choice', timestamp: 10 }, firstChoiceEvents);
    chat = await commitStoryMessage(chat, firstChoiceMessage);
    expect(chat.scenarioState).toEqual(expect.objectContaining({
      phase: 'choice',
      choiceEpoch: 2,
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));

    chat = chooseStoryBranch(chat, '让林医生追问护士昨晚去向');
    expect(chat.scenarioState?.selectedChoice).toEqual(expect.objectContaining({
      label: '让林医生追问护士昨晚去向',
      risk: '激怒护士并让她拒绝同行',
      reward: '得到停电线索',
    }));

    const firstConsequenceEvents: StoryEvent[] = [
      { type: 'narration', text: '林医生把问题压得更低，走廊顶灯忽然闪了一下。护士的眼神从血迹移到档案室门锁上，终于承认停电时有个拿铜钥匙的人进过档案室；代价是她后退半步，明显开始警觉。' },
      { type: 'speech', characterId: 'nurse', text: '我只看见钥匙，不知道那个人的脸。你再逼我，我就不往前走了。' },
    ];
    recordTurn(firstConsequenceEvents);
    chat = await commitStoryMessage(chat, storyEventMessage(chat, { id: 'first-consequence', timestamp: 20 }, firstConsequenceEvents));
    expect(chat.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      selectedChoice: null,
      selectedChoiceEpoch: undefined,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
    }));
    expect(chat.scenarioState?.choiceHistory?.[0]).toEqual(expect.objectContaining({
      label: '让林医生追问护士昨晚去向',
      outcome: expect.stringContaining('拿铜钥匙的人进过档案室'),
      impact: expect.stringMatching(/关系变化|新线索|代价|风险|兑现收益|承接风险/),
    }));

    const pressureEvents: StoryEvent[] = [
      { type: 'narration', text: '档案室门锁里传来极轻的转动声，旧医院走廊的雨味被一股消毒水气味压住。地上的血迹没有通向楼梯，反而在门前断掉，像有人故意把路线擦干净。' },
      { type: 'speech', characterId: 'lin', text: '钥匙是真的，血迹也是真的。现在的问题是，门里的人为什么还没有出来？' },
    ];
    recordTurn(pressureEvents);
    chat = await commitStoryMessage(chat, storyEventMessage(chat, { id: 'pressure', timestamp: 30 }, pressureEvents));
    expect(chat.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));
    expect(chat.scenarioState?.branches?.filter((branch) => Number(branch.choiceEpoch || 0) === 3)).toHaveLength(0);

    const secondChoiceEvents: StoryEvent[] = [
      { type: 'narration', text: '门内的脚步声停在锁后，护士袖口露出一角被雨水洇开的名单。林医生必须在门里的人逃走前决定先抓哪条线。' },
      { type: 'speech', characterId: 'nurse', text: '别开门。名单上的名字如果被看见，我们都会有危险。' },
      {
        type: 'choice_point',
        choices: [
          { label: '让林医生立刻推开档案室门', prompt: '林医生推门确认门里的人和血迹来源', intent: '冒险', risk: '惊动门内的人并暴露已经掌握钥匙线索', reward: '确认谁进入过档案室' },
          { label: '让护士交出袖口里的名单', prompt: '护士交出袖口里被雨水洇开的名单', intent: '揭露', risk: '护士可能彻底失去信任', reward: '得到失踪名单上的缺失名字' },
        ],
      },
    ];
    recordTurn(secondChoiceEvents, { requireChoices: true });
    chat = await commitStoryMessage(chat, storyEventMessage(chat, { id: 'second-choice', timestamp: 40 }, secondChoiceEvents));
    expect(chat.scenarioState).toEqual(expect.objectContaining({
      phase: 'choice',
      choiceEpoch: 3,
      storyBeatKind: 'decision',
      storyChoicePolicy: 'require',
    }));

    chat = chooseStoryBranch(chat, '让护士交出袖口里的名单');
    const continuityBeforeSecondConsequence = buildStoryAssetPrompt(chat).join('\n');
    expect(continuityBeforeSecondConsequence).toContain('Recent user choices');
    expect(continuityBeforeSecondConsequence).toContain('让林医生追问护士昨晚去向');
    expect(continuityBeforeSecondConsequence).toContain('让护士交出袖口里的名单');
    expect(continuityBeforeSecondConsequence).toContain('Unchosen branches for continuity only');
    expect(continuityBeforeSecondConsequence).toContain('让主角检查墙上的新鲜血迹');
    expect(continuityBeforeSecondConsequence).toContain('让林医生立刻推开档案室门');
    expect(continuityBeforeSecondConsequence).toContain('Do not write an unchosen branch as if it happened');

    const secondConsequenceEvents: StoryEvent[] = [
      { type: 'narration', text: '护士把袖口里的名单拍在窗台上，纸角被雨水泡软，缺失的名字旁边压着一枚档案室钥匙印。她没有再退，却把灯关掉，代价是林医生再也看不清门内那个人的脸。' },
      { type: 'speech', characterId: 'nurse', text: '名单给你，但你欠我一次。门里那个人不是我放进去的。' },
    ];
    recordTurn(secondConsequenceEvents);
    chat = await commitStoryMessage(chat, storyEventMessage(chat, { id: 'second-consequence', timestamp: 50 }, secondConsequenceEvents));
    expect(chat.scenarioState).toEqual(expect.objectContaining({
      phase: 'scene',
      choiceEpoch: 3,
      selectedChoice: null,
      selectedChoiceEpoch: undefined,
      storyBeatKind: 'pressure',
      storyChoicePolicy: 'forbid',
    }));
    expect(chat.scenarioState?.choiceHistory).toHaveLength(2);
    expect(chat.scenarioState?.choiceHistory?.[1]).toEqual(expect.objectContaining({
      label: '让护士交出袖口里的名单',
      outcome: expect.stringContaining('名单拍在窗台上'),
      impact: expect.stringMatching(/关系变化|新线索|代价|风险|兑现收益|承接风险/),
    }));
    expect(chat.scenarioState?.chapterRecap).toEqual(expect.objectContaining({
      lastChoiceLabels: ['让林医生追问护士昨晚去向', '让护士交出袖口里的名单'],
      choiceImpacts: expect.arrayContaining([expect.any(String)]),
    }));
    const finalContinuity = buildStoryAssetPrompt(chat).join('\n');
    expect(finalContinuity).toContain('outcome=');
    expect(finalContinuity).toContain('impact=');
    expect(finalContinuity).toContain('Respect the user-selected path as canon');
  });
});
