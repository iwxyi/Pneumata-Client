import { describe, expect, it, vi } from 'vitest';
import { localOutboxStorageKey, mirrorLocalOutboxQueues, mirrorLocalOutboxSourceQueue } from './localOutboxMirror';
import type { LocalOutboxRecord } from './localOutboxDb';
import type { LocalOutboxScopeType } from './localOutboxProjection';

function createRepositoryMock() {
  const sources = new Map<LocalOutboxScopeType, LocalOutboxRecord[]>();
  return {
    repository: {
      list: vi.fn(async () => Array.from(sources.values()).flat().map((record) => ({
        ...record,
        key: `test\n${record.id}`,
        storageKey: 'test',
      }))),
      upsertMany: vi.fn(),
      remove: vi.fn(),
      replaceSource: vi.fn(async (_storageKey: string, sourceType: LocalOutboxScopeType, records: LocalOutboxRecord[]) => {
        sources.set(sourceType, records);
      }),
      selectDue: vi.fn(async () => null),
      markStatus: vi.fn(async () => null),
    },
    sources,
  };
}

describe('localOutboxMirror', () => {
  it('uses the current local data user as the outbox storage key', () => {
    expect(localOutboxStorageKey('user-1')).toBe('pneumata-local-outbox-user-1');
  });

  it('mirrors each source queue into isolated outbox sources', async () => {
    const { repository, sources } = createRepositoryMock();
    await mirrorLocalOutboxQueues({
      characterOperations: [{
        id: 'character-op-1',
        kind: 'patch',
        entityId: 'character-1',
        targetIds: ['character-1'],
        patch: { name: '新名字' },
        clientTimestamp: 100,
        status: 'pending',
        attemptCount: 0,
      }],
      chatOperations: [{
        id: 'chat-op-1',
        kind: 'patch',
        entityId: 'chat-1',
        targetIds: ['chat-1'],
        patch: { deletedAt: 200 },
        clientTimestamp: 200,
        status: 'failed',
        attemptCount: 2,
        lastError: 'server_unavailable: 502',
      }],
      messageOperations: [{
        id: 'message-op-1',
        kind: 'create',
        chatId: 'chat-1',
        localMessageId: 'local-message-1',
        createdAt: 300,
        status: 'syncing',
        attemptCount: 1,
      }],
      artifactJobs: [{
        id: 'artifact-job-1',
        kind: 'diary',
        characterId: 'character-1',
        dateKey: '2026-06-08',
        status: 'running',
        attempts: 1,
        createdAt: 400,
      }],
    }, { repository, storageKey: 'test-outbox', now: 500 });

    expect(repository.replaceSource).toHaveBeenCalledTimes(4);
    expect(sources.get('character')?.[0]).toMatchObject({
      id: 'character-op-1',
      sourceType: 'character',
      sourceId: 'character-op-1',
      status: 'pending',
      updatedAt: 500,
      payload: expect.objectContaining({ patch: { name: '新名字' } }),
    });
    expect(sources.get('chat')?.[0]).toMatchObject({
      id: 'chat-op-1',
      status: 'failed',
      priority: 80,
      lastError: 'server_unavailable: 502',
    });
    expect(sources.get('message')?.[0]).toMatchObject({
      id: 'message-op-1',
      status: 'syncing',
      priority: 100,
    });
    expect(sources.get('artifact')?.[0]).toMatchObject({
      id: 'artifact-job-1',
      status: 'syncing',
      sourceType: 'artifact',
    });
  });

  it('writes empty source records so stale outbox rows can be cleared', async () => {
    const { repository, sources } = createRepositoryMock();
    sources.set('chat', [{
      id: 'old-chat-op',
      sourceType: 'chat',
      sourceId: 'old-chat-op',
      scopeType: 'chat',
      kind: 'patch',
      targetId: 'chat-1',
      targetIds: ['chat-1'],
      status: 'pending',
      createdAt: 1,
      attemptCount: 0,
      lastError: null,
      retryAt: 0,
      lockedAt: 0,
      priority: 10,
      updatedAt: 1,
    }]);

    await mirrorLocalOutboxQueues({}, { repository, storageKey: 'test-outbox', now: 2 });

    expect(sources.get('chat')).toEqual([]);
    expect(repository.replaceSource).toHaveBeenCalledWith('test-outbox', 'chat', []);
  });

  it('can mirror one source queue without clearing other source queues', async () => {
    const { repository, sources } = createRepositoryMock();
    sources.set('chat', [{
      id: 'chat-op-1',
      sourceType: 'chat',
      sourceId: 'chat-op-1',
      scopeType: 'chat',
      kind: 'patch',
      targetId: 'chat-1',
      targetIds: ['chat-1'],
      status: 'pending',
      createdAt: 1,
      attemptCount: 0,
      lastError: null,
      retryAt: 0,
      lockedAt: 0,
      priority: 10,
      updatedAt: 1,
    }]);

    await mirrorLocalOutboxSourceQueue('message', {
      messageOperations: [{
        id: 'message-op-1',
        kind: 'create',
        chatId: 'chat-1',
        localMessageId: 'local-message-1',
        createdAt: 300,
        status: 'pending',
        attemptCount: 0,
      }],
    }, { repository, storageKey: 'test-outbox', now: 500 });

    expect(repository.replaceSource).toHaveBeenCalledTimes(1);
    expect(repository.replaceSource).toHaveBeenCalledWith('test-outbox', 'message', [
      expect.objectContaining({
        id: 'message-op-1',
        sourceType: 'message',
        status: 'pending',
      }),
    ]);
    expect(sources.get('chat')?.[0]?.id).toBe('chat-op-1');
    expect(sources.get('message')?.[0]?.id).toBe('message-op-1');
  });
});
