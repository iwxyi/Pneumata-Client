import { describe, expect, it } from 'vitest';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import {
  createMessageRevisionDraft,
  getMessageBranchVersionInfo,
  getRevisionSiblingIndex,
  isMessageBranchingEnabled,
  projectActiveBranchMessages,
} from './messageBranching';

function buildChat(overrides: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: 'Test',
    topic: 'Test',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['user'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  };
}

function buildMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'chatId' | 'type' | 'senderId' | 'senderName' | 'content' | 'emotion' | 'timestamp'>): Message {
  return {
    ...overrides,
    isDeleted: overrides.isDeleted ?? false,
  };
}

describe('messageBranching', () => {
  it('enables branching only for the allowlisted text rooms', () => {
    expect(isMessageBranchingEnabled(buildChat())).toBe(true);
    expect(isMessageBranchingEnabled(buildChat({
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
    }))).toBe(false);
    expect(isMessageBranchingEnabled(buildChat({
      sessionKind: { topology: 'team', family: 'agent', scenarioId: 'single-agent-workflow', surfaceProfile: 'dashboard' },
    }))).toBe(false);
  });

  it('projects a linear transcript unchanged when no branch selection exists', () => {
    const messages = [
      buildMessage({ id: 'm-1', chatId: 'chat-1', type: 'user', senderId: 'user', senderName: 'User', content: 'A', emotion: 0, timestamp: 1 }),
      buildMessage({ id: 'm-2', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'B', emotion: 0, timestamp: 2 }),
      buildMessage({ id: 'm-3', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'C', emotion: 0, timestamp: 3 }),
    ];

    expect(projectActiveBranchMessages(buildChat(), messages).map((message) => message.id)).toEqual(['m-1', 'm-2', 'm-3']);
  });

  it('switches to a revision branch without deleting the old continuation', () => {
    const messages = [
      buildMessage({ id: 'm-a', chatId: 'chat-1', type: 'user', senderId: 'user', senderName: 'User', content: 'A', emotion: 0, timestamp: 1 }),
      buildMessage({ id: 'm-b', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'B', emotion: 0, timestamp: 2 }),
      buildMessage({ id: 'm-c', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'C', emotion: 0, timestamp: 3 }),
      buildMessage({
        id: 'm-b2',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: 'B2',
        emotion: 0,
        timestamp: 4,
        metadata: {
          branching: {
            parentNodeId: 'm-a',
            revisionRootId: 'm-b',
            revisionOfMessageId: 'm-b',
          },
        },
      }),
      buildMessage({
        id: 'm-d',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: 'D',
        emotion: 0,
        timestamp: 5,
      }),
    ];

    const chat = buildChat({
      messageBranchState: {
        selectedRevisionByRootId: { 'm-b': 'm-b2' },
        activeChildByParentNodeId: { 'm-a': 'm-b2' },
        activeLeafNodeId: 'm-d',
      },
    });

    expect(projectActiveBranchMessages(chat, messages).map((message) => message.id)).toEqual(['m-a', 'm-b2', 'm-d']);
    expect(getRevisionSiblingIndex(chat, messages, 'm-b')).toBe('1/2');
    expect(getRevisionSiblingIndex(chat, messages, 'm-b2')).toBe('2/2');

    const info = getMessageBranchVersionInfo(chat, messages, 'm-b2');
    expect(info?.nodeIds).toEqual(['m-b', 'm-b2']);
    expect(info?.total).toBe(2);
    expect(info?.isActive).toBe(true);
  });

  it('keeps the original branch active when selection points at the old revision', () => {
    const messages = [
      buildMessage({ id: 'm-a', chatId: 'chat-1', type: 'user', senderId: 'user', senderName: 'User', content: 'A', emotion: 0, timestamp: 1 }),
      buildMessage({ id: 'm-b', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'B', emotion: 0, timestamp: 2 }),
      buildMessage({ id: 'm-c', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'C', emotion: 0, timestamp: 3 }),
      buildMessage({
        id: 'm-b2',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: 'B2',
        emotion: 0,
        timestamp: 4,
        metadata: {
          branching: {
            parentNodeId: 'm-a',
            revisionRootId: 'm-b',
            revisionOfMessageId: 'm-b',
          },
        },
      }),
    ];

    const chat = buildChat({
      messageBranchState: {
        selectedRevisionByRootId: { 'm-b': 'm-b' },
        activeChildByParentNodeId: { 'm-a': 'm-b' },
      },
    });

    expect(projectActiveBranchMessages(chat, messages).map((message) => message.id)).toEqual(['m-a', 'm-b', 'm-c']);
  });

  it('creates a revision draft with immutable branch metadata', () => {
    const sourceMessage = buildMessage({
      id: 'm-b',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'ai-1',
      senderName: 'AI',
      content: 'B',
      emotion: 0,
      timestamp: 2,
    });

    const revision = createMessageRevisionDraft({
      sourceMessage,
      parentNodeId: 'm-a',
      content: 'B revised',
      nodeId: 'm-b2',
    });

    expect(revision.content).toBe('B revised');
    expect(revision.metadata?.branching).toMatchObject({
      nodeId: 'm-b2',
      parentNodeId: 'm-a',
      revisionRootId: 'm-b',
      revisionOfMessageId: 'm-b',
      createdFromMessageId: 'm-b',
    });
    expect(revision.senderId).toBe('ai-1');
    expect(revision.senderName).toBe('AI');
  });
});
