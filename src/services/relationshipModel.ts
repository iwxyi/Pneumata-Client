import type { CharacterRelationshipPreset } from '../types/character';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';

export function projectPresetToLedgerCurrent(relation: CharacterRelationshipPreset): RelationshipLedgerEntry['current'] {
  return {
    warmth: relation.warmth,
    competence: relation.competence,
    trust: relation.trust,
    threat: relation.threat,
  };
}

export function relationshipPositiveScore(relation: Pick<CharacterRelationshipPreset, 'warmth' | 'competence' | 'trust' | 'threat'>) {
  return relation.warmth + relation.competence + relation.trust - relation.threat;
}
