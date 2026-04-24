import { describe, expect, it, vi } from 'vitest';
import { revealMessageContent } from './sessionRunner';

describe('runSessionLoop', () => {
  it('reveals the final content progressively', async () => {
    const chunkCalls: string[] = [];

    await revealMessageContent({
      content: '最终文本',
      isActive: () => true,
      onChunk: (content) => {
        chunkCalls.push(content);
      },
    });

    expect(chunkCalls.length).toBeGreaterThan(1);
    expect(chunkCalls.at(-1)).toBe('最终文本');
  });
});
