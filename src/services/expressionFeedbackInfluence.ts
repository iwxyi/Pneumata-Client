import type { MemoryItem } from './memoryTypes';

export type ExpressionFeedbackCategory = 'too_long' | 'too_formal' | 'too_assistant' | 'out_of_character';
type FeedbackPolarity = 'negative' | 'positive';

export interface ExpressionFeedbackSignal {
  category: ExpressionFeedbackCategory;
  label: string;
  count: number;
  strength: number;
  positiveCount: number;
  negativeCount: number;
  items: MemoryItem[];
}

const CATEGORY_LABELS: Record<ExpressionFeedbackCategory, string> = {
  too_long: '控制长度',
  too_formal: '降低正式感',
  too_assistant: '减少助手腔',
  out_of_character: '贴近角色',
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function classifyExpressionFeedback(text: string): ExpressionFeedbackCategory | null {
  if (/这次长度合适|长度合适|展开程度的正向校准|聊天节奏.*正向校准/.test(text)) return 'too_long';
  if (/这次表达像角色|像角色本人|正向校准.*角色身份|说话习惯的正向校准/.test(text)) return 'out_of_character';
  if (/太像通用助手|太像助手|标准答案腔|服务式措辞|中立总结/.test(text)) return 'too_assistant';
  if (/偏长|太长|更克制|即时聊天/.test(text)) return 'too_long';
  if (/偏正式|太正式|报告腔|模板化/.test(text)) return 'too_formal';
  if (/不像本人|不像这个角色|贴合角色身份|说话习惯|年龄感|关系立场/.test(text)) return 'out_of_character';
  return null;
}

function classifyFeedbackPolarity(text: string): FeedbackPolarity {
  return /(这次长度合适|长度合适|这次表达像角色|像角色本人|正向校准)/.test(text) ? 'positive' : 'negative';
}

export function getExpressionFeedbackCategoryLabel(category: ExpressionFeedbackCategory) {
  return CATEGORY_LABELS[category];
}

function scoreFeedbackItem(item: MemoryItem) {
  const confidence = clamp01(item.confidence || 0.6);
  const salience = clamp01(item.salience || 0.6);
  const recurrence = Math.min(3, Math.max(1, item.reinforcementCount || 1));
  return 0.16 + confidence * 0.16 + salience * 0.12 + (recurrence - 1) * 0.1;
}

export function summarizeExpressionFeedbackInfluence(items: MemoryItem[]): ExpressionFeedbackSignal[] {
  const groups = new Map<ExpressionFeedbackCategory, { positive: MemoryItem[]; negative: MemoryItem[] }>();
  for (const item of items) {
    if (item.sourceTag !== 'expression_feedback' || item.archivedAt) continue;
    const text = `${item.summary || ''} ${item.text || ''}`;
    const category = classifyExpressionFeedback(text);
    if (!category) continue;
    const polarity = classifyFeedbackPolarity(text);
    const group = groups.get(category) || { positive: [], negative: [] };
    group[polarity].push(item);
    groups.set(category, group);
  }

  return Array.from(groups.entries())
    .map(([category, group]) => {
      const sortedNegative = group.negative.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const sortedPositive = group.positive.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const negativeScore = sortedNegative.slice(0, 5).reduce((sum, item) => sum + scoreFeedbackItem(item), 0);
      const positiveScore = sortedPositive.slice(0, 5).reduce((sum, item) => sum + scoreFeedbackItem(item), 0) * 0.85;
      const countBoost = Math.min(0.22, Math.max(0, sortedNegative.length - 1) * 0.08);
      const strength = clamp01(negativeScore + countBoost - positiveScore);
      return {
        category,
        label: CATEGORY_LABELS[category],
        count: sortedNegative.length,
        positiveCount: sortedPositive.length,
        negativeCount: sortedNegative.length,
        strength,
        items: [...sortedNegative, ...sortedPositive].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
      };
    })
    .filter((signal) => signal.negativeCount > 0 || signal.positiveCount > 0)
    .sort((a, b) => b.strength - a.strength);
}

export function getExpressionFeedbackSignal(signals: ExpressionFeedbackSignal[], category: ExpressionFeedbackCategory) {
  return signals.find((signal) => signal.category === category) || null;
}
