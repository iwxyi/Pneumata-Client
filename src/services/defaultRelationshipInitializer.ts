import { generateResponse } from './aiClient';
import type { AIModelProfile } from '../types/settings';
import { isAIProfileUsable } from '../types/settings';
import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import type { RelationshipStructureKind, RoomRelationshipSharedFact, RoomRelationshipStructureEdge } from '../types/chat';

interface RawRelationshipInference {
  fromName?: unknown;
  toName?: unknown;
  warmth?: unknown;
  competence?: unknown;
  trust?: unknown;
  threat?: unknown;
  attachment?: unknown;
  deference?: unknown;
  note?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

interface RawRelationshipInferenceResponse {
  relationships?: RawRelationshipInference[];
  structure?: RawRelationshipStructure[];
  sharedStructure?: RawSharedRelationshipStructure[];
}

interface RawRelationshipStructure {
  fromName?: unknown;
  toName?: unknown;
  kind?: unknown;
  statement?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

interface RawSharedRelationshipStructure {
  memberNames?: unknown;
  kind?: unknown;
  kinds?: unknown;
  statement?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

export type DefaultRelationshipScope = 'created_only' | 'created_and_existing' | 'selected_members';

/** Shared options for every relationship-analysis caller. */
export interface DefaultRelationshipAnalysisOptions {
  /** Candidate set described by createdCharacters/allCharacters and scope. */
  scope?: DefaultRelationshipScope;
  /** Replace existing relationships inside replaceWithinCharacterIds. */
  overwriteExisting?: boolean;
  /** Explicitly restrict writes to directions with no existing relationship. */
  onlyMissing?: boolean;
  /** Backward-compatible alias used by the group refresh action. */
  force?: boolean;
  replaceWithinCharacterIds?: string[];
}

function shouldOverwriteRelationships(params: Pick<DefaultRelationshipAnalysisOptions, 'force' | 'overwriteExisting' | 'onlyMissing'>) {
  if (params.onlyMissing === true) return false;
  return params.force === true || params.overwriteExisting === true || params.onlyMissing === false;
}

export interface DefaultRelationshipPatch {
  id: string;
  updates: Partial<AICharacter>;
}

export interface DefaultRelationshipSuggestion {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  preset: CharacterRelationshipPreset;
  confidence: number;
  reason: string;
}

export type DefaultRelationshipSuggestionSkipReason = 'missing_character' | 'self_relationship' | 'protected_existing_relationship';

export interface DefaultRelationshipSuggestionResult {
  suggestionId: string;
  status: 'applied' | 'skipped';
  reason?: DefaultRelationshipSuggestionSkipReason;
}

export interface DefaultRelationshipPatchPlan {
  patches: DefaultRelationshipPatch[];
  results: DefaultRelationshipSuggestionResult[];
}

export interface DefaultRelationshipInitializationResult {
  patches: DefaultRelationshipPatch[];
  structureEdges: RoomRelationshipStructureEdge[];
  sharedStructureFacts: RoomRelationshipSharedFact[];
}

function clampNumber(value: unknown, min: number, max: number, fallback = 0) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractJsonObject(content: string) {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  return first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
}

function buildUniqueNameMap(characters: AICharacter[]) {
  const counts = new Map<string, number>();
  characters.forEach((character) => {
    const key = character.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const map = new Map<string, AICharacter>();
  characters.forEach((character) => {
    const key = character.name.trim().toLowerCase();
    if (counts.get(key) === 1) map.set(key, character);
  });
  return map;
}

function summarizeCharacter(character: AICharacter) {
  const core = character.coreProfile;
  return [
    `name: ${character.name}`,
    character.group ? `group/theme: ${character.group}` : '',
    character.background ? `background: ${character.background.slice(0, 240)}` : '',
    character.speakingStyle ? `speakingStyle: ${character.speakingStyle.slice(0, 180)}` : '',
    character.expertise?.length ? `expertise: ${character.expertise.slice(0, 5).join(', ')}` : '',
    core?.coreDesire ? `coreDesire: ${core.coreDesire}` : '',
    core?.coreFear ? `coreFear: ${core.coreFear}` : '',
    core?.socialMask ? `socialMask: ${core.socialMask}` : '',
    core?.conflictStyle ? `conflictStyle: ${core.conflictStyle}` : '',
  ].filter(Boolean).join('\n');
}

function buildPrompt(params: { createdCharacters: AICharacter[]; allCharacters: AICharacter[]; language: 'zh' | 'en'; scope: DefaultRelationshipScope }) {
  const createdNames = params.createdCharacters.map((character) => character.name).join(params.language === 'zh' ? '、' : ', ');
  const characterBlock = params.allCharacters.map((character) => `---\n${summarizeCharacter(character)}`).join('\n');
  const scopeRule = params.scope === 'selected_members'
    ? params.language === 'zh'
      ? '本次只判断当前群聊成员彼此之间的默认关系；不要输出成员之外的任何角色关系。'
      : 'Only infer default relationships among the current group members; do not output relationships involving anyone outside this room.'
    : params.scope === 'created_only'
    ? params.language === 'zh'
      ? '本次只判断刚创建角色彼此之间的关系；不要输出刚创建角色与旧角色之间的关系。'
      : 'Only infer relationships among newly created characters in this pass; do not output relationships between newly created and existing characters.'
    : params.language === 'zh'
      ? '本次重点补全刚创建角色与已有角色之间的关系；也可以包含仍然缺失的刚创建角色彼此关系。不要输出已有角色彼此之间的关系。'
      : 'Prioritize completing relationships between newly created and existing characters in this pass; you may include still-missing relationships among newly created characters. Do not output relationships among existing characters only.';
  if (params.language === 'zh') {
    return [
      `${params.scope === 'selected_members' ? '当前群聊成员' : '刚创建的角色'}：${createdNames}`,
      `请根据${params.scope === 'selected_members' ? '当前群聊成员' : '刚创建角色'}的信息，以及所有 AI 角色的名字和简介，判断这些角色之间是否需要初始化方向性关系。`,
      scopeRule,
      '不要使用“夫妻/朋友/前任/同事”等固定标签作为输出字段。也不要因为一个标签就硬套高好感。输出六轴数值、自然语言说明和置信度。',
      '允许复杂多重关系：同一对角色可以既亲密又危险、既有保护欲又不信任、既是亲属/伴侣又是仇敌或政治对手。请把这种矛盾体现在 warmth、trust、competence、threat 和 note 中。',
      '在资料允许的范围内，优先识别具有后续发展潜力的关系张力：责任与私情冲突、能力认可与权力不服、共同目标下的利益分歧、旧恩与旧怨并存、依赖与防备拉扯。张力必须能从角色身份、背景、欲望、恐惧、说话方式或既有关系中找到依据；不能为了戏剧性凭空编造背叛、仇恨、秘密或极端数值。关系应留下可自然演变的余地，而不是预设剧情结局。',
      '除了情绪亲疏，也要识别有明确依据的公共关系事实：上下级与职责归属、师徒/亲属、同僚或阵营、债务/命令、宿敌或政治依附。角色资料或可明确识别的经典身份已经足以说明这类事实；不要因为仅仅同处一个群聊就编造。',
      'relationships 只写单向主观视角：A→B 必须是 A 对 B 的态度、判断、顾虑或行动倾向；B→A 同理，绝不可把两边内容合并。上下级、同事、亲属、阵营等客观关系即使涉及两人，也必须写入 sharedStructure，不能写进任一方向的 note 或 structure。',
      'note 要写成可展示的简短主观看法，例如“怕他翻旧账，便不肯先低头”或“认可他的本事，却不愿受他摆布”，而不是“普通互动”或空泛情绪词。用 deference 表示让位、服从或不服从，用 attachment 表示牵挂与行动上的在意。',
      '可以更新任意方向，但应优先输出与刚创建角色有关的关系；如果两个刚创建角色之间明显有关，也可以输出。',
      '如果刚创建角色与已有角色在简介里明显有关，也可以输出新角色->已有角色或已有角色->新角色的初始印象；不要覆盖已有强关系。',
      '不要为所有组合机械生成关系。只输出有明显依据、能改善角色互动连续性的关系；如果 AI 判断关系确实很弱，也要如实给出对应数值和说明，不要把弱关系伪装成更强的关系。',
      '六轴范围：warmth -70..70，competence -70..70，trust -70..70，threat 0..70，attachment 0..70，deference -70..70。confidence 0..1。',
      '返回严格 JSON：{"relationships":[{"fromName":"角色A","toName":"角色B","warmth":0,"competence":0,"trust":0,"threat":0,"attachment":0,"deference":0,"note":"角色A对角色B的主观看法","confidence":0.8,"reason":"依据"}],"sharedStructure":[{"memberNames":["角色A","角色B"],"kinds":["authority","duty"],"statement":"角色A是角色B的直属上司，并负责安排其差事","confidence":0.9,"reason":"依据"}]}。sharedStructure 专门写双方或多方共同拥有的客观关系事实；同事、上下级、亲属、阵营、结义、共同债务或宿敌都必须写在这里。每一组相同成员只输出一条 sharedStructure；若同时有亲属、同属、职责等多层事实，在 kinds 中列全，statement 用一段不重复的综合说明。不要输出 structure。kinds 只能包含 authority、duty、kinship、affiliation、rivalry、obligation。',
      '所有 fromName/toName 必须来自角色列表。不要输出 markdown，不要解释。',
      `角色列表：\n${characterBlock}`,
    ].join('\n\n');
  }
  return [
    `${params.scope === 'selected_members' ? 'Current group members' : 'Newly created characters'}: ${createdNames}`,
    `Infer directional initial relationships ${params.scope === 'selected_members' ? 'among the current group members' : 'between these AI characters'} from their profiles.`,
    scopeRule,
    'Do not output fixed relationship labels such as spouse/friend/ex/colleague. Do not hard-code affection from labels. Output only six-axis scores, a natural-language note, confidence, and reason.',
    'Allow complex layered relationships: the same pair can be intimate and dangerous, protective but distrustful, relatives/spouses and enemies or political rivals at once. Represent that contradiction across warmth, trust, competence, threat, and note.',
    'Within the evidence in the profiles, prioritize relationship tension with room to develop: duty versus personal feeling, respect for ability versus resistance to authority, shared goals with conflicting interests, old favor alongside old resentment, or dependence mixed with guardedness. Every tension must be grounded in identity, background, desire, fear, speaking style, or an existing relationship. Never invent betrayal, hatred, secrets, or extreme scores merely for drama. Leave room for natural change rather than prewriting an outcome.',
    'In addition to emotional affinity, identify clearly grounded public relationship facts: authority and duty, mentor/family, colleagues or factions, command/obligation, rivalry or political dependence. When profiles or clearly identifiable canonical roles establish a fact, include it. Do not invent a relationship merely because two characters share a room.',
    'relationships must only express subjective directional perspective: A→B is A’s attitude, judgment, concern, or action tendency toward B; B→A is the reverse. Never merge both sides. Objective facts such as hierarchy, colleagues, kinship, faction, or shared duty belong only in sharedStructure, never in either directional note or structure.',
    'Write note as a concise displayable subjective view, such as “fears old debts and refuses to yield first” or “respects their skill but refuses to be controlled”, never as “ordinary interaction” or a vague emotion. Use deference for yielding/obedience or refusal to yield, and attachment for concern that changes action.',
    'You may update any direction, but prioritize relationships involving newly created characters. Include relationships among newly created characters when clearly implied.',
    'If newly created characters are clearly connected to existing characters, you may output new->existing or existing->new initial impressions. Do not overwrite strong existing relationships.',
    'Do not generate every pair mechanically. Only output relationships with clear grounding and useful interaction value. If the model judges a relationship as weak, represent that weak relationship honestly instead of inflating it or disguising it as something stronger.',
    'Axis ranges: warmth -70..70, competence -70..70, trust -70..70, threat 0..70, attachment 0..70, deference -70..70. confidence 0..1.',
    'Return strict JSON: {"relationships":[{"fromName":"A","toName":"B","warmth":0,"competence":0,"trust":0,"threat":0,"attachment":0,"deference":0,"note":"A’s subjective view of B","confidence":0.8,"reason":"basis"}],"sharedStructure":[{"memberNames":["A","B"],"kinds":["authority","duty"],"statement":"A is B’s direct superior and assigns their duties","confidence":0.9,"reason":"basis"}]}. sharedStructure is a public fact for two or more members; hierarchy, colleagues, kinship, faction, sworn siblinghood, joint debt, and rivalry must be placed here. Output exactly one sharedStructure entry per member group; combine multiple layers in kinds and use one non-repetitive summary in statement. Do not output structure. Kinds may contain authority, duty, kinship, affiliation, rivalry, or obligation.',
    'Every fromName/toName must come from the character list. No markdown. No explanation.',
    `Characters:\n${characterBlock}`,
  ].join('\n\n');
}

function parseRelationshipInference(content: string): RawRelationshipInferenceResponse {
  return JSON.parse(extractJsonObject(content)) as RawRelationshipInferenceResponse;
}

const STRUCTURE_KINDS = new Set<RelationshipStructureKind>(['authority', 'duty', 'kinship', 'affiliation', 'rivalry', 'obligation']);

function buildStructureEdges(raw: RawRelationshipStructure[] | undefined, nameMap: Map<string, AICharacter>, createdIds: Set<string>, scope: DefaultRelationshipScope, now: number) {
  const seen = new Set<string>();
  return (raw || []).flatMap((item, index): RoomRelationshipStructureEdge[] => {
    const confidence = normalizeConfidence(item.confidence);
    const from = nameMap.get(normalizeName(item.fromName).toLowerCase());
    const to = nameMap.get(normalizeName(item.toName).toLowerCase());
    const kind = normalizeName(item.kind) as RelationshipStructureKind;
    const statement = normalizeName(item.statement);
    if (!from || !to || from.id === to.id || confidence < 0.55 || !STRUCTURE_KINDS.has(kind) || !statement) return [];
    if ((scope === 'created_only' || scope === 'selected_members') && (!createdIds.has(from.id) || !createdIds.has(to.id))) return [];
    const key = `${from.id}->${to.id}:${kind}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `structure-${now}-${index}-${from.id}-${to.id}-${kind}`,
      fromId: from.id,
      toId: to.id,
      kind,
      statement: statement.slice(0, 180),
      confidence,
      evidence: normalizeName(item.reason).slice(0, 180),
      updatedAt: now,
    }];
  });
}

function buildSharedStructureFacts(raw: RawSharedRelationshipStructure[] | undefined, nameMap: Map<string, AICharacter>, createdIds: Set<string>, scope: DefaultRelationshipScope, now: number) {
  const seen = new Set<string>();
  return (raw || []).flatMap((item, index): RoomRelationshipSharedFact[] => {
    const confidence = normalizeConfidence(item.confidence);
    const kinds = Array.from(new Set((Array.isArray(item.kinds) ? item.kinds : [item.kind])
      .map(normalizeName)
      .filter((kind): kind is RelationshipStructureKind => STRUCTURE_KINDS.has(kind as RelationshipStructureKind))));
    const kind = kinds[0];
    const statement = normalizeName(item.statement);
    const names = Array.isArray(item.memberNames) ? item.memberNames.map(normalizeName).filter(Boolean) : [];
    const memberIds = Array.from(new Set(names.map((name) => nameMap.get(name.toLowerCase())?.id).filter((id): id is string => Boolean(id)))).sort();
    if (confidence < 0.55 || memberIds.length < 2 || !kind || !statement) return [];
    if ((scope === 'created_only' || scope === 'selected_members') && memberIds.some((id) => !createdIds.has(id))) return [];
    const key = `${memberIds.join('|')}:${kinds.join(',')}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: `shared-structure-${now}-${index}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`, memberIds, kind, kinds, statement: statement.slice(0, 180), confidence, evidence: normalizeName(item.reason).slice(0, 180), updatedAt: now }];
  });
}

function hasExistingDefaultRelationship(existing?: CharacterRelationshipPreset) {
  return Boolean(existing);
}

function buildRelationshipPreset(targetId: string, raw: RawRelationshipInference): CharacterRelationshipPreset {
  const note = normalizeName(raw.note) || normalizeName(raw.reason);
  return {
    characterId: targetId,
    warmth: clampNumber(raw.warmth, -70, 70),
    competence: clampNumber(raw.competence, -70, 70),
    trust: clampNumber(raw.trust, -70, 70),
    threat: clampNumber(raw.threat, 0, 70),
    attachment: clampNumber(raw.attachment, 0, 70),
    deference: clampNumber(raw.deference, -70, 70),
    note: note.slice(0, 180),
    source: 'ai_inferred',
    confidence: normalizeConfidence(raw.confidence),
    evidence: normalizeName(raw.reason).slice(0, 180),
    updatedAt: Date.now(),
  };
}

function resolveNow(now?: number) {
  return typeof now === 'number' && Number.isFinite(now) ? Math.round(now) : Date.now();
}

export async function buildDefaultRelationshipPatches(params: {
  config: AIModelProfile;
  createdCharacters: AICharacter[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  scope?: DefaultRelationshipScope;
  now?: number;
  signal?: AbortSignal;
  force?: boolean;
  replaceWithinCharacterIds?: string[];
  overwriteExisting?: boolean;
  onlyMissing?: boolean;
}): Promise<DefaultRelationshipPatch[]> {
  const now = resolveNow(params.now);
  const suggestions = await buildDefaultRelationshipSuggestions({ ...params, now });
  return buildDefaultRelationshipPatchesFromSuggestions({
    suggestions,
    allCharacters: params.allCharacters,
    language: params.language,
    now,
    force: shouldOverwriteRelationships(params),
    replaceWithinCharacterIds: params.replaceWithinCharacterIds,
  });
}

export async function buildDefaultRelationshipSuggestions(params: {
  config: AIModelProfile;
  createdCharacters: AICharacter[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  scope?: DefaultRelationshipScope;
  now?: number;
  signal?: AbortSignal;
  force?: boolean;
  replaceWithinCharacterIds?: string[];
  overwriteExisting?: boolean;
  onlyMissing?: boolean;
  onStructure?: (structure: { edges: RoomRelationshipStructureEdge[]; sharedFacts: RoomRelationshipSharedFact[] }) => void;
}): Promise<DefaultRelationshipSuggestion[]> {
  const now = resolveNow(params.now);
  const scope = params.scope || 'created_and_existing';
  const created = params.createdCharacters.filter((character) => !character.deletedAt && !character.isPreset);
  const all = params.allCharacters.filter((character) => !character.deletedAt);
  if (!created.length || all.length < 2 || !isAIProfileUsable(params.config)) return [];

  const response = await generateResponse(
    params.config,
    'You infer initial directional relationship axes for AI characters. Return valid JSON only.',
    [{ role: 'user', content: buildPrompt({ createdCharacters: created, allCharacters: all, language: params.language, scope }) }],
    undefined,
    { maxTokens: 3200, signal: params.signal, aiUsage: { type: 'relationship_analysis', label: '初始化角色关系', scope: 'character' } },
  );

  const nameMap = buildUniqueNameMap(all);
  const createdIds = new Set(created.map((character) => character.id));
  const suggestions: DefaultRelationshipSuggestion[] = [];
  const suggestionIdCounts = new Map<string, number>();

  const inference = parseRelationshipInference(response);
  const structureEdges = buildStructureEdges(inference.structure, nameMap, createdIds, scope, now);
  const sharedStructureFacts = buildSharedStructureFacts(inference.sharedStructure, nameMap, createdIds, scope, now);
  params.onStructure?.({ edges: structureEdges, sharedFacts: sharedStructureFacts });

  (inference.relationships || []).forEach((raw) => {
    const confidence = normalizeConfidence(raw.confidence);
    if (confidence < 0.55) return;
    const from = nameMap.get(normalizeName(raw.fromName).toLowerCase());
    const to = nameMap.get(normalizeName(raw.toName).toLowerCase());
    if (!from || !to || from.id === to.id) return;
    if (shouldOverwriteRelationships(params) && params.replaceWithinCharacterIds?.length) {
      const replaceIds = new Set(params.replaceWithinCharacterIds);
      if (!replaceIds.has(from.id) || !replaceIds.has(to.id)) return;
    }
    if (!createdIds.has(from.id) && !createdIds.has(to.id)) return;
    if ((scope === 'created_only' || scope === 'selected_members') && (!createdIds.has(from.id) || !createdIds.has(to.id))) return;

    const existing = from.relationships.find((relation) => relation.characterId === to.id);
    if (!shouldOverwriteRelationships(params) && hasExistingDefaultRelationship(existing)) return;

    const preset = { ...buildRelationshipPreset(to.id, raw), updatedAt: now };
    const baseId = `${from.id}->${to.id}`;
    const duplicateIndex = suggestionIdCounts.get(baseId) || 0;
    suggestionIdCounts.set(baseId, duplicateIndex + 1);
    suggestions.push({
      id: duplicateIndex ? `${baseId}:${duplicateIndex}` : baseId,
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      preset,
      confidence,
      reason: normalizeName(raw.reason),
    });
  });

  return suggestions;
}

export async function buildDefaultRelationshipInitialization(params: {
  config: AIModelProfile;
  createdCharacters: AICharacter[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  scope?: DefaultRelationshipScope;
  now?: number;
  signal?: AbortSignal;
  force?: boolean;
  replaceWithinCharacterIds?: string[];
  overwriteExisting?: boolean;
  onlyMissing?: boolean;
}): Promise<DefaultRelationshipInitializationResult> {
  let structureEdges: RoomRelationshipStructureEdge[] = [];
  let sharedStructureFacts: RoomRelationshipSharedFact[] = [];
  const suggestions = await buildDefaultRelationshipSuggestions({
    ...params,
    onStructure: (structure) => { structureEdges = structure.edges; sharedStructureFacts = structure.sharedFacts; },
    force: shouldOverwriteRelationships(params),
    replaceWithinCharacterIds: params.replaceWithinCharacterIds,
  });
  return {
    patches: buildDefaultRelationshipPatchesFromSuggestions({
      suggestions,
      allCharacters: params.allCharacters,
      language: params.language,
      now: params.now,
      force: shouldOverwriteRelationships(params),
      replaceWithinCharacterIds: params.replaceWithinCharacterIds,
    }),
    structureEdges,
    sharedStructureFacts,
  };
}

export function buildDefaultRelationshipPatchesFromSuggestions(params: {
  suggestions: DefaultRelationshipSuggestion[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  now?: number;
  force?: boolean;
  replaceWithinCharacterIds?: string[];
  overwriteExisting?: boolean;
  onlyMissing?: boolean;
}): DefaultRelationshipPatch[] {
  return planDefaultRelationshipPatchesFromSuggestions(params).patches;
}

export function planDefaultRelationshipPatchesFromSuggestions(params: {
  suggestions: DefaultRelationshipSuggestion[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  now?: number;
  force?: boolean;
  replaceWithinCharacterIds?: string[];
}): DefaultRelationshipPatchPlan {
  const now = resolveNow(params.now);
  const characterById = new Map(params.allCharacters.map((character) => [character.id, character]));
  const patchesById = new Map<string, DefaultRelationshipPatch>();
  const results: DefaultRelationshipSuggestionResult[] = [];

  if (params.force && params.replaceWithinCharacterIds?.length) {
    const replaceIds = new Set(params.replaceWithinCharacterIds);
    params.allCharacters.forEach((character) => {
      if (!replaceIds.has(character.id)) return;
      const relationships = character.relationships.filter((relation) => !replaceIds.has(relation.characterId));
      if (relationships.length !== character.relationships.length) {
        patchesById.set(character.id, { id: character.id, updates: { relationships } });
      }
    });
  }

  params.suggestions.forEach((suggestion) => {
    const from = characterById.get(suggestion.fromId);
    const to = characterById.get(suggestion.toId);
    if (!from || !to) {
      results.push({ suggestionId: suggestion.id, status: 'skipped', reason: 'missing_character' });
      return;
    }
    if (from.id === to.id) {
      results.push({ suggestionId: suggestion.id, status: 'skipped', reason: 'self_relationship' });
      return;
    }

    const currentPatch = patchesById.get(from.id);
    const source = currentPatch
      ? { ...from, ...currentPatch.updates, relationships: currentPatch.updates.relationships || from.relationships }
      : from;
    const existing = source.relationships.find((relation) => relation.characterId === to.id);
    if (!shouldOverwriteRelationships(params) && hasExistingDefaultRelationship(existing)) {
      results.push({ suggestionId: suggestion.id, status: 'skipped', reason: 'protected_existing_relationship' });
      return;
    }

    const nextPreset = { ...suggestion.preset, characterId: to.id, updatedAt: now };
    const relationships = existing
      ? source.relationships.map((relation) => relation.characterId === to.id ? { ...relation, ...nextPreset } : relation)
      : [...source.relationships, nextPreset];
    const timelineText = params.language === 'zh'
      ? `AI 初始化关系：对 ${to.name} 的初始印象已形成。`
      : `AI initialized an initial impression toward ${to.name}.`;
    const timelineEntry = { type: 'relationship' as const, text: timelineText, createdAt: now };
    patchesById.set(from.id, {
      id: from.id,
      updates: {
        relationships,
        runtimeTimeline: [...(source.runtimeTimeline || []), timelineEntry].slice(-80),
      },
    });
    results.push({ suggestionId: suggestion.id, status: 'applied' });
  });

  return { patches: Array.from(patchesById.values()), results };
}

export async function initializeDefaultRelationshipsForCreatedCharacters(params: {
  config: AIModelProfile | null | undefined;
  createdCharacters: AICharacter[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  updateCharacters: (patches: DefaultRelationshipPatch[]) => Promise<void>;
  scope?: DefaultRelationshipScope;
  now?: number;
  signal?: AbortSignal;
  force?: boolean;
  replaceWithinCharacterIds?: string[];
  overwriteExisting?: boolean;
  onlyMissing?: boolean;
  updateRelationshipStructure?: (structure: { edges: RoomRelationshipStructureEdge[]; sharedFacts: RoomRelationshipSharedFact[] }) => Promise<void>;
}) {
  if (!params.config) return [];
  const result = await buildDefaultRelationshipInitialization({
    config: params.config,
    createdCharacters: params.createdCharacters,
    allCharacters: params.allCharacters,
    language: params.language,
    scope: params.scope,
    now: params.now,
    signal: params.signal,
    force: shouldOverwriteRelationships(params),
    replaceWithinCharacterIds: params.replaceWithinCharacterIds,
  });
  if (result.patches.length) await params.updateCharacters(result.patches);
  if (params.updateRelationshipStructure && (shouldOverwriteRelationships(params) || result.structureEdges.length || result.sharedStructureFacts.length)) {
    await params.updateRelationshipStructure({ edges: result.structureEdges, sharedFacts: result.sharedStructureFacts });
  }
  return result.patches;
}
