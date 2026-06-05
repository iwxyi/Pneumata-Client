import { describe, expect, it } from 'vitest';
import { clearResolvedFieldConflicts, detectPendingFieldConflicts } from './syncConflictRecords';

describe('syncConflictRecords', () => {
  it('records remote field updates that collide with local pending fields', () => {
    const conflicts = detectPendingFieldConflicts({
      entityType: 'chat',
      now: 300,
      localEntities: [{ id: 'chat-1', name: '本地标题', updatedAt: 200 }],
      remoteEntities: [{ id: 'chat-1', name: '云端标题', updatedAt: 250 }],
      pendingOperations: [{
        id: 'op-1',
        entityId: 'chat-1',
        clientTimestamp: 200,
        patch: { name: '本地标题' },
        status: 'pending',
        attemptCount: 0,
      }],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: 'chat:chat-1:name',
      field: 'name',
      localValue: '本地标题',
      remoteValue: '云端标题',
      localOperationIds: ['op-1'],
    });
  });

  it('does not record conflicts for equal values or metadata-only fields', () => {
    const conflicts = detectPendingFieldConflicts({
      entityType: 'character',
      localEntities: [{ id: 'character-1', name: '小甲', updatedAt: 200 }],
      remoteEntities: [{ id: 'character-1', name: '小甲', updatedAt: 250 }],
      pendingOperations: [{
        id: 'op-1',
        entityId: 'character-1',
        clientTimestamp: 200,
        patch: { name: '小甲', updatedAt: 200 },
        status: 'pending',
        attemptCount: 0,
      }],
    });

    expect(conflicts).toEqual([]);
  });

  it('clears conflicts by entity or operation id', () => {
    const records = detectPendingFieldConflicts({
      entityType: 'chat',
      localEntities: [{ id: 'chat-1', name: '本地标题' }],
      remoteEntities: [{ id: 'chat-1', name: '云端标题' }],
      pendingOperations: [{
        id: 'op-1',
        entityId: 'chat-1',
        clientTimestamp: 200,
        patch: { name: '本地标题' },
        status: 'pending',
        attemptCount: 0,
      }],
    });

    expect(clearResolvedFieldConflicts(records, { entityType: 'chat', operationIds: ['op-1'] })).toEqual([]);
  });
});
