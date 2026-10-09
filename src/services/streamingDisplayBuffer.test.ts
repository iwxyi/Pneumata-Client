import { describe, expect, it } from 'vitest';
import { getNextStreamingDisplayContent } from './streamingDisplayBuffer';

describe('getNextStreamingDisplayContent', () => {
  it('reveals incoming streaming text progressively', () => {
    expect(getNextStreamingDisplayContent('', 'abcdef')).toBe('a');
    expect(getNextStreamingDisplayContent('a', 'abcdef')).toBe('ab');
  });

  it('uses larger steps for long incoming text without jumping to the end', () => {
    const target = 'x'.repeat(160);

    expect(getNextStreamingDisplayContent('', target)).toBe('x'.repeat(4));
    expect(getNextStreamingDisplayContent('x'.repeat(4), target)).toBe('x'.repeat(8));
  });

  it('jumps to target when stream content is rewritten', () => {
    expect(getNextStreamingDisplayContent('旧内容', '新内容')).toBe('新内容');
  });
});
