import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation } from '../../types/chat';
import { runOneRound } from '../chatEngine';
import { STORY_ENGINE } from './storyEngine';

vi.mock('../aiClient', () => ({
  generateResponse: vi.fn(async () => '旁白正文'),
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
    expect(scenarioState).toEqual(expect.objectContaining({ phase: 'scene', choiceEpoch: 1, selectedChoiceEpoch: 1, sceneBeatCount: 1 }));
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
            { label: '让主角推门进入', prompt: '主角推门进入旧宅' },
            { label: '让同伴低声劝阻', prompt: '同伴低声劝阻主角' },
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
      expect.stringContaining('Latest chapter recap'),
      expect.stringContaining('Open questions to preserve or answer deliberately'),
      expect.stringContaining('Known clues to reuse or reframe'),
      expect.stringContaining('Current stakes'),
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
      expect.stringContaining('Prefer spoken tension'),
    ]));

    const branchChat = buildStoryChat();
    branchChat.scenarioState = { ...(branchChat.scenarioState || {}), phase: 'branch' };
    const branchPrompt = STORY_ENGINE.buildGenerationPromptContext?.({ conversation: branchChat, characters: [], messages: [], speaker: { id: 'narrator', name: '旁白' } as never });
    expect(branchPrompt?.additionalConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('beatKind=consequence; choicePolicy=forbid'),
      expect.stringContaining('1 short narrator setup block followed by 2-5 character chat bubbles'),
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

  it('allows speaking when choice phase has no visible story choices', () => {
    const chat = buildStoryChat();
    chat.scenarioState = { ...(chat.scenarioState || {}), phase: 'choice' };
    expect(STORY_ENGINE.resolveTurnPolicy?.({ conversation: chat, characters: [], messages: [] })).toEqual({ runChat: true, runAction: false, interleaveAction: false });
    expect(STORY_ENGINE.resolveTurnPolicy?.({
      conversation: chat,
      characters: [],
      messages: [{ id: 'm1', chatId: 'story-1', type: 'ai', senderId: 'narrator', senderName: '旁白', content: '选择', timestamp: 1, isDeleted: false, emotion: 0, metadata: { storyChoices: [{ label: '进入旧楼', prompt: '进入旧楼' }, { label: '留在门口追问护士', prompt: '留在门口追问护士' }] } }],
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

});
