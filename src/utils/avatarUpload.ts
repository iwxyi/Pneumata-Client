const DEFAULT_MAX_SIZE = 320;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_MAX_BYTES = 220 * 1024;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load avatar image'));
    image.src = src;
  });
}

export async function prepareAvatarUploadDataUrl(dataUrl: string, options?: { maxSize?: number; quality?: number }) {
  if (!dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const maxSize = Math.max(128, options?.maxSize || DEFAULT_MAX_SIZE);
  const quality = Math.min(1, Math.max(0.5, options?.quality || DEFAULT_QUALITY));
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, width, height);

  const estimatedMaxBytes = DEFAULT_MAX_BYTES;
  const candidates = [
    { mimeType: 'image/webp', qualities: [quality, 0.76, 0.68] },
    { mimeType: 'image/jpeg', qualities: [quality, 0.76, 0.68] },
  ] as const;

  for (const candidate of candidates) {
    for (const candidateQuality of candidate.qualities) {
      const encoded = canvas.toDataURL(candidate.mimeType, candidateQuality);
      if (encoded && encoded !== 'data:,' && estimateDataUrlBytes(encoded) <= estimatedMaxBytes) {
        return encoded;
      }
    }
  }

  const fallback = canvas.toDataURL('image/jpeg', 0.62);
  if (fallback && fallback !== 'data:,') {
    return fallback;
  }

  return dataUrl;
}

function estimateDataUrlBytes(dataUrl: string) {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0);
  return Math.floor((payload.length * 3) / 4) - padding;
}
