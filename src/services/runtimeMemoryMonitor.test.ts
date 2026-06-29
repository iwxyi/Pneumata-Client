import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DriverMessageCommitTransition } from '../types/chat';
import { sizePendingOperationEntry, summarizeMessages, summarizeRuntimeMemoryState } from './runtimeMemoryMonitor';

describe('runtimeMemoryMonitor forensics', () => {
  beforeEach(() => {
    (globalThis as { __PNEUMATA_MEMORY_MONITOR_ENABLED__?: boolean }).__PNEUMATA_MEMORY_MONITOR_ENABLED__ = true;
  });

  afterEach(() => {
    delete (globalThis as { __PNEUMATA_MEMORY_MONITOR_ENABLED__?: boolean }).__PNEUMATA_MEMORY_MONITOR_ENABLED__;
  });

  it('summarizes active messages', () => {
    const summary = summarizeMessages([
      {
        id: 'm1',
        chatId: 'chat-1',
        type: 'event',
        senderId: 'speaker-1',
        senderName: '说话者',
        content: 'hello',
        emotion: 0,
        timestamp: 1,
        isDeleted: false,
      },
      {
        id: 'm2',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'speaker-2',
        senderName: '角色',
        content: 'world',
        emotion: 0,
        timestamp: 2,
        isDeleted: false,
        isStreaming: true,
      },
    ]);

    expect(summary).toMatchObject({
      count: 2,
      event: 1,
      streaming: 1,
      totalContentChars: 10,
      uniqueIds: 2,
    });
  });

  it('summarizes pending operations', () => {
    const entry = sizePendingOperationEntry({
      id: 'op-1',
      kind: 'patch',
      status: 'pending',
      attemptCount: 3,
      patch: { foo: 1, bar: true },
      payload: { baz: 'x' },
    }, 0);

    expect(entry).toMatchObject({
      id: 'op-1',
      label: 'patch',
      counts: {
        patchKeys: 2,
        payloadKeys: 1,
        attemptCount: 3,
      },
    });
  });

  it('keeps transition size measurements disabled outside verbose mode', () => {
    const transition = {
      chatPatch: {
        runtimeEventsV2: Array.from({ length: 20 }, (_, index) => ({ id: `event-${index}` })),
        relationshipLedger: Array.from({ length: 20 }, (_, index) => ({ characterId: `character-${index}` })),
      },
      characterPatches: Array.from({ length: 10 }, (_, index) => ({
        characterId: `character-${index}`,
        patch: {
          runtimeTimeline: Array.from({ length: 10 }, (__, itemIndex) => ({ id: `${index}-${itemIndex}` })),
        },
      })),
      runtimeEvents: Array.from({ length: 10 }, (_, index) => ({ type: 'runtime', id: `runtime-${index}` })),
      chatRuntimeDelta: {
        runtimeEventsV2: Array.from({ length: 20 }, (_, index) => ({ id: `delta-event-${index}` })),
        relationshipLedger: Array.from({ length: 20 }, (_, index) => ({ characterId: `delta-character-${index}` })),
      },
    } as unknown as DriverMessageCommitTransition;

    const summary = summarizeRuntimeMemoryState({ transition });

    expect(summary.counts.transitionRuntimeEvents).toBe(10);
    expect(summary.counts.transitionCharacterPatches).toBe(10);
    expect(summary.sizes).toMatchObject({
      transitionJson: 0,
      chatPatchJson: 0,
      characterPatchesJson: 0,
      runtimeEventsJson: 0,
      patchRuntimeEventsV2Json: 0,
      patchRelationshipLedgerJson: 0,
      runtimeDeltaJson: 0,
      runtimeDeltaEventsJson: 0,
      runtimeDeltaLedgerJson: 0,
    });
  });
});
