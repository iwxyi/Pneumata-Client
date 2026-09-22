import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { get: vi.fn() },
}));

vi.mock('./api', () => ({
  api: { fetchNetworkResource: (...args: unknown[]) => apiFetchMock(...args) },
}));

import { fetchNetworkResource } from './networkResourceService';

const response = (content: string, finalUrl = 'https://example.com/article') => ({
  requestedUrl: finalUrl,
  finalUrl,
  status: 200,
  contentType: 'text/plain',
  sizeBytes: content.length,
  fileName: 'article',
  encoding: 'utf8' as const,
  content,
});

function browserResponse(body: BodyInit, contentType: string) {
  const result = new Response(body, { status: 200, headers: { 'content-type': contentType } });
  Object.defineProperty(result, 'url', { value: 'https://example.com/article' });
  return result;
}

beforeEach(() => {
  apiFetchMock.mockReset();
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchNetworkResource transport selection', () => {
  it('uses the browser response without consuming server bandwidth when direct fetch succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(browserResponse('complete body', 'text/plain'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchNetworkResource('https://example.com/article');

    expect(result.transport).toBe('browser');
    expect(result.text).toBe('complete body');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/article', expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated server fallback after a browser policy failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    apiFetchMock.mockResolvedValue(response('fallback body'));

    const result = await fetchNetworkResource('https://example.com/article');

    expect(result.transport).toBe('server-fallback');
    expect(result.text).toBe('fallback body');
    expect(apiFetchMock).toHaveBeenCalledWith('https://example.com/article', 'readable', 20_000);
  });

  it('does not use the server when fallback is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fetchNetworkResource('https://example.com/article', 'readable', { allowServerFallback: false }))
      .rejects.toThrow('Failed to fetch');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('rejects explicit local addresses before selecting a transport', async () => {
    await expect(fetchNetworkResource('http://127.0.0.1/private')).rejects.toThrow('不允许访问本地或内网地址');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('rejects FTP credentials and local FTP targets before server fallback', async () => {
    await expect(fetchNetworkResource('ftp://user:secret@example.com/file.txt')).rejects.toThrow('不包含认证信息');
    await expect(fetchNetworkResource('ftp://127.0.0.1/file.txt')).rejects.toThrow('不允许访问本地或内网地址');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
