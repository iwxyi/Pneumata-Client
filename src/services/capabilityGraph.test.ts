import { describe, expect, it } from 'vitest';
import type { GroupChat } from '../types/chat';
import { resolveEffectiveCapabilities } from './capabilityGraph';

describe('capabilityGraph', () => {
  it('derives capabilities from scenario, style, and channel semantics', () => {
    const capabilities = resolveEffectiveCapabilities({
      id: 'chat-1',
      type: 'ai_direct',
      mode: 'open_chat',
      sessionKind: {
        topology: 'thread',
        family: 'conversation',
        scenarioId: 'ai-private-thread',
        surfaceProfile: 'text',
      },
    } as GroupChat, { styleProfile: 'companion_room', allowMarkdown: true });

    expect(capabilities.channelType).toBe('ai_direct');
    expect(capabilities.styleProfile).toBe('companion_room');
    expect(capabilities.targetPriority).toBe('counterpart');
    expect(capabilities.memoryMode).toBe('pair_private');
  });
});
