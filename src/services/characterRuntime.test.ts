import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { accumulateCharacterRuntime } from './characterRuntime';

function buildCharacter(): AICharacter {
  return {
    id: 'char-1',
    name: '甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
    runtimeTimeline: [],
  };
}

describe('characterRuntime', () => {
  it('uses provided now when event createdAt is missing', () => {
    const timeline = accumulateCharacterRuntime(buildCharacter(), { type: 'drift', text: '发生轻微漂移' }, { now: 1777000000000 });
    expect(timeline.at(-1)?.createdAt).toBe(1777000000000);
  });
});

