import type { MemoryItem } from './memoryTypes';
import { normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from './relationshipLedger';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';

export type ExperienceChangeKind = 'memory' | 'relationship';

export interface PresentedExperienceChange {
  key: string;
  kind: ExperienceChangeKind;
  title: string;
  text: string;
  chips: string[];
  updatedAt: number;
}

const EXPERIENCE_LENS_LABELS: Record<string, string> = {
  llm_memory_objective_event: '客观事件',
  llm_memory_character_perspective: '主观理解',
  llm_memory_relationship_imprint: '关系印记',
  llm_memory_emotion_effect: '情绪后效',
  llm_memory_growth_signal: '成长信号',
  llm_memory_distillation: 'LLM沉淀',
  memory_distillation: '本地蒸馏',
};

const MEMORY_LAYER_LABELS: Record<MemoryItem['layer'], string> = {
  long_term: '长期',
  episodic: '情节',
  working: '即时',
};

const MEMORY_SCOPE_LABELS: Record<MemoryItem['scope'], string> = {
  character_self: '角色',
  relationship: '关系',
  conversation: '会话',
  thread: '线程',
  system_runtime: '运行态',
};

export function getExperienceLensLabel(sourceTag?: string | null) {
  return sourceTag ? EXPERIENCE_LENS_LABELS[sourceTag] || null : null;
}

function memberNameMap(members: AICharacter[]) {
  return new Map(members.map((member) => [member.id, member.name || '成员']));
}

function replaceMemberIds(text: string, names: Map<string, string>) {
  let next = text;
  names.forEach((name, id) => {
    next = next.replace(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), name);
  });
  return next;
}

function compactText(text: string, max = 82) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function summarizeMemoryChange(item: MemoryItem, names: Map<string, string>, formatMemoryText?: (text: string, item: MemoryItem) => string): PresentedExperienceChange {
  const lens = getExperienceLensLabel(item.sourceTag);
  const displayText = formatMemoryText ? formatMemoryText(item.text, item) : replaceMemberIds(item.text, names);
  return {
    key: `memory-${item.id}`,
    kind: 'memory',
    title: lens || '记忆沉淀',
    text: compactText(displayText),
    chips: [lens, MEMORY_LAYER_LABELS[item.layer], MEMORY_SCOPE_LABELS[item.scope]].filter(Boolean) as string[],
    updatedAt: item.updatedAt || item.createdAt || 0,
  };
}

function strongestRelationshipAxes(entry: RelationshipLedgerEntry) {
  const delta = toRelationshipDisplayDelta(entry.current);
  return [
    { label: '亲和', value: delta.warmth },
    { label: '能力', value: delta.competence },
    { label: '信任', value: delta.trust },
    { label: '威胁', value: delta.threat },
  ]
    .filter((item) => item.value)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
    .map((item) => `${item.label}${item.value > 0 ? '+' : ''}${item.value}`);
}

function summarizeRelationshipChange(entry: RelationshipLedgerEntry, names: Map<string, string>): PresentedExperienceChange {
  const normalized = normalizeRelationshipLedgerEntry(entry);
  const actor = names.get(normalized.actorId) || normalized.actorId;
  const target = names.get(normalized.targetId) || normalized.targetId;
  const semantic = normalized.derived?.semantic;
  const latestEvidence = normalized.recentEvents.at(-1)?.summary || semantic?.summary || '';
  const evidence = compactText(replaceMemberIds(latestEvidence, names), 76);
  return {
    key: `relationship-${normalized.pairKey}`,
    kind: 'relationship',
    title: `${actor} → ${target}`,
    text: semantic?.summary ? compactText(`${semantic.summary}${evidence ? `：${evidence}` : ''}`) : evidence,
    chips: [semantic?.stage, ...(semantic?.labels || []).slice(0, 2), ...strongestRelationshipAxes(normalized).slice(0, 1)].filter(Boolean) as string[],
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
    .filter((item) => !item.archivedAt)
    .map((item) => summarizeMemoryChange(item, names, params.formatMemoryText));
  const relationshipChanges = (params.chat.relationshipLedger || [])
    .map((item) => summarizeRelationshipChange(item, names));
  return [...memoryChanges, ...relationshipChanges]
    .filter((item) => item.text || item.chips.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, params.limit ?? 4);
}
