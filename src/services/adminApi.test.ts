import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { adminApi } from './adminApi';

describe('adminApi error messages', () => {
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

  it('surfaces backend login errors instead of a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: '管理员邮箱或密码错误',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(adminApi.login('admin', 'wrong')).rejects.toMatchObject({
      name: 'ApiError',
      message: '管理员邮箱或密码错误',
      status: 401,
    } satisfies Partial<ApiError>);
  });

  it('surfaces html fallback responses as proxy configuration errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<!doctype html><html></html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })));

    await expect(adminApi.login('admin', 'admin')).rejects.toMatchObject({
      name: 'ApiError',
      message: '后台接口返回了前端页面，请检查后端服务或开发代理配置（HTTP 404）',
      status: 404,
      code: 'INVALID_ADMIN_API_RESPONSE',
    } satisfies Partial<ApiError>);
  });

  it('surfaces network failures as backend connectivity errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')));

    await expect(adminApi.login('admin', 'admin')).rejects.toMatchObject({
      name: 'ApiError',
      message: '无法连接后台接口，请检查后端服务或开发代理配置',
      code: 'ADMIN_API_NETWORK_ERROR',
    } satisfies Partial<ApiError>);
  });
});
