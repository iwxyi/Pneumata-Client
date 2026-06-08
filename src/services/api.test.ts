import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api sync changes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rebuilds the current scope when a log cursor has expired', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'reset_required',
        code: 'SYNC_CURSOR_EXPIRED',
        scope: 'chats.summary',
        cursor: 'log:120',
        revision: 'log:120',
        changes: [],
        hasMore: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'modified',
        scope: 'chats.summary',
        cursor: 'log:150',
        revision: 'log:150',
        changes: [{ op: 'delete', entity: 'chat_summary', id: 'chat-1', revision: 150 }],
        hasMore: false,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getSyncChanges({ scope: 'chats.summary', since: 'log:1' });

    expect(result.status).toBe('modified');
    expect(result.cursor).toBe('log:150');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sync/changes?scope=chats.summary&since=log%3A1');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sync/changes?scope=chats.summary');
  });

  it('does not retry ordinary sync responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      status: 'not_modified',
      scope: 'characters.summary',
      cursor: 'log:10',
      revision: 'log:10',
      changes: [],
      hasMore: false,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getSyncChanges({ scope: 'characters.summary', since: 'log:10' });

    expect(result.status).toBe('not_modified');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sync/changes?scope=characters.summary&since=log%3A10');
  });
});
