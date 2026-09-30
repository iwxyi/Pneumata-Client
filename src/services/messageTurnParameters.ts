import type { GroupChat } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { MessageMetadata } from '../types/message';
import type { InnerLifeProjection } from './innerLifeEngine';

type TurnParameters = NonNullable<MessageMetadata['turnParameters']>;

export function captureTurnParameters(input: {
  chat: GroupChat;
  speaker: AICharacter;
  members: AICharacter[];
  innerLife: InnerLifeProjection;
  move: string;
  targetId?: string | null;
  intendedRecipientIds: string[];
  hotspot?: string | null;
  enabled: boolean;
}): Omit<TurnParameters, 'delivery'> | undefined {
  if (!input.enabled) return undefined;
  const names = new Map(input.members.map((member) => [member.id, member.name]));
  const nameOf = (id: string) => names.get(id);
  const relevantIds = new Set([
    ...input.intendedRecipientIds,
    input.targetId,
    input.innerLife.activeAffect?.counterpartId,
  ].filter((id): id is string => Boolean(id && nameOf(id) && id !== input.speaker.id)));
  const relationships = [...relevantIds].slice(0, 8).flatMap((id) => {
    const relation = input.speaker.relationships?.find((entry) => entry.characterId === id);
    const ledger = input.chat.relationshipLedger?.find((entry) => entry.actorId === input.speaker.id && entry.targetId === id);
    // Authored relationships are the global source of truth; the room ledger is a legacy fallback.
    const axes = relation || ledger?.current;
    if (!axes) return [];
    return [{ target: nameOf(id)!, warmth: axes.warmth, competence: axes.competence,
      trust: axes.trust, threat: axes.threat, attachment: axes.attachment || 0,
      deference: axes.deference || 0 }];
  });
  const room = input.chat.worldState?.structuredRoomState;
  return {
    version: 1,
    emotion: {
      mood: {
        pleasure: input.innerLife.state.mood.pleasure,
        arousal: input.innerLife.state.mood.arousal,
        dominance: input.innerLife.state.mood.dominance,
      },
      tone: input.innerLife.tone,
      impulse: input.innerLife.impulse,
      pressure: input.innerLife.pressure,
      ...(input.innerLife.dominantEmotion ? { dominant: {
        kind: input.innerLife.dominantEmotion.kind,
        value: input.innerLife.dominantEmotion.value,
      } } : {}),
      ...(input.innerLife.activeAffect && nameOf(input.innerLife.activeAffect.counterpartId) ? { directed: {
        counterpart: nameOf(input.innerLife.activeAffect.counterpartId)!,
        kind: input.innerLife.activeAffect.kind,
        role: input.innerLife.activeAffect.role,
        pressure: input.innerLife.activeAffect.pressure,
      } } : {}),
    },
    relationships,
    ...(room ? { room: { heat: room.heat, cohesion: room.cohesion, topicDrift: room.topicDrift,
      ...(input.hotspot ? { hotspot: input.hotspot } : {}) } } : input.hotspot ? { room: {
      hotspot: input.hotspot,
    } } : {}),
    plan: {
      move: input.move,
      ...(input.targetId && nameOf(input.targetId) ? { target: nameOf(input.targetId) } : {}),
      addressedBefore: input.innerLife.evidence.some((item) => item.includes('直接提到') || item.includes('直接点名')),
      intendedRecipients: input.intendedRecipientIds.flatMap((id) => nameOf(id) ? [nameOf(id)!] : []).slice(0, 8),
    },
  };
}

export function finishTurnParameters(input: {
  captured?: Omit<TurnParameters, 'delivery'>;
  members: AICharacter[];
  addressedTargetIds?: string[] | null;
  primaryAddressedTargetId?: string | null;
  bubbleCount: number;
}): TurnParameters | undefined {
  if (!input.captured) return undefined;
  const names = new Map(input.members.map((member) => [member.id, member.name]));
  return {
    ...input.captured,
    delivery: {
      addressedRecipients: (input.addressedTargetIds || []).flatMap((id) => names.get(id) ? [names.get(id)!] : []).slice(0, 8),
      ...(input.primaryAddressedTargetId && names.get(input.primaryAddressedTargetId)
        ? { primaryRecipient: names.get(input.primaryAddressedTargetId) } : {}),
      bubbleCount: input.bubbleCount,
    },
  };
}
