import { describe, expect, it } from 'vitest';
import { parseGeneratedProfile, parseGeneratedProfileMap } from './characterGenerator';

describe('characterGenerator', () => {
  it('normalizes generated behavior axes for a single profile', () => {
    const profile = parseGeneratedProfile(JSON.stringify({
      avatar: '🤖',
      personality: {
        openness: 72,
        extroversion: 35,
        agreeableness: 61,
        neuroticism: 44,
        humor: 28,
        creativity: 80,
        assertiveness: 67,
        empathy: 52,
      },
      behavior: {
        proactivity: 81,
        aggressiveness: 22,
        humorIntensity: 17,
        empathyLevel: 58,
        summarizing: 74,
        offTopic: 9,
      },
      expertise: ['测试'],
      speakingStyle: '简洁直接。',
      background: '测试角色。',
    }));

    expect(profile.behavior).toMatchObject({
      proactivity: 81,
      aggressiveness: 22,
      humorIntensity: 17,
      empathyLevel: 58,
      summarizing: 74,
      offTopic: 9,
    });
  });

  it('keeps generated behavior axes in batch profiles', () => {
    const profiles = parseGeneratedProfileMap(JSON.stringify([
      {
        name: '甲',
        avatar: '🤖',
        personality: {
          openness: 50,
          extroversion: 50,
          agreeableness: 50,
          neuroticism: 50,
          humor: 50,
          creativity: 50,
          assertiveness: 50,
          empathy: 50,
        },
        behavior: {
          proactivity: 25,
          aggressiveness: 70,
          humorIntensity: 35,
          empathyLevel: 41,
          summarizing: 18,
          offTopic: 63,
        },
        expertise: [],
        speakingStyle: '',
        background: '',
      },
    ]), ['甲']);

    expect(profiles[0].profile.behavior).toMatchObject({
      proactivity: 25,
      aggressiveness: 70,
      humorIntensity: 35,
      empathyLevel: 41,
      summarizing: 18,
      offTopic: 63,
    });
  });
});
