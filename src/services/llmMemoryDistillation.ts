import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';

const LLM_CHAT_DISTILLATION_TURN_GAP = 20;
const LLM_CHARACTER_DISTILLATION_TURN_GAP = 16;
const LLM_CHAT_MIN_ITEMS = 6;
const LLM_CHARACTER_MIN_ITEMS = 5;
const LLM_DISTILLATION_VERSION = 'llm-v1';

interface LlmDistilledItem {
  scope: MemoryCandidate['scope'];
  kind: MemoryCandidate['kind'];
  subjectIds?: string[];
  text: string;
  confidence?: number;
}

interface LlmDistillationResult {
  items: LlmDistilledItem[];
}

function recentEligibleItems(items: MemoryItem[]) {
  return items
    .filter((item) => !item.archivedAt && (item.layer === 'working' || item.layer === 'episodic'))
    .slice(-10);
}

function latestLlmDistilledAt(items: MemoryItem[]) {
  return Math.max(0, ...items.filter((item) => item.origin === 'distilled' && item.distillationVersion === LLM_DISTILLATION_VERSION).map((item) => item.distilledAt || 0));
}

function hasEnoughNovelEvidence(items: MemoryItem[]) {
  const sourceIds = Array.from(new Set(items.flatMap((item) => item.sourceEventIds || [])));
  return sourceIds.length >= 3;
}

function buildPerceptionAndMemoryBias(character: AICharacter) {
  const traits: string[] = [];
  if (character.personality.extroversion <= 35) traits.push('更容易记住社交时自己的紧张、犹豫、被压迫感，而不是完整外部热闹场景');
  if (character.personality.extroversion >= 70) traits.push('更容易记住社交氛围、参与感、谁和谁在互动，但可能忽略他人细微情绪变化');
  if (character.personality.empathy >= 70 || character.behavior.empathyLevel >= 70) traits.push('更容易记住他人的情绪线索、委屈、尴尬、被忽视感');
  if (character.personality.empathy <= 35 && character.behavior.aggressiveness >= 60) traits.push('更容易记住立场、输赢、谁压过谁，而不是他人的细腻感受');
  if (character.personality.neuroticism >= 70) traits.push('更容易放大威胁、冒犯、被误解、羞耻或失控感');
  if (character.personality.agreeableness <= 35) traits.push('更容易记住冲突、双标、地位高低、边界被踩');
  if (character.personality.openness >= 70) traits.push('更容易记住抽象意义、观点结构、隐含模式，而不只是一句原话');
  if (character.behavior.summarizing >= 70) traits.push('更容易把经历压缩成结论、判断和规则');
  if (character.behavior.offTopic >= 70) traits.push('更容易记住联想出来的旁支情境，而不是严格主线');
  if (character.behavior.humorIntensity >= 70) traits.push('更容易记住玩笑、讽刺、气氛反差和社交表演性');
  return traits;
}

function buildCharacterLens(character: AICharacter) {
  const perceptionBias = buildPerceptionAndMemoryBias(character);
  return [
    `性格参数：开放 ${character.personality.openness} / 外向 ${character.personality.extroversion} / 宜人 ${character.personality.agreeableness} / 神经质 ${character.personality.neuroticism} / 幽默 ${character.personality.humor} / 创造 ${character.personality.creativity} / 主见 ${character.personality.assertiveness} / 共情 ${character.personality.empathy}`,
    `行为参数：主动 ${character.behavior.proactivity} / 攻击 ${character.behavior.aggressiveness} / 幽默 ${character.behavior.humorIntensity} / 共情 ${character.behavior.empathyLevel} / 总结 ${character.behavior.summarizing} / 跑题 ${character.behavior.offTopic}`,
    character.background ? `背景：${character.background}` : '',
    character.speakingStyle ? `说话风格：${character.speakingStyle}` : '',
    perceptionBias.length ? `该角色更可能保留的记忆偏向：${perceptionBias.join('；')}` : '该角色的记忆应贴合其人格、行为、注意力与感受偏好，不要假设其会平均记住所有细节。',
    '不要把角色写成全知观察者。要根据其性格、行为、情绪敏感度、社交位置、注意力偏差来决定“会记住什么”与“会忽略什么”。',
  ].filter(Boolean).join('\n');
}

function buildEvidenceBlock(items: MemoryItem[]) {
  return items.map((item, index) => `${index + 1}. [${item.scope}/${item.layer}/${item.kind}] ${item.text}`).join('\n');
}

function normalizeScope(value: unknown): MemoryCandidate['scope'] {
  const allowed: MemoryCandidate['scope'][] = ['conversation', 'character_self', 'relationship', 'thread', 'system_runtime'];
  return allowed.includes(value as MemoryCandidate['scope']) ? value as MemoryCandidate['scope'] : 'character_self';
}

function normalizeKind(value: unknown): MemoryCandidate['kind'] {
  const allowed: MemoryCandidate['kind'][] = ['decision', 'conflict', 'bond', 'resentment', 'status_shift', 'trait_evidence', 'bias', 'taboo', 'obsession', 'artifact', 'thread_effect'];
  return allowed.includes(value as MemoryCandidate['kind']) ? value as MemoryCandidate['kind'] : 'bias';
}

function parseResult(raw: string): LlmDistillationResult {
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

function toCandidate(ownerId: string, source: MemoryItem[], item: LlmDistilledItem): MemoryCandidate {
  return {
    scope: item.scope,
    layerHint: 'long_term',
    kind: item.kind,
    ownerId,
    subjectIds: item.subjectIds,
    text: item.text,
    sourceEventIds: source.flatMap((entry) => entry.sourceEventIds || []).slice(-8),
    sourceTag: 'llm_memory_distillation',
    origin: 'distilled',
    distilledFromIds: source.map((entry) => entry.id),
    distilledAt: Date.now(),
    distillationVersion: LLM_DISTILLATION_VERSION,
    scoreBreakdown: {
      stability: 0.88,
      recurrence: 0.72,
      impact: 0.8,
      specificity: 0.82,
      durability: 0.92,
    },
  };
}

export function shouldRunLlmChatDistillation(chat: GroupChat, turnCount: number) {
  const items = recentEligibleItems(chat.layeredMemories || []);
  if (items.length < LLM_CHAT_MIN_ITEMS) return false;
  if (turnCount < LLM_CHAT_DISTILLATION_TURN_GAP) return false;
  const latest = latestLlmDistilledAt(chat.layeredMemories || []);
  return (!latest || items.every((item) => item.updatedAt > latest)) && hasEnoughNovelEvidence(items);
}

export function shouldRunLlmCharacterDistillation(character: AICharacter, turnCount: number) {
  const items = recentEligibleItems(character.layeredMemories || []);
  if (items.length < LLM_CHARACTER_MIN_ITEMS) return false;
  if (turnCount < LLM_CHARACTER_DISTILLATION_TURN_GAP) return false;
  const latest = latestLlmDistilledAt(character.layeredMemories || []);
  return (!latest || items.every((item) => item.updatedAt > latest)) && hasEnoughNovelEvidence(items);
}

export async function distillChatMemoriesWithLlm(api: APIConfig, chat: GroupChat): Promise<MemoryCandidate[]> {
  const source = recentEligibleItems(chat.layeredMemories || []);
  if (source.length < LLM_CHAT_MIN_ITEMS) return [];
  const systemPrompt = `你是一个群体记忆蒸馏器。\n你的任务不是复述对话，而是从最近多条记忆证据里提炼 1~2 条更稳定的核心长期记忆。\n重点参考社会学、心理学、互动动力学视角：长期站队、资格结构、稳定冲突线、群体共识、长期情绪后果。\n不要输出瞬时聊天细节，不要重复原句。\n只输出 JSON：{\"items\":[{\"scope\":\"conversation|relationship\",\"kind\":\"conflict|bond|resentment|status_shift|decision\",\"subjectIds\":[\"...\"],\"text\":\"...\",\"confidence\":0.0}]}。`;
  const raw = await generateJsonResponse(api, systemPrompt, [
    { role: 'user', content: `群聊：${chat.name}\n主题：${chat.topic || '未设置'}\n最近记忆证据：\n${buildEvidenceBlock(source)}` },
  ]);
  const result = parseResult(raw);
  return result.items.slice(0, 2).map((item) => toCandidate(chat.id, source, item));
}

export async function distillCharacterMemoriesWithLlm(api: APIConfig, character: AICharacter): Promise<MemoryCandidate[]> {
  const source = recentEligibleItems(character.layeredMemories || []);
  if (source.length < LLM_CHARACTER_MIN_ITEMS) return [];
  const systemPrompt = `你是一个角色长期记忆蒸馏器。\n你的任务不是机械压缩，而是根据角色的人格、行为倾向、注意力偏差、社会位置、情绪敏感度，提炼 1~2 条更稳定的长期记忆。\n要综合使用社会学、心理学、互动动力学视角，但必须服从这个角色自己的参数与主观体验。\n重点不是“客观上发生了什么”，而是“这个角色更可能记住什么、怎么理解、怎么误读、怎么带偏见地保留”。\n不要默认角色会平均记住全部细节；若某类信息按角色特征本来就不容易被其注意或保留，就不要硬写进记忆。\n输出应体现角色化的长期判断，而不是通用总结。\n只输出 JSON：{\"items\":[{\"scope\":\"character_self|relationship\",\"kind\":\"bias|bond|resentment|taboo|obsession|trait_evidence\",\"subjectIds\":[\"...\"],\"text\":\"...\",\"confidence\":0.0}]}。`;
  const raw = await generateJsonResponse(api, systemPrompt, [
    { role: 'user', content: `角色：${character.name}\n${buildCharacterLens(character)}\n最近记忆证据：\n${buildEvidenceBlock(source)}` },
  ]);
  const result = parseResult(raw);
  return result.items.slice(0, 2).map((item) => toCandidate(character.id, source, item));
}
