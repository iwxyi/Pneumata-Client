import { describe, expect, it } from 'vitest';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import {
  buildMessageBranchVersionInfoByMessageId,
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
  it('enables branching by default except explicitly disabled stateful modes', () => {
    expect(isMessageBranchingEnabled(buildChat())).toBe(true);
    expect(isMessageBranchingEnabled(buildChat({
      mode: 'classroom',
      sessionKind: { topology: 'group', family: 'study', scenarioId: 'ielts-coach', surfaceProfile: 'form' },
    }))).toBe(true);
    expect(isMessageBranchingEnabled(buildChat({
      mode: 'agent_workflow',
      sessionKind: { topology: 'team', family: 'agent', scenarioId: 'single-agent-workflow', surfaceProfile: 'dashboard' },
    }))).toBe(true);
    expect(isMessageBranchingEnabled(buildChat({
      messageBranchState: { enabled: false },
    }))).toBe(false);
    expect(isMessageBranchingEnabled(buildChat({
      mode: 'scripted_play',
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
    }))).toBe(false);
    expect(isMessageBranchingEnabled(buildChat({
      mode: 'werewolf',
      sessionKind: { topology: 'table', family: 'deduction', scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid' },
    }))).toBe(false);
    expect(isMessageBranchingEnabled(buildChat({
      mode: 'murder_mystery',
      sessionKind: { topology: 'table', family: 'mystery', scenarioId: 'murder-mystery', surfaceProfile: 'hybrid' },
    }))).toBe(false);
    expect(isMessageBranchingEnabled(buildChat({
      mode: 'board_game',
      sessionKind: { topology: 'table', family: 'board_game', scenarioId: 'board-game', surfaceProfile: 'board' },
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

  it('builds branch version info in one pass for visible messages', () => {
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
        selectedRevisionByRootId: { 'm-b': 'm-b2' },
        activeChildByParentNodeId: { 'm-a': 'm-b2' },
      },
    });

    const infoById = buildMessageBranchVersionInfoByMessageId(chat, messages, ['m-b', 'm-b2']);

    expect(infoById['m-b']).toMatchObject({ index: 1, total: 2, isActive: false, nodeIds: ['m-b', 'm-b2'] });
    expect(infoById['m-b2']).toMatchObject({ index: 2, total: 2, isActive: true, nodeIds: ['m-b', 'm-b2'] });
  });

  it('skips version info for linear messages without sibling revisions', () => {
    const messages = [
      buildMessage({ id: 'm-a', chatId: 'chat-1', type: 'user', senderId: 'user', senderName: 'User', content: 'A', emotion: 0, timestamp: 1 }),
      buildMessage({ id: 'm-b', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'B', emotion: 0, timestamp: 2 }),
      buildMessage({ id: 'm-c', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'C', emotion: 0, timestamp: 3 }),
    ];

    expect(buildMessageBranchVersionInfoByMessageId(buildChat(), messages, ['m-a', 'm-b'])).toEqual({});
  });

  it('keeps the original timeline active until a revision is explicitly selected', () => {
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

    expect(projectActiveBranchMessages(buildChat(), messages).map((message) => message.id)).toEqual(['m-a', 'm-b', 'm-c']);
    expect(projectActiveBranchMessages(buildChat({ messageBranchState: { enabled: true } }), messages).map((message) => message.id)).toEqual(['m-a', 'm-b', 'm-c']);
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

  it('keeps a partial cached branch window visible when parent nodes are outside the window', () => {
    const messages = [
      buildMessage({
        id: 'm-98',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: '98',
        emotion: 0,
        timestamp: 98,
        metadata: { branching: { parentNodeId: 'm-97' } },
      }),
      buildMessage({
        id: 'm-99',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: '99',
        emotion: 0,
        timestamp: 99,
        metadata: { branching: { parentNodeId: 'm-98' } },
      }),
      buildMessage({
        id: 'm-100',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: '100',
        emotion: 0,
        timestamp: 100,
        metadata: { branching: { parentNodeId: 'm-99' } },
      }),
    ];

    expect(projectActiveBranchMessages(buildChat({
      messageBranchState: {
        activeChildByParentNodeId: { 'm-97': 'm-98' },
        activeLeafNodeId: 'm-100',
      },
    }), messages).map((message) => message.id)).toEqual(['m-98', 'm-99', 'm-100']);
  });

  it('projects every reachable component in a partial branch window', () => {
    const messages = [
      buildMessage({ id: 'm-98', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: '98', emotion: 0, timestamp: 98, metadata: { branching: { parentNodeId: null } } }),
      buildMessage({ id: 'm-99', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: '99', emotion: 0, timestamp: 99, metadata: { branching: { parentNodeId: 'm-98' } } }),
      buildMessage({ id: 'm-100', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: '100', emotion: 0, timestamp: 100, metadata: { branching: { parentNodeId: null } } }),
      buildMessage({ id: 'm-101', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: '101', emotion: 0, timestamp: 101, metadata: { branching: { parentNodeId: 'm-100' } } }),
    ];

    expect(projectActiveBranchMessages(buildChat(), messages).map((message) => message.id)).toEqual(['m-98', 'm-99', 'm-100', 'm-101']);
  });

  it('keeps later plain continuation messages when the selected branch path has a stale short tail', () => {
    const messages = [
      buildMessage({ id: 'm-a', chatId: 'chat-1', type: 'user', senderId: 'user', senderName: 'User', content: 'A', emotion: 0, timestamp: 1 }),
      buildMessage({ id: 'm-b', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'B', emotion: 0, timestamp: 2 }),
      buildMessage({
        id: 'm-b2',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: 'B2',
        emotion: 0,
        timestamp: 3,
        metadata: {
          branching: {
            parentNodeId: 'm-a',
            revisionRootId: 'm-b',
            revisionOfMessageId: 'm-b',
          },
        },
      }),
      buildMessage({ id: 'm-c', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'C', emotion: 0, timestamp: 4 }),
      buildMessage({ id: 'm-d', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'D', emotion: 0, timestamp: 5 }),
    ];

    const chat = buildChat({
      messageBranchState: {
        selectedRevisionByRootId: { 'm-b': 'm-b2' },
        activeChildByParentNodeId: { 'm-a': 'm-b2' },
        activeLeafNodeId: 'm-b2',
      },
    });

    expect(projectActiveBranchMessages(chat, messages).map((message) => message.id)).toEqual(['m-a', 'm-b2', 'm-c', 'm-d']);
  });

  it('restores nested descendant revision selections when switching back to a parent branch', () => {
    const messages = [
      buildMessage({ id: 'm-a', chatId: 'chat-1', type: 'user', senderId: 'user', senderName: 'User', content: 'A', emotion: 0, timestamp: 1 }),
      buildMessage({ id: 'm-b', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'B1', emotion: 0, timestamp: 2 }),
      buildMessage({ id: 'm-c', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'C1', emotion: 0, timestamp: 3 }),
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
      buildMessage({ id: 'm-d', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'D1', emotion: 0, timestamp: 5, metadata: { branching: { parentNodeId: 'm-b2' } } }),
      buildMessage({
        id: 'm-d2',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'ai-1',
        senderName: 'AI',
        content: 'D2',
        emotion: 0,
        timestamp: 6,
        metadata: {
          branching: {
            parentNodeId: 'm-b2',
            revisionRootId: 'm-d',
            revisionOfMessageId: 'm-d',
          },
        },
      }),
      buildMessage({ id: 'm-e', chatId: 'chat-1', type: 'ai', senderId: 'ai-1', senderName: 'AI', content: 'E', emotion: 0, timestamp: 7, metadata: { branching: { parentNodeId: 'm-d2' } } }),
    ];

    const originalParentChat = buildChat({
      messageBranchState: {
        selectedRevisionByRootId: { 'm-b': 'm-b', 'm-d': 'm-d2' },
        activeChildByParentNodeId: { 'm-a': 'm-b', 'm-b2': 'm-d2' },
      },
    });
    expect(projectActiveBranchMessages(originalParentChat, messages).map((message) => message.id)).toEqual(['m-a', 'm-b', 'm-c']);

    const restoredParentChat = buildChat({
      messageBranchState: {
        selectedRevisionByRootId: { 'm-b': 'm-b2', 'm-d': 'm-d2' },
        activeChildByParentNodeId: { 'm-a': 'm-b2', 'm-b2': 'm-d2' },
      },
    });
    expect(projectActiveBranchMessages(restoredParentChat, messages).map((message) => message.id)).toEqual(['m-a', 'm-b2', 'm-d2', 'm-e']);
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
