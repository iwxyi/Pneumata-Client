import type { ScenarioBranchState } from '../types/chat';
import type { StoryChoiceSuggestion } from '../types/message';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';

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

function sanitizeStoryChoiceLabel(label: string) {
  return label
    .trim()
    .replace(/^(?:选项|选择|方案|分支)\s*(?:[A-Da-d]|\d+|[一二三四])?\s*[：:、.)）-]?\s*/u, '')
    .replace(/[\s（(【[]*(?:意图|风险|收益|回报|奖励|代价)\s*[：:].*$/u, '')
    .trim();
}

export function sanitizeStoryChoicePrompt(prompt: string) {
  return prompt
    .trim()
    .replace(/(?:^|[\s；;。])(?:意图|风险|收益|回报|奖励|代价)\s*[：:].*$/u, '')
    .trim();
}

export function isConcreteStoryChoiceLabel(label: string) {
  const normalized = label.replace(/\s+/g, '').trim();
  if (!normalized) return false;
  return !abstractStoryChoicePatterns.some((pattern) => pattern.test(normalized));
}

function normalizeChoiceText(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：“”"'‘’（）()[\]{}《》<>…—\-.,!?;:]/g, '')
    .trim();
}

function buildCharacterNgrams(text: string, size = 2) {
  const normalized = normalizeChoiceText(text);
  const grams = new Set<string>();
  if (normalized.length <= size) {
    if (normalized) grams.add(normalized);
    return grams;
  }
  for (let index = 0; index <= normalized.length - size; index += 1) {
    grams.add(normalized.slice(index, index + size));
  }
  return grams;
}

function choiceTextSimilarity(left: string, right: string) {
  const a = buildCharacterNgrams(left);
  const b = buildCharacterNgrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((gram) => {
    if (b.has(gram)) overlap += 1;
  });
  return overlap / Math.min(a.size, b.size);
}

function extractChoiceKeywords(text: string) {
  const normalized = normalizeChoiceText(text);
  const keywords = new Set<string>();
  const terms = [
    '追问', '质问', '逼问', '试探', '调查', '检查', '查看', '进入', '离开', '打开', '寻找', '保护', '隐瞒', '揭露', '跟踪', '等待', '叫住', '放走', '交代', '说出',
    '医生', '护士', '小姐', '少爷', '夫人', '院长', '太后', '月奴', '主角', '同伴', '黑衣人', '林医生', '护士长',
    '记录', '档案', '病历', '血迹', '线索', '证据', '长剑', '枕下', '停电', '真相', '名单', '钥匙', '封存柜', '地下室', '档案室',
  ];
  for (const term of terms) {
    if (normalized.includes(term)) keywords.add(term);
  }
  return keywords;
}

function choiceKeywordOverlap(left: string, right: string) {
  const a = extractChoiceKeywords(left);
  const b = extractChoiceKeywords(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((keyword) => {
    if (b.has(keyword)) overlap += 1;
  });
  return overlap / Math.min(a.size, b.size);
}

function isNearDuplicateChoice(choice: StoryChoiceSuggestion, previous: StoryChoiceSuggestion[]) {
  const choiceText = `${choice.label}${choice.prompt ? ` ${choice.prompt}` : ''}`;
  const normalizedChoiceText = normalizeChoiceText(choiceText);
  if (normalizedChoiceText.length < 10) return false;
  return previous.some((item) => {
    const previousText = `${item.label}${item.prompt ? ` ${item.prompt}` : ''}`;
    const normalizedPreviousText = normalizeChoiceText(previousText);
    if (normalizedPreviousText.length < 10) return false;
    if (normalizedPreviousText.includes(normalizedChoiceText) || normalizedChoiceText.includes(normalizedPreviousText)) return true;
    return choiceTextSimilarity(choiceText, previousText) >= 0.78 || choiceKeywordOverlap(choiceText, previousText) >= 0.67;
  });
}

export function normalizeStoryChoiceSuggestions(value: unknown): StoryChoiceSuggestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const choices: StoryChoiceSuggestion[] = [];
  for (const choice of value
    .map((choice) => {
      if (!choice || typeof choice !== 'object') return { label: '', prompt: '' };
      const item = choice as Partial<Record<keyof StoryChoiceSuggestion, unknown>>;
      const label = typeof item.label === 'string' ? sanitizeStoryChoiceLabel(item.label) : '';
      const prompt = typeof item.prompt === 'string' ? sanitizeStoryChoicePrompt(item.prompt) : '';
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
    })) {
    if (!choice.label || !isConcreteStoryChoiceLabel(choice.label) || seen.has(choice.label)) continue;
    if (isNearDuplicateChoice(choice, choices)) continue;
    seen.add(choice.label);
    choices.push(choice);
    if (choices.length >= 4) break;
  }
  return choices;
}

export function hasVisibleStoryChoices(value: unknown) {
  return normalizeStoryChoiceSuggestions(value).length >= 2;
}

export function getOpenStoryChoiceState(chat: GroupChat | undefined, messages: Message[]) {
  if (chat?.sessionKind?.scenarioId !== 'story-reader') return null;
  if (chat.scenarioState?.phase !== 'choice') return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const choices = normalizeStoryChoiceSuggestions(message.metadata?.storyChoices);
    if (choices.length >= 2) return { source: 'message' as const, messageId: message.id, count: choices.length };
  }
  const currentEpoch = Number(chat.scenarioState?.choiceEpoch || 0);
  const activeBranches = (chat.scenarioState?.branches || []).filter((branch) => (
    branch.status !== 'locked'
    && branch.status !== 'completed'
    && branch.status !== 'chosen'
    && Number(branch.choiceEpoch || 0) === currentEpoch
  ));
  if (activeBranches.length >= 2) {
    return { source: 'branches' as const, messageId: null, count: activeBranches.length };
  }
  return null;
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
    const prompt = sanitizeStoryChoicePrompt(choice.prompt || choice.label);
    const branch = activeBranches.find((item) => {
      if (usedBranchIds.has(item.branchId)) return false;
      return item.label === choice.label && sanitizeStoryChoicePrompt(item.prompt || item.description || item.label) === prompt;
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
