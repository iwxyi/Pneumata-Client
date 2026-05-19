import type { MemoryCandidate, MemoryDecision, MemoryItem } from './memoryTypes';

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
  lens?: MemoryExperienceLens;
  decision?: MemoryDecision;
}

export interface LlmMemoryAnalysisResult {
  items: LlmAnalyzedMemoryItem[];
}

export type MemoryExperienceLens =
  | 'objective_event'
  | 'character_perspective'
  | 'relationship_imprint'
  | 'emotion_effect'
  | 'growth_signal';

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

function normalizeLens(value: unknown): MemoryExperienceLens | undefined {
  const allowed: MemoryExperienceLens[] = ['objective_event', 'character_perspective', 'relationship_imprint', 'emotion_effect', 'growth_signal'];
  return allowed.includes(value as MemoryExperienceLens) ? value as MemoryExperienceLens : undefined;
}

function normalizeDecision(value: unknown): MemoryDecision | undefined {
  const allowed: MemoryDecision[] = ['create', 'reinforce', 'revise', 'merge', 'archive', 'ignore'];
  return allowed.includes(value as MemoryDecision) ? value as MemoryDecision : undefined;
}

function normalizeAnalyzedItem(item: Record<string, unknown>, lens?: MemoryExperienceLens): LlmAnalyzedMemoryItem {
  return {
    scope: normalizeScope(item.scope),
    kind: normalizeKind(item.kind),
    subjectIds: Array.isArray(item.subjectIds) ? item.subjectIds.filter((id): id is string => typeof id === 'string') : undefined,
    text: typeof item.text === 'string' ? item.text.trim() : '',
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.78,
    lens: normalizeLens(item.lens) || lens,
    decision: normalizeDecision(item.decision),
  };
}

function normalizeAnalyzedItems(items: unknown, lens?: MemoryExperienceLens) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => normalizeAnalyzedItem(item, lens))
    .filter((item) => item.text && item.decision !== 'ignore');
}

export function parseLlmMemoryAnalysisResult(raw: string): LlmMemoryAnalysisResult {
  const parsed = JSON.parse(raw) as {
    items?: Array<Record<string, unknown>>;
    objectiveEvents?: Array<Record<string, unknown>>;
    characterPerspectives?: Array<Record<string, unknown>>;
    relationshipImprints?: Array<Record<string, unknown>>;
    emotionEffects?: Array<Record<string, unknown>>;
    growthSignals?: Array<Record<string, unknown>>;
  };
  return {
    items: [
      ...normalizeAnalyzedItems(parsed.items),
      ...normalizeAnalyzedItems(parsed.objectiveEvents, 'objective_event'),
      ...normalizeAnalyzedItems(parsed.characterPerspectives, 'character_perspective'),
      ...normalizeAnalyzedItems(parsed.relationshipImprints, 'relationship_imprint'),
      ...normalizeAnalyzedItems(parsed.emotionEffects, 'emotion_effect'),
      ...normalizeAnalyzedItems(parsed.growthSignals, 'growth_signal'),
    ],
  };
}

export function buildChatMemoryAnalysisPrompt() {
  return `你是一个群体经历与长期记忆分析器。\n根据最近的结构化证据和原始证据，提炼真正值得长期保留的群体事件、关系印记、情绪后效和发展主线。\n这不是摘要任务。不要复制原话，不要复述流水账，不要把同一主线换个说法重复写。\n只在证据已经跨越多个互动对象、多个事件，并形成稳定群体结构或长期后果时才输出。\n\n输出一个 JSON 对象，字段均为数组，可为空：\n{\n  "objectiveEvents":[{"scope":"conversation","kind":"conflict|status_shift|decision","subjectIds":["..."],"text":"客观角度：事情如何发展、局势如何变化","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}],\n  "relationshipImprints":[{"scope":"relationship","kind":"bond|resentment|bias|obsession","subjectIds":["actorId","targetId"],"text":"关系角度：某人对某人的长期印象或关系语义如何变化","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}],\n  "emotionEffects":[{"scope":"conversation|relationship","kind":"status_shift|conflict|bond|resentment","subjectIds":["..."],"text":"情绪后效：这段经历留下了什么情绪惯性","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}],\n  "growthSignals":[{"scope":"conversation","kind":"status_shift|decision","subjectIds":["..."],"text":"群体发展：群聊关系结构、长期梗或共同认知如何变化","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}]\n}\n\n要求：\n1. 每个 text 必须是可展示的长期记忆结论，不是原始发言摘抄。\n2. relationshipImprints 可以表达好感、喜欢、依赖、保护欲、嫉妒、戒备、厌烦、憎恶、同盟、裂痕、和解等真人关系语义。\n3. 如果只是单轮吵闹、临时吐槽或证据不足，返回空数组。\n4. 优先输出 1-3 条高价值记忆，最多 4 条。\n5. 只输出 JSON。`;
}

export function buildCharacterMemoryAnalysisPrompt() {
  return `你是一个角色经历、主观记忆与关系印记分析器。\n根据最近的结构化证据、原始证据和角色设定，提炼这个角色像真人一样会留下的长期记忆。\n这不是摘要任务。你要判断角色会如何理解事件、误读什么、在意什么、对谁形成怎样的关系印记，以及这会怎样改变自我认知。\n不要复制原话，不要把单轮情绪波动写成长期记忆。证据不足就返回空数组。\n\n输出一个 JSON 对象，字段均为数组，可为空：\n{\n  "characterPerspectives":[{"scope":"character_self","kind":"bias|trait_evidence|status_shift|taboo|obsession","subjectIds":["characterId"],"text":"角色主观角度：我如何理解这件事、我在意或回避什么","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}],\n  "relationshipImprints":[{"scope":"relationship","kind":"bond|resentment|bias|obsession","subjectIds":["targetId"],"text":"角色对某人的长期印象：好感、喜欢、依赖、嫉妒、戒备、厌烦、失望、憎恶、保护欲等","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}],\n  "emotionEffects":[{"scope":"character_self|relationship","kind":"status_shift|bond|resentment|obsession","subjectIds":["..."],"text":"这段经历留下的情绪后效和下次反应倾向","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}],\n  "growthSignals":[{"scope":"character_self","kind":"trait_evidence|decision|bias","subjectIds":["characterId"],"text":"角色成长：自我认知、价值观、行为模式或愿望期待如何变化","confidence":0.0,"decision":"create|reinforce|revise|merge|archive|ignore"}]\n}\n\n要求：\n1. 必须符合角色人格、背景、说话风格、身份、当前关系和情绪，不要生成通用模板。\n2. 同一事件对不同角色应有不同主观解释。\n3. relationshipImprints 应是长期关系语义，不只是四轴数值的文字化。\n4. 优先输出 1-3 条高价值记忆，最多 4 条。\n5. 只输出 JSON。`;
}
