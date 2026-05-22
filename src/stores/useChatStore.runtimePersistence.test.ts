import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  DEFAULT_OPEN_CHAT_MODE_CONFIG,
  DEFAULT_OPEN_CHAT_MODE_STATE,
  type GroupChat,
} from '../types/chat';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import type { MemoryItem } from '../services/memoryTypes';

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function memory(index: number): MemoryItem {
  return {
    id: `memory-${index}`,
    scope: 'conversation',
    layer: 'episodic',
    kind: 'status_shift',
    ownerId: 'chat-1',
    text: `记忆 ${index}`,
    salience: 50,
    confidence: 0.8,
    recency: 50,
    reinforcementCount: 1,
    sourceEventIds: [`event-${index}`],
    createdAt: index,
    updatedAt: index,
  };
}

function runtimeEvent(index: number): RuntimeEventV2 {
  return {
    id: `event-${index}`,
    conversationId: 'chat-1',
    kind: 'room_shift',
    createdAt: index,
    summary: `房间变化 ${index}`,
    visibility: 'public',
    payload: { heat: index },
  };
}

function relationship(index: number): RelationshipLedgerEntry {
  return {
    pairKey: `a-${index}->b-${index}`,
    actorId: `a-${index}`,
    targetId: `b-${index}`,
    current: { warmth: 1, competence: 0, trust: 2, threat: 0 },
    trend: 'up',
    recentEvents: [],
    lastUpdatedAt: index,
  };
}

function chat(overrides: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    name: '测试群聊',
    topic: '测试主题',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    layeredMemories: [],
    runtimeSeed: { notes: [], artifacts: [] },
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood: '紧张', focus: '关系变化' },
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  };
}

describe('chat runtime persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
    localStorage.setItem('miragetea-auth-mode', 'cloud');
    localStorage.setItem('miragetea-token', 'test-token');
  });

  it('keeps bounded runtime fields in cloud patches', async () => {
    const { __chatRuntimePersistenceForTests } = await import('./useChatStore');
    const { compactChatPatchForCloud, limits } = __chatRuntimePersistenceForTests;
    const patch = compactChatPatchForCloud({
      layeredMemories: Array.from({ length: limits.layeredMemories + 5 }, (_, index) => memory(index)),
      runtimeSeed: {
        notes: Array.from({ length: limits.runtimeSeedNotes + 3 }, (_, index) => `note-${index}`),
        artifacts: Array.from({ length: limits.runtimeSeedArtifacts + 3 }, (_, index) => `artifact-${index}`),
      },
      runtimeTimeline: Array.from({ length: limits.runtimeTimeline + 5 }, (_, index) => ({ type: 'note', text: `timeline-${index}`, createdAt: index })),
      runtimeEventsV2: Array.from({ length: limits.runtimeEventsV2 + 5 }, (_, index) => runtimeEvent(index)),
      relationshipLedger: Array.from({ length: limits.relationshipLedger + 5 }, (_, index) => relationship(index)),
      worldState: { mood: '紧张', focus: '关系变化', recentEvent: '刚刚被维护', conflictAxes: [] },
      updatedAt: 999,
      lastMessageAt: 999,
    });

    expect(patch.layeredMemories).toHaveLength(limits.layeredMemories);
    expect(patch.runtimeSeed).toMatchObject({
      notes: expect.arrayContaining(['note-3']),
      artifacts: expect.arrayContaining(['artifact-3']),
    });
    expect((patch.runtimeSeed as NonNullable<GroupChat['runtimeSeed']>).notes).toHaveLength(limits.runtimeSeedNotes);
    expect(patch.runtimeTimeline).toHaveLength(limits.runtimeTimeline);
    expect(patch.runtimeEventsV2).toHaveLength(limits.runtimeEventsV2);
    expect(patch.relationshipLedger).toHaveLength(limits.relationshipLedger);
    expect(patch.worldState).toMatchObject({ mood: '紧张', focus: '关系变化' });
    expect(patch.updatedAt).toBeUndefined();
    expect(patch.lastMessageAt).toBeUndefined();
  });

  it('keeps bounded runtime fields in local persistence', async () => {
    const { __chatRuntimePersistenceForTests } = await import('./useChatStore');
    const { buildPersistedChatState, limits } = __chatRuntimePersistenceForTests;
    const persisted = buildPersistedChatState({
      chats: [chat({
        layeredMemories: Array.from({ length: limits.layeredMemories + 2 }, (_, index) => memory(index)),
        runtimeTimeline: Array.from({ length: limits.runtimeTimeline + 2 }, (_, index) => ({ type: 'note', text: `timeline-${index}`, createdAt: index })),
        runtimeEventsV2: Array.from({ length: limits.runtimeEventsV2 + 2 }, (_, index) => runtimeEvent(index)),
        relationshipLedger: Array.from({ length: limits.relationshipLedger + 2 }, (_, index) => relationship(index)),
      })],
      currentChatId: 'chat-1',
      lastSyncedAt: 1,
      pendingOperations: [],
    });

    expect(persisted.chats[0].layeredMemories).toHaveLength(limits.layeredMemories);
    expect(persisted.chats[0].runtimeTimeline).toHaveLength(limits.runtimeTimeline);
    expect(persisted.chats[0].runtimeEventsV2).toHaveLength(limits.runtimeEventsV2);
    expect(persisted.chats[0].relationshipLedger).toHaveLength(limits.relationshipLedger);
  });
});
