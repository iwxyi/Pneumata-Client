import type { MemoryCandidate, MemoryDecision, MemoryItem, MemorySharedPhraseDescriptor, MemorySourceType, MemorySubjectOwner, MemoryValidity, MemoryVisibility } from './memoryTypes';

export const LLM_MEMORY_ANALYSIS_VERSION = 'llm-v2';
export const LLM_MEMORY_ANALYSIS_TRACKED_SOURCE_EVENT_LIMIT = 32;
export const LLM_MEMORY_ANALYSIS_MAX_SOURCE_ITEMS = 18;
export const LLM_MEMORY_ANALYSIS_MAX_OUTPUT_ITEMS = 6;

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
  subjectOwner?: MemorySubjectOwner;
  sourceType?: MemorySourceType;
  privacyRisk?: number;
  visibility?: MemoryVisibility;
  validity?: MemoryValidity;
  semanticTags?: string[];
  associations?: string[];
  sharedPhrase?: MemorySharedPhraseDescriptor;
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

function normalizeSubjectOwner(value: unknown): MemorySubjectOwner | undefined {
  const allowed: MemorySubjectOwner[] = ['user', 'speaker', 'target', 'third_party', 'unknown'];
  return allowed.includes(value as MemorySubjectOwner) ? value as MemorySubjectOwner : undefined;
}

function normalizeSourceType(value: unknown): MemorySourceType | undefined {
  const allowed: MemorySourceType[] = ['serious', 'joke', 'test', 'correction', 'temporary', 'distilled', 'runtime'];
  return allowed.includes(value as MemorySourceType) ? value as MemorySourceType : undefined;
}

function normalizeVisibility(value: unknown): MemoryVisibility | undefined {
  const allowed: MemoryVisibility[] = ['private', 'pair_private', 'public_safe', 'never_surface'];
  return allowed.includes(value as MemoryVisibility) ? value as MemoryVisibility : undefined;
}

function normalizeValidity(value: unknown): MemoryValidity | undefined {
  const allowed: MemoryValidity[] = ['active', 'stale', 'contradicted', 'uncertain'];
  return allowed.includes(value as MemoryValidity) ? value as MemoryValidity : undefined;
}

function normalizePrivacyRisk(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function normalizeStringList(value: unknown, maxItems = 8) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))).slice(0, maxItems)
    : undefined;
}

function defaultSubjectOwner(scope: MemoryCandidate['scope'], lens?: MemoryExperienceLens): MemorySubjectOwner {
  if (scope === 'character_self') return 'speaker';
  if (scope === 'relationship') return 'target';
  if (lens === 'character_perspective' || lens === 'emotion_effect' || lens === 'growth_signal') return 'speaker';
  return 'unknown';
}

function defaultVisibility(scope: MemoryCandidate['scope'], kind: MemoryCandidate['kind']): MemoryVisibility {
  if (scope === 'relationship') return 'pair_private';
  if (kind === 'taboo' || kind === 'resentment') return 'pair_private';
  return 'public_safe';
}

function defaultPrivacyRisk(visibility: MemoryVisibility, kind: MemoryCandidate['kind']) {
  const base = visibility === 'never_surface' ? 1 : visibility === 'private' ? 0.45 : visibility === 'pair_private' ? 0.22 : 0.08;
  const kindRisk = kind === 'taboo' || kind === 'resentment' ? 0.08 : 0;
  return Math.min(1, base + kindRisk);
}

function normalizeSharedPhrase(value: unknown): MemorySharedPhraseDescriptor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const kinds: MemorySharedPhraseDescriptor['kind'][] = ['pet_name', 'inside_joke', 'promise_line', 'comfort_line', 'confession_line', 'secret_code', 'other'];
  const visibilities: MemorySharedPhraseDescriptor['visibility'][] = ['private', 'between_actors', 'public_hint'];
  if (!text || !kinds.includes(raw.kind as MemorySharedPhraseDescriptor['kind']) || !visibilities.includes(raw.visibility as MemorySharedPhraseDescriptor['visibility'])) return undefined;
  return {
    text: text.slice(0, 96),
    kind: raw.kind as MemorySharedPhraseDescriptor['kind'],
    visibility: raw.visibility as MemorySharedPhraseDescriptor['visibility'],
  };
}

function normalizeAnalyzedItem(item: Record<string, unknown>, lens?: MemoryExperienceLens): LlmAnalyzedMemoryItem {
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  const scope = normalizeScope(item.scope);
  const kind = normalizeKind(item.kind);
  const visibility = normalizeVisibility(item.visibility) || defaultVisibility(scope, kind);
  return {
    scope,
    kind,
    subjectIds: Array.isArray(item.subjectIds) ? item.subjectIds.filter((id): id is string => typeof id === 'string') : undefined,
    text,
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.78,
    lens: normalizeLens(item.lens) || lens,
    decision: normalizeDecision(item.decision),
    subjectOwner: normalizeSubjectOwner(item.subjectOwner) || defaultSubjectOwner(scope, lens),
    sourceType: normalizeSourceType(item.sourceType) || 'distilled',
    privacyRisk: normalizePrivacyRisk(item.privacyRisk) ?? defaultPrivacyRisk(visibility, kind),
    visibility,
    validity: normalizeValidity(item.validity) || 'active',
    semanticTags: normalizeStringList(item.semanticTags),
    associations: normalizeStringList(item.associations, 12),
    sharedPhrase: normalizeSharedPhrase(item.sharedPhrase),
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
  return `你是一个群体经历与长期记忆分析器。\n根据最近的结构化证据和原始证据，提炼真正值得长期保留的群体事件、关系印记、情绪后效和发展主线。\n这不是摘要任务。不要复制原话，不要复述流水账，不要把同一主线换个说法重复写。\n只在证据已经跨越多个互动对象、多个事件，并形成稳定群体结构或长期后果时才输出。\n\n输出一个 JSON 对象，字段均为数组，可为空：\n{\n  "objectiveEvents":[{"scope":"conversation","kind":"conflict","subjectIds":["member-id"],"text":"<根据证据新写的群体事件长期结论>","confidence":0.0,"decision":"create","subjectOwner":"unknown","sourceType":"distilled","privacyRisk":0.0,"visibility":"public_safe","validity":"active","semanticTags":["主题标签"],"associations":["可联想到的话题"]}],\n  "relationshipImprints":[{"scope":"relationship","kind":"bond","subjectIds":["actor-id","target-id"],"text":"<根据证据新写的关系印记长期结论>","confidence":0.0,"decision":"create","subjectOwner":"target","sourceType":"distilled","privacyRisk":0.2,"visibility":"pair_private","validity":"active","semanticTags":["关系标签"],"associations":["可联想到的话题"]}],\n  "emotionEffects":[{"scope":"conversation","kind":"status_shift","subjectIds":["member-id"],"text":"<根据证据新写的情绪后效长期结论>","confidence":0.0,"decision":"create","subjectOwner":"unknown","sourceType":"distilled","privacyRisk":0.1,"visibility":"public_safe","validity":"active","semanticTags":["情绪标签"],"associations":["可联想到的话题"]}],\n  "growthSignals":[{"scope":"conversation","kind":"status_shift","subjectIds":["member-id"],"text":"<根据证据新写的发展主线长期结论>","confidence":0.0,"decision":"create","subjectOwner":"unknown","sourceType":"distilled","privacyRisk":0.1,"visibility":"public_safe","validity":"active","semanticTags":["发展标签"],"associations":["可联想到的话题"]}]\n}\n\n要求：\n1. 每个 text 必须是可展示的长期记忆结论，不是原始发言摘抄。\n2. 上方尖括号内容只是字段占位符，绝不能原样输出，也不能把“客观角度/关系角度/情绪后效/群体发展”等栏目名写进 text。\n3. 多个人、多条关系同时成立时，要拆成多条记忆；不要把不同主体揉成“大家都如何”的含混总结。\n4. relationshipImprints 可以表达好感、喜欢、依赖、保护欲、嫉妒、戒备、厌烦、憎恶、同盟、裂痕、和解等真人关系语义；subjectIds 必须包含实际涉及的 actor-id/target-id。\n5. kind=artifact 只用于已经由群聊明确形成、可作为后续引用对象的产物，例如计划、清单、纪要、结论、规则、时间线；不要把反问、吐槽、台词、临时玩笑或“计划哪里不靠谱了”这类句子写成 artifact。\n6. 玩笑、测试、反讽、临时破例、后来澄清为假的内容不能写成稳定事实；需要保留时标 validity=uncertain/contradicted 或 decision=archive/revise/ignore。\n7. 如果只是单轮吵闹、临时吐槽或证据不足，返回空数组。\n8. 优先输出 1-4 条高价值记忆，最多 ${LLM_MEMORY_ANALYSIS_MAX_OUTPUT_ITEMS} 条；同一 subjectIds 组合最多 2 条。\n9. subjectOwner 表示这条记忆归属谁：user/speaker/target/third_party/unknown。不要把朋友、同事、家人的事实写成 user。\n10. visibility 控制未来能否显性提起：私密、健康、第三方事实优先 private/pair_private/never_surface；普通群体事实可 public_safe。\n11. semanticTags 写事实标签，associations 写弱联想话题，例如“不喜欢甜”可关联“饮料、奶茶、甜品、下午茶”。\n12. 只输出 JSON。`;
}

export function buildCharacterMemoryAnalysisPrompt() {
  return `你是一个角色经历、主观记忆与关系印记分析器。\n根据最近的结构化证据、原始证据和角色设定，提炼这个角色像真人一样会留下的长期记忆。\n这不是摘要任务。你要判断角色会如何理解事件、误读什么、在意什么、对谁形成怎样的关系印记，以及这会怎样改变自我认知。\n不要复制原话，不要把单轮情绪波动写成长期记忆。证据不足就返回空数组。\n\n输出一个 JSON 对象，字段均为数组，可为空：\n{\n  "characterPerspectives":[{"scope":"character_self","kind":"bias","subjectIds":["character-id"],"text":"<根据证据新写的角色主观长期结论>","confidence":0.0,"decision":"create","subjectOwner":"speaker","sourceType":"distilled","privacyRisk":0.1,"visibility":"public_safe","validity":"active","semanticTags":["角色标签"],"associations":["可联想到的话题"]}],\n  "relationshipImprints":[{"scope":"relationship","kind":"bond","subjectIds":["target-id"],"text":"<根据证据新写的关系印记长期结论>","confidence":0.0,"decision":"create","subjectOwner":"target","sourceType":"distilled","privacyRisk":0.2,"visibility":"pair_private","validity":"active","semanticTags":["关系标签"],"associations":["可联想到的话题"]}],\n  "emotionEffects":[{"scope":"character_self","kind":"status_shift","subjectIds":["character-id"],"text":"<根据证据新写的情绪后效长期结论>","confidence":0.0,"decision":"create","subjectOwner":"speaker","sourceType":"distilled","privacyRisk":0.1,"visibility":"public_safe","validity":"active","semanticTags":["情绪标签"],"associations":["可联想到的话题"]}],\n  "growthSignals":[{"scope":"character_self","kind":"trait_evidence","subjectIds":["character-id"],"text":"<根据证据新写的角色成长长期结论>","confidence":0.0,"decision":"create","subjectOwner":"speaker","sourceType":"distilled","privacyRisk":0.1,"visibility":"public_safe","validity":"active","semanticTags":["成长标签"],"associations":["可联想到的话题"]}]\n}\n\n要求：\n1. 必须符合角色人格、背景、说话风格、身份、当前关系和情绪，不要生成通用模板。\n2. 上方尖括号内容只是字段占位符，绝不能原样输出，也不能把“角色主观角度/角色对某人的长期印象/情绪后效/角色成长”等栏目名写进 text。\n3. 同一事件对不同角色应有不同主观解释；同一角色对多个人形成不同印象时，要拆成多条 relationshipImprints。\n4. relationshipImprints 应是长期关系语义，不只是四轴数值的文字化；subjectIds 必须指向对应关系对象。\n5. 玩笑、测试、反讽、临时破例、后来澄清为假的内容不能写成稳定事实；需要保留时标 validity=uncertain/contradicted 或 decision=archive/revise/ignore。\n6. 优先输出 1-4 条高价值记忆，最多 ${LLM_MEMORY_ANALYSIS_MAX_OUTPUT_ITEMS} 条；同一 subjectIds 组合最多 2 条。\n7. subjectOwner 表示这条记忆归属谁：speaker 是当前角色自身，target 是关系对象，third_party 是朋友/家人/同事等第三方，unknown 是群体事实。\n8. visibility 控制未来能否显性提起；私密关系、健康、第三方事实不要设成 public_safe。\n9. semanticTags 写事实标签，associations 写可自然联想到的话题，用于未来无关键词重叠时召回。\n10. 只输出 JSON。`;
}
