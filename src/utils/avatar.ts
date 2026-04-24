export function isImageAvatar(value?: string | null) {
  if (!value) return false;
  return value.startsWith('data:image/') || value.startsWith('http');
}
