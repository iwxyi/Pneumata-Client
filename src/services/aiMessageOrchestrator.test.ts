import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';

const chatEngineMocks = vi.hoisted(() => {
  class EmptyGeneratedResponseError extends Error {
    localInterceptionReported: boolean;
    reason: string;

    constructor(speakerName: string, options?: { localInterceptionReported?: boolean; reason?: string; message?: string }) {
      const reason = options?.reason || 'empty_content';
      super(options?.message || `${speakerName} 没有生成有效内容，本轮已跳过。`);
      this.name = 'EmptyGeneratedResponseError';
      this.localInterceptionReported = Boolean(options?.localInterceptionReported);
      this.reason = reason;
    }
  }

  return {
    EmptyGeneratedResponseError,
    generateSpeakerMessage: vi.fn(),
  };
});

const commitMocks = vi.hoisted(() => ({
  commitGeneratedMessageTurn: vi.fn(),
}));

vi.mock('./chatEngine', () => chatEngineMocks);
vi.mock('./generatedMessageTurnCommit', () => commitMocks);

import { generateAndCommitAiMessage } from './aiMessageOrchestrator';

function buildCharacter(id: string, name: string): AICharacter {
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
  };
}

function buildChat(): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '测试群',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a'],
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
  };
}

function buildParams(patch: Partial<Parameters<typeof generateAndCommitAiMessage>[0]> = {}): Parameters<typeof generateAndCommitAiMessage>[0] {
  const speaker = buildCharacter('a', '甲');
  return {
    api: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' } as APIConfig,
    aiProfiles: [],
    chatId: 'chat-1',
    chat: buildChat(),
    speaker,
    characters: [speaker],
    currentMessages: [],
    timestamp: 1000,
    onCommit: vi.fn(),
    upsertMessage: vi.fn(),
    updateCharacter: vi.fn(),
    appendEventMessage: vi.fn(),
    updateChat: vi.fn(),
    recordSpeak: vi.fn(),
    ...patch,
  };
}

describe('generateAndCommitAiMessage', () => {
  beforeEach(() => {
    chatEngineMocks.generateSpeakerMessage.mockReset();
    commitMocks.commitGeneratedMessageTurn.mockReset();
    commitMocks.commitGeneratedMessageTurn.mockResolvedValue({ segments: [], results: [] });
  });

  it('does not write whitespace-only streaming chunks to the visible message', async () => {
    const upsertMessage = vi.fn();
    const onChunk = vi.fn();
    chatEngineMocks.generateSpeakerMessage.mockImplementationOnce(async (args: { onChunk?: (content: string) => void }) => {
      args.onChunk?.('                                                            ');
      args.onChunk?.('有效内容');
      return { id: 'msg-1', chatId: 'chat-1', type: 'ai', senderId: 'a', senderName: '甲', content: '有效内容', emotion: 0 } as Message;
    });

    await generateAndCommitAiMessage(buildParams({ upsertMessage, onChunk }));

    const writtenContents = upsertMessage.mock.calls.map((call) => (call[0] as Message).content);
    expect(writtenContents).toEqual(['']);
    expect(commitMocks.commitGeneratedMessageTurn).toHaveBeenCalledWith(expect.objectContaining({
      streamingMessage: expect.objectContaining({ content: '' }),
    }));
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('有效内容');
  });

  it('deletes the streaming placeholder when generation ends with empty content', async () => {
    const upsertMessage = vi.fn();
    chatEngineMocks.generateSpeakerMessage.mockRejectedValueOnce(new chatEngineMocks.EmptyGeneratedResponseError('甲', { reason: 'empty_content' }));

    await expect(generateAndCommitAiMessage(buildParams({ upsertMessage }))).rejects.toThrow('没有生成有效内容');

    expect(upsertMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: '',
      isDeleted: true,
      isStreaming: false,
    }));
  });
});
