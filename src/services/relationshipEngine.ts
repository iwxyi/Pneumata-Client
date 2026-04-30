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
  const positive = relation.warmth * 0.32 + relation.competence * 0.2 + relation.trust * 0.28;
  const negative = relation.threat * 0.38;
  return (positive - negative - 50) / 100;
}

export function summarizeRelationshipShift(relation?: CharacterRelationshipPreset) {
  if (!relation) return '关系开始建立';
  const positive = relation.warmth + relation.competence + relation.trust;
  const negative = relation.threat;
  if (positive - negative >= 120) return '明显靠近';
  if (negative - positive >= 40) return '明显恶化';
  if (positive >= 150) return '略有升温';
  return '略有紧张';
}

export function updateCharacterRelationship(
  character: AICharacter,
  targetCharacterId: string,
  messageContent: string,
  multiplier: number = 1,
): AICharacter {
  const rawDelta = deriveRelationshipDelta(messageContent);
  const delta = {
    warmth: Math.round(rawDelta.warmth * multiplier),
    competence: Math.round(rawDelta.competence * multiplier),
    trust: Math.round(rawDelta.trust * multiplier),
    threat: Math.round(rawDelta.threat * multiplier),
  };
  const existing = character.relationships.find((item) => item.characterId === targetCharacterId);

  const nextRelationship: CharacterRelationshipPreset = existing
    ? {
        ...existing,
        warmth: clamp(existing.warmth + delta.warmth),
        competence: clamp(existing.competence + delta.competence),
        trust: clamp(existing.trust + delta.trust),
        threat: clamp(existing.threat + delta.threat),
        updatedAt: Date.now(),
      }
    : {
        characterId: targetCharacterId,
        warmth: clamp(50 + delta.warmth),
        competence: clamp(50 + delta.competence),
        trust: clamp(50 + delta.trust),
        threat: clamp(delta.threat),
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
