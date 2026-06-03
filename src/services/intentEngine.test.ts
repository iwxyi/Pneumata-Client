import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { deriveSpeakIntent, deriveSpeakIntentFromContext } from './intentEngine';

function character(patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'a',
    name: '小甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 45, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 20, humorIntensity: 20, empathyLevel: 50, summarizing: 20, offTopic: 20 },
    expertise: [],
    speakingStyle: '',
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

describe('intentEngine soul state adaptation', () => {
  it('treats topic guidance as a concrete room answer intent instead of drifting with old banter', () => {
    const intent = deriveSpeakIntentFromContext(character(), undefined, '香蕉证件照也不是不行。', {
      source: 'user_message',
      beatType: 'invite',
      targetActorIds: [],
      pressure: 0.58,
      reason: '用户正在明确改变群聊焦点。',
      userGuidance: {
        kind: 'topic_shift',
        rawText: '新话题：狼抓羊有过错吗？狼应该抓羊吗？',
        actorIds: [],
        mentionedActorIds: [],
        focusText: '新话题：狼抓羊有过错吗？狼应该抓羊吗？',
        beatType: 'invite',
        pressure: 0.58,
        maxTurns: 3,
        reason: '用户正在明确改变群聊焦点。',
      },
    });

    expect(intent.reason).toContain('user topic guidance');
    expect(intent.target).toBe('group');
    expect(intent.delivery).toBe('short_reply');
  });

  it('lets moderate affection soften a default reply intent', () => {
    const intent = deriveSpeakIntent(character({
      emotionalState: { irritation: 0, affection: 32, insecurity: 0, excitement: 0, embarrassment: 0 },
    }), 'b');

    expect(intent.reason).toContain('stay close');
    expect(intent.stance).toBe('support');
    expect(intent.emotionalTone).toBe('warm');
  });

  it('lets moderate irritation carry into a challenged reply intent', () => {
    const intent = deriveSpeakIntent(character({
      emotionalState: { irritation: 34, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 },
    }), 'b');

    expect(intent.reason).toContain('tension');
    expect(intent.stance).toBe('challenge');
    expect(intent.emotionalTone).toBe('defensive');
  });

  it('keeps generic second-person pressure as room-level intent without a resolved target', () => {
    const intent = deriveSpeakIntentFromContext(character({
      behavior: { proactivity: 50, aggressiveness: 80, humorIntensity: 20, empathyLevel: 50, summarizing: 20, offTopic: 20 },
    }), undefined, '你这也太不靠谱了吧？');

    expect(intent.target).toBe('group');
  });

  it('uses direct-reply intent only after target resolution identifies the addressed actor', () => {
    const intent = deriveSpeakIntentFromContext(character({
      behavior: { proactivity: 50, aggressiveness: 80, humorIntensity: 20, empathyLevel: 50, summarizing: 20, offTopic: 20 },
    }), 'b', '你这也太不靠谱了吧？');

    expect(intent.target).toBe('b');
  });

  it('turns ignored loneliness into a side remark', () => {
    const intent = deriveSpeakIntent(character({
      soulState: {
        mood: { pleasure: -20, arousal: 45, dominance: 40 },
        energy: 45,
        attention: 60,
        loneliness: 76,
        repression: 20,
        shame: 30,
        envy: 0,
        trustInRoom: 45,
        ignoredStreak: 3,
      },
    }));

    expect(intent.reason).toContain('noticed');
    expect(intent.stance).toBe('side_comment');
    expect(intent.delivery).toBe('side_remark');
  });

  it('lets high room safety soften a cold default intent', () => {
    const intent = deriveSpeakIntent(character({
      soulState: {
        mood: { pleasure: 30, arousal: 20, dominance: 45 },
        energy: 60,
        attention: 55,
        loneliness: 10,
        repression: 10,
        shame: 10,
        envy: 0,
        trustInRoom: 82,
        ignoredStreak: 0,
      },
    }));

    expect(intent.reason).toContain('safe');
    expect(intent.emotionalTone).toBe('warm');
  });

  it('turns repair impulse into a warm but restrained intent', () => {
    const intent = deriveSpeakIntent(character({
      soulState: {
        mood: { pleasure: -5, arousal: 35, dominance: 40 },
        energy: 55,
        attention: 52,
        loneliness: 15,
        repression: 45,
        shame: 50,
        envy: 0,
        trustInRoom: 58,
        ignoredStreak: 0,
        lastImpulse: 'repair',
      },
    }), 'b');

    expect(intent.reason).toContain('repair');
    expect(intent.emotionalTone).toBe('warm');
    expect(['support', 'side_comment']).toContain(intent.stance);
  });
});
