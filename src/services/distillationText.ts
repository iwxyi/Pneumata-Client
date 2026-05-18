const UUID_SEGMENT_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){2,3}(?:-[0-9a-f]{3,12})?$/i;

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function isUuidSegment(segment: string) {
  return UUID_SEGMENT_PATTERN.test(segment.trim());
}

export function sanitizeDistillationText(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return '';

  const segments = normalized
    .split(/\s*\/\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !isUuidSegment(segment));
  const seen = new Set<string>();
  const uniqueSegments = segments.filter((segment) => {
    if (seen.has(segment)) return false;
    seen.add(segment);
    return true;
  });

  if (!uniqueSegments.length) return '';
  return normalizeWhitespace(uniqueSegments.join(' / '));
}

export function sanitizeDistillationTexts(texts: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const text of texts) {
    const value = sanitizeDistillationText(text);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
  }

  return cleaned;
}

export function sanitizeMemoryText(text: string) {
  return sanitizeDistillationText(text);
}

export function sanitizeMemoryTexts(texts: string[]) {
  return sanitizeDistillationTexts(texts);
}
