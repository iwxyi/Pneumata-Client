import { ApiError } from './api';

const AUTH_EXPIRED_CODES = new Set([
  'AUTH_EXPIRED',
  'AUTH_REQUIRED',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'UNAUTHORIZED',
]);

const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'networkerror',
  'network error',
  'load failed',
  'fetch failed',
  'err_connection_refused',
  'err_network',
];

function cleanAction(action: string) {
  return action.replace(/[。.!！\s]+$/g, '').trim() || '请求';
}

function isAuthExpiredCode(code?: string) {
  return Boolean(code && AUTH_EXPIRED_CODES.has(code.toUpperCase()));
}

function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function getReadableApiMessage(error: ApiError) {
  const message = error.message.trim();
  if (!message || /^HTTP\s+\d+$/i.test(message) || message === '请求失败') return '';
  return message;
}

export function buildApiErrorUserMessage(error: unknown, action: string) {
  const prefix = `${cleanAction(action)}失败`;

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403 || isAuthExpiredCode(error.code)) {
      return `${prefix}：登录已过期，请重新登录后再试。`;
    }
    if (error.status === 404) {
      return `${prefix}：云端资源不存在，可能已在其他设备删除或尚未同步。`;
    }
    if (error.status === 409) {
      return `${prefix}：数据版本冲突，请刷新后重试。`;
    }
    if (error.status === 413) {
      return `${prefix}：同步数据过大，请清理或压缩后再试。`;
    }
    if (error.status === 429) {
      return `${prefix}：请求过于频繁，请稍后再试。`;
    }
    if (error.status && error.status >= 500) {
      return `${prefix}：服务器暂时不可用，请稍后再试。`;
    }

    const readable = getReadableApiMessage(error);
    if (readable) return `${prefix}：${readable}`;
  }

  if (isNetworkError(error)) {
    return `${prefix}：网络无法连接或服务器未启动。`;
  }

  if (error instanceof Error && error.message.trim()) {
    return `${prefix}：${error.message.trim()}`;
  }

  return `${prefix}，请稍后重试。`;
}
