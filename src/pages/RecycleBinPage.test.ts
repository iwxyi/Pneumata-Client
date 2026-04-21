import { describe, expect, it } from 'vitest';

type DeletedItem = { id: string; deletedAt?: number | null };

function removeSelectedFromItems<T extends DeletedItem>(items: T[], ids: string[]) {
  const removed = new Set(ids);
  return items.filter((item) => !removed.has(item.id));
}

function sortByDeletedAt<T extends DeletedItem>(items: T[]) {
  return [...items].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

describe('RecycleBinPage helpers', () => {
  it('removes restored items immediately from local recycle state', () => {
    const items = [
      { id: 'a', deletedAt: 10 },
      { id: 'b', deletedAt: 20 },
      { id: 'c', deletedAt: 30 },
    ];

    expect(removeSelectedFromItems(items, ['b', 'c'])).toEqual([
      { id: 'a', deletedAt: 10 },
    ]);
  });

  it('sorts deleted items with most recently deleted first', () => {
    const items = [
      { id: 'a', deletedAt: 10 },
      { id: 'b', deletedAt: 30 },
      { id: 'c', deletedAt: 20 },
    ];

    expect(sortByDeletedAt(items).map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });
});
