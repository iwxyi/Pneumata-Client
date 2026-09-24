import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { InnerLifeProjection } from './innerLifeEngine';

export type CharacterRelationalAction = 'approach' | 'resist' | 'avoid' | 'repair' | 'compete' | 'situated' | 'observe' | 'disengage';
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

function relationshipToTarget(character: AICharacter, targetActorId: string | undefined, message: Message | null) {
  const resolvedTargetId = targetActorId || message?.senderId;
  if (!resolvedTargetId) return undefined;
  return character.relationships.find((item) => item.characterId === resolvedTargetId);
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
  targetActorId?: string;
  targetName?: string;
  sharedRelationshipFacts?: string[];
  includeRelationshipNote?: boolean;
}): CharacterTurnDrive {
  const { speaker, innerLife } = input;
  const core = speaker.coreProfile;
  const latest = latestOtherMessage(speaker, input.messages);
  const relationship = relationshipToTarget(speaker, input.targetActorId, latest);
  const targetName = input.targetName || latest?.senderName || 'the current person';
  const sharedRelationshipFacts = (input.sharedRelationshipFacts || []).filter(Boolean).slice(0, 2);
  const evidence: string[] = [];
  const directAddress = Boolean(latest && (latest.content.includes(speaker.name) || (latest as Message & { addressedTargetIds?: string[] }).addressedTargetIds?.includes(speaker.id)));
  if (directAddress) evidence.push('direct_address');
  if (relationship) evidence.push('relationship_to_current_target');
  if (input.includeRelationshipNote !== false && relationship?.note?.trim()) evidence.push('directional_relationship_note');
  if (sharedRelationshipFacts.length) evidence.push('shared_relationship_structure');
  if (core?.coreDesire) evidence.push('core_desire');
  if (core?.coreFear) evidence.push('core_fear');
  if (core?.valuePriority?.length || core?.values?.length) evidence.push('core_values');
  if (core?.interactionHabits?.length || core?.perceptionBiases?.length || core?.sensitivities?.length) evidence.push('character_attention_pattern');
  if (innerLife.impulse !== 'stay_silent') evidence.push(`inner_impulse:${innerLife.impulse}`);

  let relationalAction: CharacterRelationalAction = 'observe';
  if (innerLife.impulse === 'repair') relationalAction = 'repair';
  else if (innerLife.impulse === 'mock' || innerLife.impulse === 'defend_face') relationalAction = 'resist';
  else if (innerLife.impulse === 'comfort') relationalAction = 'approach';
  else if (innerLife.impulse === 'show_off') relationalAction = 'compete';
  else if (relationship || sharedRelationshipFacts.length) relationalAction = 'situated';
  else if (innerLife.impulse === 'avoid' || innerLife.impulse === 'withdraw' || innerLife.impulse === 'stay_silent') relationalAction = 'avoid';

  const attentionLens = core?.interactionHabits?.[0]
    || core?.perceptionBiases?.[0]
    || core?.sensitivities?.[0]
    || core?.valuePriority?.[0]
    || core?.values?.[0]
    || (latest ? 'the concrete pressure or loose end in the latest line' : 'what is actually present, without inventing a hidden motive');
  const explicitRelationshipStakes = [
    input.includeRelationshipNote !== false && relationship?.note?.trim() ? `With ${targetName}, the live personal stake is: ${relationship.note.trim()}` : '',
    sharedRelationshipFacts.length ? `With ${targetName}, the shared reality is: ${sharedRelationshipFacts.join(' / ')}` : '',
  ].filter(Boolean);
  const relationshipStake = explicitRelationshipStakes.join('; ')
    || (relationship ? `The current relationship with ${targetName} matters, but its six axes must be interpreted together rather than reduced to one preset reaction` : '');
  const identityStake = core?.coreDesire
    ? `Their standing desire is ${core.coreDesire}`
    : core?.coreFear
      ? `They do not want ${core.coreFear} repeated`
      : '';
  const stake = [relationshipStake, identityStake].filter(Boolean).join('; ')
    || 'no invented private stake; only respond to something concrete if there is one';
  const speakingNecessity: SpeakingNecessity = directAddress || innerLife.pressure >= 0.66 || relationalAction === 'repair' || relationalAction === 'resist'
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
