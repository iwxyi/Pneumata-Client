import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import type { Message } from '../types/message';
import type { MemoryItem } from './memoryTypes';
import { buildChatMessages, buildPromptMemoryTrace, buildSystemPromptWithContext } from './promptBuilder';

function buildCharacter(overrides: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories: [],
    background: '穿搭博主',
    speakingStyle: '轻快',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: {
      shortTermSummary: '',
      longTerm: [],
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    speechProfile: undefined,
    personalityDrift: {},
    modelProfileId: null,
    modelProfileIds: {},
    bubbleStyleId: null,
    runtimeTimeline: [],
    deletedAt: null,
    fieldVersions: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '测试群聊',
    topic: '日常聊天',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildDirectChat() {
  return normalizeConversation({
    ...buildChat(),
    type: 'direct',
    name: '苏苏单聊',
    relationshipLedger: [{
      pairKey: 'char-a->user',
      actorId: 'char-a',
      targetId: 'user',
      current: { warmth: 48, competence: 8, trust: 42, threat: 4 },
      derived: {
        semantic: {
          stage: '深度绑定',
          labels: ['喜欢', '深度牵挂'],
          summary: '深度绑定：喜欢、深度牵挂',
          intensity: 72,
        },
      },
      trend: 'up',
      recentEvents: [{ id: 'evt-1', kind: 'interaction', createdAt: 10, summary: '用户记得苏苏提过的压力。', actorIds: ['char-a'], targetIds: ['user'] }],
      lastUpdatedAt: 10,
    }],
  });
}

function buildAiDirectChat() {
  return normalizeConversation({
    ...buildChat(),
    type: 'ai_direct',
    name: '苏苏和阿远',
    memberIds: ['char-a', 'char-b'],
  });
}

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id || 'msg-1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-b',
    senderName: '阿远',
    content: '那次雨夜我不是故意失约。',
    emotion: 0,
    timestamp: 2,
    isDeleted: false,
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'old-memory',
    ownerId: 'char-a',
    scope: 'relationship',
    layer: 'long_term',
    kind: 'resentment',
    subjectIds: ['char-b'],
    text: '苏苏记得阿远曾在雨夜失约。',
    salience: 0.82,
    confidence: 0.82,
    recency: 0.2,
    reinforcementCount: 2,
    sourceEventIds: ['old-event'],
    sourceTag: 'llm_memory_relationship_imprint',
    origin: 'distilled',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: 10,
    ...overrides,
  };
}

const leakySpeakerId = '3c78729f-e52d-4dde-b27f-01a949960bb8b';
const leakyTargetId = '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321';

describe('buildSystemPromptWithContext', () => {
  it('passes developer guidance messages to the model as user turns', () => {
    const rendered = buildChatMessages([
      buildMessage({ type: 'god', senderId: 'user', senderName: '开发者', content: '新话题：狼抓羊有过错吗？' }),
    ], new Map(), 12);

    expect(rendered).toEqual([{
      role: 'user',
      content: '开发者: 新话题：狼抓羊有过错吗？',
    }]);
  });

  it('projects direct chat history with the current speaker as assistant', () => {
    const rendered = buildChatMessages([
      buildMessage({ type: 'user', senderId: 'user', senderName: '开发者', content: '能具体讲讲第一章发生了什么吗？', timestamp: 1 }),
      buildMessage({ type: 'ai', senderId: 'char-a', senderName: '潇潇', content: '第一章从废弃大楼里的命案展开。', timestamp: 2 }),
      buildMessage({ type: 'user', senderId: 'user', senderName: '开发者', content: '第二章又讲了什么？', timestamp: 3 }),
    ], new Map(), 12, { currentSpeakerId: 'char-a', chatType: buildDirectChat().type });

    expect(rendered).toEqual([
      { role: 'user', content: '开发者: 能具体讲讲第一章发生了什么吗？' },
      { role: 'assistant', content: '第一章从废弃大楼里的命案展开。' },
      { role: 'user', content: '开发者: 第二章又讲了什么？' },
    ]);
  });

  it('projects group chat history with other AI speakers as named user-side context', () => {
    const rendered = buildChatMessages([
      buildMessage({ type: 'user', senderId: 'user', senderName: '开发者', content: '你们换一种接法。', timestamp: 1 }),
      buildMessage({ type: 'ai', senderId: 'char-a', senderName: '甲', content: '收到，那我负责带锅底，八点见。', timestamp: 2 }),
      buildMessage({ type: 'ai', senderId: 'char-b', senderName: '乙', content: '收到，那我负责带蘸料，八点见。', timestamp: 3 }),
    ], new Map(), 12, { currentSpeakerId: 'char-b', chatType: buildChat().type });

    expect(rendered).toEqual([
      { role: 'user', content: '开发者: 你们换一种接法。' },
      { role: 'user', content: '甲: 收到，那我负责带锅底，八点见。' },
      { role: 'assistant', content: '收到，那我负责带蘸料，八点见。' },
    ]);
  });

  it('projects AI private thread counterpart turns as named user-side context', () => {
    const rendered = buildChatMessages([
      buildMessage({
        type: 'ai',
        senderId: 'char-a',
        senderName: '苏苏',
        content: '我刚才在群里是不是说重了？',
        timestamp: 1,
      }),
      buildMessage({
        type: 'ai',
        senderId: 'char-b',
        senderName: '阿远',
        content: '有一点，但我知道你不是故意的。',
        timestamp: 2,
      }),
    ], new Map(), 12, { currentSpeakerId: 'char-a', chatType: buildAiDirectChat().type });

    expect(rendered).toEqual([
      { role: 'assistant', content: '我刚才在群里是不是说重了？' },
      { role: 'user', content: '阿远: 有一点，但我知道你不是故意的。' },
    ]);
  });

  it('does not duplicate raw recent dialogue inside the system prompt window summary', () => {
    const character = buildCharacter();
    const prompt = buildSystemPromptWithContext(character, buildChat(), 0, [
      buildMessage({ type: 'user', senderId: 'user', senderName: '开发者', content: '这种违约金要怎么举证？' }),
      buildMessage({ type: 'ai', senderId: 'char-a', senderName: '专业律师', content: '你这个问题问到了实务中的痛点。' }),
    ], new Map([[character.id, character]]));

    expect(prompt).toContain('## Conversation Window');
    expect(prompt).toContain('complete recent transcript is provided separately');
    expect(prompt).toContain('Recent visible turns: 2');
    expect(prompt).not.toContain('这种违约金要怎么举证');
    expect(prompt).not.toContain('你这个问题问到了实务中的痛点');
  });

  it('does not target the latest AI speaker in group prompts without explicit address evidence', () => {
    const speaker = buildCharacter({ id: 'char-a', name: '喜羊羊' });
    const latestAi = buildCharacter({ id: 'char-b', name: '灰太狼' });
    const trace = buildPromptMemoryTrace(speaker, { ...buildChat(), memberIds: ['char-a', 'char-b'] }, [
      buildMessage({ senderId: 'char-b', senderName: '灰太狼', content: '你这话听着就不靠谱。' }),
    ], new Map([
      [speaker.id, speaker],
      [latestAi.id, latestAi],
    ]));

    expect(trace.targetActorId).toBeUndefined();
    expect(trace.targetReason).toBeUndefined();
  });

  it('targets the latest AI speaker in group prompts when that message explicitly addresses the current speaker', () => {
    const speaker = buildCharacter({ id: 'char-a', name: '喜羊羊' });
    const latestAi = buildCharacter({ id: 'char-b', name: '灰太狼' });
    const message = buildMessage({ senderId: 'char-b', senderName: '灰太狼', content: '刚才那个锅底方案我不太同意。' }) as Message & {
      addressedTargetIds: string[];
      primaryAddressedTargetId: string;
    };
    message.addressedTargetIds = ['char-a'];
    message.primaryAddressedTargetId = 'char-a';

    const trace = buildPromptMemoryTrace(speaker, { ...buildChat(), memberIds: ['char-a', 'char-b'] }, [message], new Map([
      [speaker.id, speaker],
      [latestAi.id, latestAi],
    ]));

    expect(trace.targetActorId).toBe('char-b');
    expect(trace.targetReason).toBe('来自上一条消息的明确指向');
  });

  it('does not let stale human guidance retarget prompt memory after a newer user turn', () => {
    const speaker = buildCharacter({ id: 'char-a', name: '潇潇' });
    const target = buildCharacter({ id: 'char-b', name: '阿强' });
    const trace = buildPromptMemoryTrace(speaker, { ...buildChat(), memberIds: ['char-a', 'char-b'] }, [
      buildMessage({ type: 'user', senderId: 'user', senderName: '开发者', content: '阿强刚才怎么看？', timestamp: 1 }),
      buildMessage({ type: 'ai', senderId: 'char-a', senderName: '潇潇', content: '我先说我的看法。', timestamp: 2 }),
      buildMessage({ type: 'user', senderId: 'user', senderName: '开发者', content: '第二章又讲了什么？', timestamp: 3 }),
    ], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));

    expect(trace.targetActorId).toBeUndefined();
    expect(trace.targetReason).toBeUndefined();
  });

  it('includes every manual memory seed field in the unified prompt', () => {
    const character = buildCharacter({
      memory: {
        shortTermSummary: '刚和用户聊过春季穿搭',
        longTerm: ['记得用户喜欢低饱和配色'],
        secrets: ['不想承认自己接了商业合作'],
        obsessions: ['总会关注鞋包搭配'],
        tabooTopics: ['被质疑审美时会防御'],
        userMemories: ['用户预算有限但重视质感'],
      },
    });

    const prompt = buildSystemPromptWithContext(character, buildChat(), 0, [], new Map([[character.id, character]]));

    expect(prompt).toContain('## Manual Memory Seeds');
    expect(prompt).toContain('刚和用户聊过春季穿搭');
    expect(prompt).toContain('记得用户喜欢低饱和配色');
    expect(prompt).toContain('不想承认自己接了商业合作');
    expect(prompt).toContain('总会关注鞋包搭配');
    expect(prompt).toContain('被质疑审美时会防御');
    expect(prompt).toContain('用户预算有限但重视质感');
  });

  it('injects companionship context for direct chats without confirming romance', () => {
    const character = buildCharacter({
      memory: {
        shortTermSummary: '',
        longTerm: [],
        secrets: [],
        obsessions: [],
        tabooTopics: [],
        userMemories: ['用户说过明天面试会紧张。'],
      },
    });
    const prompt = buildSystemPromptWithContext(character, buildDirectChat(), 0, [
      buildMessage({ type: 'user', senderId: 'user', senderName: '用户', content: '明天面试有点紧张。' }),
    ], new Map([[character.id, character]]));

    expect(prompt).toContain('## Companionship Context');
    expect(prompt).toContain('Pending care topics');
    expect(prompt).toContain('明天面试');
    expect(prompt).toContain('Do not claim a confirmed romantic relationship');
    expect(prompt).not.toContain('phase: confirmed relationship');
  });

  it('injects user shared memory anchors into direct companionship context', () => {
    const character = buildCharacter({
      layeredMemories: [{
        id: 'user-anchor',
        scope: 'relationship',
        layer: 'long_term',
        kind: 'bond',
        ownerId: 'char-a',
        subjectIds: ['char-a', 'user'],
        text: '第一次深夜聊天后，苏苏记住了用户当时没有退出对话。',
        evidenceText: '用户那晚陪苏苏聊到很晚。',
        salience: 0.9,
        confidence: 0.9,
        recency: 0.7,
        reinforcementCount: 2,
        sourceEventIds: ['evt-user-anchor'],
        origin: 'distilled',
        createdAt: 10,
        updatedAt: 20,
      }],
      relationships: [{
        characterId: 'char-b',
        warmth: 90,
        competence: 10,
        trust: 90,
        threat: 0,
        note: '共同秘密是只有他们知道的暗号。',
      }],
    });
    const prompt = buildSystemPromptWithContext(character, buildDirectChat(), 0, [
      buildMessage({ type: 'user', senderId: 'user', senderName: '用户', content: '今天有点累。' }),
    ], new Map([[character.id, character]]));

    expect(prompt).toContain('Shared memory anchors with the user');
    expect(prompt).toContain('第一次深夜聊天');
    expect(prompt).not.toContain('只有他们知道的暗号');
  });

  it('does not inject companionship context for group chats', () => {
    const character = buildCharacter();
    const prompt = buildSystemPromptWithContext(character, buildChat(), 0, [
      buildMessage({ type: 'user', senderId: 'user', senderName: '用户', content: '明天面试有点紧张。' }),
    ], new Map([[character.id, character]]));

    expect(prompt).not.toContain('## Companionship Context');
  });

  it('keeps shared secrets masked in public group prompts', () => {
    const speaker = buildCharacter({
      relationships: [{
        characterId: 'char-b',
        warmth: 72,
        competence: 10,
        trust: 86,
        threat: 0,
        note: '共同秘密是只有他们知道的暗号：雨夜便利店。',
      }],
    });
    const target = buildCharacter({ id: 'char-b', name: '阿远' });
    const chat = { ...buildChat(), memberIds: ['char-a', 'char-b'] };
    const prompt = buildSystemPromptWithContext(speaker, chat, 0, [buildMessage()], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));

    expect(prompt).toContain('## Public Shared-Secret Guard');
    expect(prompt).toContain('一个只有熟人懂的暗号');
    expect(prompt).toContain('Do not reveal privateText');
    expect(prompt).not.toContain('雨夜便利店');

    const trace = buildPromptMemoryTrace(speaker, chat, [buildMessage()], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));
    expect(trace.sharedSecretGuards).toContain('群聊避嫌：一个只有熟人懂的暗号 · sealed');
  });

  it('allows pair-private shared secret recall in AI direct prompts', () => {
    const speaker = buildCharacter({
      relationships: [{
        characterId: 'char-b',
        warmth: 72,
        competence: 10,
        trust: 86,
        threat: 0,
        note: '共同秘密是只有他们知道的暗号：雨夜便利店。',
      }],
    });
    const target = buildCharacter({ id: 'char-b', name: '阿远' });
    const prompt = buildSystemPromptWithContext(speaker, buildAiDirectChat(), 0, [
      buildMessage({ senderId: 'char-b', senderName: '阿远', content: '你刚刚在群里怎么突然岔开话题？' }),
    ], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));

    expect(prompt).toContain('## Pair-Private Shared Secrets');
    expect(prompt).toContain('雨夜便利店');
    expect(prompt).toContain('you may use these as subtext or recall them directly');

    const trace = buildPromptMemoryTrace(speaker, buildAiDirectChat(), [
      buildMessage({ senderId: 'char-b', senderName: '阿远', content: '你刚刚在群里怎么突然岔开话题？' }),
    ], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));
    expect(trace.sharedSecretGuards).toContain('AI私聊可召回：阿远 · 一个只有熟人懂的暗号 · sealed');
  });

  it('exposes archived memories that were actually injected into the prompt trace', () => {
    const speaker = buildCharacter({ layeredMemories: [memory()] });
    const target = buildCharacter({ id: 'char-b', name: '阿远' });
    const chat = { ...buildChat(), memberIds: ['char-a', 'char-b'] };
    const message = buildMessage() as Message & { addressedTargetIds: string[]; primaryAddressedTargetId: string };
    message.addressedTargetIds = [speaker.id];
    message.primaryAddressedTargetId = speaker.id;
    const trace = buildPromptMemoryTrace(speaker, chat, [message], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));

    expect(trace.injectedIds).toContain('old-memory');
    expect(trace.recalledArchives[0]).toMatchObject({
      id: 'old-memory',
      recallReason: expect.stringContaining('旧档'),
    });
  });

  it('prioritizes the person named by human guidance over the latest AI speaker', () => {
    const speaker = buildCharacter({
      id: 'char-a',
      name: '苏苏',
      layeredMemories: [
        memory({
          id: 'about-target',
          ownerId: 'char-a',
          subjectIds: ['char-c'],
          text: '苏苏记得林北上次替她挡了一句难听话。',
          summary: '林北曾替苏苏解围。',
          archivedAt: 10,
        }),
        memory({
          id: 'about-latest-speaker',
          ownerId: 'char-a',
          subjectIds: ['char-b'],
          text: '苏苏记得阿远昨天跑题。',
          summary: '阿远昨天跑题。',
          archivedAt: null,
          salience: 0.95,
          confidence: 0.95,
          recency: 1,
        }),
      ],
    });
    const latestSpeaker = buildCharacter({ id: 'char-b', name: '阿远' });
    const namedTarget = buildCharacter({ id: 'char-c', name: '林北' });
    const chat = { ...buildChat(), memberIds: ['char-a', 'char-b', 'char-c'] };
    const trace = buildPromptMemoryTrace(speaker, chat, [
      buildMessage({ id: 'ai-latest', senderId: 'char-b', senderName: '阿远', content: '继续刚才那个梗。', timestamp: 2 }),
      buildMessage({ id: 'user-guidance', type: 'god', senderId: 'user', senderName: '开发者', content: '苏苏说说你怎么看林北', timestamp: 3 }),
    ], new Map([
      [speaker.id, speaker],
      [latestSpeaker.id, latestSpeaker],
      [namedTarget.id, namedTarget],
    ]));

    expect(trace.injectedIds).toContain('about-target');
    expect(trace).toMatchObject({
      targetActorId: 'char-c',
      targetActorName: '林北',
      targetReason: '来自人工点名中的被谈论对象',
    });
    expect(trace.recalledArchives[0]).toMatchObject({
      id: 'about-target',
      recallReason: expect.stringContaining('旧档'),
    });
  });

  it('uses media request subjects as targeted memory subjects instead of only the sender', () => {
    const sender = buildCharacter({
      id: 'char-a',
      name: '美羊羊',
      layeredMemories: [memory({
        id: 'gray-wolf-portrait-memory',
        ownerId: 'char-a',
        subjectIds: ['char-c'],
        text: '美羊羊记得灰太狼特别在意胡子有没有画歪。',
        summary: '灰太狼很在意胡子是否对称。',
        archivedAt: 10,
      })],
    });
    const latestSpeaker = buildCharacter({ id: 'char-b', name: '懒羊羊' });
    const subject = buildCharacter({ id: 'char-c', name: '灰太狼' });
    const chat = { ...buildChat(), memberIds: ['char-a', 'char-b', 'char-c'] };
    const trace = buildPromptMemoryTrace(sender, chat, [
      buildMessage({ id: 'ai-latest', senderId: 'char-b', senderName: '懒羊羊', content: '我想继续聊零食。', timestamp: 2 }),
      buildMessage({ id: 'user-image', type: 'god', senderId: 'user', senderName: '开发者', content: '美羊羊发个灰太狼证件照的图片', timestamp: 3 }),
    ], new Map([
      [sender.id, sender],
      [latestSpeaker.id, latestSpeaker],
      [subject.id, subject],
    ]));

    expect(trace.injectedIds).toContain('gray-wolf-portrait-memory');
    expect(trace).toMatchObject({
      targetActorId: 'char-c',
      targetActorName: '灰太狼',
      targetReason: '来自人工发图请求的图片对象',
    });
    expect(trace.recalledArchives[0]?.summary).toContain('灰太狼');
  });

  it('injects readable memory context into generation prompts without raw ids or enum labels', () => {
    const speaker = buildCharacter({
      id: leakySpeakerId,
      name: '喜羊羊',
      layeredMemories: [memory({
        id: 'leaky-memory',
        ownerId: leakySpeakerId,
        subjectIds: [leakyTargetId],
        scope: 'relationship',
        layer: 'long_term',
        kind: 'status_shift',
        text: `${leakySpeakerId} 在 status_shift 后开始回避 ${leakyTargetId}`,
        evidenceText: `source events: ${leakySpeakerId} relationship_delta ${leakyTargetId}`,
        sourceTag: 'unknown_internal_source',
        archivedAt: null,
        salience: 0.95,
        confidence: 0.92,
        recency: 0.9,
      })],
    });
    const target = buildCharacter({ id: leakyTargetId, name: '灰太狼' });
    const chat = { ...buildChat(), memberIds: [leakySpeakerId, leakyTargetId] };
    const prompt = buildSystemPromptWithContext(speaker, chat, 0, [
      buildMessage({ senderId: leakyTargetId, senderName: '灰太狼', content: '你刚才是不是又躲开了？' }),
    ], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));

    expect(prompt).toContain('喜羊羊');
    expect(prompt).toContain('灰太狼');
    expect(prompt).toContain('state shift');
    expect(prompt).not.toContain(leakySpeakerId);
    expect(prompt).not.toContain(leakyTargetId);
    expect(prompt).not.toContain('status_shift');
    expect(prompt).not.toContain('relationship_delta');
    expect(prompt).not.toContain('source events');
    expect(prompt).not.toContain('unknown_internal_source');
    expect(prompt).not.toContain('[relationship/');
  });

  it('sanitizes recalled memory trace summaries while keeping structural trace fields', () => {
    const speaker = buildCharacter({
      id: leakySpeakerId,
      name: '喜羊羊',
      layeredMemories: [memory({
        id: 'archived-leaky-memory',
        ownerId: leakySpeakerId,
        subjectIds: [leakyTargetId],
        scope: 'relationship',
        layer: 'long_term',
        kind: 'status_shift',
        text: `${leakySpeakerId} 因 status_shift 记住了 ${leakyTargetId} 的追问`,
        sourceTag: 'unknown_internal_source',
        archivedAt: 10,
      })],
    });
    const target = buildCharacter({ id: leakyTargetId, name: '灰太狼' });
    const chat = { ...buildChat(), memberIds: [leakySpeakerId, leakyTargetId] };
    const message = buildMessage({ senderId: leakyTargetId, senderName: '灰太狼', content: '你还记得那次追问吗？' }) as Message & {
      addressedTargetIds: string[];
      primaryAddressedTargetId: string;
    };
    message.addressedTargetIds = [speaker.id];
    message.primaryAddressedTargetId = speaker.id;
    const trace = buildPromptMemoryTrace(speaker, chat, [
      message,
    ], new Map([
      [speaker.id, speaker],
      [target.id, target],
    ]));

    expect(trace.recalledArchives[0]).toMatchObject({
      id: 'archived-leaky-memory',
      scope: 'relationship',
      kind: 'status_shift',
      layer: 'long_term',
    });
    expect(trace.recalledArchives[0].summary).toContain('喜羊羊');
    expect(trace.recalledArchives[0].summary).toContain('灰太狼');
    expect(trace.recalledArchives[0].summary).not.toContain(leakySpeakerId);
    expect(trace.recalledArchives[0].summary).not.toContain(leakyTargetId);
    expect(trace.recalledArchives[0].summary).not.toContain('status_shift');
  });
});
