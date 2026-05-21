export type RuntimeSeedKind = 'note' | 'artifact';

const ARTIFACT_TITLE_PATTERN = /(计划|方案|清单|纪要|结论|共识|规则|时间线|待办|复盘|summary|conclusion|plan|checklist|timeline)$/i;
const ARTIFACT_PREFIX_PATTERN = /^(总结|共识|方案|清单|计划|纪要|结论|规则|时间线|待办|复盘|summary|conclusion|plan|checklist|timeline)[:：]/i;

function cleanSeedLine(line: string) {
  return line
    .replace(/\{[\s\S]*"eventType"[\s\S]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestionLike(text: string) {
  return /[？?]|哪里|怎么|为什么|凭什么|是不是|难道|吗|嘛|呢|呀/.test(text);
}

function isDialogueLike(text: string) {
  return /(哥哥|姐姐|叔叔|阿姨|老婆|老公|哈哈|嘻嘻|哼|你凭什么|你也想|怎么就)/.test(text);
}

export function classifyRuntimeArtifactSeedLine(line: string) {
  const text = cleanSeedLine(line);
  if (!text) return { text, valid: false, reason: 'empty' as const };
  if (isDialogueLike(text)) return { text, valid: false, reason: 'dialogue_like' as const };
  if (isQuestionLike(text)) return { text, valid: false, reason: 'question_like' as const };
  if (text.length < 6) return { text, valid: false, reason: 'too_short' as const };
  if (ARTIFACT_PREFIX_PATTERN.test(text) || ARTIFACT_TITLE_PATTERN.test(text)) return { text, valid: true, reason: 'artifact_shape' as const };
  return { text, valid: false, reason: 'not_artifact_shape' as const };
}

export function normalizeRuntimeSeedLines(text: string, kind: RuntimeSeedKind = 'note') {
  const lines = text.split('\n').map(cleanSeedLine).filter(Boolean);
  const selected = kind === 'artifact'
    ? lines.filter((line) => classifyRuntimeArtifactSeedLine(line).valid)
    : lines;
  return Array.from(new Set(selected));
}

export function normalizeRuntimeSeedArtifactLines(lines: string[]) {
  return Array.from(new Set(lines.map(cleanSeedLine).filter((line) => classifyRuntimeArtifactSeedLine(line).valid)));
}
