import type { StoryChoiceSuggestion } from '../types/message';

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
      if (!choice.label || seen.has(choice.label)) return false;
      seen.add(choice.label);
      return true;
    })
    .slice(0, 4);
}

export function hasVisibleStoryChoices(value: unknown) {
  return normalizeStoryChoiceSuggestions(value).length > 0;
}
