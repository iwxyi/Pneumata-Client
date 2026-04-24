import type { AICharacter } from '../types/character';
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

function isQuestionLike(text: string) {
  return /[?？]|吗|咋|怎么|凭什么|为什么|要不|是不是/.test(text);
}

function mentionsTarget(text: string) {
  return /你|你这|他说|她说|这点|刚才|不是吧|等等|所以|可问题是/i.test(text);
}

export function describeIntentForPrompt(intent: SpeakIntent) {
  return `reason=${intent.reason}; target=${intent.target}; stance=${intent.stance}; tone=${intent.emotionalTone}; delivery=${intent.delivery}; shape=${intent.messageShape}`;
}

export function deriveSpeakIntentFromContext(character: AICharacter, recentTargetId?: string, recentText: string = ''): SpeakIntent {
  const base = deriveSpeakIntent(character, recentTargetId);
  const pressure = getRecentConversationPressure(recentText);
  if (mentionsTarget(recentText) && base.stance === 'challenge') return withMessageShape({ ...base, stance: isQuestionLike(recentText) ? 'challenge' : 'probe', delivery: 'quick_question' });
  if (mentionsTarget(recentText) && base.stance === 'support') return withMessageShape({ ...base, stance: 'back_up', delivery: pressure > 0 ? 'side_remark' : 'short_reply' });
  if (pressure > 0.1) return withMessageShape({ ...base, delivery: base.stance === 'summarize' ? 'short_reply' : 'side_remark', emotionalTone: base.emotionalTone === 'cold' ? 'defensive' : base.emotionalTone });
  if (pressure < -0.1 && base.stance !== 'summarize') return withMessageShape({ ...base, delivery: 'quick_question', stance: base.stance === 'support' ? 'probe' : base.stance });
  return withMessageShape(base);
}

export function deriveSpeakIntent(character: AICharacter, recentTargetId?: string): SpeakIntent {
  const emotional = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const relationWeight = recentTargetId ? getRelationshipWeight(character, recentTargetId) : 0;

  const dramaBoost = Boolean((globalThis as { __MIRAGETEA_DRAMA_BOOST__?: boolean }).__MIRAGETEA_DRAMA_BOOST__);

  if (emotional.irritation > (dramaBoost ? 42 : 55) || relationWeight < (dramaBoost ? -0.18 : -0.3)) {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'felt challenged',
      target: recentTargetId || 'group',
      stance: relationWeight < -0.5 ? 'pile_on' : 'challenge',
      emotionalTone: emotional.irritation > 75 ? 'sarcastic' : 'annoyed',
      delivery: emotional.irritation > 70 ? 'sharp_followup' : 'short_reply',
    });
  }

  if (emotional.affection > 40 || relationWeight > 0.35) {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to support',
      target: recentTargetId || 'group',
      stance: relationWeight > 0.55 ? 'back_up' : 'support',
      emotionalTone: 'warm',
      delivery: 'short_reply',
    });
  }

  if (character.behavior.summarizing >= 70) {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to structure the discussion',
      target: 'group',
      stance: 'summarize',
      emotionalTone: 'cold',
      delivery: 'group_redirect',
    });
  }

  if (character.behavior.humorIntensity >= 70) {
    return withMessageShape({
      shouldSpeak: true,
      reason: 'wants to lighten the mood',
      target: 'group',
      stance: 'side_comment',
      emotionalTone: 'excited',
      delivery: 'side_remark',
    });
  }

  return withMessageShape({
    shouldSpeak: true,
    reason: 'has something to add',
    target: recentTargetId || 'group',
    stance: emotional.excitement > 55 ? 'show_off' : 'deflect',
    emotionalTone: emotional.insecurity > 40 ? 'defensive' : 'cold',
    delivery: emotional.excitement > 55 ? 'side_remark' : 'short_reply',
  });
}

export function deriveSpeakIntentLegacy(character: AICharacter, recentTargetId?: string): SpeakIntent {
  return deriveSpeakIntent(character, recentTargetId);
}
