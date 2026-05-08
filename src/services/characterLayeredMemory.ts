import type { AICharacter } from '../types/character';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { consolidateMemoryCandidates } from './memoryConsolidation';

function buildRelationshipMemoryCandidate(character: AICharacter, targetId: string, targetName: string, content: string): MemoryCandidate {
  const relation = character.relationships.find((item) => item.characterId === targetId);
  const isPositive = (relation?.warmth || 0) + (relation?.competence || 0) + (relation?.trust || 0) >= (relation?.threat || 0) + 12;
  return {
    scope: 'relationship',
    layerHint: 'episodic',
    kind: isPositive ? 'bond' : 'resentment',
    ownerId: character.id,
    subjectIds: [character.id, targetId],
    text: `对 ${targetName} 的态度发生变化：${content.slice(0, 96)}`,
    sourceEventIds: ['group_relationship_shift'],
    scoreBreakdown: { stability: 0.65, recurrence: 0.55, impact: 0.8, specificity: 0.7, durability: 0.65 },
  };
}

function buildSelfStateMemoryCandidate(character: AICharacter, content: string): MemoryCandidate {
  return {
    scope: 'character_self',
    layerHint: 'working',
    kind: 'trait_evidence',
    ownerId: character.id,
    text: `近期表达倾向：${content.slice(0, 96)}`,
    sourceEventIds: ['self_expression'],
    scoreBreakdown: { stability: 0.45, recurrence: 0.45, impact: 0.6, specificity: 0.68, durability: 0.45 },
  };
}

function buildDriftMemoryCandidates(character: AICharacter, drift: Partial<AICharacter['personality']>): MemoryCandidate[] {
  const entries = Object.entries(drift || {}).filter(([, value]) => typeof value === 'number' && value !== 0);
  if (!entries.length) return [];
  return [{
    scope: 'character_self',
    layerHint: 'episodic',
    kind: 'trait_evidence',
    ownerId: character.id,
    text: `性格出现漂移：${entries.map(([key, value]) => `${key}${Number(value) > 0 ? '+' : ''}${value}`).join('，')}`,
    sourceEventIds: ['personality_drift'],
    scoreBreakdown: { stability: 0.55, recurrence: 0.45, impact: 0.7, specificity: 0.75, durability: 0.55 },
  }];
}

function buildEmotionMemoryCandidates(character: AICharacter): MemoryCandidate[] {
  const emotional = character.emotionalState;
  if (!emotional) return [];
  const entries = Object.entries(emotional).filter(([, value]) => typeof value === 'number' && value >= 55);
  if (!entries.length) return [];
  return [{
    scope: 'character_self',
    layerHint: 'working',
    kind: 'trait_evidence',
    ownerId: character.id,
    text: `当前情绪偏高：${entries.map(([key, value]) => `${key}${value}`).join('，')}`,
    sourceEventIds: ['emotional_state'],
    scoreBreakdown: { stability: 0.45, recurrence: 0.4, impact: 0.65, specificity: 0.7, durability: 0.4 },
  }];
}

function buildCoreProfileMemoryCandidates(character: AICharacter): MemoryCandidate[] {
  if (!character.coreProfile?.coreDesire && !character.coreProfile?.coreFear) return [];
  return [{
    scope: 'character_self',
    layerHint: 'long_term',
    kind: 'bias',
    ownerId: character.id,
    text: [character.coreProfile?.coreDesire ? `欲望:${character.coreProfile.coreDesire}` : '', character.coreProfile?.coreFear ? `恐惧:${character.coreProfile.coreFear}` : ''].filter(Boolean).join(' / '),
    sourceEventIds: ['core_profile'],
    scoreBreakdown: { stability: 0.8, recurrence: 0.5, impact: 0.7, specificity: 0.75, durability: 0.85 },
  }];
}

function buildTraitMemoryCandidates(character: AICharacter): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  if (character.background?.trim()) {
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: 'trait_evidence',
      ownerId: character.id,
      text: `背景线索：${character.background.slice(0, 80)}`,
      sourceEventIds: ['background'],
      scoreBreakdown: { stability: 0.75, recurrence: 0.35, impact: 0.55, specificity: 0.75, durability: 0.8 },
    });
  }
  if (character.speakingStyle?.trim()) {
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: 'trait_evidence',
      ownerId: character.id,
      text: `说话风格：${character.speakingStyle.slice(0, 60)}`,
      sourceEventIds: ['speaking_style'],
      scoreBreakdown: { stability: 0.72, recurrence: 0.35, impact: 0.5, specificity: 0.7, durability: 0.78 },
    });
  }
  if (character.expertise?.length) {
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: 'trait_evidence',
      ownerId: character.id,
      text: `专长：${character.expertise.join(' / ').slice(0, 80)}`,
      sourceEventIds: ['expertise'],
      scoreBreakdown: { stability: 0.78, recurrence: 0.4, impact: 0.58, specificity: 0.76, durability: 0.82 },
    });
  }
  return candidates;
}

export function updateCharacterLayeredMemories(params: {
  character: AICharacter;
  targetId?: string;
  targetName?: string;
  content: string;
  personalityDrift: Partial<AICharacter['personality']>;
}) {
  const primaryCandidate = params.targetId && params.targetName
    ? buildRelationshipMemoryCandidate(params.character, params.targetId, params.targetName, params.content)
    : buildSelfStateMemoryCandidate(params.character, params.content);

  const candidates: MemoryCandidate[] = [
    primaryCandidate,
    ...buildDriftMemoryCandidates(params.character, params.personalityDrift),
    ...buildEmotionMemoryCandidates(params.character),
    ...buildCoreProfileMemoryCandidates(params.character),
    ...buildTraitMemoryCandidates(params.character),
  ];

  return consolidateMemoryCandidates(params.character.layeredMemories || [], candidates);
}

export function getCharacterLayeredMemories(character: AICharacter): MemoryItem[] {
  return character.layeredMemories || [];
}
