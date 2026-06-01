import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import { readMemoryDistillationMeta } from './sessionProjection';
import { sanitizeDistillationTexts } from './distillationText';
import { sanitizeUserFacingText } from './displayTextSanitizer';
import { getExperienceLensLabel } from './experienceChangePresentation';

export interface DistillationRuntimeEventDebugItem {
  key: string;
  timestamp: number;
  headline: string;
  bodyTexts: string[];
  caption: string;
}

export interface DistillationPersistedMemoryDebugItem {
  key: string;
  timestamp: number;
  headline: string;
  bodyText: string;
  caption: string;
}

export interface MemoryDistillationDebugProjection {
  sectionTitle: string;
  runtimeEventItems: DistillationRuntimeEventDebugItem[];
  persistedItems: DistillationPersistedMemoryDebugItem[];
}

function formatMemoryDistillationOwner(payload: Record<string, unknown>, isZh: boolean) {
  if (typeof payload.ownerLabel === 'string' && payload.ownerLabel) return payload.ownerLabel;
  return payload.ownerType === 'character' ? (isZh ? '角色记忆' : 'Character memory') : (isZh ? '群聊记忆' : 'Chat memory');
}

function formatMemoryDistillationMergeMode(payload: Record<string, unknown>, isZh: boolean) {
  if (typeof payload.mergeModeLabel === 'string' && payload.mergeModeLabel) return payload.mergeModeLabel;
  if (typeof payload.mergeMode === 'string' && payload.mergeMode) {
    const labels: Record<string, string> = {
      reinforce_same_bucket: isZh ? '同类证据强化' : 'Reinforce similar evidence',
      revise_existing: isZh ? '修订已有记忆' : 'Revise existing memory',
      merge_related: isZh ? '合并相关记忆' : 'Merge related memories',
      append_new: isZh ? '新增记忆' : 'Append new memory',
    };
    return labels[payload.mergeMode] || payload.mergeMode;
  }
  return isZh ? '同类证据强化合并' : 'Reinforce similar evidence';
}

function formatMemoryDistillationCounts(payload: Record<string, unknown>, isZh: boolean) {
  const evidenceCount = typeof payload.newEvidenceCount === 'number' ? payload.newEvidenceCount : 0;
  return isZh ? `证据事件 ${evidenceCount}` : `Evidence events ${evidenceCount}`;
}

function formatMemorySourceTag(sourceTag: string | null | undefined, isZh: boolean) {
  const lensLabel = getExperienceLensLabel(sourceTag, isZh ? 'zh' : 'en');
  if (lensLabel) return lensLabel;
  const labels: Record<string, string> = {
    llm_memory_objective_event: isZh ? '客观事件' : 'Objective event',
    llm_memory_character_perspective: isZh ? '主观理解' : 'Character perspective',
    llm_memory_relationship_imprint: isZh ? '关系印记' : 'Relationship imprint',
    llm_memory_emotion_effect: isZh ? '情绪后效' : 'Emotion effect',
    llm_memory_growth_signal: isZh ? '成长信号' : 'Growth signal',
    llm_memory_distillation: isZh ? 'LLM 蒸馏' : 'LLM distillation',
    memory_distillation: isZh ? '记忆蒸馏' : 'Memory distillation',
  };
  return sourceTag ? labels[sourceTag] || sourceTag : labels.memory_distillation;
}

function buildMemoryDistillationBody(payload: Record<string, unknown>, members: AICharacter[] = []) {
  const candidateTexts = Array.isArray(payload.candidateTexts)
    ? sanitizeDistillationTexts(payload.candidateTexts.filter((value: unknown): value is string => typeof value === 'string'))
    : [];
  return candidateTexts.map((text) => sanitizeUserFacingText(text, members));
}

export function projectMemoryDistillationDebug(
  chat: GroupChat,
  timeline: ProjectedRuntimeTimelineItem[],
  isZh: boolean,
  members: AICharacter[] = [],
): MemoryDistillationDebugProjection | null {
  const runtimeEventItems = timeline
    .filter((item) => readMemoryDistillationMeta(item) && item.event)
    .slice(-4)
    .reverse()
    .map((item) => {
      const payload = (readMemoryDistillationMeta(item) || {}) as Record<string, unknown>;
      const owner = formatMemoryDistillationOwner(payload, isZh);
      return {
        key: item.event?.id || String(item.createdAt),
        timestamp: item.createdAt,
        headline: `${owner}蒸馏`,
        bodyTexts: buildMemoryDistillationBody(payload, members),
        caption: `${formatMemoryDistillationCounts(payload, isZh)} · ${isZh ? '合并方式' : 'Merge'} ${formatMemoryDistillationMergeMode(payload, isZh)}`,
      };
    });

  const persistedItems = (chat.layeredMemories || [])
    .filter((item) => item.origin === 'distilled')
    .slice()
    .sort((left, right) => (right.distilledAt || right.updatedAt || 0) - (left.distilledAt || left.updatedAt || 0))
    .slice(0, 4)
    .map((item) => ({
      key: item.id,
      timestamp: item.distilledAt || item.updatedAt,
      headline: `${item.ownerId === chat.id ? (isZh ? '群聊记忆' : 'Chat memory') : (isZh ? '角色记忆' : 'Character memory')} · ${isZh ? '已写入核心蒸馏' : 'Distilled into long-term memory'}`,
      bodyText: sanitizeUserFacingText(item.text, members),
      caption: isZh ? `来源 ${formatMemorySourceTag(item.sourceTag, isZh)} · 强化 ${item.reinforcementCount}` : `Source ${formatMemorySourceTag(item.sourceTag, isZh)} · Reinforcement ${item.reinforcementCount}`,
    }));

  if (!runtimeEventItems.length && !persistedItems.length) return null;
  return {
    sectionTitle: isZh ? '记忆蒸馏' : 'Memory distillation',
    runtimeEventItems,
    persistedItems,
  };
}
