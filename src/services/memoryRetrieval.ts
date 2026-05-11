import type { MemoryItem, MemoryLayer, MemoryRetrievalContext, MemoryScope } from './memoryTypes';

const DEFAULT_LAYER_PRIORITY: MemoryLayer[] = ['working', 'episodic', 'long_term'];
const DEFAULT_SCOPE_PRIORITY: MemoryScope[] = ['relationship', 'conversation', 'thread', 'character_self', 'system_runtime'];

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

function scoreForContext(item: MemoryItem, context: MemoryRetrievalContext) {
  let score = item.salience + item.confidence + item.recency * 0.4;
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
  return score;
}

export function retrieveRelevantMemories(items: MemoryItem[], context: MemoryRetrievalContext) {
  return [...items]
    .filter((item) => !item.archivedAt)
    .filter((item) => isAllowedBySourceTag(item, context))
    .sort((a, b) => scoreForContext(b, context) - scoreForContext(a, context))
    .slice(0, context.maxItems)
    .map((item) => ({ ...item, lastActivatedAt: Date.now() }));
}
