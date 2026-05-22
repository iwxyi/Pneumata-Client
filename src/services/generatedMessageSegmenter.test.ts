import { describe, expect, it } from 'vitest';
import type { GeneratedRoundMessage } from './chatEngine';
import { splitGeneratedMessageText, splitGeneratedRoundMessage } from './generatedMessageSegmenter';

function buildMessage(content: string, messageCount = 1): GeneratedRoundMessage {
  return {
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-1',
    senderName: '甲',
    content,
    emotion: 0,
    metadata: {
      runtimeDecision: {
        innerLife: {
          impulse: 'show_off',
          tone: 'casual',
          reason: '想多说两句',
          pressure: 0.5,
          expressionPlan: {
            messageCount,
          },
        },
      },
    },
  };
}

describe('generatedMessageSegmenter', () => {
  it('splits long speech on natural sentence boundaries', () => {
    const segments = splitGeneratedMessageText('不是我说，这个办法能用。但是你得先把前面的坑补上，不然后面全是连环炸。还有，别再把锅扣给别人了。', 2);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.join('')).toContain('这个办法能用');
    expect(segments.join('')).toContain('别再把锅扣给别人了');
  });

  it('keeps short speech as one bubble', () => {
    expect(splitGeneratedMessageText('行吧，那我先看着。', 2)).toEqual(['行吧，那我先看着。']);
  });

  it('keeps turn-level metadata only on the first segment', () => {
    const segments = splitGeneratedRoundMessage(buildMessage('我先说结论，这个点不是不能聊。只是你们现在全在绕开真正的问题。要不先把谁负责讲清楚？', 2));
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.metadata?.runtimeDecision?.innerLife?.impulse).toBe('show_off');
    expect(segments[1]?.metadata?.runtimeDecision).toBeUndefined();
  });

  it('does not split withdrawn or media messages', () => {
    const withdrawn = buildMessage('刚才话重了点。', 2);
    withdrawn.metadata = {
      withdrawal: {
        withdrawn: true,
        originalContent: withdrawn.content,
      },
    };
    expect(splitGeneratedRoundMessage(withdrawn)).toHaveLength(1);

    const media = buildMessage('看这个图。这个更直观。', 2);
    media.metadata = {
      generationDecision: {
        image: {
          shouldGenerate: true,
        },
      },
    };
    expect(splitGeneratedRoundMessage(media)).toHaveLength(1);
  });

  it('does not split markdown longform messages', () => {
    const message = buildMessage('我把第三幕那场雨先写成这样：\n\n她站在旧站台下面，没有马上回头。广播念到最后一班车时，伞沿的水正好落在鞋尖上。\n\n“你看，”她说，“连天气都比你会道歉。”', 3);
    message.metadata = {
      ...message.metadata,
      format: 'markdown',
    };
    expect(splitGeneratedRoundMessage(message)).toHaveLength(1);
  });
});
