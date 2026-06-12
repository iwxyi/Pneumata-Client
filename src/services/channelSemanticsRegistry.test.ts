import { describe, expect, it } from 'vitest';
import { getChannelSemantics } from './channelSemanticsRegistry';

describe('channelSemanticsRegistry', () => {
  it('returns distinct semantics for direct, ai_direct, and group', () => {
    expect(getChannelSemantics({ type: 'direct' }).targetPriority).toBe('latest_human');
    expect(getChannelSemantics({ type: 'ai_direct' }).targetPriority).toBe('counterpart');
    expect(getChannelSemantics({ type: 'group' }).targetPriority).toBe('room_thread');
  });
});
