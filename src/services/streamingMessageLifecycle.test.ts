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

  it('keeps streamed content when finalization returns a shorter substring', () => {
    expect(
      resolveCommittedStreamContent(
        '谁站你这边了？',
        '谁站你这边了？我只是看喜羊羊不顺眼',
      ),
    ).toBe('谁站你这边了？我只是看喜羊羊不顺眼');
  });

  it('does not lose the opening text when finalization trims to a comma-boundary suffix', () => {
    expect(
      resolveCommittedStreamContent(
        '这里不能再靠本地规则截断，否则流式结束后就会丢前半句。',
        '我先说结论，这里不能再靠本地规则截断，否则流式结束后就会丢前半句。',
      ),
    ).toBe('我先说结论，这里不能再靠本地规则截断，否则流式结束后就会丢前半句。');
  });

  it('keeps streamed content when punctuation normalization reveals suffix truncation', () => {
    expect(
      resolveCommittedStreamContent(
        '这个点不是不能聊只是你们现在全在绕开真正的问题要不先把谁负责讲清楚',
        '我先说结论，这个点不是不能聊，只是你们现在全在绕开真正的问题，要不先把谁负责讲清楚？',
      ),
    ).toBe('我先说结论，这个点不是不能聊，只是你们现在全在绕开真正的问题，要不先把谁负责讲清楚？');
  });

  it('does not discard a draft when the same message is already committed', () => {
    const current = message({ id: 'local-1', isStreaming: true, content: '逐字内容' });
    const committed = message({ id: 'local-1', isStreaming: false, content: '最终内容' });

    expect(shouldDiscardStreamingDraft(current, null)).toBe(true);
    expect(shouldDiscardStreamingDraft(current, message({ id: 'local-1', isStreaming: true }))).toBe(true);
    expect(shouldDiscardStreamingDraft(current, committed)).toBe(false);
  });
});
