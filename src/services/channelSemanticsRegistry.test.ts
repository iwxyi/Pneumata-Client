import { describe, expect, it } from 'vitest';
import { getChannelSemantics } from './channelSemanticsRegistry';

describe('channelSemanticsRegistry', () => {
  it('returns distinct semantics for direct, ai_direct, and group', () => {
    expect(getChannelSemantics({ type: 'direct' }).targetPriority).toBe('latest_human');
    expect(getChannelSemantics({ type: 'ai_direct' }).targetPriority).toBe('counterpart');
    expect(getChannelSemantics({ type: 'group' }).targetPriority).toBe('room_thread');
  });

  it('keeps private character conversation distinct from the neutral assistant channel', () => {
    const direct = getChannelSemantics({ type: 'direct' });
    expect(direct.promptPrefix).toContain('private conversation between this person and the user');
    expect(direct.promptPrefix).toContain('explicit request for help or a deliverable');
    expect(direct.promptPrefix).not.toContain('primary job is to answer');
    expect(getChannelSemantics({ type: 'assistant' }).promptPrefix).toContain('neutral assistant channel');
  });
});
