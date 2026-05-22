import type { AICharacter } from '../types/character';
import type { DirectorIntent } from './directorIntent';
import { getRelationshipWeight } from './relationshipEngine';

export interface SpeakIntent {
  shouldSpeak: boolean;
  reason: string;
  target: string;
  stance: 'support' | 'challenge' | 'deflect' | 'joke' | 'summarize' | 'provoke' | 'comfort' | 'pile_on' | 'back_up' | 'probe' | 'side_comment' | 'change_subject' | 'cool_down' | 'show_off';
  emotionalTone: 'warm' | 'annoyed' | 'defensive' | 'excited' | 'sarcastic' | 'cold';
  delivery: 'short_reply' | 'sharp_followup' | 'side_remark' | 'quick_question' | 'group_redirect';
  messageShape: 'fragment' | 'single_sentence' | 'two_sentences' | 'question_only';
}

function getDefaultMessageShape(intent: Pick<SpeakIntent, 'delivery' | 'stance'>): SpeakIntent['messageShape'] {
  if (intent.delivery === 'quick_question') return 'question_only';
  if (intent.delivery === 'side_remark') return 'fragment';
  if (intent.stance === 'summarize') return 'two_sentences';
  return 'single_sentence';
}

function withMessageShape(intent: Omit<SpeakIntent, 'messageShape'>): SpeakIntent {
  return {
    ...intent,
    messageShape: getDefaultMessageShape(intent),
  };
}

function getRecentConversationPressure(recentText: string) {
  const trimmed = recentText.trim();
  if (!trimmed) return 0;
  if (trimmed.length <= 12) return 0.28;
  if (trimmed.length <= 18) return 0.2;
  if (trimmed.length >= 80) return -0.18;
  return 0;
}

function getQuestionIntentWeight(character: AICharacter) {
  const questionBias = character.speechProfile?.questionBias ?? 50;
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const drift = character.personalityDrift || {};
  const curiosity = questionBias * 0.55;
  const steering = (character.behavior.summarizing + character.behavior.proactivity) * 0.18;
  const playfulness = (character.behavior.humorIntensity + emotional.excitement) * 0.12;
  const tension = (character.behavior.aggressiveness + emotional.irritation) * 0.1;
  const insecurity = emotional.insecurity * 0.08;
  const driftPull = ((drift.openness || 0) * 0.9) + ((drift.assertiveness || 0) * 0.8) + ((drift.empathy || 0) * 0.5) - ((drift.neuroticism || 0) * 0.45);
  return curiosity + steering + playfulness + tension + insecurity + driftPull;
}

function shouldUseQuestionMove(character: AICharacter, recentText: string, recentTargetId?: string) {
  const pressure = getRecentConversationPressure(recentText);
  const questionLike = isQuestionLike(recentText);
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const relationWeight = recentTargetId ? getRelationshipWeight(character, recentTargetId) : 0;
  const weight = getQuestionIntentWeight(character);
  if (questionLike && mentionsTarget(recentText)) return true;
  if (emotional.excitement >= 72 && character.behavior.humorIntensity >= 64) return true;
  if (emotional.irritation >= 68 || relationWeight <= -0.42) return true;
  if (pressure < -0.1 && weight >= 48) return true;
  if (pressure > 0.18 && weight >= 58) return true;
  return weight >= 66;
}

function chooseQuestionDelivery(character: AICharacter, recentText: string) {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  if (emotional.irritation >= 68 || /不是|凭什么|怎么就|你这|离谱/i.test(recentText)) return 'sharp_followup' as const;
  if (character.behavior.summarizing >= 68 || character.behavior.proactivity >= 68) return 'group_redirect' as const;
  if (character.behavior.humorIntensity >= 68 || emotional.excitement >= 70) return 'side_remark' as const;
  return 'quick_question' as const;
}

function chooseQuestionStance(character: AICharacter, recentText: string, recentTargetId?: string) {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const relationWeight = recentTargetId ? getRelationshipWeight(character, recentTargetId) : 0;
  if (emotional.irritation >= 68 || relationWeight <= -0.42) return 'challenge' as const;
  if (character.behavior.humorIntensity >= 70 && emotional.excitement >= 62) return 'side_comment' as const;
  if (character.behavior.summarizing >= 68 || /扯远|先别|重点|所以/i.test(recentText)) return 'change_subject' as const;
  return 'probe' as const;
}

function chooseQuestionShape(stance: SpeakIntent['stance'], delivery: SpeakIntent['delivery']) {
  if (delivery === 'side_remark') return 'fragment' as const;
  if (delivery === 'group_redirect') return 'single_sentence' as const;
  if (stance === 'challenge' || stance === 'probe') return 'question_only' as const;
  return 'single_sentence' as const;
}

function withExplicitShape(intent: Omit<SpeakIntent, 'messageShape'>, messageShape: SpeakIntent['messageShape']): SpeakIntent {
  return {
    ...intent,
    messageShape,
  };
}

function buildQuestionIntent(character: AICharacter, recentTargetId?: string, recentText: string = ''): SpeakIntent {
  const stance = chooseQuestionStance(character, recentText, recentTargetId);
  const delivery = chooseQuestionDelivery(character, recentText);
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  return withExplicitShape({
    shouldSpeak: true,
    reason: stance === 'change_subject' ? 'wants to steer the room' : stance === 'side_comment' ? 'wants to play with the room' : stance === 'challenge' ? 'wants to press someone' : 'wants to pull one more reaction',
    target: recentTargetId || 'group',
    stance,
    emotionalTone: stance === 'challenge' ? (emotional.irritation >= 75 ? 'sarcastic' : 'annoyed') : stance === 'side_comment' ? 'excited' : emotional.insecurity > 48 ? 'defensive' : 'cold',
    delivery,
  }, chooseQuestionShape(stance, delivery));
}

function applyDriftToBaseIntent(character: AICharacter, base: SpeakIntent): SpeakIntent {
  const drift = character.personalityDrift || {};
  if ((drift.assertiveness || 0) >= 10 && base.stance === 'deflect') {
    return withMessageShape({ ...base, stance: 'show_off', delivery: base.delivery === 'short_reply' ? 'side_remark' : base.delivery, emotionalTone: 'excited' });
  }
  if ((drift.empathy || 0) >= 10 && (base.stance === 'challenge' || base.stance === 'pile_on')) {
    return withMessageShape({ ...base, stance: 'probe', delivery: 'quick_question', emotionalTone: 'defensive' });
  }
  if ((drift.neuroticism || 0) >= 10 && base.stance === 'support') {
    return withMessageShape({ ...base, stance: 'deflect', delivery: 'short_reply', emotionalTone: 'defensive' });
  }
  if ((drift.openness || 0) >= 10 && base.delivery === 'short_reply' && base.stance !== 'summarize') {
    return withMessageShape({ ...base, stance: base.stance === 'deflect' ? 'change_subject' : base.stance, delivery: 'side_remark', emotionalTone: base.emotionalTone === 'cold' ? 'excited' : base.emotionalTone });
  }
  return base;
}

function applyEmotionToBaseIntent(character: AICharacter, base: SpeakIntent): SpeakIntent {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  if (emotional.irritation >= 28 && base.stance !== 'summarize' && base.stance !== 'cool_down') {
    return withMessageShape({
      ...base,
      reason: base.reason === 'has something to add' ? 'still carries tension from recent interaction' : base.reason,
      stance: base.target === 'group' ? 'probe' : 'challenge',
      emotionalTone: emotional.irritation >= 45 ? 'annoyed' : 'defensive',
      delivery: base.delivery === 'group_redirect' ? 'quick_question' : base.delivery,
    });
  }
  if (emotional.affection >= 28 && (base.stance === 'deflect' || base.stance === 'side_comment' || base.emotionalTone === 'cold')) {
    return withMessageShape({
      ...base,
      reason: base.reason === 'has something to add' ? 'wants to stay close to the current exchange' : base.reason,
      stance: base.target === 'group' ? 'side_comment' : 'support',
      emotionalTone: 'warm',
      delivery: base.delivery === 'group_redirect' ? 'short_reply' : base.delivery,
    });
  }
  if (emotional.excitement >= 28 && base.delivery === 'short_reply' && base.stance !== 'summarize') {
    return withMessageShape({
      ...base,
      emotionalTone: 'excited',
      delivery: 'side_remark',
    });
  }
  if (emotional.insecurity >= 28 && base.emotionalTone === 'cold' && base.stance !== 'summarize') {
    return withMessageShape({
      ...base,
      emotionalTone: 'defensive',
      stance: base.stance === 'deflect' && base.target !== 'group' ? 'probe' : base.stance,
    });
  }
  if (emotional.embarrassment >= 65 && base.stance !== 'summarize') {
    return withMessageShape({ ...base, stance: 'side_comment', delivery: 'side_remark', emotionalTone: 'defensive' });
  }
  if (emotional.excitement >= 72 && base.stance === 'support') {
    return withMessageShape({ ...base, stance: 'show_off', delivery: 'side_remark', emotionalTone: 'excited' });
  }
  if (emotional.insecurity >= 68 && base.stance === 'challenge') {
    return withMessageShape({ ...base, stance: 'probe', delivery: 'quick_question', emotionalTone: 'defensive' });
  }
  return base;
}

function adjustQuestionIntentByEmotion(character: AICharacter, intent: SpeakIntent): SpeakIntent {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  if (emotional.embarrassment >= 70 && intent.delivery === 'quick_question') {
    return withExplicitShape({ ...intent, stance: 'side_comment', delivery: 'side_remark', emotionalTone: 'defensive' }, 'fragment');
  }
  if (emotional.excitement >= 75 && intent.delivery === 'quick_question') {
    return withExplicitShape({ ...intent, stance: intent.stance === 'probe' ? 'side_comment' : intent.stance, delivery: 'side_remark', emotionalTone: 'excited' }, 'fragment');
  }
  return intent;
}

function adjustQuestionIntentByDrift(character: AICharacter, intent: SpeakIntent): SpeakIntent {
  const drift = character.personalityDrift || {};
  if ((drift.assertiveness || 0) >= 12 && intent.stance === 'probe') {
    return withExplicitShape({ ...intent, stance: 'challenge', delivery: intent.delivery === 'quick_question' ? 'sharp_followup' : intent.delivery, emotionalTone: 'annoyed' }, 'question_only');
  }
  if ((drift.empathy || 0) >= 12 && intent.stance === 'challenge') {
    return withExplicitShape({ ...intent, stance: 'probe', delivery: 'quick_question', emotionalTone: 'defensive' }, 'question_only');
  }
  if ((drift.openness || 0) >= 12 && intent.delivery === 'quick_question') {
    return withExplicitShape({ ...intent, stance: intent.stance === 'probe' ? 'change_subject' : intent.stance, delivery: 'group_redirect' }, 'single_sentence');
  }
  return intent;
}

function adaptQuestionIntent(character: AICharacter, intent: SpeakIntent) {
  return adjustQuestionIntentByDrift(character, adjustQuestionIntentByEmotion(character, intent));
}

function applySoulStateToIntent(character: AICharacter, base: SpeakIntent): SpeakIntent {
  const soul = character.soulState;
  if (!soul) return base;

  if (soul.loneliness >= 68 && soul.ignoredStreak >= 2 && base.target === 'group') {
    return withExplicitShape({
      ...base,
      reason: 'wants to be noticed without admitting it',
      stance: 'side_comment',
      emotionalTone: soul.shame >= 55 ? 'defensive' : 'cold',
      delivery: 'side_remark',
    }, 'fragment');
  }

  if (soul.lastImpulse === 'repair') {
    return withExplicitShape({
      ...base,
      reason: 'wants to repair the relationship without sounding too soft',
      stance: base.target === 'group' ? 'side_comment' : 'support',
      emotionalTone: 'warm',
      delivery: base.delivery === 'group_redirect' ? 'short_reply' : base.delivery,
    }, base.messageShape === 'two_sentences' ? 'single_sentence' : base.messageShape);
  }

  if ((soul.repression >= 66 || soul.shame >= 64) && base.stance !== 'summarize') {
    return withExplicitShape({
      ...base,
      reason: soul.shame >= soul.repression ? 'wants to save face and repair the moment' : 'has swallowed too many words',
      stance: base.stance === 'support' || base.stance === 'back_up' ? 'probe' : 'deflect',
      emotionalTone: 'defensive',
      delivery: base.delivery === 'group_redirect' ? 'side_remark' : base.delivery,
    }, base.messageShape === 'two_sentences' ? 'single_sentence' : base.messageShape);
  }

  if (soul.trustInRoom >= 68 && soul.repression <= 35 && soul.loneliness <= 38 && (base.stance === 'deflect' || base.emotionalTone === 'cold')) {
    return withMessageShape({
      ...base,
      reason: 'feels safe enough to soften a little',
      stance: base.target === 'group' ? 'side_comment' : 'support',
      emotionalTone: 'warm',
      delivery: base.delivery === 'group_redirect' ? 'short_reply' : base.delivery,
    });
  }

  return base;
}

function adaptBaseIntent(character: AICharacter, base: SpeakIntent) {
  return applySoulStateToIntent(character, applyDriftToBaseIntent(character, applyEmotionToBaseIntent(character, base)));
}

function maybePromoteToQuestionIntent(character: AICharacter, base: SpeakIntent, recentTargetId?: string, recentText: string = '') {
  if (!shouldUseQuestionMove(character, recentText, recentTargetId)) return adaptBaseIntent(character, base);
  if (base.stance === 'summarize' && character.behavior.summarizing >= 78) return adaptBaseIntent(character, base);
  return adaptQuestionIntent(character, buildQuestionIntent(character, recentTargetId, recentText));
}


function isQuestionLike(text: string) {
  return /[?？]|吗|咋|怎么|凭什么|为什么|要不|是不是/.test(text);
}

function mentionsTarget(text: string) {
  return /你|你这|他说|她说|这点|刚才|不是吧|等等|所以|可问题是/i.test(text);
}

export function describeIntentForPrompt(intent: SpeakIntent) {
  return `reason=${intent.reason}; target=${intent.target}; stance=${intent.stance}; tone=${intent.emotionalTone}; delivery=${intent.delivery}; shape=${intent.messageShape}`;
}

function deriveSpeakIntentFromDirectorIntent(character: AICharacter, directorIntent?: DirectorIntent | null): SpeakIntent | null {
  if (!directorIntent) return null;
  const isTargeted = directorIntent.targetActorIds.includes(character.id);
  if (!isTargeted && directorIntent.beatType !== 'summarize' && directorIntent.beatType !== 'invite') return null;
  const target = directorIntent.targetActorIds.find((actorId) => actorId !== character.id) || 'group';
  if (directorIntent.beatType === 'answer') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'was pulled into the current pressure',
      target,
      stance: 'probe',
      emotionalTone: character.emotionalState?.insecurity && character.emotionalState.insecurity > 60 ? 'defensive' : 'cold',
      delivery: 'short_reply',
    });
  }
  if (directorIntent.beatType === 'defend') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to protect the current target',
      target,
      stance: 'back_up',
      emotionalTone: 'warm',
      delivery: 'short_reply',
    });
  }
  if (directorIntent.beatType === 'challenge' || directorIntent.beatType === 'escalate') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to press the active conflict',
      target,
      stance: 'challenge',
      emotionalTone: character.emotionalState?.irritation && character.emotionalState.irritation > 70 ? 'sarcastic' : 'annoyed',
      delivery: 'sharp_followup',
    });
  }
  if (directorIntent.beatType === 'cool_down') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to reduce the room pressure',
      target: 'group',
      stance: 'cool_down',
      emotionalTone: 'warm',
      delivery: 'group_redirect',
    });
  }
  if (directorIntent.beatType === 'summarize') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to structure the discussion',
      target: 'group',
      stance: 'summarize',
      emotionalTone: 'cold',
      delivery: 'group_redirect',
    });
  }
  if (directorIntent.beatType === 'deflect') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to redirect the pressure',
      target: 'group',
      stance: 'deflect',
      emotionalTone: 'defensive',
      delivery: 'side_remark',
    });
  }
  if (directorIntent.beatType === 'reveal') {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to expose one piece of the hidden thread',
      target,
      stance: 'probe',
      emotionalTone: 'cold',
      delivery: 'quick_question',
    });
  }
  return null;
}

export function deriveSpeakIntentFromContext(character: AICharacter, recentTargetId?: string, recentText: string = '', directorIntent?: DirectorIntent | null): SpeakIntent {
  const directedIntent = deriveSpeakIntentFromDirectorIntent(character, directorIntent);
  if (directedIntent) return adaptBaseIntent(character, directedIntent);
  const base = deriveSpeakIntent(character, recentTargetId);
  const pressure = getRecentConversationPressure(recentText);
  if (mentionsTarget(recentText) && base.stance === 'challenge') {
    return adaptQuestionIntent(character, withMessageShape({ ...base, stance: isQuestionLike(recentText) ? 'challenge' : 'probe', delivery: 'quick_question' }));
  }
  if (mentionsTarget(recentText) && base.stance === 'support') {
    return adaptBaseIntent(character, withMessageShape({ ...base, stance: 'back_up', delivery: pressure > 0 ? 'side_remark' : 'short_reply' }));
  }
  if (pressure > 0.1) {
    return maybePromoteToQuestionIntent(character, withMessageShape({ ...base, delivery: base.stance === 'summarize' ? 'short_reply' : 'side_remark', emotionalTone: base.emotionalTone === 'cold' ? 'defensive' : base.emotionalTone }), recentTargetId, recentText);
  }
  if (pressure < -0.1 && base.stance !== 'summarize') {
    return adaptQuestionIntent(character, withMessageShape({ ...base, delivery: 'quick_question', stance: base.stance === 'support' ? 'probe' : base.stance }));
  }
  return maybePromoteToQuestionIntent(character, withMessageShape(base), recentTargetId, recentText);
}

export function deriveSpeakIntent(character: AICharacter, recentTargetId?: string): SpeakIntent {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const relationWeight = recentTargetId ? getRelationshipWeight(character, recentTargetId) : 0;

  const dramaBoost = Boolean((globalThis as { __MIRAGETEA_DRAMA_BOOST__?: boolean }).__MIRAGETEA_DRAMA_BOOST__);

  if (emotional.irritation > (dramaBoost ? 42 : 55) || relationWeight < (dramaBoost ? -0.18 : -0.3)) {
    return adaptBaseIntent(character, withMessageShape({
      shouldSpeak: true,
      reason: 'felt challenged',
      target: recentTargetId || 'group',
      stance: relationWeight < -0.5 ? 'pile_on' : 'challenge',
      emotionalTone: emotional.irritation > 75 ? 'sarcastic' : 'annoyed',
      delivery: emotional.irritation > 70 ? 'sharp_followup' : 'short_reply',
    }));
  }

  if (emotional.affection > 40 || relationWeight > 0.35) {
    return adaptBaseIntent(character, withMessageShape({
      shouldSpeak: true,
      reason: 'wants to support',
      target: recentTargetId || 'group',
      stance: relationWeight > 0.55 ? 'back_up' : 'support',
      emotionalTone: 'warm',
      delivery: 'short_reply',
    }));
  }

  if (character.behavior.summarizing >= 70) {
    return adaptBaseIntent(character, withMessageShape({
      shouldSpeak: true,
      reason: 'wants to structure the discussion',
      target: 'group',
      stance: 'summarize',
      emotionalTone: 'cold',
      delivery: 'group_redirect',
    }));
  }

  if (character.behavior.humorIntensity >= 70) {
    return adaptBaseIntent(character, withMessageShape({
      shouldSpeak: true,
      reason: 'wants to lighten the mood',
      target: 'group',
      stance: 'side_comment',
      emotionalTone: 'excited',
      delivery: 'side_remark',
    }));
  }

  return adaptBaseIntent(character, withMessageShape({
    shouldSpeak: true,
    reason: 'has something to add',
    target: recentTargetId || 'group',
    stance: emotional.excitement > 55 ? 'show_off' : 'deflect',
    emotionalTone: emotional.insecurity > 40 ? 'defensive' : 'cold',
    delivery: emotional.excitement > 55 ? 'side_remark' : 'short_reply',
  }));
}

export function deriveSpeakIntentLegacy(character: AICharacter, recentTargetId?: string): SpeakIntent {
  return deriveSpeakIntent(character, recentTargetId);
}
