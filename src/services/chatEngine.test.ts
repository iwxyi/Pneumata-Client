import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import type { Message } from '../types/message';
import type { AIModelProfile } from '../types/settings';
import { __chatEngineTestUtils, generateSpeakerMessage, runOneRound } from './chatEngine';
import { evaluateDuplicateGuard } from './duplicateGuard';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';
import type { SpeakIntent } from './intentEngine';
import type { DirectorIntent } from './directorIntent';
import { useSettingsStore } from '../stores/useSettingsStore';

const generateResponseMock = vi.hoisted(() => vi.fn());

vi.mock('./aiClient', () => ({
  generateResponse: (...args: unknown[]) => generateResponseMock(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-01T14:00:00+08:00'));
});

afterEach(() => {
  vi.useRealTimers();
  useSettingsStore.setState({ developerMode: false });
  delete (globalThis as { __AICHATGROUP_DEBUG_SCHEDULER__?: boolean }).__AICHATGROUP_DEBUG_SCHEDULER__;
});

const speaker = { name: '喜羊羊' } as AICharacter;
const defaultIntent: SpeakIntent = {
  shouldSpeak: true,
  reason: 'test',
  target: 'group',
  stance: 'challenge',
  emotionalTone: 'annoyed',
  delivery: 'short_reply',
  messageShape: 'single_sentence',
};

function buildCharacter(id: string, name: string, patch: Partial<AICharacter> = {}): AICharacter {
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
    ...patch,
  };
}

function buildChat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '羊村大家庭闲聊',
    topic: '最近有什么好玩的事？',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['mei', 'hui'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    sourceChatId: null,
    sourceMemberIds: [],
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: DEFAULT_CONVERSATION_WORLD_STATE,
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  };
}

function buildProfiles(): AIModelProfile[] {
  return [
    {
      id: 'text-default',
      name: '默认文本',
      type: 'text',
      provider: 'openai',
      apiKey: 'text-key',
      baseUrl: 'https://example.test',
      model: 'text-model',
      isDefault: true,
    },
    {
      id: 'image-default',
      name: '默认图片',
      type: 'image',
      provider: 'openai',
      apiKey: 'image-key',
      baseUrl: 'https://example.test',
      model: 'image-model',
      isDefault: true,
    },
  ];
}

function longStorySection(opening: string) {
  return `${opening}雨声贴着檐角往下落，旧宅门前的青苔被踩出一道深色的痕。阿梅没有立刻往前，她先把灯笼举高，让光从门缝里探进去；那点光没有照见人，只照见地上拖过的水印，像有人刚从后院井边回来。风从廊下穿过，带出一股潮湿的药味，和她袖口残留的艾草味搅在一起。她想起方才窗纸上那道影子退开时的停顿，忽然明白对方不是逃走，而是在等她做出判断。门内又响了一声，很轻，像指甲碰到木盒边缘。她的手指压住门环，没有推开，只让铁环在掌心里冷下去。这个停顿让院子里的每一处声音都变得清楚：远处巡夜人的梆子、墙根积水里落下的瓦灰、还有屋里某个人刻意压低的呼吸。等到那呼吸终于乱了一拍，阿梅才知道自己已经逼近了答案。她往后退了半步，故意让鞋底擦过碎瓦，给门里的人一个可以误判的声音。屋内果然有布料掠过桌角的窸窣，随后是一件硬物被仓促放回盒中的轻响。她没有急着拆穿，只把灯笼移向门轴，照见那里新蹭掉的一点漆皮；漆皮下面的木色很浅，说明这扇门刚被人从里面用力抵过。她伸手摸了摸门框，指腹沾到一点细粉，凉而干，不像墙灰，更像药柜里磨碎后没来得及收净的石灰。院外的梆子敲到第三下时，她终于把这些零散的线索拼在一起：屋里那个人不是被困住的受害者，而是在销毁某件能指向后院井口的东西。她抬眼看向门缝，声音压得很低，却足够让里面的人听见。门里没有立刻回应，只有木盒扣锁被慢慢压住的闷声。阿梅知道自己已经没有回头路，于是把灯笼挂到门侧铁钩上，空出右手去摸袖中的短刀。刀柄上的缠线被雨气浸得发冷，她握住它时，才发现自己的掌心也全是冷汗。她没有马上拔刀，只把呼吸放慢，等屋里的人先露出下一次破绽。`;
}

function buildAiMessage(senderId: string, senderName: string, content: string, timestamp = 1): Message {
  return {
    id: `msg-${senderId}-${timestamp}`,
    chatId: 'chat-1',
    type: 'ai',
    senderId,
    senderName,
    content,
    emotion: 0,
    timestamp,
    isDeleted: false,
  };
}

function buildUserMessage(content: string, timestamp = 1): Message {
  return {
    id: `user-${timestamp}`,
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: '用户',
    content,
    emotion: 0,
    timestamp,
    isDeleted: false,
  };
}

function buildMediaDirectorIntent(): DirectorIntent {
  return {
    source: 'user_message',
    beatType: 'answer',
    targetActorIds: ['mei'],
    pressure: 0.98,
    reason: '用户指定角色发送或创作图片。',
    userGuidance: {
      kind: 'media_request',
      rawText: '美羊羊发个灰太狼证件照的图片',
      actorIds: ['mei'],
      mentionedActorIds: ['mei', 'hui'],
      focusText: '美羊羊发个灰太狼证件照的图片',
      beatType: 'answer',
      pressure: 0.98,
      maxTurns: 1,
      reason: '用户指定角色发送或创作图片。',
      mediaRequest: {
        kind: 'image',
        subjectActorIds: ['hui'],
        subjectText: '灰太狼',
        actionText: '发个灰太狼证件照的图片',
      },
    },
  };
}

describe('chatEngine streaming preview', () => {
  it('suppresses incomplete JSON envelope chunks before content is available', () => {
    expect(__chatEngineTestUtils.isPendingJsonEnvelopeChunk('{')).toBe(true);
    expect(__chatEngineTestUtils.isPendingJsonEnvelopeChunk('  {"content"')).toBe(true);
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{', speaker)).toBeNull();
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('```json\n{', speaker)).toBeNull();
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"', speaker)).toBe('');
  });

  it('extracts visible content from partial JSON once content starts streaming', () => {
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"喜羊羊：先别急', speaker)).toBe('先别急');
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"那也不至于', speaker)).toBe('那也不至于');
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('直接纯文本', speaker)).toBe('直接纯文本');
  });

  it('keeps a natural multi-clause reply intact when finalizing the committed message', () => {
    const content = '谁站你这边了？我只是看喜羊羊不顺眼。';
    expect(__chatEngineTestUtils.finalizeResponse(content, defaultIntent, speaker, [])).toBe(content);
  });

  it('builds world event context prompt from attention, calendar, and moments', () => {
    const now = Date.now();
    const chat = buildChat({
      memberIds: ['mei', 'hui', 'user'],
      runtimeEventsV2: [
        {
          id: 'evt-attn',
          conversationId: 'chat-1',
          kind: 'attention_candidate',
          actorIds: ['mei'],
          targetIds: ['user'],
          summary: '用户状态低落，想关心',
          visibility: 'derived_public',
          createdAt: now - 5 * 60_000,
          payload: { targetIds: ['user'], confidence: 0.9, reason: '用户状态低落，想关心' },
        } as never,
        {
          id: 'evt-cal',
          conversationId: 'chat-1',
          kind: 'event_candidate',
          actorIds: ['mei'],
          targetIds: ['mei', 'user'],
          summary: '准备一起吃饭',
          visibility: 'derived_public',
          createdAt: now - 3 * 60_000,
          payload: {
            eventKind: 'social_outing',
            title: '晚餐',
            activityType: '聚餐',
            participantIds: ['mei', 'user'],
            startAt: now + 60 * 60_000,
            timeHint: '今晚 19:00',
            locationHint: '徐汇',
          },
        } as never,
        {
          id: 'evt-moment',
          conversationId: 'chat-1',
          kind: 'artifact',
          actorIds: ['hui'],
          targetIds: ['mei'],
          summary: '灰太狼发了动态',
          visibility: 'derived_public',
          createdAt: now - 20 * 60_000,
          payload: { eventKind: 'post_moment', artifactType: 'moment_text', title: '今天不错', text: '工作收工了' },
        } as never,
      ],
    });
    const prompt = __chatEngineTestUtils.buildWorldEventContextPrompt({
      chat,
      speaker: buildCharacter('mei', '美羊羊'),
      members: [buildCharacter('mei', '美羊羊'), buildCharacter('hui', '灰太狼')],
      now,
    });
    expect(prompt).toContain('World event context:');
    expect(prompt).toContain('Attention state:');
    expect(prompt).toContain('Upcoming schedule:');
    expect(prompt).toContain('Recent social signal:');
  });

  it('builds world influence rules prompt for comfort-first and restraint', () => {
    const now = Date.now();
    const chat = buildChat({
      memberIds: ['mei', 'hui', 'user'],
      relationshipLedger: [{
        pairKey: 'mei->user',
        actorId: 'mei',
        targetId: 'user',
        current: { warmth: 16, competence: 4, trust: 12, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: now - 30 * 60_000,
      }] as never,
      runtimeEventsV2: [{
        id: 'evt-attn',
        conversationId: 'chat-1',
        kind: 'attention_candidate',
        actorIds: ['mei'],
        targetIds: ['user'],
        summary: '用户有点低落',
        visibility: 'derived_public',
        createdAt: now - 5 * 60_000,
        payload: { targetIds: ['user'], confidence: 0.96, reason: '用户有点低落' },
      } as never],
    });
    const prompt = __chatEngineTestUtils.buildWorldEventInfluenceRulesPrompt({
      chat,
      speaker: buildCharacter('mei', '美羊羊'),
      members: [buildCharacter('mei', '美羊羊'), buildCharacter('hui', '灰太狼')],
      now,
    });
    expect(prompt).toContain('World influence rules:');
    expect(prompt).toContain('caring move toward the user');
  });

  it('builds world influence rules for urgent calendar and conflicts', () => {
    const now = Date.now();
    const chat = buildChat({
      memberIds: ['mei', 'hui', 'user'],
      runtimeEventsV2: [
        {
          id: 'evt-1',
          conversationId: 'chat-1',
          kind: 'event_candidate',
          actorIds: ['mei'],
          targetIds: ['mei', 'hui'],
          summary: '约了晚餐',
          visibility: 'derived_public',
          createdAt: now - 60_000,
          payload: {
            eventKind: 'social_outing',
            dedupeKey: 'dinner-1',
            title: '晚餐',
            participantIds: ['mei', 'hui'],
            startAt: now + 2 * 60 * 60_000,
            durationMinutes: 120,
          },
        } as never,
        {
          id: 'evt-2',
          conversationId: 'chat-1',
          kind: 'event_candidate',
          actorIds: ['mei'],
          targetIds: ['mei', 'hui'],
          summary: '又约了电影',
          visibility: 'derived_public',
          createdAt: now - 30_000,
          payload: {
            eventKind: 'social_outing',
            dedupeKey: 'movie-1',
            title: '电影',
            participantIds: ['mei', 'hui'],
            startAt: now + 2.5 * 60 * 60_000,
            durationMinutes: 120,
          },
        } as never,
      ],
    });
    const prompt = __chatEngineTestUtils.buildWorldEventInfluenceRulesPrompt({
      chat,
      speaker: buildCharacter('mei', '美羊羊'),
      members: [buildCharacter('mei', '美羊羊'), buildCharacter('hui', '灰太狼')],
      now,
    });
    expect(prompt).toContain('upcoming schedule');
    expect(prompt).toContain('schedule conflict');
  });

  it('exposes image capability from the default image model when the character is not explicitly bound', () => {
    expect(__chatEngineTestUtils.buildMediaCapabilities({ id: 'char-1', modelProfileIds: {} } as AICharacter, [{
      id: 'image-default',
      name: '默认图片',
      type: 'image',
      provider: 'openai',
      apiKey: 'key',
      baseUrl: 'https://example.test',
      model: 'image-model',
      isDefault: true,
    }])).toEqual({ image: true, audio: false });
  });

  it('uses the model profile array as media profiles when generation receives profile-based api config', () => {
    const profiles: AIModelProfile[] = [{
      id: 'image-default',
      name: '默认图片',
      type: 'image',
      provider: 'openai',
      apiKey: 'key',
      baseUrl: 'https://example.test',
      model: 'image-model',
      isDefault: true,
    }];
    const resolved = __chatEngineTestUtils.resolveMediaProfiles(profiles, undefined);
    expect(resolved).toBe(profiles);
    expect(__chatEngineTestUtils.buildMediaCapabilities({ id: 'char-1', modelProfileIds: {} } as AICharacter, resolved)).toEqual({ image: true, audio: false });
  });

  it('requires a media decision in the prompt contract when image generation is available', () => {
    const contract = buildInlineInteractionContract({
      chat: { id: 'chat-1', memberIds: ['char-1'], runtimeEventsV2: [] } as never,
      speaker: { id: 'char-1', name: '美羊羊' } as AICharacter,
      characters: [{ id: 'char-1', name: '美羊羊' } as AICharacter],
      recentMessages: [
        buildUserMessage('美羊羊发个灰太狼证件照的图片', 1),
        buildAiMessage('char-1', '美羊羊', '来啦，我先构思一下。', 2),
      ],
      mediaCapabilities: { image: true, audio: false },
    });

    expect(contract).toContain('mediaDecision is required when a media capability is available');
    expect(contract).toContain('Do not pretend the user can see a picture');
    expect(contract).toContain('image.prompt must be a complete image-generation prompt');
    expect(contract).toContain('Treat the requested image type as the center of the prompt');
    expect(contract).toContain('milk tea or food image should detail');
    expect(contract).toContain('while keeping them temporary and context-dependent');
    expect(contract).toContain('natural phone camera perspective');
    expect(contract).toContain('keep stable identity anchors across images');
    expect(contract).toContain('按当前请求自然作答；可短可长');
    expect(contract).toContain('deliberate repeated tone, keyword, rhythm, format');
    expect(contract).toContain('accidental template drift');
    expect(contract).toContain('Recent transcript scope');
    expect(contract).toContain('does not repeat raw dialogue');
    expect(contract).not.toContain('美羊羊发个灰太狼证件照的图片');
    expect(contract).not.toContain('来啦，我先构思一下');
    expect(contract).not.toContain('一句自然的群聊回复');
  });

  it('adds authoritative storyEvents for story reader prose, dialogue, and choices', () => {
    const contract = buildInlineInteractionContract({
      chat: buildChat({
        memberIds: ['narrator'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        runtimeEventsV2: [],
      }),
      speaker: { id: 'narrator', name: '旁白' } as AICharacter,
      characters: [{ id: 'narrator', name: '旁白' } as AICharacter],
      recentMessages: [],
    });

    expect(contract).toContain('This is the required shape for story-reader turns');
    expect(contract).toContain('"storyEvents": [');
    expect(contract).toContain('Do not copy the JSON shape with storyEvents=null');
    expect(contract).toContain('must include at least one visible narration or speech event');
    expect(contract).toContain('Story-reader turns must use storyEvents as the authoritative visible story body');
    expect(contract).toContain('"type":"choice_point"');
    expect(contract).toContain('Speech text must be chat-like');
    expect(contract).toContain("Do not let one character inherit another character's private object");
    expect(contract).toContain('Do not output alternate rewrites of the same moment');
    expect(contract).toContain('keep only the final version; do not include both drafts in storyEvents');
    expect(contract).toContain('Write visible scene execution, not author notes');
    expect(contract).toContain('If the user just chose a branch, first show what immediately changes on screen');
    expect(contract).toContain('storyEvents.choice_point is the source of truth');
    expect(contract).toContain('Do not output top-level storyChoices for the primary path');
    expect(contract).not.toContain('"content": ""');
    expect(contract).not.toContain('"extraMessages": null');
    expect(contract).not.toContain('"narrativeText": null');
    expect(contract).not.toContain('"narrativeBlocks": null');
    expect(contract).not.toContain('narrativeBlocks');
    expect(contract).not.toContain('narrativeText');
    expect(contract).not.toContain('按当前请求自然作答');
    expect(contract).not.toContain('content is the first visible chat bubble');
    expect(contract).not.toContain('extraMessages is optional. Use null for one bubble');
    expect(contract).not.toContain('"storyChoices": null');
    expect(contract).not.toContain('storyChoices drives the UI');
  });

  it('asks the model to judge counterpart interaction hints in AI private chats', () => {
    const contract = buildInlineInteractionContract({
      chat: { id: 'chat-1', type: 'ai_direct', memberIds: ['char-1', 'char-2'], runtimeEventsV2: [] } as never,
      speaker: { id: 'char-1', name: '甲' } as AICharacter,
      characters: [{ id: 'char-1', name: '甲' } as AICharacter, { id: 'char-2', name: '乙' } as AICharacter],
      recentMessages: [
        buildAiMessage('char-2', '乙', '我刚才那句话可能有点重。', 1),
      ],
    });

    expect(contract).toContain('In AI direct chats, target the other participant');
    expect(contract).toContain('do not target the speaker or the user unless the user is an actual participant');
    expect(contract).toContain('id=char-2; name=乙');
  });

  it('does not locally force detailed chat requests into a professional longform surface', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '我会这么拆：每个实例单独分支，提交前只 stage 自己改的文件，再 rebase 或 merge 回主线。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const linus = buildCharacter('linus', 'Linus', { expertise: ['Git', '代码管理'] });

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['linus'] }),
      speaker: linus,
      characters: [linus],
      messages: [
        buildUserMessage('详细讲讲你会怎么做？', 1),
      ],
      apiConfig: buildProfiles(),
    });
    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(prompt).toContain('Decide the visible length yourself');
    expect(prompt).not.toContain('Professional form is available');
    expect(message.content).toContain('每个实例单独分支');
  });

  it('removes leaked runtime field names from generated visible content', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: 'eventType先按“未翻案、有人先试锋”落着，你别替任何人往下续。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const empress = buildCharacter('empress', '太后');

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['empress'] }),
      speaker: empress,
      characters: [empress],
      messages: [
        buildUserMessage('继续说。', 1),
      ],
      apiConfig: buildProfiles(),
    });

    expect(message.content).toBe('先按“未翻案、有人先试锋”落着，你别替任何人往下续。');
    expect(message.content).not.toContain('eventType');
  });

  it('commits storyEvents as visible narrator content, narrative blocks, and choices when content is empty', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '',
      storyEvents: [
        { type: 'narration', text: longStorySection('雨水顺着医院旧楼的铁门往下流，门缝里传出断续的敲击声。') },
        { type: 'speech', characterId: 'lin', speakerName: '林医生', text: '不要开那扇门。' },
        {
          type: 'choice_point',
          choices: [
            { label: '让林医生去地下档案室查被撕掉的病历', prompt: '林医生进入地下档案室查病历' },
            { label: '让护士追问昨晚停电记录', prompt: '护士追问停电记录' },
          ],
        },
      ],
      storyChoices: null,
      extraMessages: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const lin = buildCharacter('lin', '林医生');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        memberIds: ['lin'],
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [lin],
      messages: [
        buildAiMessage('narrator', '旁白', '旧楼尽头的灯忽明忽暗。', 1),
        buildUserMessage('开始故事', 2),
      ],
      apiConfig: buildProfiles(),
    });

    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');
    expect(prompt).toContain('You are the story-reader narrative engine');
    expect(prompt).toContain('Return exactly one valid JSON object');
    expect(prompt).toContain('"storyEvents": [');
    expect(prompt).not.toContain('Reply as a chat message');
    expect(prompt).not.toContain('Current speaking intent');
    expect(prompt).not.toContain('Hard constraints for this reply');
    expect(prompt).not.toContain('Response surface:');
    expect(prompt).not.toContain('mediaDecision');
    expect(generateResponseMock.mock.calls[0]?.[4]).toEqual(expect.objectContaining({ responseFormat: 'json' }));
    const chatMessages = (generateResponseMock.mock.calls[0]?.[2] || []) as Array<{ role: string; content: string }>;
    expect(chatMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.stringContaining('旁白: 旧楼尽头的灯忽明忽暗。') }),
    ]));
    expect(chatMessages.some((item) => item.role === 'assistant')).toBe(false);

    expect(message.senderId).toBe('narrator');
    expect(message.content).toContain('雨水顺着医院旧楼的铁门往下流');
    expect(message.content).toContain('林医生：“不要开那扇门。”');
    expect(message.metadata?.storyEvents).toHaveLength(3);
    expect(message.metadata?.storyQuality).toEqual(expect.objectContaining({
      score: expect.any(Number),
      labels: expect.arrayContaining(['has_narration', 'has_speech', 'has_choice_point', 'concrete_scene', 'has_story_hook']),
    }));
    expect(message.metadata?.storyQuality?.gaps).not.toContain('missing_story_hook');
    expect(message.metadata?.storyChoices).toEqual([
      { label: '让林医生去地下档案室查被撕掉的病历', prompt: '林医生进入地下档案室查病历' },
      { label: '让护士追问昨晚停电记录', prompt: '护士追问停电记录' },
    ]);
    expect(message.metadata?.narrativeTurn?.povActorId).toBe('narrator');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorKind: 'narrator', displayMode: 'paragraph' }),
      expect.objectContaining({ actorKind: 'character', displayMode: 'bubble', characterId: 'lin' }),
      expect.objectContaining({ actorKind: 'system', displayMode: 'system_panel', text: expect.stringContaining('新的抉择点') }),
    ]);
  });

  it('retries story-reader generations that restart the scene instead of continuing the latest beat', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '',
        storyEvents: [
          { type: 'narration', text: '前情：沈清婉发现枕下长剑，月奴站在门边等待她的命令。' },
          { type: 'narration', text: '她重新抬起眼，望向那扇半掩的门。' },
        ],
        storyChoices: null,
        extraMessages: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '',
        storyEvents: [
          { type: 'narration', text: longStorySection('影子退开后，门槛外反而传来一声极轻的衣料摩擦。沈清婉把剑柄压回袖中。') },
          { type: 'speech', characterId: 'nurse', speakerName: '月奴', text: '小姐，外头的人还没走远。' },
        ],
        storyChoices: null,
        extraMessages: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');
    const nurse = buildCharacter('nurse', '月奴');
    const previousBeat: Message = {
      id: 'prev-story',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'narrator',
      senderName: '旁白',
      content: '',
      emotion: 0,
      timestamp: 2,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'turn-prev',
          turnKind: 'narrative_beat',
          sceneId: 'main',
          phase: 'scene',
          povActorId: 'narrator',
          blocks: [
            {
              id: 'p1',
              actorId: 'narrator',
              actorKind: 'narrator',
              kind: 'prose',
              displayMode: 'paragraph',
              text: '烛火又跳了一下，门外那道影子终于从窗纸上退开。',
            },
            {
              id: 's1',
              actorId: 'nurse',
              actorKind: 'character',
              kind: 'dialogue',
              displayMode: 'bubble',
              characterId: 'nurse',
              text: '小姐，奴婢不是不肯说，是不能在这里说。',
            },
          ],
        },
      },
    };

    const message = await generateSpeakerMessage({
      chat: buildChat({
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        memberIds: ['nurse'],
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [nurse],
      messages: [buildUserMessage('继续故事', 1), previousBeat],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    const firstPrompt = String(generateResponseMock.mock.calls[0]?.[1] || '');
    expect(firstPrompt).toContain('900-1600 Chinese characters');
    expect(firstPrompt).toContain('1200-2200 Chinese characters');
    const retryPrompt = String(generateResponseMock.mock.calls[1]?.[1] || '');
    expect(retryPrompt).toContain('故事房下一节没有按小说连续阅读接续');
    expect(retryPrompt).toContain('Story continuity retry');
    expect(retryPrompt).toContain('Start after the final visible moment');
    expect(retryPrompt).not.toContain('Previous visible beat ended at');
    expect(retryPrompt).not.toContain('门外那道影子终于从窗纸上退开');
    expect(retryPrompt).not.toContain('Rejected draft:');
    expect(message.content).toContain('影子退开后');
    expect(message.content).not.toContain('前情');
  });

  it('blocks semantic near-duplicates even when wording shifts', () => {
    const result = evaluateDuplicateGuard({
      content: '先单开一个分支，提交前只暂存你自己的文件。',
      messages: [
        buildAiMessage('mei', '美羊羊', '先开独立分支，提交前只 stage 自己改动的文件。', 1),
      ],
      speakerId: 'mei',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("exactly repeats the speaker's recent line");
  });

  it('injects runtime role constraint when the same speaker dominates recent airtime', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '先把最关键的一点说清楚。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const analyst = buildCharacter('linus', 'Linus', { expertise: ['架构设计'] });

    await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['linus', 'mei'] }),
      speaker: analyst,
      characters: [analyst, buildCharacter('mei', '美羊羊')],
      messages: [
        buildAiMessage('linus', 'Linus', '上一轮我先说。', 1),
        buildAiMessage('linus', 'Linus', '我再补一条。', 2),
        buildAiMessage('mei', '美羊羊', '我插一句。', 3),
        buildAiMessage('linus', 'Linus', '还有一个点。', 4),
        buildAiMessage('linus', 'Linus', '最后再补一句。', 5),
        buildUserMessage('详细分析一下这个取舍。', 6),
      ],
      apiConfig: buildProfiles(),
      generationContext: {
        promptContext: {
          styleProfile: 'analytical_room',
        },
      },
    });
    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(prompt).toContain('Runtime Role Constraint');
    expect(prompt).toContain('Add one new dimension');
    expect(prompt).toContain('Keep this turn compact');
  });

  it('treats collective essay requests as deliverable tasks instead of ordinary banter', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '如果让我认真写，我会先说：AI不会简单地替代人类。\n\n它更像一面放大镜，把人的能力差异、制度漏洞和创造力一起放大。\n\n所以我不想只问它会不会抢走工作，而要问人类准备怎样重新安排自己的价值。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const susu = buildCharacter('susu', '穿搭博主苏苏');
    const luxun = buildCharacter('luxun', '鲁智深');

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['susu', 'luxun'] }),
      speaker: susu,
      characters: [susu, luxun],
      messages: [
        buildUserMessage('你怎么看待AI在未来对人类的影响？每个人写一篇800字作文', Date.now()),
      ],
      apiConfig: buildProfiles(),
      speakerSelection: {
        speakerId: 'susu',
        policy: { source: 'user_guidance_lock', lockedActorIds: ['susu', 'luxun'] },
      },
    });
    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(prompt).toContain('## User Guidance Override');
    expect(prompt).toContain('Requested actor(s): 穿搭博主苏苏、鲁智深');
    expect(prompt).toContain('Honor explicit output form, quantity, and length requirements');
    expect(prompt).toContain('produce that deliverable');
    expect(prompt).toContain('escaped newline sequences');
    expect(prompt).toContain('Do not put a heading marker, separator, and the whole article on one line');
    expect(prompt).toContain('Longform');
    expect(message.content).toContain('\n\n它更像一面放大镜');
    expect(message.metadata?.runtimeDecision?.directorIntent?.targetActorIds).toEqual(['susu', 'luxun']);
    expect(message.metadata?.runtimeDecision?.speakerSelection).toMatchObject({
      speakerId: 'susu',
      policy: { source: 'user_guidance_lock', lockedActorIds: ['susu', 'luxun'] },
    });
    expect(message.metadata?.runtimeDecision?.responseSurface?.kind).toBe('longform');
    expect(message.metadata?.runtimeDecision?.responseSurface?.basis || []).toContain('topic:longform-writing-task');
  });

  it('honors disabled role actions from mode config and strips visible action asides', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '（轻轻挠头）这个我先记下来，等会儿接着说。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const xiao = buildCharacter('xiao', '潇潇');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['xiao'],
        showRoleActions: undefined,
        modeConfig: {
          freeSpeaking: true,
          allowInterruptions: true,
          allowPrivateThreads: true,
          allowDirectorInterventions: true,
          showRoleActions: false,
        },
      }),
      speaker: xiao,
      characters: [xiao],
      messages: [buildUserMessage('等下', 1)],
      apiConfig: buildProfiles(),
    });
    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(prompt).toContain('Visible role action policy');
    expect(prompt).toContain('Do not include standalone action narration');
    expect(message.content).toBe('这个我先记下来，等会儿接着说。');
  });

  it('preserves parsed image decisions and converts them into queued attachments', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '来啦，你看这杯杨枝甘露。',
      mediaDecision: {
        image: {
          shouldGenerate: true,
          reason: '用户明确想看图片',
          prompt: 'A cute WeChat-style photo of mango pomelo sago dessert on a table',
          altText: '一杯杨枝甘露甜品',
        },
      },
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const metadata = __chatEngineTestUtils.buildMessageMetadata({
      decision: parsed?.mediaDecision,
      capabilities: { image: true, audio: false },
      content: parsed?.content || '',
    });

    expect(metadata?.attachments).toHaveLength(1);
    expect(metadata?.attachments?.[0]).toMatchObject({
      kind: 'image',
      status: 'queued',
      promptText: 'A cute WeChat-style photo of mango pomelo sago dessert on a table',
      altText: '一杯杨枝甘露甜品',
    });
  });

  it('normalizes singleton social event hints from model envelopes', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '这事别在这里说，回头我单独找你。',
      interactionHints: null,
      socialEventHints: {
        eventKind: 'pair_private_thread',
        participantIds: ['a', 'b'],
        targetIds: ['b'],
        confidence: 90,
        visibilityPlan: 'conversation_private',
      },
      conflictFocus: null,
    }));

    expect(parsed?.socialEventHints).toEqual([expect.objectContaining({
      eventKind: 'pair_private_thread',
      participantIds: ['a', 'b'],
      targetIds: ['b'],
      confidence: 0.9,
      visibilityPlan: 'conversation_private',
    })]);
  });

  it('rejects story narrativeBlocks as a legacy body and retries with storyEvents', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: '雨水从旧宅檐角连成一线。\n\n门缝里透出一截冷光。',
        narrativeBlocks: [
          { actorId: 'narrator', kind: 'prose', text: '雨水从旧宅檐角连成一线。' },
          { actorId: 'mei', actorName: '阿梅', kind: 'dialogue', text: '别靠太近。' },
          { actorId: 'narrator', kind: 'prose', text: '门缝里透出一截冷光。' },
        ],
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: longStorySection('雨水从旧宅檐角连成一线。') },
          { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '别靠太近。' },
          { type: 'narration', actorId: 'narrator', text: '门缝里透出一截冷光。' },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [], chapterMemory: '阿梅在旧宅门口听见门内有脚步声。', stakes: ['暴露位置'] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(generateResponseMock.mock.calls[1]?.[1]).toContain('old top-level body container');
    expect(generateResponseMock.mock.calls[1]?.[1]).not.toContain('legacy narrativeBlocks');
    expect(generateResponseMock.mock.calls[1]?.[1]).not.toContain('narrativeBlocks=null');
    expect(message.content).toBe('');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: expect.stringContaining('雨水从旧宅檐角连成一线。') }),
      expect.objectContaining({ actorId: 'mei', actorName: '阿梅', actorKind: 'character', kind: 'dialogue', displayMode: 'bubble', text: '别靠太近。' }),
      expect.objectContaining({ actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: '门缝里透出一截冷光。' }),
    ]);
    expect(message.metadata?.contextText).toContain('别靠太近。');
  });

  it('commits storyEvents as blocks and choice metadata', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'narration', actorId: 'narrator', text: longStorySection('门锁轻轻弹开。') },
        { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '现在只能进去。' },
        { type: 'choice_point', choices: [
          { label: '让阿梅推门进入', prompt: '阿梅推门进入旧宅' },
          { label: '让阿梅先退回院子', prompt: '阿梅退回院子观察窗户' },
        ] },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [], chapterMemory: '阿梅在旧宅门口听见门内有脚步声。', stakes: ['暴露位置'] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(message.content).toBe('');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: expect.stringContaining('门锁轻轻弹开。') }),
      expect.objectContaining({ actorId: 'mei', actorName: '阿梅', actorKind: 'character', kind: 'dialogue', displayMode: 'bubble', text: '现在只能进去。' }),
      expect.objectContaining({ actorKind: 'system', kind: 'system_note', displayMode: 'system_panel', text: expect.stringContaining('新的抉择点') }),
    ]);
    expect(message.metadata?.narrativeTurn?.blocks.at(-1)?.text).toContain('当前压力已经形成，下一步会改变这一章的走向。');
    expect(message.metadata?.narrativeTurn?.blocks.at(-1)?.text).toContain('取舍：暴露位置');
    expect(message.metadata?.storyChoices).toEqual([
      { label: '让阿梅推门进入', prompt: '阿梅推门进入旧宅' },
      { label: '让阿梅先退回院子', prompt: '阿梅退回院子观察窗户' },
    ]);
  });

  it('matches story event speech actors by actorName', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'narration', actorId: 'narrator', text: longStorySection('门轴上的水珠落了下来。') },
        { type: 'speech', actorName: '阿梅', text: '别碰那盏灯。' },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(message.metadata?.narrativeTurn?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: 'mei', actorName: '阿梅', actorKind: 'character', kind: 'dialogue', displayMode: 'bubble', text: '别碰那盏灯。' }),
    ]));
  });

  it('matches story dialogue actors by name without leaking unknown actor diagnostics in normal mode', async () => {
    generateResponseMock.mockReset();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateResponseMock.mockResolvedValue(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'narration', actorId: 'narrator', text: longStorySection('门轴上的水珠落了下来。') },
        { type: 'speech', actorId: '阿梅', text: '别碰那盏灯。' },
        { type: 'speech', actorId: 'ghost', actorName: '幽灵角色', text: '我也拿着她手里的当归。' },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(message.metadata?.narrativeTurn?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: 'mei', actorName: '阿梅', actorKind: 'character', kind: 'dialogue', displayMode: 'bubble', text: '别碰那盏灯。' }),
      expect.objectContaining({ actorId: 'narrator', actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: '我也拿着她手里的当归。' }),
    ]));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('logs unknown story dialogue actors only in developer mode', async () => {
    generateResponseMock.mockReset();
    useSettingsStore.setState({ developerMode: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    generateResponseMock.mockResolvedValue(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'narration', actorId: 'narrator', text: longStorySection('门轴上的水珠落了下来。') },
        { type: 'speech', actorId: 'ghost', actorName: '幽灵角色', text: '我也拿着她手里的当归。' },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(warnSpy).toHaveBeenCalledWith('[story-reader] Unknown narrative dialogue actor; downgraded to narrator prose.', expect.objectContaining({ actorId: 'ghost', actorName: '幽灵角色' }));
    debugSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('projects storyEvent speech with actor names as character bubbles', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'narration', actorId: 'narrator', text: longStorySection('门轴上的水珠落了下来。') },
        { type: 'speech', actorName: '江采薇', text: '皇后娘娘说的是……奴婢在针线房学过几年绣活。' },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const caiwei = buildCharacter('caiwei', '江采薇', { group: '宫女' });

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'caiwei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, caiwei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(message.metadata?.narrativeTurn?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: 'caiwei', actorName: '江采薇', actorKind: 'character', kind: 'dialogue', displayMode: 'bubble', text: '皇后娘娘说的是……奴婢在针线房学过几年绣活。' }),
    ]));
  });

  it('treats narrator dialogue blocks as prose without unknown actor warnings', async () => {
    generateResponseMock.mockReset();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateResponseMock.mockResolvedValue(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'speech', actorId: '旁白', text: longStorySection('门后的风忽然停了。') },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorId: 'narrator', actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: expect.stringContaining('门后的风忽然停了。') }),
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rejects story narrativeText instead of committing it as body text', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: '走廊尽头的灯忽明忽暗，潮湿墙面渗出旧照片一样的阴影。',
        storyEvents: null,
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: longStorySection('走廊尽头的灯忽明忽暗，潮湿墙面渗出旧照片一样的阴影。') },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(generateResponseMock.mock.calls[1]?.[1]).toContain('old top-level body container');
    expect(generateResponseMock.mock.calls[1]?.[1]).not.toContain('narrativeText');
    expect(generateResponseMock.mock.calls[1]?.[1]).not.toContain('legacy narrativeBlocks');
    expect(message.content).toBe('');
    expect(message.extraMessages).toBeNull();
    expect(message.metadata?.narrativeTurn?.blocks[0]?.text).toContain('走廊尽头的灯忽明忽暗，潮湿墙面渗出旧照片一样的阴影。');
    expect(message.metadata?.contextText).toContain('走廊尽头的灯忽明忽暗');
  });

  it('retries internally repetitive storyEvents without feeding the rejected draft back into the prompt', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          {
            type: 'narration',
            actorId: 'narrator',
            text: '沈清婉没有立刻接话，只把铜钱推到烛火边缘。月奴的目光从铜钱上移开，落在自己裙摆上那道白色粉末痕迹上。月奴的目光从铜钱上移开，落在自己裙摆上那道白色粉末痕迹上，像是又把半截话咽了回去。',
          },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: longStorySection('沈清婉把梳子放回妆台，屋里安静得只剩烛芯轻响。') },
          { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '别靠太近。' },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');
    const previousBeat: Message = {
      id: 'prev-story-repetition',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'narrator',
      senderName: '旁白',
      content: '',
      emotion: 0,
      timestamp: 2,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'turn-prev-repetition',
          turnKind: 'narrative_beat',
          sceneId: 'main',
          phase: 'scene',
          povActorId: 'narrator',
          blocks: [
            {
              id: 'p1',
              actorId: 'narrator',
              actorKind: 'narrator',
              kind: 'prose',
              displayMode: 'paragraph',
              text: '月奴说完这句话，终于抬起眼看向沈清婉。',
            },
            {
              id: 's1',
              actorId: 'mei',
              actorKind: 'character',
              kind: 'dialogue',
              displayMode: 'bubble',
              characterId: 'mei',
              text: '奴婢认得那道刻痕。',
            },
          ],
        },
      },
    };

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'branch', choiceEpoch: 2, branches: [], selectedChoice: { branchId: 'b1', label: '追问月奴', prompt: '追问月奴' }, selectedChoiceEpoch: 2 },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('我选择：追问月奴', 1), previousBeat],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    const retryPrompt = String(generateResponseMock.mock.calls[1]?.[1] || '');
    expect(retryPrompt).toContain('Story continuity retry');
    expect(retryPrompt).toContain('repeats_internal_story_beat');
    expect(retryPrompt).not.toContain('Rejected draft:');
    expect(retryPrompt).not.toContain('Previous visible beat ended at');
    expect(retryPrompt).not.toContain('月奴说完这句话');
    expect(retryPrompt).not.toContain('奴婢认得那道刻痕');
    expect(retryPrompt).not.toContain('白色粉末痕迹');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorKind: 'narrator', displayMode: 'paragraph', text: expect.stringContaining('沈清婉把梳子放回妆台，屋里安静得只剩烛芯轻响。') }),
      expect.objectContaining({ actorId: 'mei', actorName: '阿梅', displayMode: 'bubble', text: '别靠太近。' }),
    ]);
  });

  it('retries story-reader sections that are too short to feel like a complete novel beat', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: '门锁响了一下。' },
          { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '有人在里面。' },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: longStorySection('门锁响了一下。') },
          { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '有人在里面。' },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    const retryPrompt = String(generateResponseMock.mock.calls[1]?.[1] || '');
    expect(retryPrompt).toContain('visible story section was too short');
    expect(retryPrompt).toContain('complete novel-like section');
    expect(retryPrompt).not.toContain('mediaDecision');
    expect(retryPrompt).not.toContain('content says or implies');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorKind: 'narrator', displayMode: 'paragraph', text: expect.stringContaining('门锁响了一下。') }),
      expect.objectContaining({ actorId: 'mei', actorName: '阿梅', displayMode: 'bubble', text: '有人在里面。' }),
    ]));
  });

  it('accepts a longer story section when every event advances the same committed beat', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValueOnce(JSON.stringify({
      narrativeText: null,
      storyEvents: [
        { type: 'narration', actorId: 'narrator', text: longStorySection('侯府东侧偏门半掩着，湿冷灯影照出一把新换的铜锁；锁舌边缘没有旧划痕，说明有人刚刚改过出入口。') },
        { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '这把锁不是府里的旧物，钥匙孔还没磨出痕。' },
        { type: 'narration', actorId: 'narrator', text: '门槛下的泥点被雨水泡开，泥里混着细碎香灰，颜色却和祠堂后窗那一带的灰土完全不同。' },
        { type: 'narration', actorId: 'narrator', text: '巡夜声从远处压近，阿梅立刻收起灯笼，改用手背去试门缝里透出的温度。' },
        { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '里面刚点过火，屋里的人没走多久。' },
        { type: 'narration', actorId: 'narrator', text: '门后的木案被拖动过，地上留下两道浅痕，一道朝内，一道朝井边，像有人临时改了搬运方向。' },
        { type: 'narration', actorId: 'narrator', text: '窗纸内侧有一枚半干的指印，指腹纹路被药粉糊住，只剩掌根的压痕，斜斜按在窗棂边。' },
        { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '他不是从窗子逃的，是从窗子递了东西出去。' },
        { type: 'narration', actorId: 'narrator', text: '后院井绳轻轻晃动，水桶却停在井台外，绳尾沾着一截红线，和先前断在袖口的颜色相同。' },
        { type: 'narration', actorId: 'narrator', text: '阿梅把红线收进帕子，没有立刻追出去，因为墙外已经响起第二个人压低的咳声。' },
        { type: 'speech', actorId: 'mei', actorName: '阿梅', text: '有两个人，一个在屋里灭证，一个在墙外接应。' },
        { type: 'narration', actorId: 'narrator', text: '她退回门前，故意敲响铜环，让屋里的人以为自己还没发现井边红线。这个假动作给她争取到半息时间，也把门内门外两个人同时逼到必须回应的位置。屋内的人先沉不住气，木栓轻轻一跳；墙外那声咳嗽也戛然而止。阿梅没有立刻闯门，只把红线藏进袖中，等两边都以为她还在犹豫时，才把真正的退路锁死。' },
      ],
      narrativeBlocks: null,
      content: '',
      extraMessages: null,
      storyChoices: null,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const narrator = buildCharacter('narrator', '旁白');
    const mei = buildCharacter('mei', '阿梅');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator', 'mei'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator, mei],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(message.metadata?.narrativeTurn?.blocks).toHaveLength(12);
  });

  it('rejects story-reader JSON that puts visible story only in content', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: null,
        narrativeBlocks: null,
        content: '门里传来脚步声。',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: longStorySection('门里传来脚步声。') },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(message.content).toBe('');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorId: 'narrator', actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: expect.stringContaining('门里传来脚步声。') }),
    ]);
  });

  it('retries plain story text instead of committing it as a fallback bubble', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce('雨滴砸在青石阶上，门内传来一声很轻的咳嗽。')
      .mockResolvedValueOnce(JSON.stringify({
        narrativeText: null,
        storyEvents: [
          { type: 'narration', actorId: 'narrator', text: longStorySection('雨滴砸在青石阶上。') },
        ],
        narrativeBlocks: null,
        content: '',
        extraMessages: null,
        storyChoices: null,
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const narrator = buildCharacter('narrator', '旁白');

    const message = await generateSpeakerMessage({
      chat: buildChat({
        memberIds: ['narrator'],
        mode: 'scripted_play',
        sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
        scenarioState: { phase: 'scene', choiceEpoch: 1, branches: [] },
      }),
      speaker: narrator,
      characters: [narrator],
      messages: [buildUserMessage('继续推进', 1)],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    const retryPrompt = String(generateResponseMock.mock.calls[1]?.[1] || '');
    expect(retryPrompt).toContain('Story protocol retry');
    expect(retryPrompt).toContain('old top-level body container');
    expect(retryPrompt).not.toContain('legacy narrativeBlocks');
    expect(message.content).toBe('');
    expect(message.metadata?.narrativeTurn?.blocks).toEqual([
      expect.objectContaining({ actorId: 'narrator', actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: expect.stringContaining('雨滴砸在青石阶上。') }),
    ]);
  });

  it('preserves narrative turn metadata without media decisions', () => {
    const metadata = __chatEngineTestUtils.buildMessageMetadata({
      decision: null,
      capabilities: { image: false, audio: false },
      content: '雨落在旧宅门前。',
      narrativeTurn: {
        turnId: 'turn-1',
        turnKind: 'narrative_beat',
        sceneId: 'main',
        povActorId: 'narrator',
        blocks: [{ id: 'block-1', actorId: 'narrator', actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: '雨落在旧宅门前。' }],
      },
    });

    expect(metadata?.narrativeTurn?.blocks[0]).toMatchObject({
      actorKind: 'narrator',
      kind: 'prose',
      displayMode: 'paragraph',
      text: '雨落在旧宅门前。',
    });
  });

  it('builds deterministic attachment ids when metadata now is fixed', () => {
    const decision = {
      image: {
        shouldGenerate: true,
        reason: '用户明确想看图片',
        prompt: 'A cute WeChat-style photo of mango pomelo sago dessert on a table',
        altText: '一杯杨枝甘露甜品',
      },
    };
    const first = __chatEngineTestUtils.buildMessageMetadata({
      decision,
      capabilities: { image: true, audio: false },
      content: '来啦，你看这杯杨枝甘露。',
      now: 1777000000000,
    });
    const second = __chatEngineTestUtils.buildMessageMetadata({
      decision,
      capabilities: { image: true, audio: false },
      content: '来啦，你看这杯杨枝甘露。',
      now: 1777000000000,
    });
    expect(first?.attachments?.[0]?.id).toBe(second?.attachments?.[0]?.id);
  });

  it('forces a queued image attachment for explicit media guidance when the text model omits mediaDecision', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '来啦，我把灰太狼先生的证件照画得超精神～',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊', {
      visualIdentity: { description: '粉白色小羊，温柔爱画画', styleHint: '柔和童话插画' },
    });
    const hui = buildCharacter('hui', '灰太狼', {
      background: '灰太狼，经典狼族角色，戴黄色补丁帽，脸部有胡须和自信表情。',
      visualIdentity: { description: '灰色狼，黄色补丁帽，两撇胡子，表情夸张' },
    });

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [{
        id: 'guide',
        chatId: 'chat-1',
        type: 'god',
        senderId: 'user',
        senderName: '开发者',
        content: '美羊羊发个灰太狼证件照的图片',
        emotion: 0,
        timestamp: 10,
        isDeleted: false,
      }],
      apiConfig: buildProfiles(),
      directorIntent: buildMediaDirectorIntent(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(message.content).toBe('来啦，我把灰太狼先生的证件照画得超精神～');
    expect(message.metadata?.generationDecision?.image).toMatchObject({
      shouldGenerate: true,
      reason: '用户明确要求这个角色发送或创作图片。',
      altText: '美羊羊发来的灰太狼图片',
      referenceCharacterIds: ['hui'],
    });
    expect(message.metadata?.attachments).toHaveLength(1);
    expect(message.metadata?.attachments?.[0]).toMatchObject({
      kind: 'image',
      status: 'queued',
      altText: '美羊羊发来的灰太狼图片',
      referenceCharacterIds: ['hui'],
    });
    expect(message.metadata?.attachments?.[0]?.promptText).toContain('美羊羊发个灰太狼证件照的图片');
    expect(message.metadata?.attachments?.[0]?.promptText).toContain('灰太狼');
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toMatchObject({
      status: 'accepted',
      validated: true,
      retryCount: 0,
      rejectedDraftCount: 0,
      finalReason: 'matched',
      forcedMediaQueued: true,
    });
  });

  it('drops extra messages already included in the streamed content to avoid duplicate bubbles', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '等下\n你刚说谁来着？',
      extraMessages: ['你刚说谁来着？'],
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [],
      apiConfig: buildProfiles(),
    });

    expect(message.content).toBe('等下\n你刚说谁来着？');
    expect(message.extraMessages ?? null).toBeNull();
  });

  it('allows multiline chat while warning against repeated visible layouts', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '（轻叹一声，目光落向窗外竹影）\n\n热闹自有热闹的好，冷清也有冷清的趣。\n\n（转回视线，语气淡了几分）你且去别处热闹罢。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const dai = buildCharacter('dai', '林黛玉');
    const lu = buildCharacter('lu', '鲁智深');

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['dai', 'lu'] }),
      speaker: dai,
      characters: [dai, lu],
      messages: [
        buildAiMessage('dai', '林黛玉', '（轻轻摇头）\n\n你且去菜园子里施展你的威风罢。\n\n（转身欲走）', 1),
        buildAiMessage('lu', '鲁智深', '那俺去菜园子里吼两嗓子。', 2),
        buildAiMessage('dai', '林黛玉', '（转身欲走，又停住脚步）\n\n你且去罢。\n\n（回头淡淡一笑）', 3),
      ],
      apiConfig: buildProfiles(),
    });
    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(prompt).toContain('## Turn Format Variety');
    expect(prompt).toContain('Keep any format that the current content genuinely needs');
    expect(prompt).toContain('not a ban on any specific punctuation');
    expect(message.content).toBe('（轻叹一声，目光落向窗外竹影）\n\n热闹自有热闹的好，冷清也有冷清的趣。\n\n（转回视线，语气淡了几分）你且去别处热闹罢。');
  });

  it('keeps ordinary user turns in transcript instead of elevating them into system-level guidance', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '那我直接说安排：八点到，锅底和蘸料分开带，谁迟到谁洗碗。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [
        buildUserMessage('你们换一种接法，别再只换开头继续同一个套路。', 1),
        buildAiMessage('hui', '灰太狼', '那我也继续安排一下，八点羊肉火锅我来掌勺。', 2),
      ],
      apiConfig: buildProfiles(),
    });

    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');
    const chatMessages = generateResponseMock.mock.calls[0]?.[2] as Array<{ role: string; content: string }>;
    expect(prompt).not.toContain('## Latest Human Turn Context');
    expect(prompt).not.toContain('你们换一种接法，别再只换开头继续同一个套路。');
    expect(chatMessages.some((item) => item.content === '用户: 你们换一种接法，别再只换开头继续同一个套路。')).toBe(true);
    expect((message.metadata?.runtimeDecision as Record<string, unknown> | undefined)?.latestHumanTurn).toBeUndefined();
  });

  it('preserves natural extra bubbles even when the turn plan leans toward one bubble', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '一',
      extraMessages: ['二', '三'],
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [],
      apiConfig: buildProfiles(),
    });

    expect(message.content).toBe('一');
    expect(message.extraMessages).toEqual(['二', '三']);
  });

  it('retries when a draft exactly repeats a recent room line', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '行行行，你俩一唱一和的，我投降。那件夹克改好了记得喊我去捡漏，二手还能省一笔呢～',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '捡漏这事你们先别抢，我得先看那件夹克还能不能救。',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [
        buildAiMessage('hui', '灰太狼', '行行行，你俩一唱一和的，我投降。那件夹克改好了记得喊我去捡漏，二手还能省一笔呢～'),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(onLocalInterception).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'surface_echo_retry',
      speakerId: 'mei',
      speakerName: '美羊羊',
      draft: expect.stringContaining('捡漏'),
      reason: expect.stringContaining('exactly repeats'),
      attempt: 1,
    }));
    expect(message.content).toBe('捡漏这事你们先别抢，我得先看那件夹克还能不能救。');
  });

  it('retries exact room-line repeats on professional discussion surfaces too', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '财富伦理师，你这句话其实比我之前那个功能模块的拆解更狠。',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '我换个角度说：这里真正危险的是把人的处境误读成可交易指标。',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const analyst = buildCharacter('analyst', '心理学家', { expertise: ['心理学'] });
    const ethicist = buildCharacter('ethicist', '财富伦理师', { expertise: ['伦理'] });
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat({ mode: 'group_discussion', memberIds: ['analyst', 'ethicist'] }),
      speaker: analyst,
      characters: [analyst, ethicist],
      messages: [
        buildAiMessage('ethicist', '财富伦理师', '财富伦理师，你这句话其实比我之前那个功能模块的拆解更狠。', 1),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(onLocalInterception).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'surface_echo_retry',
      reason: expect.stringContaining('exactly repeats'),
      attempt: 1,
    }));
    expect(message.content).toBe('我换个角度说：这里真正危险的是把人的处境误读成可交易指标。');
  });

  it('prevents syntax contagion through prompt structure instead of local punctuation blacklists', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '这个问题的关键——不是她发了什么，而是谁替她决定了发什么。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const analyst = buildCharacter('analyst', '心理学家', { expertise: ['心理学'] });
    const reporter = buildCharacter('reporter', '娱乐记者');
    const observer = buildCharacter('observer', '女权观察家');
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['analyst', 'reporter', 'observer'] }),
      speaker: analyst,
      characters: [analyst, reporter, observer],
      messages: [
        buildAiMessage('reporter', '娱乐记者', '这话扎心——可它确实把问题摆上桌了。', 1),
        buildAiMessage('observer', '女权观察家', '我不同意——至少不该只看曝光量。', 2),
        buildAiMessage('reporter', '娱乐记者', '那就更微妙了——镜头到底对着谁？', 3),
        buildAiMessage('observer', '女权观察家', '问题就在这里——她的名字一直在后面。', 4),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');
    const chatMessages = generateResponseMock.mock.calls[0]?.[2] as Array<{ role: string; content: string }>;

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(onLocalInterception).not.toHaveBeenCalled();
    expect(prompt).toContain('## Style Quarantine');
    expect(prompt).toContain('choose your own sentence architecture');
    expect(prompt).toContain('The complete recent transcript is provided separately as chat messages');
    expect(prompt).not.toContain('这话扎心');
    expect(prompt).not.toContain('镜头到底对着谁');
    expect(chatMessages.every((item) => item.role === 'user')).toBe(true);
    expect(chatMessages.some((item) => item.content.includes('娱乐记者: 这话扎心'))).toBe(true);
    expect(message.content).toBe('这个问题的关键——不是她发了什么，而是谁替她决定了发什么。');
  });

  it('warns the model away from repeated self opening frames without local phrase blacklists', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '赔偿金额可以先从合同约定的定额违约金入手，再让法院按传播范围、过错程度和工资水平去调减。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const lawyer = buildCharacter('lawyer', '专业律师', { expertise: ['合同法', '劳动争议'] });
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['lawyer'] }),
      speaker: lawyer,
      characters: [lawyer],
      messages: [
        buildUserMessage('这种景区 NPC 保密违约金怎么写？', 1),
        buildAiMessage('lawyer', '专业律师', '你这个问题问到了实务中的痛点。景区要证明实际损失，确实不能靠模糊数据。', 2),
        buildUserMessage('点赞少是不是就很轻微？', 3),
        buildAiMessage('lawyer', '专业律师', '你这个问题问到了实务中的另一个关键点。点赞数量低不等于行为轻微。', 4),
        buildUserMessage('那赔偿金额怎么确定？', 5),
        buildAiMessage('lawyer', '专业律师', '你这个问题问到了实务中的核心困境。没有明确实际损失时，违约金需要看约定是否合理。', 6),
        buildUserMessage('如果法院要调低，景区要准备什么材料？', 7),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(onLocalInterception).not.toHaveBeenCalled();
    expect(prompt).toContain('opening-frame history');
    expect(prompt).toContain('acknowledgement-then-framework move');
    expect(prompt).toContain('Do not solve repetition by swapping one stock phrase for another');
    expect(prompt).toContain('## Turn Length Variety');
    expect(prompt).toContain('Do not target a fixed middle length');
    expect(prompt).not.toContain('你这个问题问到了实务中的痛点');
    expect(prompt).not.toContain('你这个问题问到了实务中的另一个关键点');
    expect(prompt).not.toContain('你这个问题问到了实务中的核心困境');
    expect(message.content).toBe('赔偿金额可以先从合同约定的定额违约金入手，再让法院按传播范围、过错程度和工资水平去调减。');
  });

  it('allows intentional repeated tone or format when the model marks intentionalRepeat', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '你这个问题问到了“没法举证但又不能零处罚”的缝里，我就顺着这个缝说。',
      intentionalRepeat: true,
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const lawyer = buildCharacter('lawyer', '专业律师', { expertise: ['合同法'] });
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['lawyer'] }),
      speaker: lawyer,
      characters: [lawyer],
      messages: [
        buildAiMessage('lawyer', '专业律师', '你这个问题问到了实务中的痛点。景区要证明实际损失很难。', 1),
        buildUserMessage('那如果视频几乎没人看呢？', 2),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(onLocalInterception).not.toHaveBeenCalled();
    expect(message.metadata?.runtimeDecision?.intentionalRepeat).toBe(true);
    expect(message.metadata?.runtimeDecision?.responseSurface?.kind).toBe('chat');
  });

  it('does not locally blacklist borrowed emoji markers once style quarantine is in the prompt', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '我也有点想排队了😂',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [
        buildAiMessage('hui', '灰太狼', '期待你下手别太狠😂', 1),
        buildAiMessage('mei', '美羊羊', '随便改，改坏了也不心疼😂', 2),
        buildAiMessage('hui', '灰太狼', '那我也排队等内部价😂', 3),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    const prompt = String(generateResponseMock.mock.calls[0]?.[1] || '');

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(onLocalInterception).not.toHaveBeenCalled();
    expect(prompt).toContain('## Expression Surface Choice');
    expect(prompt).toContain('decorative-marker turns');
    expect(prompt).toContain('generation prior, not output filtering');
    expect(message.content).toBe('我也有点想排队了😂');
  });

  it('allows exact repeated answers when the user asks for a poem next line', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '春风又绿江南岸',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');
    const onLocalInterception = vi.fn();

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [
        buildAiMessage('hui', '灰太狼', '春风又绿江南岸', 1),
        buildUserMessage('“京口瓜洲一水间”的下一句是什么？', 2),
      ],
      apiConfig: buildProfiles(),
      onLocalInterception,
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(onLocalInterception).not.toHaveBeenCalled();
    expect(message.content).toBe('春风又绿江南岸');
  });

  it('retries explicit media guidance when the first draft keeps chatting instead of sending the requested image', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '蕉太狼你这一天天的，满脑子都是香蕉，连灰太狼先生的胡子都不放过啦～',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '来啦，我把灰太狼先生的证件照画好了，帽子和胡子都认真画了哦～',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const mei = buildCharacter('mei', '美羊羊', {
      visualIdentity: { description: '粉白色小羊，温柔爱画画', styleHint: '柔和童话插画' },
    });
    const hui = buildCharacter('hui', '灰太狼', {
      background: '灰太狼，经典狼族角色，戴黄色补丁帽，脸部有胡须和自信表情。',
      visualIdentity: { description: '灰色狼，黄色补丁帽，两撇胡子，表情夸张' },
    });
    const jiao = buildCharacter('jiao', '蕉太狼');
    const chunks: string[] = [];

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['mei', 'hui', 'jiao'] }),
      speaker: mei,
      characters: [mei, hui, jiao],
      messages: [
        {
          id: 'old-banter',
          chatId: 'chat-1',
          type: 'ai',
          senderId: 'jiao',
          senderName: '蕉太狼',
          content: '暖羊羊姐姐这接梗能力，比我那根变异香蕉还顺滑～',
          emotion: 0,
          timestamp: 10,
          isDeleted: false,
        },
        {
          id: 'guide',
          chatId: 'chat-1',
          type: 'user',
          senderId: 'user',
          senderName: '我',
          content: '美羊羊发个灰太狼证件照的图片',
          emotion: 0,
          timestamp: 20,
          isDeleted: false,
        },
      ],
      apiConfig: buildProfiles(),
      directorIntent: buildMediaDirectorIntent(),
      onChunk: (content) => chunks.push(content),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(String(generateResponseMock.mock.calls[1]?.[1] || '')).toContain('Guidance retry');
    expect(chunks).toEqual(['来啦，我把灰太狼先生的证件照画好了，帽子和胡子都认真画了哦～']);
    expect(message.content).toContain('灰太狼');
    expect(message.content).toContain('证件照');
    expect(message.content).not.toContain('蕉太狼你这一天天的');
    expect(message.metadata?.attachments?.[0]).toMatchObject({
      kind: 'image',
      status: 'queued',
      referenceCharacterIds: ['hui'],
    });
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toMatchObject({
      status: 'accepted_after_retry',
      validated: true,
      retryCount: 1,
      rejectedDraftCount: 1,
      rejectedReasons: ['missing_requested_image'],
      finalReason: 'matched',
      forcedMediaQueued: true,
    });
  });

  it('does not let a character pretend to send an image when no image model is available', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '来啦，我把灰太狼先生的证件照画好了，帽子和胡子都认真画了哦～',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '我现在没有图片模型，发不了真正的证件照图片，只能先把构图想法说给你听。',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');
    const textOnlyProfiles = buildProfiles().filter((profile) => profile.type !== 'image');

    const message = await generateSpeakerMessage({
      chat: buildChat(),
      speaker: mei,
      characters: [mei, hui],
      messages: [{
        id: 'guide',
        chatId: 'chat-1',
        type: 'god',
        senderId: 'user',
        senderName: '开发者',
        content: '美羊羊发个灰太狼证件照的图片',
        emotion: 0,
        timestamp: 10,
        isDeleted: false,
      }],
      apiConfig: textOnlyProfiles,
      directorIntent: buildMediaDirectorIntent(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(String(generateResponseMock.mock.calls[1]?.[1] || '')).toContain('Do not pretend an image was sent');
    expect(message.content).toContain('发不了');
    expect(message.metadata?.attachments).toEqual([]);
    expect(message.metadata?.generationDecision).toBeUndefined();
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toMatchObject({
      status: 'accepted_after_retry',
      validated: true,
      retryCount: 1,
      rejectedDraftCount: 1,
      rejectedReasons: ['missing_requested_image'],
      finalReason: 'matched',
    });
  });

  it('treats direct user messages as companionship context instead of topic guidance', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '我记得你明天面试会紧张。先别急，我们一点点把最难的部分拆开。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊', {
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说过明天面试会紧张。'],
      },
    });
    const directChat = buildChat({
      type: 'direct',
      memberIds: ['mei'],
      relationshipLedger: [{
        pairKey: 'mei->user',
        actorId: 'mei',
        targetId: 'user',
        current: { warmth: 18, trust: 12, competence: 4, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 100,
      }],
    });

    const message = await generateSpeakerMessage({
      chat: directChat,
      speaker: mei,
      characters: [mei],
      messages: [buildUserMessage('明天面试有点紧张。', 200)],
      apiConfig: buildProfiles(),
    });

    expect(message.metadata?.runtimeDecision?.directorIntent?.userGuidance).toBeFalsy();
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toBeUndefined();
    expect(message.metadata?.runtimeDecision?.companionshipContext).toMatchObject({
      currentAddress: '你',
    });
    expect(message.metadata?.runtimeDecision?.companionshipContext?.pendingCareTopics.join(' / ')).toContain('明天面试');
    expect(String(generateResponseMock.mock.calls[0]?.[1] || '')).toContain('## Companionship Context');
    expect(String(generateResponseMock.mock.calls[0]?.[1] || '')).toContain('明天面试');
  });

  it('does not retry plain topic shifts as persistent guidance tasks', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '蕉太狼你又把香蕉扯到胡子上了，这话题也太滑了吧～',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '狼抓羊这事不能只说“应该”，至少得先分清生存本能和伤害别人是不是一回事吧？',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const man = buildCharacter('man', '慢羊羊', { expertise: ['伦理', '狼抓羊', '自然法则'] });
    const jiao = buildCharacter('jiao', '蕉太狼', { expertise: ['香蕉'] });
    const now = Date.now();

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['man', 'jiao'] }),
      speaker: man,
      characters: [man, jiao],
      messages: [
        {
          id: 'old',
          chatId: 'chat-1',
          type: 'ai',
          senderId: 'jiao',
          senderName: '蕉太狼',
          content: '香蕉证件照也不是不行。',
          emotion: 0,
          timestamp: now - 2000,
          isDeleted: false,
        },
        {
          id: 'guide',
          chatId: 'chat-1',
          type: 'user',
          senderId: 'user',
          senderName: '我',
          content: '新话题：狼抓羊有过错吗？狼应该抓羊吗？',
          emotion: 0,
          timestamp: now - 1000,
          isDeleted: false,
        },
      ],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(message.content).not.toContain('狼抓羊有没有过错得');
    expect(message.metadata?.runtimeDecision?.directorIntent?.userGuidance).toBeFalsy();
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toBeUndefined();
  });

  it('does not retry plain question topic shifts through keyword validation', async () => {
    generateResponseMock.mockReset();
    generateResponseMock
      .mockResolvedValueOnce(JSON.stringify({
        content: '狼抓羊证件照也挺好玩，灰太狼肯定想把羊画进去吧～',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        content: '狼抓羊有没有过错得分开看：生存本能是一回事，故意伤害羊又是另一回事。',
        interactionHints: null,
        socialEventHints: null,
        conflictFocus: null,
      }));
    const man = buildCharacter('man', '慢羊羊', { expertise: ['伦理', '狼抓羊', '自然法则'] });
    const now = Date.now();

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['man'] }),
      speaker: man,
      characters: [man],
      messages: [
        {
          id: 'guide',
          chatId: 'chat-1',
          type: 'god',
          senderId: 'user',
          senderName: '开发者',
          content: '新话题：狼抓羊有过错吗？狼应该抓羊吗？',
          emotion: 0,
          timestamp: now - 1000,
          isDeleted: false,
        },
      ],
      apiConfig: buildProfiles(),
    });

    expect(generateResponseMock).toHaveBeenCalledTimes(1);
    expect(message.content).toBe('狼抓羊证件照也挺好玩，灰太狼肯定想把羊画进去吧～');
    expect(message.metadata?.runtimeDecision?.directorIntent?.userGuidance).toBeFalsy();
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toBeUndefined();
  });

  it('recovers the latest unresolved media guidance from messages even without a passed directorIntent', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '来啦来啦，灰太狼先生的证件照我画好了～',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼', {
      visualIdentity: { description: '灰色狼，黄色补丁帽，两撇胡子' },
    });
    const lan = buildCharacter('lan', '懒羊羊');
    const now = Date.now();

    const message = await generateSpeakerMessage({
      chat: buildChat({ memberIds: ['mei', 'hui', 'lan'] }),
      speaker: mei,
      characters: [mei, hui, lan],
      messages: [
        {
          id: 'guide',
          chatId: 'chat-1',
          type: 'god',
          senderId: 'user',
          senderName: '开发者',
          content: '美羊羊发个灰太狼证件照的图片',
          emotion: 0,
          timestamp: now - 2000,
          isDeleted: false,
        },
        {
          id: 'slipped',
          chatId: 'chat-1',
          type: 'ai',
          senderId: 'hui',
          senderName: '灰太狼',
          content: '我看看你画得够不够帅，别把我胡子画歪了！',
          emotion: 0,
          timestamp: now - 1000,
          isDeleted: false,
        },
      ],
      apiConfig: buildProfiles(),
    });

    expect(message.senderId).toBe('mei');
    expect(message.metadata?.runtimeDecision?.directorIntent?.userGuidance).toMatchObject({
      kind: 'media_request',
      actorIds: ['mei'],
      mediaRequest: { subjectActorIds: ['hui'] },
    });
    expect(message.metadata?.attachments?.[0]).toMatchObject({
      kind: 'image',
      status: 'queued',
      referenceCharacterIds: ['hui'],
    });
  });

  it('locks explicit media guidance to the requested speaker instead of letting other members抢话', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '来啦，我把灰太狼先生画成最帅证件照～',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊', {
      visualIdentity: { description: '粉白色小羊，温柔爱画画', styleHint: '柔和童话插画' },
    });
    const hui = buildCharacter('hui', '灰太狼', {
      background: '灰太狼，戴黄色补丁帽，脸部有胡须。',
      visualIdentity: { description: '灰色狼，黄色补丁帽，两撇胡子' },
    });
    const lan = buildCharacter('lan', '懒羊羊');
    const completed: unknown[] = [];
    const selected: string[] = [];
    const now = Date.now();

    await runOneRound(
      buildChat({ memberIds: ['mei', 'hui', 'lan'] }),
      [mei, hui, lan],
      [
        {
          id: 'guide',
          chatId: 'chat-1',
          type: 'god',
          senderId: 'user',
          senderName: '开发者',
          content: '美羊羊发个灰太狼证件照的图片',
          emotion: 0,
          timestamp: now - 2000,
          isDeleted: false,
        },
        {
          id: 'non-target',
          chatId: 'chat-1',
          type: 'ai',
          senderId: 'hui',
          senderName: '灰太狼',
          content: '我看看你画得够不够帅，别把我胡子画歪了！',
          emotion: 0,
          timestamp: now - 1000,
          isDeleted: false,
        },
      ],
      buildProfiles(),
      {
        onSpeakerSelected: (characterId) => selected.push(characterId),
        onMessageChunk: () => undefined,
        onMessageComplete: (message) => { completed.push(message); },
        onError: (error) => { throw error; },
      },
      undefined,
      undefined,
      {},
    );

    expect(selected[0]).toBe('mei');
    expect(completed[0]).toMatchObject({ senderId: 'mei' });
    expect((completed[0] as { metadata?: { attachments?: unknown[] } }).metadata?.attachments).toHaveLength(1);
  });

  it('locks short-name direct writing guidance to the intended long-named speaker', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '如果让我写，我会先把AI当成一面镜子：它照出的不是人类会不会被替代，而是我们愿不愿意重新分配创造力。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const susu = buildCharacter('susu', '穿搭博主苏苏');
    const luxun = buildCharacter('luxun', '鲁智深');
    const xiao = buildCharacter('xiao', '潇潇');
    const completed: unknown[] = [];
    const selected: string[] = [];
    const now = Date.now();

    await runOneRound(
      buildChat({ memberIds: ['susu', 'luxun', 'xiao'] }),
      [susu, luxun, xiao],
      [{
        id: 'guide',
        chatId: 'chat-1',
        type: 'god',
        senderId: 'user',
        senderName: '开发者',
        content: '苏苏你写一篇这个话题的800字作文',
        emotion: 0,
        timestamp: now - 1000,
        isDeleted: false,
      }],
      buildProfiles(),
      {
        onSpeakerSelected: (characterId) => selected.push(characterId),
        onMessageChunk: () => undefined,
        onMessageComplete: (message) => { completed.push(message); },
        onError: (error) => { throw error; },
      },
      undefined,
      undefined,
      {},
    );

    expect(selected[0]).toBe('susu');
    expect(completed[0]).toMatchObject({ senderId: 'susu' });
    expect((completed[0] as { metadata?: { runtimeDecision?: { directorIntent?: { userGuidance?: { actorIds?: string[] } } } } }).metadata?.runtimeDecision?.directorIntent?.userGuidance?.actorIds).toEqual(['susu']);
  });

  it('does not rotate explicit targeted guidance to another speaker when the locked actor fails', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');
    const lan = buildCharacter('lan', '懒羊羊');
    const completed: unknown[] = [];
    const selected: string[] = [];
    const errors: Error[] = [];
    const now = Date.now();

    await runOneRound(
      buildChat({ memberIds: ['mei', 'hui', 'lan'] }),
      [mei, hui, lan],
      [
        {
          id: 'guide',
          chatId: 'chat-1',
          type: 'god',
          senderId: 'user',
          senderName: '开发者',
          content: '美羊羊发个灰太狼证件照的图片',
          emotion: 0,
          timestamp: now - 2000,
          isDeleted: false,
        },
        {
          id: 'non-target',
          chatId: 'chat-1',
          type: 'ai',
          senderId: 'hui',
          senderName: '灰太狼',
          content: '我看看你画得够不够帅，别把我胡子画歪了！',
          emotion: 0,
          timestamp: now - 1000,
          isDeleted: false,
        },
      ],
      buildProfiles(),
      {
        onSpeakerSelected: (characterId) => selected.push(characterId),
        onMessageChunk: () => undefined,
        onMessageComplete: (message) => { completed.push(message); },
        onError: (error) => { errors.push(error); },
      },
      undefined,
      undefined,
      {},
    );

    expect(selected).toEqual(['mei']);
    expect(completed).toHaveLength(0);
    expect(errors[0]?.message).toContain('美羊羊');
    expect(generateResponseMock).toHaveBeenCalledTimes(3);
  });

  it('generates a group round without recursive surface resolution for open chat', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '我先接一句。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const mei = buildCharacter('mei', '美羊羊');
    const hui = buildCharacter('hui', '灰太狼');
    const completed: unknown[] = [];
    const errors: Error[] = [];

    await runOneRound(
      buildChat({ memberIds: ['mei', 'hui'] }),
      [mei, hui],
      [buildUserMessage('你们继续聊。', 1)],
      buildProfiles(),
      {
        onSpeakerSelected: () => undefined,
        onMessageChunk: () => undefined,
        onMessageComplete: (message) => { completed.push(message); },
        onError: (error) => { errors.push(error); },
      },
      undefined,
      undefined,
      {},
    );

    expect(errors).toHaveLength(0);
    expect(completed).toHaveLength(1);
    expect((completed[0] as { content: string }).content).toBe('我先接一句。');
  });

  it('maps hybrid surface sessions without recursive surface resolution', async () => {
    generateResponseMock.mockReset();
    generateResponseMock.mockResolvedValue(JSON.stringify({
      content: '先列一下关键疑点。',
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const analyst = buildCharacter('analyst', '心理学家', { expertise: ['心理学'] });
    const ethicist = buildCharacter('ethicist', '财富伦理师', { expertise: ['伦理'] });
    const completed: unknown[] = [];
    const errors: Error[] = [];

    await runOneRound(
      buildChat({ mode: 'werewolf', memberIds: ['analyst', 'ethicist'] }),
      [analyst, ethicist],
      [buildUserMessage('先说一下你们的判断。', 1)],
      buildProfiles(),
      {
        onSpeakerSelected: () => undefined,
        onMessageChunk: () => undefined,
        onMessageComplete: (message) => { completed.push(message); },
        onError: (error) => { errors.push(error); },
      },
      undefined,
      undefined,
      {},
    );

    expect(errors).toHaveLength(0);
    expect(completed).toHaveLength(1);
    expect((completed[0] as { content: string }).content).toBe('先列一下关键疑点。');
  });

  it('stores compact runtime decision metadata without requiring media generation', () => {
    const metadata = __chatEngineTestUtils.buildMessageMetadata({
      decision: null,
      capabilities: { image: false, audio: false },
      content: '我来接一下这个话题。',
      runtimeDecision: {
        directorIntent: {
          source: 'conflict',
          beatType: 'challenge',
          targetLineId: 'conflict-1',
          targetActorIds: ['a', 'b'],
          pressure: 0.8,
          reason: '冲突线正在升温',
        },
        narrativeLines: [{
          id: 'conflict-1',
          type: 'conflict',
          title: '当前矛盾',
          salience: 0.9,
          tension: 0.8,
          status: 'escalating',
          participantIds: ['a', 'b'],
        }],
        speakerScore: { actorId: 'a', finalScore: 1.2, reasons: ['conflict'] },
      },
    });

    expect(metadata?.attachments).toEqual([]);
    expect(metadata?.generationDecision).toBeUndefined();
    expect(metadata?.runtimeDecision?.directorIntent?.targetLineId).toBe('conflict-1');
    expect(metadata?.runtimeDecision?.speakerScore).toMatchObject({ actorId: 'a', finalScore: 1.2 });
  });

  it('stores explicit user guidance inside runtime decision metadata', () => {
    const runtimeDecision = __chatEngineTestUtils.buildRuntimeDecisionMetadata({
      directorIntent: {
        source: 'user_message',
        beatType: 'answer',
        targetActorIds: ['mei'],
        pressure: 0.98,
        reason: '用户指定角色发送或创作图片。',
        userGuidance: {
          kind: 'media_request',
          rawText: '美羊羊发个灰太狼证件照的图片',
          actorIds: ['mei'],
          mentionedActorIds: ['mei', 'hui'],
          focusText: '美羊羊发个灰太狼证件照的图片',
          beatType: 'answer',
          pressure: 0.98,
          maxTurns: 1,
          reason: '用户指定角色发送或创作图片。',
          mediaRequest: {
            kind: 'image',
            subjectActorIds: ['hui'],
            subjectText: '灰太狼',
            actionText: '发个灰太狼证件照的图片',
          },
        },
      },
      memoryTrace: {
        injectedIds: [],
        recalledArchives: [],
        targetActorId: 'hui',
        targetActorName: '灰太狼',
        targetReason: '来自人工发图请求的图片对象',
      },
    });

    expect(runtimeDecision?.directorIntent?.userGuidance).toMatchObject({
      kind: 'media_request',
      actorIds: ['mei'],
      mediaRequest: {
        kind: 'image',
        subjectActorIds: ['hui'],
      },
    });
    expect(runtimeDecision?.memoryContext).toMatchObject({
      targetActorId: 'hui',
      targetActorName: '灰太狼',
      targetReason: '来自人工发图请求的图片对象',
    });
  });

  it('stores world influence rule traces in runtime decision metadata', () => {
    const runtimeDecision = __chatEngineTestUtils.buildRuntimeDecisionMetadata({
      worldInfluence: {
        attentionScore: 0.82,
        attentionRestraint: 0.41,
        activeRuleIds: ['comfort_first', 'urgent_calendar_first'],
        activeRuleTexts: ['Before expanding into analysis...', 'You have an upcoming schedule within 6 hours...'],
      },
    });
    expect(runtimeDecision?.worldInfluence).toMatchObject({
      attentionScore: 0.82,
      attentionRestraint: 0.41,
      activeRuleIds: ['comfort_first', 'urgent_calendar_first'],
    });
    expect(runtimeDecision?.worldInfluence?.activeRuleTexts?.length).toBe(2);
  });

  it('adds a larger typing delay for repair and withdrawal pressure', () => {
    const slow = __chatEngineTestUtils.resolveInnerLifeTypingDelayMs({
      actorId: 'a',
      impulse: 'repair',
      tone: 'vulnerable',
      reason: '想找补',
      pressure: 0.75,
      evidence: [],
      state: {
        mood: { pleasure: -10, arousal: 50, dominance: 40 },
        energy: 42,
        attention: 50,
        loneliness: 10,
        repression: 72,
        shame: 70,
        envy: 0,
        trustInRoom: 52,
        ignoredStreak: 0,
      },
      expressionPlan: {
        tone: 'vulnerable',
        length: 'short',
        messageCount: 1,
        typoLevel: 0,
        delayMs: 1700,
        allowWithdraw: true,
      },
    }, { speed: 1 } as never);
    const fast = __chatEngineTestUtils.resolveInnerLifeTypingDelayMs({
      actorId: 'a',
      impulse: 'answer',
      tone: 'casual',
      reason: '被点名',
      pressure: 0.5,
      evidence: [],
      state: {
        mood: { pleasure: 0, arousal: 20, dominance: 50 },
        energy: 70,
        attention: 70,
        loneliness: 0,
        repression: 10,
        shame: 10,
        envy: 0,
        trustInRoom: 60,
        ignoredStreak: 0,
      },
      expressionPlan: {
        tone: 'casual',
        length: 'short',
        messageCount: 1,
        typoLevel: 0,
        delayMs: 800,
        allowWithdraw: false,
      },
    }, { speed: 2 } as never);

    expect(slow).toBeGreaterThan(fast);
    expect(slow).toBeLessThanOrEqual(2600);
  });

  it('skips ordinary inner-life typing delay for story-reader generation', () => {
    expect(__chatEngineTestUtils.shouldApplyInnerLifeTypingDelay({
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
    } as never)).toBe(false);

    expect(__chatEngineTestUtils.shouldApplyInnerLifeTypingDelay({
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
    } as never)).toBe(true);
  });
});
