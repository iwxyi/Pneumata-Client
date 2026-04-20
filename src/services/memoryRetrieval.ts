import type { MemoryItem, MemoryRetrievalContext } from './memoryTypes';

function scoreForContext(item: MemoryItem, context: MemoryRetrievalContext) {
  let score = item.salience + item.confidence + item.recency * 0.4;
  if (item.ownerId === context.speakerId) score += 1.2;
  if (context.targetId && item.subjectIds?.includes(context.targetId)) score += 1.1;
  if (item.scope === 'relationship' && context.targetId && item.subjectIds?.includes(context.targetId)) score += 1.25;
  if (item.relatedConversationId === context.conversationId) score += 0.8;
  return score;
}

export function retrieveRelevantMemories(items: MemoryItem[], context: MemoryRetrievalContext) {
  return [...items]
    .sort((a, b) => scoreForContext(b, context) - scoreForContext(a, context))
    .slice(0, context.maxItems);
}
