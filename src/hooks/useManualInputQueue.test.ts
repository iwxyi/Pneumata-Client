import { describe, expect, it, vi } from 'vitest';
import { runInterruptedManualInput } from './useManualInputQueue';

describe('interrupted manual input', () => {
  it('interrupts before waiting and resumes with the new branch after the queue releases', async () => {
    const events: string[] = [];
    const nextChat = { id: 'room', head: 'regenerated' };
    await runInterruptedManualInput({
      interrupt: () => { events.push('interrupt'); },
      enqueueManualInput: async (task) => {
        events.push('queue');
        await task();
        events.push('release');
      },
      shouldContinue: () => true,
      resumeOnCompleted: true,
      task: async () => { events.push('regenerate'); return nextChat; },
      onCompleted: (chat) => { expect(chat).toBe(nextChat); events.push('resume'); },
    });
    expect(events).toEqual(['interrupt', 'queue', 'regenerate', 'release', 'resume']);
  });

  it('keeps a previously paused conversation paused', async () => {
    const onCompleted = vi.fn();
    await runInterruptedManualInput({
      interrupt: vi.fn(),
      enqueueManualInput: async (task) => { await task(); },
      shouldContinue: () => true,
      resumeOnCompleted: false,
      task: async () => 'new-branch',
      onCompleted,
    });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it.each(['queue', 'generation'] as const)('does not resume on %s failure and exposes the error', async (failure) => {
    const error = new Error('service unavailable');
    const onCompleted = vi.fn();
    await expect(runInterruptedManualInput({
      interrupt: vi.fn(),
      enqueueManualInput: async (task) => {
        if (failure === 'queue') throw error;
        await task();
      },
      shouldContinue: () => true,
      resumeOnCompleted: true,
      task: async () => { throw error; },
      onCompleted,
    })).rejects.toBe(error);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('discards a queued request cancelled before it starts', async () => {
    const task = vi.fn(async () => 'new-branch');
    const onCompleted = vi.fn();
    await runInterruptedManualInput({
      interrupt: vi.fn(),
      enqueueManualInput: async (queuedTask) => { await queuedTask(); },
      shouldContinue: () => false,
      resumeOnCompleted: true,
      task,
      onCompleted,
    });
    expect(task).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it.each(['abort', 'epoch change'] as const)('does not restart after %s supersedes the request', async (cancellation) => {
    const controller = new AbortController();
    const requestEpoch = 1;
    let currentEpoch = requestEpoch;
    const onCompleted = vi.fn();
    await runInterruptedManualInput({
      interrupt: vi.fn(),
      enqueueManualInput: async (task) => { await task(); },
      shouldContinue: () => !controller.signal.aborted && currentEpoch === requestEpoch,
      resumeOnCompleted: true,
      task: async () => {
        if (cancellation === 'abort') controller.abort();
        else currentEpoch += 1;
        return 'late-result';
      },
      onCompleted,
    });
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
