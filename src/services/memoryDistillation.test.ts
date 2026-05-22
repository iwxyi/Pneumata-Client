import { describe, expect, it } from 'vitest';
import { buildMemoryDistillationRuntimePayload, describeMemoryDistillationStrategy, explainMemoryDistillationMerge, type MemoryDistillationDebugInfo } from './memoryDistillation';

function debugInfo(overrides: Partial<MemoryDistillationDebugInfo> = {}): MemoryDistillationDebugInfo {
  return {
    ownerType: 'chat',
    ownerId: 'chat-1',
    ownerName: '羊村大家庭闲聊',
    triggered: true,
    reason: 'distilled',
    eligibleCount: 6,
    newEvidenceCount: 6,
    candidateTexts: ['灰太狼和沸羊羊的关系有了稳定沉淀'],
    ...overrides,
  };
}

describe('memoryDistillation display payload', () => {
  it('uses readable merge and strategy labels instead of bucket wording', () => {
    const payload = buildMemoryDistillationRuntimePayload(debugInfo());

    expect(payload.mergeMode).toBe('reinforce_same_bucket');
    expect(payload.mergeModeLabel).toBe('同类证据强化合并');
    expect(payload.note).not.toContain('bucket');
    expect(payload.strategy).not.toContain('layeredMemories');
    expect(explainMemoryDistillationMerge()).not.toContain('bucket');
    expect(describeMemoryDistillationStrategy()).not.toContain('long_term');
  });
});
