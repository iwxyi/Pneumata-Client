export function isImageAvatar(value?: string | null) {
  if (!value) return false;
  return value.startsWith('data:image/')
    || value.startsWith('blob:')
    || value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('/uploads/')
    || value.startsWith('uploads/');
}
