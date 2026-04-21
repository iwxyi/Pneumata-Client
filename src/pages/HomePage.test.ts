import { describe, expect, it } from 'vitest';

function getHomeOpenPath(kind: 'group' | 'direct') {
  return kind === 'group' ? '/chats?tab=0' : '/chats?tab=1';
}

describe('HomePage navigation mapping', () => {
  it('opens group chat stats on the group tab', () => {
    expect(getHomeOpenPath('group')).toBe('/chats?tab=0');
  });

  it('opens direct chat stats on the direct tab', () => {
    expect(getHomeOpenPath('direct')).toBe('/chats?tab=1');
  });
});
