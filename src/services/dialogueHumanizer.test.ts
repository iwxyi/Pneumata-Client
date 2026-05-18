import { describe, expect, it } from 'vitest';
import { postProcessHumanChat } from './dialogueHumanizer';
import type { SpeakIntent } from './intentEngine';

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
});
