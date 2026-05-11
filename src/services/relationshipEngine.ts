import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import { deriveRelationshipDelta } from './emotionTracker';

function sanitizeMetric(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clampSigned(value: number) {
  const safeValue = sanitizeMetric(value);
  return Math.max(-100, Math.min(100, safeValue));
}

function clampThreat(value: number) {
  const safeValue = sanitizeMetric(value);
  return Math.max(0, Math.min(100, safeValue));
}

function sanitizeDelta(rawDelta: { warmth?: number; competence?: number; trust?: number; threat?: number }) {
  return {
    warmth: sanitizeMetric(rawDelta.warmth || 0),
    competence: sanitizeMetric(rawDelta.competence || 0),
    trust: sanitizeMetric(rawDelta.trust || 0),
    threat: sanitizeMetric(rawDelta.threat || 0),
  };
}

function sanitizeRelationshipPreset(relationship: CharacterRelationshipPreset): CharacterRelationshipPreset {
  return {
    ...relationship,
    warmth: clampSigned(relationship.warmth),
    competence: clampSigned(relationship.competence),
    trust: clampSigned(relationship.trust),
    threat: clampThreat(relationship.threat),
  };
}

function sanitizeCharacterRelationships(character: AICharacter): AICharacter {
  return {
    ...character,
    relationships: (character.relationships || []).map(sanitizeRelationshipPreset),
  };
}

function looksLikeNeutralProbe(text: string) {
  return /[?？]$/.test(text.trim()) || /(能具体说说|可以具体说说|你观察到了哪些|为什么这么觉得|怎么判断|什么依据|能展开吗|能详细说说)/.test(text);
}

function looksSupportiveOrProfessional(text: string) {
  return /(关键|具体说说|继续说|我想听听|这很重要|谢谢你分享|能展开一点|我们先看看)/.test(text);
}

function normalizeRawDelta(rawDelta: { warmth?: number; competence?: number; trust?: number; threat?: number }) {
  return sanitizeDelta(rawDelta);
}

function deriveSafeRelationshipDelta(messageContent: string) {
  if (looksLikeNeutralProbe(messageContent)) return { warmth: 0, competence: 1, trust: 0, threat: 0 };
  if (looksSupportiveOrProfessional(messageContent)) return { warmth: 2, competence: 1, trust: 1, threat: 0 };
  const rawDelta = sanitizeDelta(deriveRelationshipDelta(messageContent));
  if (rawDelta.threat > 0 && rawDelta.warmth >= 0 && rawDelta.trust >= 0 && !/[你他她它].*(错|闭嘴|别装|胡说|可疑|有问题|威胁|麻烦)|滚|蠢|废物|讨厌|反对/.test(messageContent)) {
    return { ...rawDelta, threat: 0 };
  }
  return rawDelta;
}

function roundRelationshipDelta(rawDelta: { warmth?: number; competence?: number; trust?: number; threat?: number }, multiplier: number) {
  const normalized = normalizeRawDelta(rawDelta);
  return {
    warmth: Math.round(normalized.warmth * multiplier),
    competence: Math.round(normalized.competence * multiplier),
    trust: Math.round(normalized.trust * multiplier),
    threat: Math.round(normalized.threat * multiplier),
  };
}

function buildNextRelationship(existing: CharacterRelationshipPreset | undefined, targetCharacterId: string, delta: { warmth: number; competence: number; trust: number; threat: number }): CharacterRelationshipPreset {
  const safeExisting = existing ? sanitizeRelationshipPreset(existing) : undefined;
  return safeExisting
    ? {
        ...safeExisting,
        warmth: clampSigned(safeExisting.warmth + delta.warmth),
        competence: clampSigned(safeExisting.competence + delta.competence),
        trust: clampSigned(safeExisting.trust + delta.trust),
        threat: clampThreat(safeExisting.threat + delta.threat),
        updatedAt: Date.now(),
      }
    : {
        characterId: targetCharacterId,
        warmth: clampSigned(delta.warmth),
        competence: clampSigned(delta.competence),
        trust: clampSigned(delta.trust),
        threat: clampThreat(delta.threat),
        note: '',
        updatedAt: Date.now(),
      };
}

export function applyRelationshipDelta(
  character: AICharacter,
  targetCharacterId: string,
  rawDelta: { warmth?: number; competence?: number; trust?: number; threat?: number },
  multiplier: number = 1,
): AICharacter {
  const safeCharacter = sanitizeCharacterRelationships(character);
  const delta = roundRelationshipDelta(sanitizeDelta(rawDelta), multiplier);
  const existing = safeCharacter.relationships.find((item) => item.characterId === targetCharacterId);
  const nextRelationship = buildNextRelationship(existing, targetCharacterId, delta);
  return sanitizeCharacterRelationships({
    ...safeCharacter,
    relationships: existing
      ? safeCharacter.relationships.map((item) => item.characterId === targetCharacterId ? nextRelationship : item)
      : [...safeCharacter.relationships, nextRelationship],
  });
}

export function deriveFallbackRelationshipDelta(messageContent: string) {
  return deriveSafeRelationshipDelta(messageContent);
}

export function updateCharacterRelationship(
  character: AICharacter,
  targetCharacterId: string,
  messageContent: string,
  multiplier: number = 1,
): AICharacter {
  return applyRelationshipDelta(character, targetCharacterId, deriveSafeRelationshipDelta(messageContent), multiplier);
}

export function updateCharacterRelationshipFromDelta(
  character: AICharacter,
  targetCharacterId: string,
  rawDelta: { warmth?: number; competence?: number; trust?: number; threat?: number },
  multiplier: number = 1,
): AICharacter {
  return applyRelationshipDelta(character, targetCharacterId, rawDelta, multiplier);
}

export function getRelationshipBetween(character: AICharacter, targetCharacterId: string) {
  return sanitizeCharacterRelationships(character).relationships.find((item) => item.characterId === targetCharacterId);
}

export function getRelationshipWeight(character: AICharacter, targetCharacterId: string) {
  const relation = getRelationshipBetween(character, targetCharacterId);
  if (!relation) return 0;
  const warmth = Number.isFinite(relation.warmth) ? relation.warmth : 0;
  const competence = Number.isFinite(relation.competence) ? relation.competence : 0;
  const trust = Number.isFinite(relation.trust) ? relation.trust : 0;
  const threat = Number.isFinite(relation.threat) ? relation.threat : 0;
  const positive = warmth * 0.32 + competence * 0.2 + trust * 0.28;
  const negative = threat * 0.38;
  return (positive - negative) / 100;
}

export function summarizeRelationshipShift(relation?: CharacterRelationshipPreset) {
  if (!relation) return '关系尚未建立';
  const safeRelation = sanitizeRelationshipPreset(relation);
  const positive = safeRelation.warmth + safeRelation.competence + safeRelation.trust;
  const negative = safeRelation.threat;
  if (positive - negative >= 36) return '明显靠近';
  if (negative - positive >= 18) return '明显恶化';
  if (positive >= 12) return '略有升温';
  if (negative >= 10) return '略有紧张';
  return '整体中性';
}
