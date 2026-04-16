import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import { deriveRelationshipDelta } from './emotionTracker';

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function getRelationshipBetween(character: AICharacter, targetCharacterId: string) {
  return character.relationships.find((item) => item.characterId === targetCharacterId);
}

export function getRelationshipWeight(character: AICharacter, targetCharacterId: string) {
  const relation = getRelationshipBetween(character, targetCharacterId);
  if (!relation) return 0;
  const positive = relation.affinity * 0.35 + relation.respect * 0.25;
  const negative = relation.hostility * 0.3 + relation.contempt * 0.25;
  return (positive - negative) / 100;
}

export function summarizeRelationshipShift(relation?: CharacterRelationshipPreset) {
  if (!relation) return '关系开始建立';
  const positive = relation.affinity + relation.respect;
  const negative = relation.hostility + relation.contempt;
  if (positive - negative >= 70) return '明显靠近';
  if (negative - positive >= 70) return '明显恶化';
  if (positive >= negative) return '略有升温';
  return '略有紧张';
}

export function updateCharacterRelationship(
  character: AICharacter,
  targetCharacterId: string,
  messageContent: string,
  multiplier: number = 1
): AICharacter {
  const rawDelta = deriveRelationshipDelta(messageContent);
  const delta = {
    affinity: Math.round(rawDelta.affinity * multiplier),
    respect: Math.round(rawDelta.respect * multiplier),
    hostility: Math.round(rawDelta.hostility * multiplier),
    contempt: Math.round(rawDelta.contempt * multiplier),
  };
  const existing = character.relationships.find((item) => item.characterId === targetCharacterId);

  const nextRelationship: CharacterRelationshipPreset = existing
    ? {
        ...existing,
        affinity: clamp(existing.affinity + delta.affinity),
        respect: clamp(existing.respect + delta.respect),
        hostility: clamp(existing.hostility + delta.hostility),
        contempt: clamp(existing.contempt + delta.contempt),
        updatedAt: Date.now(),
      }
    : {
        characterId: targetCharacterId,
        affinity: clamp(50 + delta.affinity),
        respect: clamp(50 + delta.respect),
        hostility: clamp(delta.hostility),
        contempt: clamp(delta.contempt),
        note: '',
        updatedAt: Date.now(),
      };

  return {
    ...character,
    relationships: existing
      ? character.relationships.map((item) => item.characterId === targetCharacterId ? nextRelationship : item)
      : [...character.relationships, nextRelationship],
  };
}
