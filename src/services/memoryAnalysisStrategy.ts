import type { MemoryCandidate, MemoryItem } from './memoryTypes';

export const LLM_MEMORY_ANALYSIS_VERSION = 'llm-v2';
export const LLM_MEMORY_ANALYSIS_TRACKED_SOURCE_EVENT_LIMIT = 32;
export const LLM_MEMORY_ANALYSIS_MAX_SOURCE_ITEMS = 18;

export const LLM_MEMORY_ANALYSIS_LIMITS = {
  chat: {
    minItems: 12,
    minEventEvidence: 18,
    minNewItems: 12,
    minNewSubjects: 4,
    minNewEventEvidence: 10,
  },
  character: {
    minItems: 8,
    minEventEvidence: 10,
    minNewItems: 8,
    minNewSubjects: 2,
    minNewEventEvidence: 6,
  },
} as const;

export const LLM_MEMORY_ANALYSIS_ALLOWED_SOURCE_TAGS = new Set(['interaction', 'relationship_delta', 'private_thread_effect', 'private_thread_summary']);
export const LLM_MEMORY_ANALYSIS_ALLOWED_LAYERS = new Set<MemoryItem['layer']>(['working', 'episodic']);
export const LLM_MEMORY_ANALYSIS_ALLOWED_SCOPES = new Set<MemoryItem['scope']>(['relationship', 'thread']);
export const LLM_MEMORY_ANALYSIS_ALLOWED_KINDS = new Set<MemoryItem['kind']>(['bond', 'resentment', 'thread_effect']);

export interface LlmAnalyzedMemoryItem {
  scope: MemoryCandidate['scope'];
  kind: MemoryCandidate['kind'];
  subjectIds?: string[];
  text: string;
  confidence?: number;
}

export interface LlmMemoryAnalysisResult {
  items: LlmAnalyzedMemoryItem[];
}

export function collectTrackedMemoryAnalysisSourceEventIds(source: MemoryItem[]) {
  return Array.from(
    new Set(source.flatMap((entry) => entry.sourceEventIds || []).filter(Boolean))
  ).slice(-LLM_MEMORY_ANALYSIS_TRACKED_SOURCE_EVENT_LIMIT);
}

export function collectMemoryAnalysisEvidenceText(source: MemoryItem[]) {
  return source
    .map((item, index) => {
      const evidence = item.evidenceText || item.summary || item.text;
      return `${index + 1}. ${evidence}`;
    })
    .join('\n')
    .slice(0, 4000);
}

export function buildMemoryAnalysisEvidenceBlock(items: MemoryItem[]) {
  return items.map((item, index) => {
    const evidence = item.evidenceText && item.evidenceText !== item.text ? `\n   原始证据：${item.evidenceText}` : '';
    return `${index + 1}. [${item.scope}/${item.layer}/${item.kind}] ${item.text}${evidence}`;
  }).join('\n');
}

function normalizeScope(value: unknown): MemoryCandidate['scope'] {
  const allowed: MemoryCandidate['scope'][] = ['conversation', 'character_self', 'relationship', 'thread', 'system_runtime'];
  return allowed.includes(value as MemoryCandidate['scope']) ? value as MemoryCandidate['scope'] : 'relationship';
}

function normalizeKind(value: unknown): MemoryCandidate['kind'] {
  const allowed: MemoryCandidate['kind'][] = ['decision', 'conflict', 'bond', 'resentment', 'status_shift', 'trait_evidence', 'bias', 'taboo', 'obsession', 'artifact', 'thread_effect'];
  return allowed.includes(value as MemoryCandidate['kind']) ? value as MemoryCandidate['kind'] : 'bias';
}

export function parseLlmMemoryAnalysisResult(raw: string): LlmMemoryAnalysisResult {
  const parsed = JSON.parse(raw) as { items?: Array<Record<string, unknown>> };
  return {
    items: (parsed.items || []).map((item) => ({
      scope: normalizeScope(item.scope),
      kind: normalizeKind(item.kind),
      subjectIds: Array.isArray(item.subjectIds) ? item.subjectIds.filter((id): id is string => typeof id === 'string') : undefined,
      text: typeof item.text === 'string' ? item.text.trim() : '',
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.78,
    })).filter((item) => item.text),
  };
}

export function buildChatMemoryAnalysisPrompt() {
  return `你是一个群体长期记忆分析器。\n根据最近的结构化证据和原始证据，提炼真正值得长期保留的事件、感觉、关系趋势、矛盾冲突或群体发展。\n只在证据已经跨越多个互动对象、多个事件、并形成稳定群体结构时，才提炼 1 条长期记忆。\n不要复制原话，不要复述最近几轮争吵，不要输出流水账或阶段性总结，不要把同一主线换个说法再写一遍。\n如果证据仍然只是同一段争执的局部延续，返回空数组。\n只输出 JSON：{"items":[{"scope":"conversation|relationship","kind":"conflict|bond|resentment|status_shift|decision","subjectIds":["..."],"text":"...","confidence":0.0}]}。`;
}

export function buildCharacterMemoryAnalysisPrompt() {
  return `你是一个角色长期记忆分析器。\n根据最近的结构化证据和原始证据，提炼这个角色真正稳定下来的事件印象、感觉、人际判断、矛盾冲突、长期偏向或自我变化。\n不要复制原话，不要把最近几句互呛、单轮情绪波动、临时吐槽写成长期记忆。\n如果证据只是同一轮互动的余波，返回空数组。\n只输出 JSON：{"items":[{"scope":"character_self|relationship","kind":"bias|bond|resentment|taboo|obsession|trait_evidence","subjectIds":["..."],"text":"...","confidence":0.0}]}。`;
}
