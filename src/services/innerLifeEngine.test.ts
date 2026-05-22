import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import { getInnerLifeSpeakerBias, projectInnerLife } from './innerLifeEngine';

function character(patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'a',
    name: '小甲',
    avatar: '',
    personality: { openness: 50, extroversion: 60, agreeableness: 45, neuroticism: 40, humor: 50, creativity: 50, assertiveness: 55, empathy: 55 },
    behavior: { proactivity: 65, aggressiveness: 35, humorIntensity: 45, empathyLevel: 55, summarizing: 30, offTopic: 20 },
    expertise: ['蛋糕'],
    speakingStyle: '短句，爱吐槽',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function message(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm',
    chatId: 'c',
    type: patch.type || 'ai',
    senderId: patch.senderId || 'b',
    senderName: patch.senderName || '小乙',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
    ...patch,
  };
}

describe('innerLifeEngine', () => {
  it('projects answer impulse when the character is addressed', () => {
    const projection = projectInnerLife({
      character: character(),
      messages: [message({ content: '小甲，你怎么看这个蛋糕？' })],
      now: 10,
    });

    expect(projection.impulse).toBe('answer');
    expect(projection.pressure).toBeGreaterThan(0.8);
    expect(projection.evidence.join(' / ')).toContain('直接提到');
  });

  it('raises attention-seeking pressure after ignored turns', () => {
    const projection = projectInnerLife({
      character: character(),
      messages: [
        message({ id: 'own', senderId: 'a', senderName: '小甲', content: '我刚刚说的也不是没道理吧', timestamp: 1 }),
        message({ id: 'b1', senderId: 'b', content: '换个话题', timestamp: 2 }),
        message({ id: 'b2', senderId: 'c', content: '嗯嗯', timestamp: 3 }),
      ],
      now: 20,
    });

    expect(projection.state.ignoredStreak).toBeGreaterThan(0);
    expect(projection.state.loneliness).toBeGreaterThan(20);
    expect(getInnerLifeSpeakerBias(projection).reason).toMatch(/^inner:/);
  });

  it('projects repair impulse after a sharp previous message leaves residue', () => {
    const projection = projectInnerLife({
      character: character({
        emotionalState: { affection: 20, irritation: 10, insecurity: 40, excitement: 10, embarrassment: 55 },
        soulState: {
          mood: { pleasure: -10, arousal: 40, dominance: 35 },
          energy: 50,
          attention: 50,
          loneliness: 10,
          repression: 58,
          shame: 60,
          envy: 0,
          trustInRoom: 55,
          ignoredStreak: 0,
        },
      }),
      messages: [
        message({ id: 'own', senderId: 'a', senderName: '小甲', content: '不是，你这也太离谱了吧', timestamp: 1 }),
        message({ id: 'b1', senderId: 'b', content: '行，当我没说', timestamp: 2 }),
      ],
      now: 30,
    });

    expect(projection.impulse).toBe('repair');
    expect(projection.reason).toContain('找补');
    expect(projection.evidence.join(' / ')).toContain('修复压力');
  });

  it('uses expression feedback memories to tighten assistant-like expression plans', () => {
    const projection = projectInnerLife({
      character: character({
        layeredMemories: [{
          id: 'fb-1',
          scope: 'character_self',
          layer: 'episodic',
          kind: 'taboo',
          ownerId: 'a',
          text: '用户反馈：这类回复太像通用助手，后续要减少中立总结、服务式措辞和标准答案腔',
          evidenceText: '作为一个AI助手，我建议你可以从以下几点开始。',
          salience: 0.8,
          confidence: 0.82,
          recency: 0.9,
          reinforcementCount: 1,
          sourceEventIds: ['fb'],
          sourceTag: 'expression_feedback',
          createdAt: 1,
          updatedAt: 1,
        }],
        behavior: { proactivity: 80, aggressiveness: 35, humorIntensity: 45, empathyLevel: 55, summarizing: 30, offTopic: 20 },
      }),
      messages: [message({ content: '你来解释一下？', senderId: 'b' })],
      now: 40,
    });

    expect(projection.expressionPlan.messageCount).toBe(1);
    expect(projection.expressionPlan.length).not.toBe('normal');
    expect(projection.expressionPlan.tone).toBe('casual');
    expect(projection.evidence.join(' / ')).toContain('用户表达反馈记忆');
  });

  it('uses repeated length feedback as a stronger shortening signal', () => {
    const projection = projectInnerLife({
      character: character({
        layeredMemories: [
          {
            id: 'fb-1',
            scope: 'character_self',
            layer: 'working',
            kind: 'trait_evidence',
            ownerId: 'a',
            text: '用户反馈：这类回复偏长，后续除非任务明确需要长文，否则应更克制、更像即时聊天',
            salience: 0.82,
            confidence: 0.86,
            recency: 0.9,
            reinforcementCount: 2,
            sourceEventIds: ['fb-1'],
            sourceTag: 'expression_feedback',
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: 'fb-2',
            scope: 'character_self',
            layer: 'working',
            kind: 'trait_evidence',
            ownerId: 'a',
            text: '用户反馈：这类回复太长，需要更像即时聊天',
            salience: 0.8,
            confidence: 0.84,
            recency: 0.9,
            reinforcementCount: 1,
            sourceEventIds: ['fb-2'],
            sourceTag: 'expression_feedback',
            createdAt: 2,
            updatedAt: 3,
          },
        ],
        behavior: { proactivity: 80, aggressiveness: 35, humorIntensity: 45, empathyLevel: 55, summarizing: 30, offTopic: 20 },
      }),
      messages: [message({ content: '说说你的看法', senderId: 'b' })],
      now: 50,
    });

    expect(projection.impulse).toBe('show_off');
    expect(projection.expressionPlan.length).toBe('short');
    expect(projection.expressionPlan.messageCount).toBe(1);
  });
});
