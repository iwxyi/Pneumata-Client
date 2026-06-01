import type { MemoryItem, MemoryLayer, MemoryRetrievalContext, MemoryScope } from './memoryTypes';
import { isRuntimeEvidenceMemory } from './memoryPresentation';

const DEFAULT_LAYER_PRIORITY: MemoryLayer[] = ['working', 'episodic', 'long_term'];
const DEFAULT_SCOPE_PRIORITY: MemoryScope[] = ['relationship', 'conversation', 'thread', 'character_self', 'system_runtime'];
const MAX_RECALL_TOKENS = 18;
const RECALL_THRESHOLD = 0.5;

function layerScore(layer: MemoryLayer, preferredLayers: MemoryLayer[] = DEFAULT_LAYER_PRIORITY) {
  const index = preferredLayers.indexOf(layer);
  return index === -1 ? 0 : (preferredLayers.length - index) * 0.45;
}

function scopeScore(scope: MemoryScope, preferredScopes: MemoryScope[] = DEFAULT_SCOPE_PRIORITY) {
  const index = preferredScopes.indexOf(scope);
  return index === -1 ? 0 : (preferredScopes.length - index) * 0.35;
}

function isAllowedBySourceTag(item: MemoryItem, context: MemoryRetrievalContext) {
  if (context.allowedSourceTags?.length) {
    return Boolean(item.sourceTag && context.allowedSourceTags.includes(item.sourceTag));
  }
  if (context.blockedSourceTags?.length && item.sourceTag && context.blockedSourceTags.includes(item.sourceTag)) {
    return false;
  }
  return true;
}

function normalizeCueTokens(cueText: string | undefined) {
  const raw = String(cueText || '').toLowerCase();
  const tokens: string[] = [...(raw.match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || [])];
  const cjk = raw.replace(/[^\u4e00-\u9fff]/g, '');
  for (let index = 0; index < Math.min(cjk.length - 1, 16); index += 1) {
    tokens.push(cjk.slice(index, index + 2));
  }
  return Array.from(new Set(tokens.map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, MAX_RECALL_TOKENS);
}

function buildMemoryHaystack(item: MemoryItem) {
  return [
    item.text,
    item.summary,
    item.evidenceText,
    item.kind,
    item.scope,
    item.sourceTag,
    ...(item.subjectIds || []),
  ].filter(Boolean).join('\n').toLowerCase();
}

function matchedCueTokens(item: MemoryItem, context: MemoryRetrievalContext) {
  const tokens = normalizeCueTokens(context.cueText);
  if (!tokens.length) return [];
  const haystack = buildMemoryHaystack(item);
  return tokens.filter((token) => haystack.includes(token)).slice(0, 6);
}

function cueScore(item: MemoryItem, context: MemoryRetrievalContext) {
  const matches = matchedCueTokens(item, context);
  let score = 0;
  if (context.targetId && item.subjectIds?.includes(context.targetId)) score += 0.75;
  for (const token of matches) {
    score += token.length >= 4 ? 0.32 : 0.18;
  }
  return Math.min(2.2, score);
}

function isRetrievable(item: MemoryItem, context: MemoryRetrievalContext) {
  if (!item.archivedAt) return true;
  if (!context.includeArchivedRecall) return false;
  return cueScore(item, context) >= RECALL_THRESHOLD;
}

function scoreForContext(item: MemoryItem, context: MemoryRetrievalContext) {
  let score = item.salience + item.confidence + item.recency * 0.4;
  const recallScore = cueScore(item, context);
  score += recallScore * 1.2;
  score += layerScore(item.layer, context.preferredLayers);
  score += scopeScore(item.scope, context.preferredScopes);
  if (item.ownerId === context.speakerId) score += 1.2;
  if (context.targetId && item.subjectIds?.includes(context.targetId)) score += 1.1;
  if (item.scope === 'relationship' && context.targetId && item.subjectIds?.includes(context.targetId)) score += 1.25;
  if (context.relationshipBoost && item.scope === 'relationship') score += 0.6;
  if (context.selfMemoryBoost && item.scope === 'character_self') score += 0.45;
  if (context.conversationBoost && item.scope === 'conversation') score += 0.45;
  if (item.relatedConversationId === context.conversationId) score += 0.8;
  if (context.preferredSourceTags?.length && item.sourceTag && context.preferredSourceTags.includes(item.sourceTag)) score += 0.9;
  if (context.allowedSourceTags?.length && item.sourceTag && context.allowedSourceTags.includes(item.sourceTag)) score += 0.35;
  if (item.layer === 'working') score += 0.25;
  if (item.layer === 'long_term' && item.reinforcementCount > 1) score += 0.2;
  if (item.archivedAt) score += recallScore >= 0.5 ? -0.35 : -2;
  return score;
}

export function retrieveRelevantMemories(items: MemoryItem[], context: MemoryRetrievalContext) {
  const now = typeof context.now === 'number' && Number.isFinite(context.now) ? Math.round(context.now) : Date.now();
  const maxArchivedItems = context.maxArchivedItems ?? 2;
  const active = [...items]
    .filter((item) => context.includeRuntimeEvidence || !isRuntimeEvidenceMemory(item))
    .filter((item) => isRetrievable(item, context))
    .filter((item) => isAllowedBySourceTag(item, context))
    .sort((a, b) => scoreForContext(b, context) - scoreForContext(a, context));
  const archivedCount = active.filter((item) => item.archivedAt).length;
  const selected: MemoryItem[] = [];
  let usedArchived = 0;
  for (const item of active) {
    if (item.archivedAt) {
      if (usedArchived >= maxArchivedItems || archivedCount <= 0) continue;
      usedArchived += 1;
    }
    selected.push(item);
    if (selected.length >= context.maxItems) break;
  }
  return selected
    .map((item) => {
      const recallScore = cueScore(item, context);
      const recallTokens = matchedCueTokens(item, context);
      return {
        ...item,
        lastActivatedAt: now,
        ...(item.archivedAt && recallScore >= RECALL_THRESHOLD ? {
          recallScore,
          recallTokens,
          recallCue: context.cueText?.slice(-220),
          recallReason: recallTokens.length
            ? `旧档被线索唤醒：${recallTokens.join('、')}`
            : '旧档被当前对象关系唤醒',
        } : {}),
      };
    });
}
