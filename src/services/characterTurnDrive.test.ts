import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { InnerLifeProjection } from './innerLifeEngine';
import { deriveCharacterTurnDrive } from './characterTurnDrive';

function character(id: string, patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id, name: id, avatar: '', personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 }, expertise: [], speakingStyle: '', background: '', relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] }, intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true }, isPreset: false, createdAt: 1, updatedAt: 1, ...patch,
  };
}

const innerLife: InnerLifeProjection = {
  actorId: 'x', impulse: 'stay_silent', tone: 'casual', reason: 'none', pressure: 0.24, evidence: [],
  state: { mood: { pleasure: 0, arousal: 0, dominance: 50 }, energy: 50, attention: 50, loneliness: 0, repression: 0, shame: 0, envy: 0, trustInRoom: 50, ignoredStreak: 0, updatedAt: 1 },
  expressionPlan: { tone: 'casual', length: 'short', messageCount: 1, typoLevel: 0, delayMs: 0, allowWithdraw: false },
};

describe('characterTurnDrive', () => {
  it('gives the same moment distinct stakes and lenses without hard-coding one-axis reactions', () => {
    const message = { id: 'm', chatId: 'c', senderId: 'zhang', type: 'ai' as const, content: '地界和收成明天再慢慢问，先把摊子支起来。', timestamp: 1, isDeleted: false };
    const protective = deriveCharacterTurnDrive({ speaker: character('guan', { coreProfile: { coreDesire: '不让自己人替别人吞下代价', interactionHabits: ['先看最后是谁吃亏'] }, relationships: [{ characterId: 'zhang', warmth: 28, trust: 20, competence: 12, threat: 2 }] }), messages: [message], innerLife });
    const suspicious = deriveCharacterTurnDrive({ speaker: character('liu', { coreProfile: { coreFear: '好听的承诺最后又变成空话', perceptionBiases: ['听见含糊的安排就想先看人心'] }, relationships: [{ characterId: 'zhang', warmth: 8, trust: 4, competence: 18, threat: 16 }] }), messages: [message], innerLife });
    const detached = deriveCharacterTurnDrive({ speaker: character('li', { coreProfile: { values: ['不拿别人的焦灼当自己的差事'], sensitivities: ['讨厌被推去替大家收场'] } }), messages: [message], innerLife });

    expect(protective.relationalAction).toBe('protect');
    expect(protective.attentionLens).toContain('最后是谁吃亏');
    expect(suspicious.relationalAction).toBe('situated');
    expect(suspicious.attentionLens).toContain('含糊的安排');
    expect(detached.speakingNecessity).toBe('let_silence_stand');
    expect(new Set([protective.stake, suspicious.stake, detached.stake]).size).toBe(3);
  });

  it('does not invent a private drama for an unprofiled character', () => {
    const drive = deriveCharacterTurnDrive({ speaker: character('plain'), messages: [], innerLife });
    expect(drive.stake).toContain('no invented private stake');
    expect(drive.evidence).not.toContain('core_desire');
  });

  it('turns hierarchy and directional deference into a live target-specific drive', () => {
    const superior = character('yan');
    const subordinate = character('niu', {
      relationships: [{
        characterId: 'yan', warmth: 8, competence: 72, trust: 44, threat: 26, attachment: 12, deference: 68,
        note: '敬畏阎君的裁决权，也怕当众答错后被追问。',
      }],
    });
    const drive = deriveCharacterTurnDrive({
      speaker: subordinate,
      messages: [{ id: 'm', chatId: 'c', senderId: superior.id, senderName: '阎君', type: 'ai', content: '西巷是谁巡的？', timestamp: 1, isDeleted: false }],
      innerLife,
      targetActorId: superior.id,
      targetName: '阎君',
      sharedRelationshipFacts: ['阎君统辖幽都，牛头受其差遣并负责夜巡。'],
    });

    expect(drive.relationalAction).toBe('answer_upward');
    expect(drive.stake).toContain('敬畏阎君的裁决权');
    expect(drive.stake).toContain('阎君统辖幽都');
    expect(drive.evidence).toContain('shared_relationship_structure');
  });

  it('makes authority visible from the superior side without losing it to a generic impulse', () => {
    const subordinate = character('niu', {
      relationships: [{ characterId: 'yan', warmth: 8, competence: 40, trust: 25, threat: 18, attachment: 5, deference: 60 }],
    });
    const superior = character('yan', {
      relationships: [{ characterId: 'niu', warmth: 5, competence: 30, trust: 18, threat: 2, attachment: 8, deference: 0 }],
    });
    const showOffLife = { ...innerLife, impulse: 'show_off' as const, pressure: 0.72 };
    const drive = deriveCharacterTurnDrive({
      speaker: superior,
      counterpart: subordinate,
      messages: [{ id: 'm', chatId: 'c', senderId: subordinate.id, senderName: '牛头', type: 'ai', content: '这趟差事我没办妥。', timestamp: 1, isDeleted: false }],
      innerLife: showOffLife,
      targetActorId: subordinate.id,
      targetName: '牛头',
    });

    expect(drive.relationalAction).toBe('exercise_authority');
    expect(drive.observableMove).toContain('hierarchy');
  });

  it('lets fast irritation leak through hierarchy as controlled resistance', () => {
    const superior = character('yan');
    const subordinate = character('niu', {
      personality: { openness: 50, extroversion: 35, agreeableness: 45, neuroticism: 55, humor: 30, creativity: 40, assertiveness: 38, empathy: 45 },
      behavior: { proactivity: 45, aggressiveness: 30, humorIntensity: 30, empathyLevel: 45, summarizing: 20, offTopic: 10 },
      relationships: [{ characterId: 'yan', warmth: 4, competence: 60, trust: 30, threat: 25, attachment: 4, deference: 70 }],
    });
    const irritatedLife: InnerLifeProjection = {
      ...innerLife,
      impulse: 'answer',
      dominantEmotion: { kind: 'irritation', value: 52, lead: 36 },
      state: { ...innerLife.state, repression: 58 },
    };
    const drive = deriveCharacterTurnDrive({
      speaker: subordinate,
      counterpart: superior,
      messages: [{ id: 'm', chatId: 'c', senderId: 'yan', senderName: '阎君', type: 'ai', content: '再去查一遍。', timestamp: 1, isDeleted: false }],
      innerLife: irritatedLife,
      targetActorId: 'yan',
      targetName: '阎君',
    });

    expect(drive.relationalAction).toBe('answer_upward');
    expect(drive.feltReaction).toContain('irritation');
    expect(drive.observableMove).toContain('controlled edge');
  });
});
