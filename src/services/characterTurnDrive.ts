import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { InnerLifeProjection } from './innerLifeEngine';

export type CharacterRelationalAction = 'approach' | 'protect' | 'test' | 'resist' | 'avoid' | 'repair' | 'compete' | 'observe' | 'disengage';
export type SpeakingNecessity = 'strong' | 'optional' | 'let_silence_stand';

export interface CharacterTurnDrive {
  stake: string;
  relationalAction: CharacterRelationalAction;
  attentionLens: string;
  speakingNecessity: SpeakingNecessity;
  evidence: string[];
}

function latestOtherMessage(character: AICharacter, messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event' && message.senderId !== character.id).at(-1) || null;
}

function relationshipToLastSpeaker(character: AICharacter, message: Message | null) {
  if (!message || message.senderId === 'user') return undefined;
  return character.relationships.find((item) => item.characterId === message.senderId);
}

/**
 * Decides why this person would enter this particular moment before deciding
 * what conversational move their line should take. It deliberately returns
 * evidence-backed fields so an empty profile cannot fabricate a private drama.
 */
export function deriveCharacterTurnDrive(input: {
  speaker: AICharacter;
  messages: Message[];
  innerLife: InnerLifeProjection;
}): CharacterTurnDrive {
  const { speaker, innerLife } = input;
  const core = speaker.coreProfile;
  const latest = latestOtherMessage(speaker, input.messages);
  const relationship = relationshipToLastSpeaker(speaker, latest);
  const evidence: string[] = [];
  const directAddress = Boolean(latest && (latest.content.includes(speaker.name) || (latest as Message & { addressedTargetIds?: string[] }).addressedTargetIds?.includes(speaker.id)));
  if (directAddress) evidence.push('direct_address');
  if (relationship && latest?.senderId) evidence.push('relationship_to_latest_speaker');
  if (core?.coreDesire) evidence.push('core_desire');
  if (core?.coreFear) evidence.push('core_fear');
  if (core?.valuePriority?.length || core?.values?.length) evidence.push('core_values');
  if (core?.interactionHabits?.length || core?.perceptionBiases?.length || core?.sensitivities?.length) evidence.push('character_attention_pattern');
  if (innerLife.impulse !== 'stay_silent') evidence.push(`inner_impulse:${innerLife.impulse}`);

  let relationalAction: CharacterRelationalAction = 'observe';
  if (innerLife.impulse === 'repair') relationalAction = 'repair';
  else if (relationship?.threat && relationship.threat >= 12) relationalAction = 'test';
  else if (relationship?.warmth && relationship.warmth >= 12) relationalAction = 'protect';
  else if (innerLife.impulse === 'avoid' || innerLife.impulse === 'withdraw' || innerLife.impulse === 'stay_silent') relationalAction = 'avoid';
  else if (innerLife.impulse === 'mock' || innerLife.impulse === 'defend_face') relationalAction = 'resist';
  else if (innerLife.impulse === 'comfort') relationalAction = 'approach';
  else if (innerLife.impulse === 'show_off') relationalAction = 'compete';

  const attentionLens = core?.interactionHabits?.[0]
    || core?.perceptionBiases?.[0]
    || core?.sensitivities?.[0]
    || core?.valuePriority?.[0]
    || core?.values?.[0]
    || (latest ? 'the concrete pressure or loose end in the latest line' : 'what is actually present, without inventing a hidden motive');
  const stake = core?.coreDesire
    ? `What matters personally is ${core.coreDesire}`
    : core?.coreFear
      ? `What they do not want repeated is ${core.coreFear}`
      : relationship?.warmth && relationship.warmth >= 12
        ? 'the person in front of them matters more than looking correct'
        : relationship?.threat && relationship.threat >= 12
          ? 'they do not want to yield their position without testing the terms'
          : 'no invented private stake; only respond to something concrete if there is one';
  const speakingNecessity: SpeakingNecessity = directAddress || innerLife.pressure >= 0.66 || relationalAction === 'repair' || relationalAction === 'protect' || relationalAction === 'test' || relationalAction === 'resist'
    ? 'strong'
    : innerLife.impulse === 'stay_silent' || relationalAction === 'avoid'
      ? 'let_silence_stand'
      : 'optional';

  return { stake, relationalAction, attentionLens, speakingNecessity, evidence };
}

export function getCharacterTurnDriveSpeakerBias(drive: CharacterTurnDrive) {
  if (drive.speakingNecessity === 'strong') return 0.24;
  if (drive.speakingNecessity === 'let_silence_stand') return -0.3;
  return 0;
}
