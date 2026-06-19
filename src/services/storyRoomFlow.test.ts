import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { buildChatRenderItems } from '../components/chat/chatRenderModel';
import { getNarrativeDisplayBlocks, getNarrativeParagraphBlocks } from '../components/chat/messageBubblePresentation';
import { buildVisibleStoryBranchOptions, findVisibleStoryChoiceSourceMessage, getStoryTailStatus } from '../pages/ChatDetailPage';
import { buildStoryBranchOptions } from './storyChoices';
import { runSessionActionExecutor } from './sessionActionExecutors/sessionActionExecutorRegistry';
import { STORY_ENGINE } from './engines/storyEngine';
import { buildNarrativeTurnFromStoryEvents, buildStoryEventsVisibleText, getStoryChoicesFromEvents, normalizeStoryEvents } from './narrativeRuntime';
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
});
