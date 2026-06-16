import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { buildApiErrorUserMessage } from './apiErrorMessage';

describe('buildApiErrorUserMessage', () => {
  it('shows auth expiration for 401', () => {
    expect(buildApiErrorUserMessage(new ApiError('登录已过期', { status: 401 }), '角色云同步')).toBe(
      '角色云同步失败：登录已过期，请重新登录后再试。',
    );
  });

  it('shows auth expiration for token error codes', () => {
    expect(buildApiErrorUserMessage(new ApiError('Invalid token', { status: 400, code: 'TOKEN_EXPIRED' }), '设置加载')).toBe(
      '设置加载失败：登录已过期，请重新登录后再试。',
    );
  });

  it('shows resource missing for 404', () => {
    expect(buildApiErrorUserMessage(new ApiError('HTTP 404', { status: 404 }), '聊天详情同步')).toBe(
      '聊天详情同步失败：云端资源不存在，可能已在其他设备删除或尚未同步。',
    );
  });

  it('shows conflict reason for 409', () => {
    expect(buildApiErrorUserMessage(new ApiError('Conflict', { status: 409 }), '消息云同步')).toBe(
      '消息云同步失败：数据版本冲突，请刷新后重试。',
    );
  });

  it('shows payload size reason for 413', () => {
    expect(buildApiErrorUserMessage(new ApiError('Payload Too Large', { status: 413 }), '本地数据同步到云端')).toBe(
      '本地数据同步到云端失败：同步数据过大，请清理或压缩后再试。',
    );
  });

  it('shows rate limit reason for 429', () => {
    expect(buildApiErrorUserMessage(new ApiError('Too Many Requests', { status: 429 }), '设置同步')).toBe(
      '设置同步失败：请求过于频繁，请稍后再试。',
    );
  });

  it('shows server unavailable for 5xx', () => {
    expect(buildApiErrorUserMessage(new ApiError('Internal Server Error', { status: 500 }), '世界运行摘要同步')).toBe(
      '世界运行摘要同步失败：服务器暂时不可用，请稍后再试。',
    );
  });

  it('shows network/server startup reason for fetch failures', () => {
    expect(buildApiErrorUserMessage(new TypeError('Failed to fetch'), '角色云同步')).toBe(
      '角色云同步失败：网络无法连接或服务器未启动。',
    );
  });

  it('uses readable backend messages when no known status mapping applies', () => {
    expect(buildApiErrorUserMessage(new ApiError('验证码错误', { status: 400, code: 'BAD_CODE' }), '手机号修改')).toBe(
      '手机号修改失败：验证码错误',
    );
  });
});
