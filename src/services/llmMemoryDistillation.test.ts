import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConversation, type GroupChat } from '../types/chat';
import { DEFAULT_API_CONFIG } from '../types/settings';
import type { MemoryItem } from './memoryTypes';
import { distillChatMemoriesWithLlm, shouldRunLlmChatDistillation } from './llmMemoryDistillation';

const generateJsonResponseMock = vi.fn();

vi.mock('./aiClient', () => ({
  generateJsonResponse: (...args: unknown[]) => generateJsonResponseMock(...args),
}));

function buildChat(layeredMemories: MemoryItem[]): GroupChat {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a', 'char-b', 'char-c', 'char-d', 'char-e'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    layeredMemories,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildRuntimeMemoryItem(args: {
  id: string;
  subjectIds: string[];
  eventIds: string[];
  updatedAt: number;
}): MemoryItem {
  return {
    id: args.id,
    ownerId: 'chat-1',
    scope: 'relationship',
    layer: 'working',
    kind: 'resentment',
    subjectIds: args.subjectIds,
    text: `${args.id}-evidence`,
    evidenceText: `${args.id} 的完整原始对话证据：这是一段比摘要更完整的互动原文`,
    salience: 0.82,
    confidence: 0.85,
    recency: 0.92,
    reinforcementCount: 1,
    sourceEventIds: args.eventIds,
    sourceTag: 'interaction',
    origin: 'runtime',
    createdAt: args.updatedAt - 50,
    updatedAt: args.updatedAt,
  };
}

function buildLlmMemoryItem(eventIds: string[], distilledAt: number, distilledFromIds: string[]): MemoryItem {
  return {
    id: 'llm-1',
    ownerId: 'chat-1',
    scope: 'relationship',
    layer: 'long_term',
    kind: 'resentment',
    subjectIds: ['char-a', 'char-b'],
    text: '长期拉扯主线',
    salience: 0.9,
    confidence: 0.88,
    recency: 1,
    reinforcementCount: 1,
    sourceEventIds: eventIds,
    sourceTag: 'llm_memory_distillation',
    origin: 'distilled',
    distilledFromIds,
    distilledAt,
    distillationVersion: 'llm-v2',
    createdAt: distilledAt,
    updatedAt: distilledAt,
  };
}

function buildRuntimeBatch(args: {
  prefix: string;
  eventStart: number;
  count: number;
  updatedAt: number;
  eventsPerItem?: number;
}) {
  const subjectPatterns = [
    ['char-a', 'char-b'],
    ['char-a', 'char-c'],
    ['char-b', 'char-d'],
    ['char-c', 'char-e'],
  ];
  const eventsPerItem = args.eventsPerItem || 1;
  return Array.from({ length: args.count }, (_, index) => {
    const start = args.eventStart + (index * eventsPerItem);
    const eventIds = Array.from({ length: eventsPerItem }, (__unused, offset) => `evt-${start + offset}`);
    return buildRuntimeMemoryItem({
      id: `${args.prefix}-${index + 1}`,
      subjectIds: subjectPatterns[index % subjectPatterns.length],
      eventIds,
      updatedAt: args.updatedAt,
    });
  });
}

describe('llmMemoryDistillation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('tracks the full source event coverage in chat LLM distillation candidates', async () => {
    generateJsonResponseMock.mockResolvedValue(JSON.stringify({
      items: [
        {
          scope: 'relationship',
          kind: 'resentment',
          subjectIds: ['char-a', 'char-b'],
          text: '红太狼和沸羊羊长期互相顶牛。',
          confidence: 0.84,
        },
      ],
    }));
    const source = buildRuntimeBatch({ prefix: 'seed', eventStart: 1, count: 18, updatedAt: 200, eventsPerItem: 1 });
    const chat = buildChat(source);

    const result = await distillChatMemoriesWithLlm(DEFAULT_API_CONFIG, chat);

    expect(generateJsonResponseMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceEventIds).toEqual(expect.arrayContaining(source.map((item) => item.sourceEventIds[0])));
    expect(new Set(result[0]?.sourceEventIds || []).size).toBe(18);
    expect(result[0]?.evidenceText).toContain('完整原始对话证据');
    expect(generateJsonResponseMock.mock.calls[0]?.[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining('原始证据'),
      }),
    ]));
  });

  it('does not rerun chat LLM distillation when post-distillation updates only reuse covered evidence', () => {
    const coveredSource = buildRuntimeBatch({ prefix: 'covered', eventStart: 1, count: 12, updatedAt: 3200, eventsPerItem: 2 });
    const coveredEventIds = Array.from(new Set(coveredSource.flatMap((item) => item.sourceEventIds)));
    const latestLlmItem = buildLlmMemoryItem(coveredEventIds, 3000, coveredSource.map((item) => item.id));
    const chat = buildChat([latestLlmItem, ...coveredSource]);

    expect(shouldRunLlmChatDistillation(chat, 0)).toBe(false);
  });

  it('reruns chat LLM distillation only after enough truly new evidence accumulates', () => {
    const seenEventIds = Array.from({ length: 18 }, (_, index) => `evt-${index + 1}`);
    const latestLlmItem = buildLlmMemoryItem(seenEventIds, 3000, ['old-1', 'old-2']);
    const novelSource = buildRuntimeBatch({ prefix: 'novel', eventStart: 19, count: 12, updatedAt: 3600, eventsPerItem: 2 });
    const chat = buildChat([latestLlmItem, ...novelSource]);

    expect(shouldRunLlmChatDistillation(chat, 0)).toBe(true);
  });
});
