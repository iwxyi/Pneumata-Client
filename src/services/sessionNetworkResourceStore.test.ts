import { beforeAll, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

beforeAll(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('sessionNetworkResourceStore', () => {
  it('keeps resources across turns but only loads explicitly selected ids', async () => {
    const { getSessionNetworkResourceContexts, listSessionNetworkResourceRegistry, saveSessionNetworkResource } = await import('./sessionNetworkResourceStore');
    const chatId = `chat-${Date.now()}`;
    const first = await saveSessionNetworkResource({
      chatId,
      sourceUrl: 'https://example.com/alpha.txt',
      path: 'alpha.txt',
      name: 'alpha.txt',
      mimeType: 'text/plain',
      sizeBytes: 13,
      blob: new Blob(['alpha content']),
    });
    await saveSessionNetworkResource({
      chatId,
      sourceUrl: 'https://example.com/beta.txt',
      path: 'beta.txt',
      name: 'beta.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      blob: new Blob(['beta content']),
    });

    expect(await listSessionNetworkResourceRegistry(chatId)).toHaveLength(2);
    await expect(getSessionNetworkResourceContexts(chatId, [], 'alpha')).resolves.toEqual([]);
    await expect(getSessionNetworkResourceContexts(chatId, [first.id], 'alpha')).resolves.toMatchObject([
      { name: 'alpha.txt', content: 'alpha content' },
    ]);
  });

  it('honors the dynamic character budget', async () => {
    const { getSessionNetworkResourceContexts, saveSessionNetworkResource } = await import('./sessionNetworkResourceStore');
    const chatId = `budget-${Date.now()}`;
    const saved = await saveSessionNetworkResource({
      chatId,
      sourceUrl: 'https://example.com/large.txt',
      path: 'large.txt',
      name: 'large.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
      blob: new Blob(['x'.repeat(100)]),
    });

    const [context] = await getSessionNetworkResourceContexts(chatId, [saved.id], 'large', 24);
    expect(context?.content).toHaveLength(24);
    expect(context?.truncated).toBe(true);
  });
});
