import { describe, expect, it } from 'vitest';
import { resolveCharacterOrDeleted } from './deletedEntity';

describe('deletedEntity', () => {
  it('resolves user actor id to a stable user placeholder instead of deleted member', () => {
    const resolved = resolveCharacterOrDeleted([], 'user');
    expect(resolved.id).toBe('user');
    expect(resolved.name).toBe('我');
  });
});

