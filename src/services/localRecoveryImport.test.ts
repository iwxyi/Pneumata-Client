import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importLocalRecoverySnapshot } from './localRecoveryImport';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import { normalizeCharacter, type AICharacter } from '../types/character';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, normalizeConversation, type GroupChat } from '../types/chat';
import type { Message } from '../types/message';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() {
        return values.size;
      },
    },
    configurable: true,
  });
});

vi.mock('../stores/storeSyncScheduler', async () => {
  const actual = await vi.importActual<typeof import('../stores/storeSyncScheduler')>('../stores/storeSyncScheduler');
  return {
    ...actual,
    scheduleSyncWorkersByPriority: vi.fn(() => ['message.pending-operations']),
  };
});

function character(id: string, updatedAt: number, name = id): AICharacter {
  return normalizeCharacter({
    id,
    name,
    avatar: '',
    personality: {
      openness: 0.5,
      extroversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
      humor: 0.5,
      creativity: 0.5,
      assertiveness: 0.5,
      empathy: 0.5,
    },
    behavior: {
      proactivity: 0.5,
      aggressiveness: 0.5,
      humorIntensity: 0.5,
      empathyLevel: 0.5,
      summarizing: 0.5,
      offTopic: 0.5,
    },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: {
      longTerm: [],
      shortTermSummary: '',
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
    intervention: {
      allowSpeakAs: true,
      allowDirectorPrompt: true,
      allowPrivateThread: true,
    },
    isPreset: false,
    createdAt: 1,
    updatedAt,
  });
}

function chat(id: string, updatedAt: number, name = id): GroupChat {
  return normalizeConversation({
    id,
    type: 'group',
    mode: 'open_chat',
    modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    name,
    topic: '',
    style: 'free',
    memberIds: [],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    createdAt: 1,
    updatedAt,
    lastMessageAt: updatedAt,
  });
}

function message(id: string, timestamp: number, content = id): Message {
  return {
    id,
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: 'User',
    content,
    emotion: 0,
    timestamp,
    isDeleted: false,
  };
}

beforeEach(() => {
  useCharacterStore.setState({
    characters: [],
    pendingOperations: [],
    pendingEditSyncCount: 0,
    pendingEditSyncError: null,
    isLoading: false,
  });
  useChatStore.setState({
    chats: [],
    pendingOperations: [],
    pendingEditSyncCount: 0,
    pendingEditSyncError: null,
    isLoading: false,
  });
  useMessageStore.setState({
    messages: [],
    messageWindowsByChatId: {},
    pendingOperations: [],
    activeChatId: 'chat-1',
    isLoading: false,
    isLoadingOlder: false,
  });
  useCharacterArtifactStore.setState({
    items: [],
    jobs: [],
    unreadLetterCount: 0,
    isProcessing: false,
  });
});

describe('importLocalRecoverySnapshot', () => {
  it('merges recovery data without overwriting newer local records', () => {
    useCharacterStore.setState({
      characters: [character('char-1', 200, 'local-newer')],
    });
    useChatStore.setState({
      chats: [chat('chat-1', 300, 'local-chat')],
    });

    const result = importLocalRecoverySnapshot({
      version: 1,
      data: {
        characters: [character('char-1', 100, 'snapshot-older'), character('char-2', 100, 'snapshot-new')],
        chats: [chat('chat-1', 100, 'snapshot-older'), chat('chat-2', 100, 'snapshot-new')],
        pendingOperations: {
          characters: [{ id: 'character-op-1', status: 'pending', updatedAt: 10 }],
          chats: [{ id: 'chat-op-1', status: 'failed', lastError: 'boom', updatedAt: 20 }],
        },
      },
    });

    expect(useCharacterStore.getState().characters.map((item) => [item.id, item.name])).toEqual([
      ['char-1', 'local-newer'],
      ['char-2', 'snapshot-new'],
    ]);
    expect(useChatStore.getState().chats.map((item) => [item.id, item.name])).toEqual([
      ['chat-1', 'local-chat'],
      ['chat-2', 'snapshot-new'],
    ]);
    expect(useCharacterStore.getState().pendingOperations).toHaveLength(1);
    expect(useChatStore.getState().pendingEditSyncError).toBe('boom');
    expect(result.counts.characters.preserved).toBe(1);
    expect(result.counts.characters.imported).toBe(1);
    expect(result.counts.chats.preserved).toBe(1);
    expect(result.counts.chats.imported).toBe(1);
  });

  it('merges message windows and artifact unread counts', () => {
    useMessageStore.setState({
      messageWindowsByChatId: {
        'chat-1': {
          messages: [message('msg-1', 100, 'local')],
          lastSyncedAt: 100,
          updatedAt: 100,
        },
      },
      messages: [message('msg-1', 100, 'local')],
      activeChatId: 'chat-1',
    });

    const result = importLocalRecoverySnapshot({
      version: 1,
      data: {
        messageWindowsByChatId: {
          'chat-1': {
            messages: [message('msg-1', 100, 'duplicate'), message('msg-2', 200, 'imported')],
            lastSyncedAt: 200,
            updatedAt: 200,
          },
        },
        characterArtifacts: {
          items: [{
            id: 'letter-1',
            kind: 'birth_letter',
            characterId: 'char-1',
            characterName: '角色',
            title: '信',
            text: '内容',
            source: 'local',
            unread: true,
            createdAt: 1,
            updatedAt: 1,
          }],
          jobs: [{ id: 'job-1', status: 'pending', updatedAt: 1 }],
        },
        pendingOperations: {
          messages: [{ id: 'message-op-1', status: 'pending', updatedAt: 1 }],
        },
        settings: { api: { apiKey: '' } },
        activeMessages: [message('ignored-active', 300)],
      },
    });

    expect(useMessageStore.getState().messageWindowsByChatId['chat-1'].messages.map((item) => item.id)).toEqual(['msg-1', 'msg-2']);
    expect(useMessageStore.getState().messages.map((item) => item.id)).toEqual(['msg-1', 'msg-2']);
    expect(useMessageStore.getState().pendingOperations).toHaveLength(1);
    expect(useCharacterArtifactStore.getState().unreadLetterCount).toBe(1);
    expect(result.ignored).toEqual(['settings', 'activeMessages']);
    expect(result.counts.messages.imported).toBe(1);
  });
});
