import { describe, expect, it } from 'vitest';

function normalizeMemberIds(selectedMembers: string[]) {
  return Array.from(new Set(selectedMembers.filter(Boolean)));
}

function normalizeAdminCharacterIds(adminCharacterIds: string[], validMemberIds: string[], ownerCharacterId: string | null) {
  return Array.from(new Set(adminCharacterIds.filter((memberId) => validMemberIds.includes(memberId) && memberId !== ownerCharacterId)));
}

describe('CreateChatPage member normalization', () => {
  it('deduplicates and removes empty member ids', () => {
    expect(normalizeMemberIds(['a', '', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('keeps only valid admins and excludes owner', () => {
    const validMembers = ['owner', 'admin-1', 'admin-2'];
    expect(normalizeAdminCharacterIds(['owner', 'admin-1', 'ghost', 'admin-1'], validMembers, 'owner')).toEqual(['admin-1']);
  });
});
