import { formatConflictMetricsForDisplay, formatRuntimeEventText } from '../../services/runtimeEventFactory';
import { sanitizeDistillationTexts } from '../../services/distillationText';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';

function dedupeDisplayText(text: string) {
  return sanitizeUserFacingText(text.replace(/^房间态势更新：/g, '').trim());
}

function isMemoryDistillationEvent(metrics: unknown) {
  return typeof metrics === 'object' && metrics !== null && 'ownerType' in metrics && 'candidateTexts' in metrics;
}

function buildMemoryDistillationSourcePrefix(metrics: Record<string, unknown> | null) {
  const sourceLabel = typeof metrics?.sourceLabel === 'string' ? metrics.sourceLabel : '';
  const reasonLabel = typeof metrics?.reasonLabel === 'string' ? metrics.reasonLabel : '';
  const sourceText = `${sourceLabel} ${reasonLabel}`;
  if (/llm/i.test(sourceText)) return 'LLM';
  return '本地';
}

function buildMemoryDistillationOwnerSuffix(metrics: Record<string, unknown> | null) {
  if (!metrics) return '';
  const ownerLabel = typeof metrics.ownerLabel === 'string' ? metrics.ownerLabel : '';
  const isCharacterOwner = metrics?.ownerType === 'character' || ownerLabel.startsWith('角色：');
  if (!isCharacterOwner) return '';
  const ownerName = typeof metrics.ownerName === 'string' ? metrics.ownerName : '';
  const value = ownerName || ownerLabel.replace(/^角色：/, '').trim();
  return value ? ` · ${value}` : '';
}

function formatMemoryDistillationMergeLabel(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const labels: Record<string, string> = {
    reinforce_same_bucket: '同类证据强化',
    bucket_reinforce: '同类证据强化',
    revise_existing: '修订已有记忆',
    merge_related: '合并相关记忆',
    append_new: '新增记忆',
    '同 bucket 强化合并': '同类证据强化合并',
    '同 bucket 强化': '同类证据强化',
  };
  if (!raw) return '同类证据强化合并';
  return labels[raw] || sanitizeUserFacingText(raw).replace(/bucket/gi, '同类证据');
}

export function buildEventDisplayText(payload: { eventType?: string; title?: string; summary?: string; pair?: string[]; metrics?: unknown }) {
  if (payload.eventType === 'room_state_snapshot_v2') return dedupeDisplayText(payload.summary || '');
  if (payload.eventType === 'conflict_axis_shift') return dedupeDisplayText(payload.summary || '');
  if (payload.eventType === 'memory_distillation') {
    const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics as Record<string, unknown> : null;
    const ownerLabel = typeof metrics?.ownerLabel === 'string' ? metrics.ownerLabel : '';
    const ownerType = metrics?.ownerType === 'chat' || ownerLabel.startsWith('群聊：') ? '群聊' : '角色';
    return `${buildMemoryDistillationSourcePrefix(metrics)}${ownerType}蒸馏${buildMemoryDistillationOwnerSuffix(metrics)}`;
  }
  return dedupeDisplayText(formatRuntimeEventText({
    eventType: payload.eventType || 'event',
    title: payload.title || '事件',
    summary: payload.summary || '',
    pair: payload.pair as [string, string] | undefined,
    metrics: payload.metrics,
  }));
}

export function buildMemoryDistillationMeta(payload: { metrics?: unknown }) {
  if (!isMemoryDistillationEvent(payload.metrics)) return null;
  const metrics = payload.metrics as Record<string, unknown>;
  const mergeModeLabel = formatMemoryDistillationMergeLabel(metrics.mergeModeLabel || metrics.mergeMode);
  const evidenceCount = typeof metrics.newEvidenceCount === 'number' ? metrics.newEvidenceCount : 0;
  const candidateTexts = Array.isArray(metrics.candidateTexts)
    ? sanitizeDistillationTexts(metrics.candidateTexts.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))).slice(0, 2)
      .map((text) => sanitizeUserFacingText(text))
      .filter(Boolean)
    : [];
  return {
    mergeModeLabel,
    evidenceCount,
    candidateTexts: candidateTexts.slice(0, 1),
  };
}

export function shouldHideEmptyConflictEvent(payload: { eventType?: string; summary?: string; metrics?: unknown }) {
  if (payload.eventType !== 'conflict_focus_shift' && payload.eventType !== 'conflict_axis_shift') return false;
  const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics as Record<string, unknown> : null;
  const hasSummary = Boolean(payload.summary?.trim());
  const hasMeaningfulMetrics = Boolean(
    metrics?.type
      || metrics?.stage
      || metrics?.nextPressure
      || (Array.isArray(metrics?.developmentHooks) && (metrics.developmentHooks as unknown[]).some((item) => typeof item === 'string' && item.trim()))
  );
  return !hasSummary && !hasMeaningfulMetrics;
}

export function buildConflictEventMeta(payload: { metrics?: unknown }) {
  return formatConflictMetricsForDisplay(payload.metrics);
}
