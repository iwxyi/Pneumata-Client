import { describe, expect, it } from 'vitest';
import { postProcessHumanChat } from './dialogueHumanizer';
import type { SpeakIntent } from './intentEngine';
import type { Message } from '../types/message';

function questionOnlyIntent(): SpeakIntent {
  return {
    shouldSpeak: true,
    reason: 'test',
    target: 'group',
    stance: 'challenge',
    emotionalTone: 'annoyed',
    delivery: 'quick_question',
    messageShape: 'question_only',
  };
}

function fragmentIntent(): SpeakIntent {
  return {
    shouldSpeak: true,
    reason: 'test',
    target: 'group',
    stance: 'side_comment',
    emotionalTone: 'excited',
    delivery: 'side_remark',
    messageShape: 'fragment',
  };
}

function message(content: string): Message {
  return {
    id: `msg-${content}`,
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-1',
    senderName: '甲',
    content,
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
  };
}

describe('dialogueHumanizer', () => {
  it('keeps a long follow-up stance after a question instead of truncating to the first sentence', () => {
    expect(
      postProcessHumanChat(
        '谁站你这边了？我只是看喜羊羊不顺眼，而且你刚才那句“大家都一样”本来就站不住脚；要是真一样，为什么每次出事都只让一个人出来背锅？',
        questionOnlyIntent(),
      ),
    ).toBe('谁站你这边了？我只是看喜羊羊不顺眼，而且你刚才那句“大家都一样”本来就站不住脚；要是真一样，为什么每次出事都只让一个人出来背锅？');
  });

  it('keeps generated fragment-shaped content intact instead of cutting at the first sentence boundary', () => {
    expect(
      postProcessHumanChat(
        '笑死，这话说得好像你刚才没在旁边拱火一样。先别急着装无辜，把你自己那半句解释清楚再说。',
        fragmentIntent(),
      ),
    ).toBe('笑死，这话说得好像你刚才没在旁边拱火一样。先别急着装无辜，把你自己那半句解释清楚再说。');
  });

  it('does not remove a repeated opening phrase from the generated message', () => {
    const recent = [
      message('我先说结论，这个办法能用。'),
      message('我先说结论，你们现在的问题不在这里。'),
    ];

    expect(
      postProcessHumanChat(
        '我先说结论，这里不能再靠本地规则截断，否则流式结束后就会丢前半句。',
        fragmentIntent(),
        undefined,
        recent,
      ),
    ).toBe('我先说结论，这里不能再靠本地规则截断，否则流式结束后就会丢前半句。');
  });

  it('does not strip formal lead-ins because they may be intentional content', () => {
    expect(
      postProcessHumanChat(
        '我觉得，这句话前面的三个字不能被本地后处理吃掉。',
        questionOnlyIntent(),
      ),
    ).toBe('我觉得，这句话前面的三个字不能被本地后处理吃掉。');
  });

  it('does not collapse repeated words or punctuation inside generated content', () => {
    expect(
      postProcessHumanChat(
        '等等，等等，这不是重复废话，是角色真的急了！！',
        fragmentIntent(),
      ),
    ).toBe('等等，等等，这不是重复废话，是角色真的急了！！');
  });
});
