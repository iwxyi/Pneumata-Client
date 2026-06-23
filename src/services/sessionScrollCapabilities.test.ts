import { describe, expect, it } from 'vitest';
import { resolveSessionScrollCapabilities } from './sessionScrollCapabilities';

describe('sessionScrollCapabilities', () => {
  it('keeps chat-like rooms sticky to the latest tail by default', () => {
    expect(resolveSessionScrollCapabilities({
      sessionKind: { family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
    })).toEqual({
      autoStickToBottom: true,
      autoContinueFromTail: true,
    });
  });

  it('preserves the reader anchor while a story-reader explicit continuation is pending', () => {
    expect(resolveSessionScrollCapabilities({
      sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
      explicitContinuationPending: true,
    })).toEqual({
      autoStickToBottom: false,
      autoContinueFromTail: false,
    });
  });

  it('restores story-reader tail following after the reader reaches the new tail', () => {
    expect(resolveSessionScrollCapabilities({
      sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
      explicitContinuationPending: false,
    })).toEqual({
      autoStickToBottom: true,
      autoContinueFromTail: true,
    });
  });
});
