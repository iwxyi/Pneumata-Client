import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { InnerLifeProjection } from './innerLifeEngine';

export type CharacterRelationalAction =
  | 'approach'
  | 'resist'
  | 'avoid'
  | 'repair'
  | 'compete'
  | 'answer_upward'
  | 'exercise_authority'
  | 'protect'
  | 'test'
  | 'seek_recognition'
  | 'situated'
  | 'observe'
  | 'disengage';
export type SpeakingNecessity = 'strong' | 'optional' | 'let_silence_stand';

export interface CharacterTurnDrive {
  stake: string;
  relationalAction: CharacterRelationalAction;
  feltReaction: string;
  immediateWant: string;
  immediateRisk: string;
  observableMove: string;
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

function axis(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function deriveEmotionPressure(params: {
  speaker: AICharacter;
  relationship: AICharacter['relationships'][number] | undefined;
  innerLife: InnerLifeProjection;
  targetName: string;
}) {
  const emotion = params.innerLife.dominantEmotion;
  if (!emotion || emotion.value < 18) return null;
  const constrained = axis(params.relationship?.deference) >= 30
    || axis(params.speaker.personality.assertiveness) + axis(params.speaker.behavior.aggressiveness) < 85
    || (params.innerLife.state.repression || 0) >= 48;
  const strength = emotion.value >= 65 ? 'strong' : emotion.value >= 38 ? 'clear' : 'rising';
  if (emotion.kind === 'irritation') return {
    feltReaction: `${strength} irritation is active toward ${params.targetName}; ${constrained ? 'it is being held behind control, not absent' : 'it is close to breaking through the social mask'}`,
    immediateWant: constrained ? 'answer without swallowing the slight or surrendering dignity' : 'push back now and make the other person feel the resistance',
    immediateRisk: constrained ? 'leaking resentment through a loaded pause, a too-precise correction, or a clipped answer' : 'saying more than the relationship can absorb',
    observableMove: constrained ? 'let one controlled edge show: shorten, correct one word, pause, refuse one premise, or comply too precisely' : 'interrupt, contradict, challenge, or land one unmistakable barb',
  };
  if (emotion.kind === 'affection') return {
    feltReaction: `${strength} affection makes ${params.targetName}'s outcome personally important, whether or not this speaker admits it`,
    immediateWant: constrained ? 'help in a practical way without exposing how much they care' : 'move closer and make the preference visible',
    immediateRisk: constrained ? 'being read too easily' : 'becoming partial, possessive, or overprotective',
    observableMove: constrained ? 'cover for them, remember a detail, take on a burden, or soften only one phrase' : 'reassure, defend, tease warmly, or openly choose their side',
  };
  if (emotion.kind === 'insecurity') return {
    feltReaction: `${strength} insecurity makes the latest line feel less settled than it looks`,
    immediateWant: 'regain footing and find out what the other person really means',
    immediateRisk: 'over-explaining, testing loyalty, or treating ambiguity as rejection',
    observableMove: 'ask a pointed follow-up, qualify the answer, seek confirmation indirectly, or pre-empt the feared reading',
  };
  if (emotion.kind === 'embarrassment') return {
    feltReaction: `${strength} embarrassment makes being observed by ${params.targetName} part of the problem`,
    immediateWant: 'recover face without openly confessing the discomfort',
    immediateRisk: 'a denial, joke, change of subject, or abrupt brevity revealing exactly what was meant to stay hidden',
    observableMove: 'deflect, understate, go briefly quiet, answer too quickly, or turn the attention back on the other person',
  };
  return {
    feltReaction: `${strength} excitement is outrunning the speaker's usual pacing`,
    immediateWant: 'act on the opening before the room moves on',
    immediateRisk: 'jumping ahead, interrupting, oversharing, or sending the thought in several quick beats',
    observableMove: 'volunteer, seize a detail, speak faster, take a risk, or follow with a second short message when the thought genuinely arrives late',
  };
}

function deriveRelationalAppraisal(params: {
  speaker: AICharacter;
  counterpart?: AICharacter;
  targetName: string;
  relationship: AICharacter['relationships'][number] | undefined;
  directAddress: boolean;
  innerLife: InnerLifeProjection;
}) {
  const { speaker, counterpart, targetName, relationship, directAddress, innerLife } = params;
  const warmth = axis(relationship?.warmth);
  const competence = axis(relationship?.competence);
  const trust = axis(relationship?.trust);
  const threat = axis(relationship?.threat);
  const attachment = axis(relationship?.attachment);
  const deference = axis(relationship?.deference);
  const reciprocal = counterpart?.relationships.find((item) => item.characterId === speaker.id);
  const receivesDeference = axis(reciprocal?.deference) >= 35;

  if (deference >= 35) {
    return {
      action: 'answer_upward' as const,
      feltReaction: directAddress
        ? `${targetName}'s direct attention raises the stakes; even a neutral question feels like an appraisal`
        : `${targetName}'s judgment carries weight, so this speaker cannot treat the exchange as peer-level chatter`,
      immediateWant: `remain credible in ${targetName}'s eyes without giving up firsthand judgment`,
      immediateRisk: 'looking careless, evasive, or publicly incompetent in front of someone whose judgment matters',
      observableMove: 'respond to the authority pressure first, then either account for a mistake, defend one limit, or seek confirmation; do not sound like an equal chairing a meeting',
    };
  }
  if (receivesDeference) {
    return {
      action: 'exercise_authority' as const,
      feltReaction: `${targetName} is answerable to this speaker, so their uncertainty or resistance is personally consequential rather than neutral input`,
      immediateWant: `get a usable answer from ${targetName} while deciding whether to shield, press, or correct them`,
      immediateRisk: 'losing authority through empty reassurance or humiliating a subordinate whose work is still needed',
      observableMove: 'make the hierarchy visible through permission, consequence, protection, scrutiny, or a decision; do not merely agree with the task plan',
    };
  }
  if (threat >= 25 || trust <= -20) {
    return {
      action: 'test' as const,
      feltReaction: `${targetName}'s line lands under suspicion; the surface claim is not enough`,
      immediateWant: `find what ${targetName} is omitting or make them bear the consequence of the claim`,
      immediateRisk: 'ceding initiative or being made foolish by trusting too quickly',
      observableMove: 'withhold easy agreement and test, corner, contradict, or expose one implication that changes the relationship temperature',
    };
  }
  if (attachment >= 28 || warmth >= 25) {
    return {
      action: 'protect' as const,
      feltReaction: `${targetName}'s reaction matters beyond the topic, even if this speaker hides that concern`,
      immediateWant: `keep ${targetName} close, safe, or understood without turning the moment into generic kindness`,
      immediateRisk: 'revealing too much concern, enabling a mistake, or watching the other person pull away',
      observableMove: 'show partiality through what is forgiven, noticed, defended, teased, or taken on; let care have a cost or a bias',
    };
  }
  if (competence >= 30 && trust >= 18) {
    return {
      action: 'approach' as const,
      feltReaction: `${targetName}'s judgment is credible enough to alter this speaker's own certainty`,
      immediateWant: `use ${targetName}'s judgment without disappearing into agreement`,
      immediateRisk: 'becoming a passive echo or relying on the other person beyond what the evidence supports',
      observableMove: 'concede something specific, rely on the other person for one decision, or reveal where their judgment changes the speaker\'s next act',
    };
  }
  if (innerLife.impulse === 'show_off' || axis(speaker.personality.assertiveness) >= 72) {
    return {
      action: 'seek_recognition' as const,
      feltReaction: `the exchange creates an opening to establish standing with ${targetName}`,
      immediateWant: 'be recognized as useful, right, brave, perceptive, or difficult to dismiss',
      immediateRisk: 'overplaying the bid for status and exposing insecurity',
      observableMove: 'claim a piece of authority, take a risk, or make a pointed contribution whose social purpose is visible',
    };
  }
  return {
    action: 'situated' as const,
    feltReaction: innerLife.pressure >= 0.42
      ? `the latest line creates ${innerLife.tone} pressure, but no single relationship axis decides the response`
      : 'no strong stored emotion is active; react to the immediate social consequence instead of defaulting to neutrality',
    immediateWant: `leave the exchange with a clearer position toward ${targetName}`,
    immediateRisk: 'sounding interchangeable with anyone else in the room',
    observableMove: 'choose one bias: permit, refuse, tease, concede, demand, withdraw, or reveal a preference; do not only add information',
  };
}

/**
 * Decides why this person would enter this particular moment before deciding
 * what conversational move their line should take. It deliberately returns
 * evidence-backed fields so an empty profile cannot fabricate a private drama.
 */
export function deriveCharacterTurnDrive(input: {
  speaker: AICharacter;
  counterpart?: AICharacter;
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
  const appraisal = deriveRelationalAppraisal({
    speaker,
    counterpart: input.counterpart,
    targetName,
    relationship,
    directAddress,
    innerLife,
  });
  const emotionPressure = deriveEmotionPressure({ speaker, relationship, innerLife, targetName });
  if (directAddress) evidence.push('direct_address');
  if (relationship) evidence.push('relationship_to_current_target');
  if (input.includeRelationshipNote !== false && relationship?.note?.trim()) evidence.push('directional_relationship_note');
  if (sharedRelationshipFacts.length) evidence.push('shared_relationship_structure');
  if (core?.coreDesire) evidence.push('core_desire');
  if (core?.coreFear) evidence.push('core_fear');
  if (core?.valuePriority?.length || core?.values?.length) evidence.push('core_values');
  if (core?.interactionHabits?.length || core?.perceptionBiases?.length || core?.sensitivities?.length) evidence.push('character_attention_pattern');
  if (innerLife.impulse !== 'stay_silent') evidence.push(`inner_impulse:${innerLife.impulse}`);

  let relationalAction: CharacterRelationalAction = appraisal.action;
  const hierarchyAlreadyDecidesAction = appraisal.action === 'answer_upward' || appraisal.action === 'exercise_authority';
  if (!hierarchyAlreadyDecidesAction) {
    if (innerLife.impulse === 'repair') relationalAction = 'repair';
    else if (innerLife.impulse === 'mock' || innerLife.impulse === 'defend_face') relationalAction = 'resist';
    else if (innerLife.impulse === 'comfort') relationalAction = 'approach';
    else if (innerLife.impulse === 'show_off') relationalAction = 'compete';
    else if (!relationship && !sharedRelationshipFacts.length && (innerLife.impulse === 'avoid' || innerLife.impulse === 'withdraw' || innerLife.impulse === 'stay_silent')) relationalAction = 'avoid';
  }

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

  return {
    stake,
    relationalAction,
    feltReaction: emotionPressure ? `${appraisal.feltReaction}; ${emotionPressure.feltReaction}` : appraisal.feltReaction,
    immediateWant: emotionPressure?.immediateWant || appraisal.immediateWant,
    immediateRisk: emotionPressure ? `${appraisal.immediateRisk}; ${emotionPressure.immediateRisk}` : appraisal.immediateRisk,
    observableMove: emotionPressure ? `${appraisal.observableMove}; emotionally, ${emotionPressure.observableMove}` : appraisal.observableMove,
    attentionLens,
    speakingNecessity,
    evidence,
  };
}

export function getCharacterTurnDriveSpeakerBias(drive: CharacterTurnDrive) {
  if (drive.speakingNecessity === 'strong') return 0.24;
  if (drive.speakingNecessity === 'let_silence_stand') return -0.3;
  return 0;
}
