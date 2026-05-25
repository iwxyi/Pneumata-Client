import { describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import type { AIModelProfile } from '../types/settings';
import { __chatEngineTestUtils, generateSpeakerMessage, runOneRound } from './chatEngine';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';
import type { SpeakIntent } from './intentEngine';
import type { DirectorIntent } from './directorIntent';

const generateResponseMock = vi.hoisted(() => vi.fn());

vi.mock('./aiClient', () => ({
  generateResponse: (...args: unknown[]) => generateResponseMock(...args),
}));

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
      recentMessages: [],
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

  it('retries topic guidance when the first draft ignores the new topic and continues stale banter', async () => {
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

    expect(generateResponseMock).toHaveBeenCalledTimes(2);
    expect(String(generateResponseMock.mock.calls[1]?.[1] || '')).toContain('Guidance retry');
    expect(message.content).toContain('狼');
    expect(message.content).toContain('羊');
    expect(message.content).not.toContain('香蕉');
    expect(message.metadata?.runtimeDecision?.guidanceExecution).toMatchObject({
      status: 'accepted_after_retry',
      validated: true,
      retryCount: 1,
      rejectedDraftCount: 1,
      rejectedReasons: ['missing_topic_focus'],
      finalReason: 'matched',
    });
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
});
