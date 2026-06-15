const failedAvatarUrls = new Set<string>();

export function rememberFailedAvatarUrl(value?: string | null) {
  if (!value) return;
  failedAvatarUrls.add(value);
}

export function hasFailedAvatarUrl(value?: string | null) {
  return Boolean(value && failedAvatarUrls.has(value));
}

export function resolveSafeAvatarSrc(value?: string | null) {
  if (!value) return undefined;
  return hasFailedAvatarUrl(value) ? undefined : value;
}
