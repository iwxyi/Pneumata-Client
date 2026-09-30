import type {
  MemoryItem,
  MemoryScope,
  MemorySubjectOwner,
  MemoryValidity,
  MemoryVisibility,
} from './memoryTypes';

export interface MemoryDisclosureMetadata {
  subjectOwner: MemorySubjectOwner;
  privacyRisk: number;
  visibility: MemoryVisibility;
  validity: MemoryValidity;
}

function defaultVisibility(scope: MemoryScope): MemoryVisibility {
  if (scope === 'relationship' || scope === 'thread') return 'pair_private';
  if (scope === 'character_self') return 'private';
  return 'public_safe';
}

function defaultSubjectOwner(scope: MemoryScope): MemorySubjectOwner {
  if (scope === 'relationship' || scope === 'thread') return 'target';
  if (scope === 'character_self') return 'speaker';
  return 'unknown';
}

function visibilityRisk(visibility: MemoryVisibility) {
  if (visibility === 'never_surface') return 1;
  if (visibility === 'private') return 0.75;
  if (visibility === 'pair_private') return 0.55;
  return 0.05;
}

/**
 * Resolves legacy memories without interpreting their prose. New memories are
 * expected to carry model-produced disclosure metadata; scope-based defaults
 * exist only so older persisted data has deterministic, conservative behavior.
 */
export function resolveMemoryDisclosureMetadata(
  item: Pick<MemoryItem, 'scope' | 'subjectOwner' | 'privacyRisk' | 'visibility' | 'validity'>,
): MemoryDisclosureMetadata {
  const visibility = item.visibility || defaultVisibility(item.scope);
  const subjectOwner = item.subjectOwner || defaultSubjectOwner(item.scope);
  const declaredRisk = typeof item.privacyRisk === 'number' && Number.isFinite(item.privacyRisk)
    ? Math.max(0, Math.min(1, item.privacyRisk))
    : 0;
  const ownershipRisk = subjectOwner === 'third_party' ? 0.7 : 0;
  return {
    subjectOwner,
    visibility,
    privacyRisk: Math.max(declaredRisk, visibilityRisk(visibility), ownershipRisk),
    validity: item.validity || 'active',
  };
}
