import { describe, expect, it } from 'vitest';
import type { GeneratedRoundMessage } from './chatEngine';
import { buildGeneratedTurnContent, splitGeneratedMessageText, splitGeneratedRoundMessage } from './generatedMessageSegmenter';

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
  it('keeps long speech as one committed bubble when only legacy beat count is requested', () => {
    const content = '不是我说，这个办法能用。但是你得先把前面的坑补上，不然后面全是连环炸。还有，别再把锅扣给别人了。';
    const segments = splitGeneratedMessageText(content, 2);
    expect(segments).toEqual([content]);
  });

  it('splits only when the model provides explicit extra messages', () => {
    const message = {
      ...buildMessage('等下', 3),
      extraMessages: ['你刚说谁来着？', '我没听错吧。'],
    };
    const segments = splitGeneratedRoundMessage(message);

    expect(segments.map((item) => item.content)).toEqual(['等下', '你刚说谁来着？', '我没听错吧。']);
    expect(segments.every((item) => item.extraMessages == null)).toBe(true);
    expect(buildGeneratedTurnContent(message)).toBe('等下\n你刚说谁来着？\n我没听错吧。');
    expect(segments[0]?.metadata?.runtimeDecision).toBeTruthy();
    expect(segments[1]?.metadata?.runtimeDecision).toBeUndefined();
    expect(segments[1]?.metadata?.turnSegment).toEqual({ index: 1, count: 3 });
  });

  it('uses content as the first bubble and extra messages as later bubbles', () => {
    const message = {
      ...buildMessage('原本应该说这句。', 2),
      extraMessages: ['后面补一句。'],
    };

    const segments = splitGeneratedRoundMessage(message);
    expect(segments.map((item) => item.content)).toEqual(['原本应该说这句。', '后面补一句。']);
    expect(segments[0]?.extraMessages).toBeUndefined();
  });

  it('limits extra messages to four later bubbles without dropping generated text', () => {
    const message = {
      ...buildMessage('一', 6),
      extraMessages: ['二', '三', '四', '五', '六'],
    };

    const segments = splitGeneratedRoundMessage(message);
    expect(segments.map((item) => item.content)).toEqual(['一', '二', '三', '四', '五\n六']);
    expect(buildGeneratedTurnContent(message)).toBe('一\n二\n三\n四\n五\n六');
    expect(segments[0]?.extraMessages).toBeUndefined();
  });

  it('keeps short speech as one bubble', () => {
    expect(splitGeneratedMessageText('行吧，那我先看着。', 2)).toEqual(['行吧，那我先看着。']);
  });

  it('preserves comma-boundary text without local splitting or leading text loss', () => {
    const content = '我先说结论，这个点不是不能聊，只是你们现在全在绕开真正的问题，要不先把谁负责讲清楚？';
    expect(splitGeneratedMessageText(content, 3)).toEqual([content]);
  });

  it('keeps turn-level metadata because legacy messageCount creates no secondary segment', () => {
    const message = buildMessage('我先说结论，这个点不是不能聊。只是你们现在全在绕开真正的问题。要不先把谁负责讲清楚？', 2);
    const segments = splitGeneratedRoundMessage(message);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toBe(message);
    expect(segments[0]?.metadata?.runtimeDecision?.innerLife?.impulse).toBe('show_off');
  });

  it('does not split withdrawn or media messages', () => {
    const withdrawn = buildMessage('刚才话重了点。', 2);
    withdrawn.extraMessages = ['我换个说法。'];
    withdrawn.metadata = {
      withdrawal: {
        withdrawn: true,
        originalContent: withdrawn.content,
      },
    };
    expect(splitGeneratedRoundMessage(withdrawn).map((item) => item.content)).toEqual(['刚才话重了点。']);

    const media = buildMessage('看这个图。这个更直观。', 2);
    media.extraMessages = ['你注意这个角度。'];
    media.metadata = {
      generationDecision: {
        image: {
          shouldGenerate: true,
        },
      },
    };
    expect(splitGeneratedRoundMessage(media).map((item) => item.content)).toEqual(['看这个图。这个更直观。\n你注意这个角度。']);
  });

  it('does not split markdown longform messages', () => {
    const message = buildMessage('我把第三幕那场雨先写成这样：\n\n她站在旧站台下面，没有马上回头。广播念到最后一班车时，伞沿的水正好落在鞋尖上。\n\n“你看，”她说，“连天气都比你会道歉。”', 3);
    message.extraMessages = ['这个先别拆。'];
    message.metadata = {
      ...message.metadata,
      format: 'markdown',
    };
    expect(splitGeneratedRoundMessage(message).map((item) => item.content)).toEqual([`${message.content}\n这个先别拆。`]);
  });
});
