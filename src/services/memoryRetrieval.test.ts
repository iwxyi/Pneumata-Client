import { describe, expect, it } from 'vitest';
import { retrieveRelevantMemories } from './memoryRetrieval';
import type { MemoryItem } from './memoryTypes';

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: overrides.id || 'memory-1',
    scope: overrides.scope || 'relationship',
    layer: overrides.layer || 'long_term',
    kind: overrides.kind || 'resentment',
    ownerId: overrides.ownerId || 'char-a',
    subjectIds: overrides.subjectIds || ['char-b'],
    text: overrides.text || '甲记得乙曾在公开场合让自己下不来台。',
    salience: overrides.salience ?? 0.8,
    confidence: overrides.confidence ?? 0.8,
    recency: overrides.recency ?? 0.2,
    reinforcementCount: overrides.reinforcementCount ?? 2,
    sourceEventIds: overrides.sourceEventIds || ['event-1'],
    sourceTag: overrides.sourceTag || 'memory_distillation',
    origin: overrides.origin || 'distilled',
    distilledFromIds: overrides.distilledFromIds || [],
    distilledAt: overrides.distilledAt || null,
    distillationVersion: overrides.distillationVersion || null,
    createdAt: overrides.createdAt || 1,
    updatedAt: overrides.updatedAt || 1,
    lastActivatedAt: overrides.lastActivatedAt || null,
    archivedAt: overrides.archivedAt || null,
    evidenceText: overrides.evidenceText,
    summary: overrides.summary,
    relatedConversationId: overrides.relatedConversationId,
  };
}

describe('retrieveRelevantMemories', () => {
  it('does not recall archived memories without a cue', () => {
    const result = retrieveRelevantMemories([
      memory({ id: 'archived', archivedAt: 10, text: '甲记得乙曾在雨夜失约。' }),
    ], {
      speakerId: 'char-a',
      targetId: 'char-b',
      conversationId: 'chat-1',
      maxItems: 4,
    });

    expect(result).toHaveLength(0);
  });

  it('recalls archived memories when the current cue matches the old event', () => {
    const result = retrieveRelevantMemories([
      memory({ id: 'archived', archivedAt: 10, text: '甲记得乙曾在雨夜失约。' }),
      memory({ id: 'active', text: '甲最近对乙保持礼貌距离。', recency: 1 }),
    ], {
      speakerId: 'char-a',
      targetId: 'char-b',
      conversationId: 'chat-1',
      maxItems: 4,
      cueText: '今天又下雨了，你还会失约吗',
      includeArchivedRecall: true,
    });

    expect(result.some((item) => item.id === 'archived')).toBe(true);
    expect(result.find((item) => item.id === 'archived')?.recallReason).toContain('线索唤醒');
    expect(result.find((item) => item.id === 'archived')?.recallTokens).toContain('失约');
  });

  it('excludes raw runtime evidence from normal retrieval unless explicitly requested', () => {
    const runtimeEvidence = memory({
      id: 'runtime-relationship-delta',
      layer: 'episodic',
      sourceTag: 'relationship_delta',
      origin: 'runtime',
      text: '甲 触发关系变化：甲→乙 信任-3｜88%',
      salience: 1,
      confidence: 1,
      recency: 1,
    });
    const settledMemory = memory({
      id: 'settled',
      text: '甲记得乙曾在公开场合让自己下不来台。',
      salience: 0.7,
      confidence: 0.7,
      recency: 0.7,
    });
    const baseContext = {
      speakerId: 'char-a',
      targetId: 'char-b',
      conversationId: 'chat-1',
      maxItems: 4,
    };

    expect(retrieveRelevantMemories([runtimeEvidence, settledMemory], baseContext).map((item) => item.id)).toEqual(['settled']);
    expect(retrieveRelevantMemories([runtimeEvidence, settledMemory], {
      ...baseContext,
      includeRuntimeEvidence: true,
    }).map((item) => item.id)).toContain('runtime-relationship-delta');
  });

  it('excludes legacy emotional and personality runtime entries from normal retrieval', () => {
    const emotional = memory({
      id: 'emotional-state',
      scope: 'character_self',
      layer: 'working',
      sourceTag: 'emotional_state',
      text: '当前情绪偏高：irritation80',
      salience: 1,
      confidence: 1,
      recency: 1,
    });
    const drift = memory({
      id: 'personality-drift',
      scope: 'character_self',
      layer: 'episodic',
      sourceTag: 'personality_drift',
      text: '性格出现漂移：neuroticism+12',
      salience: 1,
      confidence: 1,
      recency: 1,
    });

    const result = retrieveRelevantMemories([emotional, drift], {
      speakerId: 'char-a',
      targetId: null,
      conversationId: 'chat-1',
      maxItems: 4,
    });

    expect(result).toEqual([]);
  });
});
