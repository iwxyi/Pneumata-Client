import type { AICharacter, PersonalityParams, EmotionalState } from '../types/character';

function clamp(value: number) {
  return Math.max(-30, Math.min(30, value));
}

function scaleDelta(value: number, multiplier: number) {
  return value === 0 ? 0 : Math.round(value * multiplier);
}

export function derivePersonalityDrift(character: AICharacter, messageContent: string, multiplier: number = 1) {
  const text = messageContent.toLowerCase();
  const current = character.personalityDrift || {};
  const next: Partial<PersonalityParams> = { ...current };

  if (/反对|攻击|讨厌|差|烂|wrong|hate|terrible/.test(text)) {
    next.neuroticism = clamp((current.neuroticism || 0) + scaleDelta(2, multiplier));
    next.extroversion = clamp((current.extroversion || 0) - scaleDelta(1, multiplier));
  }

  if (/喜欢|支持|同意|欣赏|love|agree|great/.test(text)) {
    next.agreeableness = clamp((current.agreeableness || 0) + scaleDelta(1, multiplier));
    next.empathy = clamp((current.empathy || 0) + scaleDelta(1, multiplier));
  }

  return next;
}

export function deriveEmotionalState(character: AICharacter, messageContent: string, multiplier: number = 1, decayBias: number = 1): EmotionalState {
  const current = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const text = messageContent.toLowerCase();
  const scaleGain = (value: number) => Math.round(value * multiplier);
  const scaleDecay = (value: number) => Math.max(1, Math.round(value * decayBias));
  return {
    irritation: Math.max(0, Math.min(100, current.irritation + (/反对|攻击|讨厌|差|烂|wrong|hate|terrible/.test(text) ? scaleGain(12) : -scaleDecay(4)))),
    affection: Math.max(0, Math.min(100, current.affection + (/喜欢|支持|同意|欣赏|love|agree|great/.test(text) ? scaleGain(10) : -scaleDecay(2)))),
    insecurity: Math.max(0, Math.min(100, current.insecurity + (/质疑|不懂|不行|fail|wrong/.test(text) ? scaleGain(8) : -scaleDecay(2)))),
    excitement: Math.max(0, Math.min(100, current.excitement + (/！|!|太好了|太棒|amazing|great/.test(text) ? scaleGain(8) : -scaleDecay(3)))),
    embarrassment: Math.max(0, Math.min(100, current.embarrassment + (/尴尬|丢脸|embarrassed/.test(text) ? scaleGain(10) : -scaleDecay(2)))),
  };
}

export function applyDriftToBehavior(character: AICharacter) {
  const drift = character.personalityDrift || {};
  return {
    ...character.behavior,
    proactivity: Math.max(0, Math.min(100, character.behavior.proactivity + Math.round((drift.extroversion || 0) * 0.6))),
    empathyLevel: Math.max(0, Math.min(100, character.behavior.empathyLevel + Math.round((drift.empathy || 0) * 0.8))),
    aggressiveness: Math.max(0, Math.min(100, character.behavior.aggressiveness + Math.round((drift.neuroticism || 0) * 0.5))),
  };
}
