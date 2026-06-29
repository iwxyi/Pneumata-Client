import { describe, expect, it } from 'vitest';
import { shouldUseRichMarkdown } from './MarkdownText';

describe('MarkdownText markdown detection', () => {
  it('keeps common chat prose on the plain text path', () => {
    expect(shouldUseRichMarkdown('沈清婉的手指停在梳背上，那几根灰白发丝在烛光里几乎透明。')).toBe(false);
    expect(shouldUseRichMarkdown('第一行普通文本\n第二行普通文本')).toBe(false);
  });

  it('uses the rich renderer for markdown syntax', () => {
    expect(shouldUseRichMarkdown('## 标题')).toBe(true);
    expect(shouldUseRichMarkdown('- 列表项')).toBe(true);
    expect(shouldUseRichMarkdown('[链接](https://example.com)')).toBe(true);
    expect(shouldUseRichMarkdown('```ts\nconst x = 1;\n```')).toBe(true);
    expect(shouldUseRichMarkdown('| A | B |\n| - | - |')).toBe(true);
  });
});
