import { describe, expect, it } from 'vitest';
import { resolveStorySidebarTab } from './useChatSidebarProjection';

describe('resolveStorySidebarTab', () => {
  it('keeps explicit story asset tabs', () => {
    expect(resolveStorySidebarTab('narrative')).toBe('narrative');
    expect(resolveStorySidebarTab('chapters')).toBe('chapters');
    expect(resolveStorySidebarTab('clues')).toBe('clues');
    expect(resolveStorySidebarTab('roles')).toBe('roles');
    expect(resolveStorySidebarTab('developer')).toBe('developer');
  });

  it('maps ordinary chat tabs to the story overview instead of member management', () => {
    expect(resolveStorySidebarTab('members')).toBe('narrative');
    expect(resolveStorySidebarTab('world')).toBe('narrative');
    expect(resolveStorySidebarTab('actions')).toBe('narrative');
    expect(resolveStorySidebarTab('activities')).toBe('narrative');
  });
});
