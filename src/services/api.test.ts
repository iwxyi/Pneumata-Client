import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';
import { AUTH_SESSION_EXPIRED_EVENT } from './authSession';

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

  it('dispatches a session expired event when an authenticated request returns 401', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: '登录已过期，请重新登录',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('CustomEvent', class<T = unknown> extends Event {
      detail: T;
      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    });
    const eventTarget = new EventTarget();
    Object.defineProperty(eventTarget, 'location', {
      value: { pathname: '/chats/1', search: '?tab=0', hash: '' },
    });
    vi.stubGlobal('window', eventTarget);
    const events: unknown[] = [];
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, (event) => events.push((event as CustomEvent).detail));

    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);

    expect(events).toEqual([
      expect.objectContaining({ status: 401, path: '/auth/me' }),
    ]);
  });
});
