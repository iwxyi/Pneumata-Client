import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { resolveCommittedStreamContent, shouldDiscardStreamingDraft } from './streamingMessageLifecycle';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-1',
    senderName: '甲',
    content: '内容',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    ...overrides,
  };
}

describe('streamingMessageLifecycle', () => {
  it('keeps the last streamed content when final content is unexpectedly empty', () => {
    expect(resolveCommittedStreamContent('', '逐字出现的内容')).toBe('逐字出现的内容');
    expect(resolveCommittedStreamContent('   ', '逐字出现的内容')).toBe('逐字出现的内容');
    expect(resolveCommittedStreamContent('最终内容', '逐字出现的内容')).toBe('最终内容');
  });

  it('prefers the finalized content when the streamed draft is only a prefix', () => {
    expect(
      resolveCommittedStreamContent(
        '谁站你这边了？',
        '谁站你这边了？我只是看喜羊羊不顺眼',
      ),
    ).toBe('谁站你这边了？');
  });

  it('does not discard a draft when the same message is already committed', () => {
    const current = message({ id: 'local-1', isStreaming: true, content: '逐字内容' });
    const committed = message({ id: 'local-1', isStreaming: false, content: '最终内容' });

    expect(shouldDiscardStreamingDraft(current, null)).toBe(true);
    expect(shouldDiscardStreamingDraft(current, message({ id: 'local-1', isStreaming: true }))).toBe(true);
    expect(shouldDiscardStreamingDraft(current, committed)).toBe(false);
  });
});
