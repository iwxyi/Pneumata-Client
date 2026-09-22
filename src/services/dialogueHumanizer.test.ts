import { describe, expect, it } from 'vitest';
import { buildHumanizationPrompt, postProcessHumanChat } from './dialogueHumanizer';
import type { SpeakIntent } from './intentEngine';
import type { Message } from '../types/message';
import type { AICharacter } from '../types/character';

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

function backingIntent(): SpeakIntent {
  return {
    shouldSpeak: true,
    reason: 'test',
    target: 'char-2',
    stance: 'back_up',
    emotionalTone: 'warm',
    delivery: 'short_reply',
    messageShape: 'single_sentence',
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

function messageFrom(senderId: string, content: string): Message {
  return {
    ...message(content),
    id: `msg-${senderId}-${content}`,
    senderId,
    senderName: senderId,
  };
}

function character(): AICharacter {
  return {
    id: 'char-1',
    name: '甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 30 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    speechProfile: { catchphrases: [], fillers: [], tabooPhrases: [], preferredOpeners: [], preferredClosers: [], sentenceLengthBias: 'short', questionBias: 30, sarcasmBias: 10 },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('dialogueHumanizer', () => {
  it('treats a topic guidance seed as opening context rather than prior dialogue', () => {
    const prompt = buildHumanizationPrompt(
      character(),
      fragmentIntent(),
      [{
        id: 'guide-1',
        chatId: 'chat-1',
        type: 'god',
        senderId: 'user',
        senderName: '话题引导',
        content: '围绕赛博茶馆开场。',
        emotion: 0,
        timestamp: 1,
        isDeleted: false,
      }],
    );

    expect(prompt).toContain('This is the first visible message in the room');
    expect(prompt).not.toContain('Preferred archetype:');
  });

  it('does not turn selective focus or side-comment style into a length cap', () => {
    const prompt = buildHumanizationPrompt(
      character(),
      fragmentIntent(),
      [message('你能不能把这个问题完整解释一下？')],
    );

    expect(prompt).toContain('Selective focus is an attention prior only');
    expect(prompt).toContain('must not cap answer length');
    expect(prompt).toContain('任务需要时要继续说完整');
    expect(prompt).toContain('Natural group chat often leaves part of the previous message untouched');
    expect(prompt).toContain('Do not prove you understood every metaphor, acronym, or example');
    expect(prompt).not.toContain('不要自成完整段落');
  });

  it('allows ordinary chat to respond to gist instead of proving every technical term was understood', () => {
    const prompt = buildHumanizationPrompt(
      character(),
      {
        shouldSpeak: true,
        reason: 'test',
        target: 'group',
        stance: 'support',
        emotionalTone: 'cold',
        delivery: 'short_reply',
        messageShape: 'single_sentence',
      },
      [message('这个外部 watchdog 要是没人维护，定时器本身也会失效。')],
    );

    expect(prompt).toContain('Do not prove you understood every metaphor, acronym, or example');
    expect(prompt).toContain('承认没接住其中的术语');
  });

  it('does not latch onto repeated agreement phrases when the room is echoing', () => {
    const prompt = buildHumanizationPrompt(
      character(),
      backingIntent(),
      [
        messageFrom('char-2', '这句我也接。先把分寸立住。'),
        messageFrom('char-3', '这后辈说得不差。先护住肯担的人。'),
        messageFrom('char-4', '这句补得对。最后满殿站着的就都是算盘。'),
        messageFrom('char-2', '嗯，这回我站他。先把有骨头的人护住。'),
      ],
    );

    expect(prompt).toContain('agreement echo');
    expect(prompt).toContain('brief personal show of support');
    expect(prompt).toContain('Stop restating the shared conclusion');
    expect(prompt).toContain('Preferred archetype: 护住关系');
    expect(prompt).not.toContain('Preferred archetype: 顺手站边');
    expect(prompt).not.toContain('Latch onto this phrase or point if useful: 这回我站他');
  });

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
