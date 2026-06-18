import { describe, expect, it } from 'vitest';
import { getNextStreamingDisplayContent } from './streamingDisplayBuffer';

describe('getNextStreamingDisplayContent', () => {
  it('shows incoming streaming text immediately', () => {
    expect(getNextStreamingDisplayContent('', 'abcdef')).toBe('abcdef');
    expect(getNextStreamingDisplayContent('a', 'abcdef')).toBe('abcdef');
  });

  it('does not throttle long incoming text', () => {
    const target = 'x'.repeat(160);

    expect(getNextStreamingDisplayContent('', target)).toBe(target);
  });

  it('jumps to target when stream content is rewritten', () => {
    expect(getNextStreamingDisplayContent('旧内容', '新内容')).toBe('新内容');
  });
});
