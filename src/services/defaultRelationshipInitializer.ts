import { generateResponse } from './aiClient';
import type { AIModelProfile } from '../types/settings';
import { isAIProfileUsable } from '../types/settings';
import type { AICharacter, CharacterRelationshipPreset } from '../types/character';

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
}

export type DefaultRelationshipScope = 'created_only' | 'created_and_existing' | 'selected_members';

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
      '可以更新任意方向，但应优先输出与刚创建角色有关的关系；如果两个刚创建角色之间明显有关，也可以输出。',
      '如果刚创建角色与已有角色在简介里明显有关，也可以输出新角色->已有角色或已有角色->新角色的初始印象；不要覆盖已有强关系。',
      '不要为所有组合机械生成关系。只输出有明显依据、能改善角色互动连续性的关系。',
      '六轴范围：warmth -70..70，competence -70..70，trust -70..70，threat 0..70，attachment 0..70，deference -70..70。confidence 0..1。',
      '返回严格 JSON：{"relationships":[{"fromName":"角色A","toName":"角色B","warmth":0,"competence":0,"trust":0,"threat":0,"attachment":0,"deference":0,"note":"自然语言关系说明","confidence":0.8,"reason":"依据"}]}',
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
    'You may update any direction, but prioritize relationships involving newly created characters. Include relationships among newly created characters when clearly implied.',
    'If newly created characters are clearly connected to existing characters, you may output new->existing or existing->new initial impressions. Do not overwrite strong existing relationships.',
    'Do not generate every pair mechanically. Only output relationships with clear grounding and useful interaction value.',
    'Axis ranges: warmth -70..70, competence -70..70, trust -70..70, threat 0..70, attachment 0..70, deference -70..70. confidence 0..1.',
    'Return strict JSON: {"relationships":[{"fromName":"A","toName":"B","warmth":0,"competence":0,"trust":0,"threat":0,"attachment":0,"deference":0,"note":"natural-language relationship note","confidence":0.8,"reason":"basis"}]}',
    'Every fromName/toName must come from the character list. No markdown. No explanation.',
    `Characters:\n${characterBlock}`,
  ].join('\n\n');
}

function parseRelationshipInference(content: string) {
  const parsed = JSON.parse(extractJsonObject(content)) as RawRelationshipInferenceResponse;
  return Array.isArray(parsed.relationships) ? parsed.relationships : [];
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
}): Promise<DefaultRelationshipPatch[]> {
  const now = resolveNow(params.now);
  const suggestions = await buildDefaultRelationshipSuggestions({ ...params, now });
  return buildDefaultRelationshipPatchesFromSuggestions({
    suggestions,
    allCharacters: params.allCharacters,
    language: params.language,
    now,
  });
}

export async function buildDefaultRelationshipSuggestions(params: {
  config: AIModelProfile;
  createdCharacters: AICharacter[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  scope?: DefaultRelationshipScope;
  now?: number;
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
    { maxTokens: 3200, aiUsage: { type: 'relationship_analysis', label: '初始化角色关系', scope: 'character' } },
  );

  const nameMap = buildUniqueNameMap(all);
  const createdIds = new Set(created.map((character) => character.id));
  const suggestions: DefaultRelationshipSuggestion[] = [];
  const suggestionIdCounts = new Map<string, number>();

  parseRelationshipInference(response).forEach((raw) => {
    const confidence = normalizeConfidence(raw.confidence);
    if (confidence < 0.55) return;
    const from = nameMap.get(normalizeName(raw.fromName).toLowerCase());
    const to = nameMap.get(normalizeName(raw.toName).toLowerCase());
    if (!from || !to || from.id === to.id) return;
    if (!createdIds.has(from.id) && !createdIds.has(to.id)) return;
    if ((scope === 'created_only' || scope === 'selected_members') && (!createdIds.has(from.id) || !createdIds.has(to.id))) return;

    const existing = from.relationships.find((relation) => relation.characterId === to.id);
    if (hasExistingDefaultRelationship(existing)) return;

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

export function buildDefaultRelationshipPatchesFromSuggestions(params: {
  suggestions: DefaultRelationshipSuggestion[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  now?: number;
}): DefaultRelationshipPatch[] {
  return planDefaultRelationshipPatchesFromSuggestions(params).patches;
}

export function planDefaultRelationshipPatchesFromSuggestions(params: {
  suggestions: DefaultRelationshipSuggestion[];
  allCharacters: AICharacter[];
  language: 'zh' | 'en';
  now?: number;
}): DefaultRelationshipPatchPlan {
  const now = resolveNow(params.now);
  const characterById = new Map(params.allCharacters.map((character) => [character.id, character]));
  const patchesById = new Map<string, DefaultRelationshipPatch>();
  const results: DefaultRelationshipSuggestionResult[] = [];

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
    if (hasExistingDefaultRelationship(existing)) {
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
}) {
  if (!params.config) return [];
  const patches = await buildDefaultRelationshipPatches({
    config: params.config,
    createdCharacters: params.createdCharacters,
    allCharacters: params.allCharacters,
    language: params.language,
    scope: params.scope,
    now: params.now,
  });
  if (patches.length) await params.updateCharacters(patches);
  return patches;
}
