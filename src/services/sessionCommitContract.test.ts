import { describe, expect, it, vi } from 'vitest';
import { applyCommitTransition } from './sessionCommitContract';

describe('applyCommitTransition', () => {
  it('appends runtime events sequentially', async () => {
    let activeAppends = 0;
    let maxConcurrentAppends = 0;
    const callTrace: string[] = [];

    await applyCommitTransition({
      chatId: 'chat-1',
      speakerId: 'speaker-1',
      transition: {
        chatPatch: {},
        characterPatches: [],
        runtimeEvents: [
          { eventType: 'event-1', title: '事件1', summary: 'A' },
          { eventType: 'event-2', title: '事件2', summary: 'B' },
          { eventType: 'event-3', title: '事件3', summary: 'C' },
        ],
      },
      services: {
        updateCharacter: vi.fn(async () => undefined),
        appendEventMessage: vi.fn(async (_chatId, payload) => {
          activeAppends += 1;
          maxConcurrentAppends = Math.max(maxConcurrentAppends, activeAppends);
          callTrace.push(`start:${payload.eventType}`);
          await Promise.resolve();
          callTrace.push(`end:${payload.eventType}`);
          activeAppends -= 1;
        }),
        updateChat: vi.fn(async () => undefined),
        recordSpeak: vi.fn(),
      },
    });

    expect(maxConcurrentAppends).toBe(1);
    expect(callTrace).toEqual([
      'start:event-1',
      'end:event-1',
      'start:event-2',
      'end:event-2',
      'start:event-3',
      'end:event-3',
    ]);
  });

  it('normalizes runtime event timestamps into a strict ascending order', async () => {
    const createdAts: number[] = [];

    await applyCommitTransition({
      chatId: 'chat-1',
      speakerId: 'speaker-1',
      transition: {
        chatPatch: {},
        characterPatches: [],
        runtimeEvents: [
          { eventType: 'event-1', title: '事件1', summary: 'A', createdAt: 1000 },
          { eventType: 'event-2', title: '事件2', summary: 'B', createdAt: 1000 },
          { eventType: 'event-3', title: '事件3', summary: 'C', createdAt: 999 },
        ],
      },
      services: {
        updateCharacter: vi.fn(async () => undefined),
        appendEventMessage: vi.fn(async (_chatId, payload) => {
          createdAts.push(payload.createdAt as number);
        }),
        updateChat: vi.fn(async () => undefined),
        recordSpeak: vi.fn(),
      },
    });

    expect(createdAts).toHaveLength(3);
    expect(createdAts[0]).toBe(1000);
    expect(createdAts[1]).toBe(1001);
    expect(createdAts[2]).toBe(1002);
  });
});
