import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';

export type PersonaActivationLevel = 'low' | 'medium' | 'high' | 'masked';

export interface PersonaActivation {
  level: PersonaActivationLevel;
  reasons: string[];
  prompt: string;
}

function normalizeText(value: string | undefined | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function collectPersonaTerms(character: AICharacter) {
  const terms = [
    character.name,
    ...(character.expertise || []),
    character.background,
    character.speakingStyle,
    character.coreProfile?.socialMask,
    ...(character.coreProfile?.valuePriority || []),
    ...(character.coreProfile?.interactionHabits || []),
  ]
    .flatMap((item) => normalizeText(item).split(/[，,、；;。.!！?？\s/|]+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 18);
  return Array.from(new Set(terms)).slice(0, 24);
}

function latestVisible(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1) || null;
}

function hasPersonaTermHit(text: string, character: AICharacter) {
  const haystack = normalizeText(text);
  if (!haystack) return false;
  return collectPersonaTerms(character).some((term) => haystack.includes(term));
}

function isGameLikeMode(chat: GroupChat) {
  const mode = `${chat.mode || ''} ${chat.style || ''} ${chat.topic || ''} ${chat.name || ''}`.toLowerCase();
  return /(werewolf|script|murder|狼人|剧本|推理|阵营|身份|卧底|欺骗|伪装)/i.test(mode);
}

export function resolvePersonaActivation(params: {
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
}): PersonaActivation {
  const latest = latestVisible(params.messages);
  const latestText = latest?.content || '';
  const reasons: string[] = [];
  const modeConfig = params.chat.modeConfig as { hiddenRoles?: boolean; deception?: boolean; maskPersona?: boolean } | undefined;
  const masked = Boolean(modeConfig?.hiddenRoles || modeConfig?.deception || modeConfig?.maskPersona || isGameLikeMode(params.chat));
  if (masked) reasons.push('masked_or_game_context');
  if (latest?.type === 'user' || latest?.type === 'god') reasons.push('latest_human');
  if (hasPersonaTermHit(latestText, params.speaker)) reasons.push('latest_mentions_persona_terms');
  if (params.chat.topic && hasPersonaTermHit(params.chat.topic, params.speaker)) reasons.push('topic_mentions_persona_terms');
  if (params.chat.worldState?.focus && hasPersonaTermHit(params.chat.worldState.focus, params.speaker)) reasons.push('focus_mentions_persona_terms');
  const high = reasons.includes('latest_mentions_persona_terms') || reasons.includes('topic_mentions_persona_terms') || reasons.includes('focus_mentions_persona_terms');
  const level: PersonaActivationLevel = masked ? 'masked' : high ? 'high' : latest ? 'low' : 'medium';
  const prompt = buildPersonaActivationPrompt(level, reasons);
  return { level, reasons, prompt };
}

export function buildPersonaActivationPrompt(level: PersonaActivationLevel, reasons: string[] = []) {
  const base = `\n## Persona Activation
- Current persona activation: ${level}${reasons.length ? ` (${reasons.join(', ')})` : ''}.
- Persona is a background distribution, not a per-turn checklist. It should shape values, blind spots, confidence, emotional reactions, relationship stance, and word choice.
- Do not advertise job labels, expertise, backstory, catchphrases, or identity tags unless this exact turn naturally calls for them.
- A believable person can chat about daily details, argue, remember, joke, dodge, comfort, or misunderstand without explicitly referencing their occupation or archetype.`;
  if (level === 'high') {
    return `${base}
- The current context touches this character's profile. You may use relevant expertise or lived history, but still answer the live situation first and avoid turning the message into a self-introduction.`;
  }
  if (level === 'masked') {
    return `${base}
- The current mode may involve hidden identity, strategic presentation, or deception. Public behavior may diverge from private truth. Do not reveal hidden identity, private motives, or exact role knowledge unless the visible situation and game rules allow it.
- If deception or misdirection fits the mode, express it through selective emphasis, omission, deflection, or plausible confidence rather than exposing the real profile.`;
  }
  if (level === 'medium') {
    return `${base}
- Let background color the first move lightly; do not force a profession-shaped opening.`;
  }
  return `${base}
- Keep explicit persona display low this turn. Prefer current-topic relevance and relationship continuity over occupational branding.`;
}
