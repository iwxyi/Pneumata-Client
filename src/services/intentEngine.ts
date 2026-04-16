import type { AICharacter } from '../types/character';
import { getRelationshipWeight } from './relationshipEngine';

export interface SpeakIntent {
  shouldSpeak: boolean;
  reason: string;
  target: string;
  stance: 'support' | 'challenge' | 'deflect' | 'joke' | 'summarize' | 'provoke' | 'comfort';
  emotionalTone: 'warm' | 'annoyed' | 'defensive' | 'excited' | 'sarcastic' | 'cold';
}

export function deriveSpeakIntent(character: AICharacter, recentTargetId?: string): SpeakIntent {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const relationWeight = recentTargetId ? getRelationshipWeight(character, recentTargetId) : 0;

  if (emotional.irritation > 55 || relationWeight < -0.3) {
    return {
      shouldSpeak: true,
      reason: 'felt challenged',
      target: recentTargetId || 'group',
      stance: 'challenge',
      emotionalTone: emotional.irritation > 75 ? 'sarcastic' : 'annoyed',
    };
  }

  if (emotional.affection > 40 || relationWeight > 0.35) {
    return {
      shouldSpeak: true,
      reason: 'wants to support',
      target: recentTargetId || 'group',
      stance: 'support',
      emotionalTone: 'warm',
    };
  }

  if (character.behavior.summarizing >= 70) {
    return {
      shouldSpeak: true,
      reason: 'wants to structure the discussion',
      target: 'group',
      stance: 'summarize',
      emotionalTone: 'cold',
    };
  }

  if (character.behavior.humorIntensity >= 70) {
    return {
      shouldSpeak: true,
      reason: 'wants to lighten the mood',
      target: 'group',
      stance: 'joke',
      emotionalTone: 'excited',
    };
  }

  return {
    shouldSpeak: true,
    reason: 'has something to add',
    target: recentTargetId || 'group',
    stance: 'deflect',
    emotionalTone: emotional.insecurity > 40 ? 'defensive' : 'cold',
  };
}
