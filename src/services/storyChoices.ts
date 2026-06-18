import type { ScenarioBranchState } from '../types/chat';
import type { StoryChoiceSuggestion } from '../types/message';

export interface StoryBranchOption {
  label: string;
  value: string;
  prompt: string;
  intent?: string | null;
  risk?: string | null;
  reward?: string | null;
}

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
      const intent = typeof item.intent === 'string' ? item.intent.trim() : '';
      const risk = typeof item.risk === 'string' ? item.risk.trim() : '';
      const reward = typeof item.reward === 'string' ? item.reward.trim() : '';
      return {
        label,
        prompt,
        ...(intent ? { intent } : {}),
        ...(risk ? { risk } : {}),
        ...(reward ? { reward } : {}),
      };
    })
    .filter((choice) => {
      if (!choice.label || !isConcreteStoryChoiceLabel(choice.label) || seen.has(choice.label)) return false;
      seen.add(choice.label);
      return true;
    })
    .slice(0, 4);
}

export function hasVisibleStoryChoices(value: unknown) {
  return normalizeStoryChoiceSuggestions(value).length >= 2;
}

export function buildStoryBranchOptions(params: {
  storyChoices: unknown;
  branches?: ScenarioBranchState[] | null;
  choiceEpoch?: number | null;
  sourceId?: string;
}): StoryBranchOption[] {
  const choices = normalizeStoryChoiceSuggestions(params.storyChoices);
  if (choices.length < 2) return [];
  const currentEpoch = Math.max(Number(params.choiceEpoch || 0), 1);
  const availableBranches = (params.branches || []).filter((branch) => (
    branch.status !== 'locked'
    && branch.status !== 'completed'
    && branch.status !== 'chosen'
  ));
  const branchesForCurrentEpoch = availableBranches.filter((branch) => Number(branch.choiceEpoch || currentEpoch) === currentEpoch);
  const latestAvailableEpoch = Math.max(currentEpoch, ...availableBranches.map((branch) => Number(branch.choiceEpoch || 0)).filter((epoch) => epoch > 0));
  const activeBranches = branchesForCurrentEpoch.length
    ? branchesForCurrentEpoch
    : availableBranches.filter((branch) => Number(branch.choiceEpoch || latestAvailableEpoch) === latestAvailableEpoch);
  const usedBranchIds = new Set<string>();
  return choices.map((choice, index) => {
    const prompt = choice.prompt || choice.label;
    const branch = activeBranches.find((item) => {
      if (usedBranchIds.has(item.branchId)) return false;
      return item.label === choice.label && (item.prompt || item.description || item.label) === prompt;
    }) || activeBranches.find((item) => {
      if (usedBranchIds.has(item.branchId)) return false;
      return item.label === choice.label;
    });
    if (branch) usedBranchIds.add(branch.branchId);
    return {
      label: choice.label,
      value: branch?.branchId || `${params.sourceId || 'story-choice'}:${index}`,
      prompt,
      intent: choice.intent || branch?.intent || null,
      risk: choice.risk || branch?.risk || null,
      reward: choice.reward || branch?.reward || null,
    };
  });
}
