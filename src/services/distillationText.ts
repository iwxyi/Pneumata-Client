const UUID_SEGMENT_PATTERN = /^[0-9a-f]{6,}(?:-[0-9a-f]{0,12})*$/i;
const UUID_INLINE_PATTERN = /[0-9a-f]{6,}(?:-[0-9a-f]{0,12})*/gi;
const RELATION_ACTION_PATTERN = '(?:支持|维护|挑战|嘲讽|轻视|追问)';

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function isUuidSegment(segment: string) {
  return UUID_SEGMENT_PATTERN.test(segment.trim());
}

export function sanitizeDistillationText(text: string) {
  const normalized = normalizeWhitespace(text)
    .replace(new RegExp(`(?:[\\w\\u4e00-\\u9fa5]+→[\\w\\u4e00-\\u9fa5]+\\s+)?(${RELATION_ACTION_PATTERN}：)`, 'g'), '$1')
    .replace(new RegExp(`(群聊(?:稳定关系趋势|长期拉扯主轴)：)[^：/]+?\\s+(${RELATION_ACTION_PATTERN}：)`, 'g'), '$1$2')
    .replace(/^对人长期判断：/, '')
    .replace(/对\s+([^：/]+?)\s+的态度发生变化：/g, '对 $1 的关系倾向：')
    .replace(UUID_INLINE_PATTERN, '')
    .replace(/对\s+的关系倾向：/g, '')
    .replace(/\s*→\s*(?=支持：|维护：|挑战：|嘲讽：|轻视：|追问：)/g, '')
    .replace(/(?:^|：)\s*→\s*/g, (match) => match.startsWith('：') ? '：' : '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
