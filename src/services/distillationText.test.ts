import { describe, expect, it } from 'vitest';
import { sanitizeMemoryText, sanitizeMemoryTexts } from './distillationText';

describe('memory text sanitization', () => {
  it('removes full and truncated uuid-like source ids from slash-separated memory text', () => {
    expect(sanitizeMemoryText(
      '群聊稳定关系趋势：灰太狼→小灰灰 支持：灰太狼 → 小灰灰 · 儿子说得对 / 3c78729f-e52d-4dde-b27f / 群聊长期拉扯主轴：喜羊羊→蕉太狼 轻视：喜羊羊 → 蕉太狼 · 蕉太狼你别打岔 / 19b22fbd-9d0c-45f7-97b8-822'
    )).toBe(
      '群聊稳定关系趋势：灰太狼→小灰灰 支持：灰太狼 → 小灰灰 · 儿子说得对 / 群聊长期拉扯主轴：喜羊羊→蕉太狼 轻视：喜羊羊 → 蕉太狼 · 蕉太狼你别打岔'
    );
  });

  it('deduplicates repeated memory texts after id removal', () => {
    expect(sanitizeMemoryTexts([
      '灰太狼支持小灰灰 / 3c78729f-e52d-4dde-b27f',
      '灰太狼支持小灰灰 / 3c78729f-e52d-4dde-b27f',
    ])).toEqual(['灰太狼支持小灰灰']);
  });
});
