import type { StoryChoiceSuggestion } from '../types/message';

const abstractStoryChoicePatterns = [
  /^深入(?:角色)?内心$/,
  /^追查(?:异常)?线索$/,
  /^推进(?:剧情|故事|主线)$/,
  /^继续(?:剧情|故事|推进|调查|探索)?$/,
  /^面对关键人物$/,
  /^转向意外地点$/,
  /^寻找线索$/,
  /^调查真相$/,
];

export function isConcreteStoryChoiceLabel(label: string) {
  const normalized = label.replace(/\s+/g, '').trim();
  if (!normalized) return false;
  return !abstractStoryChoicePatterns.some((pattern) => pattern.test(normalized));
}

export function normalizeStoryChoiceSuggestions(value: unknown): StoryChoiceSuggestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((choice) => {
      if (!choice || typeof choice !== 'object') return { label: '', prompt: '' };
      const item = choice as Partial<Record<keyof StoryChoiceSuggestion, unknown>>;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
      return { label, prompt };
    })
    .filter((choice) => {
      if (!choice.label || !isConcreteStoryChoiceLabel(choice.label) || seen.has(choice.label)) return false;
      seen.add(choice.label);
      return true;
    })
    .slice(0, 4);
}

export function hasVisibleStoryChoices(value: unknown) {
  return normalizeStoryChoiceSuggestions(value).length > 0;
}
