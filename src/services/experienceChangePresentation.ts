import type { MemoryItem } from './memoryTypes';
import { normalizeRelationshipLedgerEntry } from './relationshipLedger';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { isUserFacingMemoryItem } from './memoryPresentation';

export type ExperienceChangeKind = 'memory' | 'relationship';

export interface PresentedExperienceChange {
  key: string;
  kind: ExperienceChangeKind;
  title: string;
  text: string;
  chips: string[];
  updatedAt: number;
}

const EXPERIENCE_LENS_LABELS: Record<string, { zh: string; en: string }> = {
  llm_memory_objective_event: { zh: '客观事件', en: 'Objective event' },
  llm_memory_character_perspective: { zh: '主观理解', en: 'Character perspective' },
  llm_memory_relationship_imprint: { zh: '关系印记', en: 'Relationship imprint' },
  llm_memory_emotion_effect: { zh: '情绪后效', en: 'Emotion effect' },
  llm_memory_growth_signal: { zh: '成长信号', en: 'Growth signal' },
  llm_memory_distillation: { zh: 'LLM沉淀', en: 'LLM distillation' },
  memory_distillation: { zh: '本地蒸馏', en: 'Local distillation' },
  expression_feedback: { zh: '表达反馈', en: 'Expression feedback' },
  interaction: { zh: '互动', en: 'Interaction' },
  relationship_delta: { zh: '关系变化', en: 'Relationship change' },
  room_shift: { zh: '房间态势', en: 'Room state' },
  message_generated: { zh: '消息生成', en: 'Message generated' },
  inner_life_repair: { zh: '内心找补', en: 'Inner repair' },
  inner_life_attention: { zh: '想被看见', en: 'Attention seeking' },
  ai_direct_starter_message: { zh: 'AI私聊', en: 'AI direct chat' },
  ai_direct_target_message: { zh: 'AI私聊', en: 'AI direct chat' },
};

const MEMORY_SCOPE_LABELS: Record<MemoryItem['scope'], string> = {
  character_self: '角色',
  relationship: '关系',
  conversation: '会话',
  thread: '线程',
  system_runtime: '运行态',
};

export function getExperienceLensLabel(sourceTag?: string | null, language: string = 'zh') {
  if (!sourceTag) return null;
  const labels = EXPERIENCE_LENS_LABELS[sourceTag];
  if (!labels) return null;
  return language.startsWith('zh') ? labels.zh : labels.en;
}

function memberNameMap(members: AICharacter[]) {
  return new Map(members.map((member) => [member.id, member.name || '成员']));
}

function replaceMemberIds(text: string, names: Map<string, string>) {
  let next = text;
  names.forEach((name, id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = id.length < 8
      ? new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}(?=$|[^\\p{L}\\p{N}_-])`, 'gu')
      : new RegExp(escaped, 'g');
    next = next.replace(pattern, (match, prefix = '') => `${prefix}${name || '成员'}`);
  });
  return next.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '成员');
}

function compactText(text: string, max = 82) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function summarizeMemoryChange(item: MemoryItem, names: Map<string, string>, formatMemoryText?: (text: string, item: MemoryItem) => string): PresentedExperienceChange {
  const lens = getExperienceLensLabel(item.sourceTag);
  const sourceText = item.summary || item.text;
  const displayText = formatMemoryText ? formatMemoryText(sourceText, item) : replaceMemberIds(sourceText, names);
  return {
    key: `memory-${item.id}`,
    kind: 'memory',
    title: lens || '记忆沉淀',
    text: compactText(displayText),
    chips: [lens, item.scope === 'relationship' ? '关系' : item.scope === 'character_self' ? '角色' : MEMORY_SCOPE_LABELS[item.scope]].filter(Boolean) as string[],
    updatedAt: item.updatedAt || item.createdAt || 0,
  };
}

function combineRelationshipSummary(semanticSummary: string | undefined, evidence: string) {
  if (!semanticSummary) return evidence;
  if (!evidence) return semanticSummary;
  if (semanticSummary.includes(evidence) || evidence.includes(semanticSummary)) return semanticSummary;
  return `${semanticSummary}：${evidence}`;
}

function summarizeRelationshipChange(entry: RelationshipLedgerEntry, names: Map<string, string>): PresentedExperienceChange {
  const normalized = normalizeRelationshipLedgerEntry(entry);
  const actor = names.get(normalized.actorId) || normalized.actorId;
  const target = names.get(normalized.targetId) || normalized.targetId;
  const semantic = normalized.derived?.semantic;
  const latestEvidence = normalized.recentEvents.at(-1)?.summary || semantic?.summary || '';
  const evidence = compactText(replaceMemberIds(latestEvidence, names), 76);
  const semanticSummary = semantic?.summary ? replaceMemberIds(semantic.summary, names) : '';
  return {
    key: `relationship-${normalized.pairKey}`,
    kind: 'relationship',
    title: `${actor} → ${target}`,
    text: compactText(combineRelationshipSummary(semanticSummary, evidence)),
    chips: [semantic?.stage, ...(semantic?.labels || []).slice(0, 2)].filter(Boolean) as string[],
    updatedAt: normalized.lastUpdatedAt || 0,
  };
}

export function buildRecentExperienceChanges(params: {
  chat: Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;
  members: AICharacter[];
  limit?: number;
  formatMemoryText?: (text: string, item: MemoryItem) => string;
}) {
  const names = memberNameMap(params.members);
  const memoryChanges = ((params.chat.layeredMemories || []) as MemoryItem[])
    .filter(isUserFacingMemoryItem)
    .map((item) => summarizeMemoryChange(item, names, params.formatMemoryText));
  const relationshipChanges = (params.chat.relationshipLedger || [])
    .map((item) => summarizeRelationshipChange(item, names));
  return [...memoryChanges, ...relationshipChanges]
    .filter((item) => item.text || item.chips.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, params.limit ?? 4);
}
