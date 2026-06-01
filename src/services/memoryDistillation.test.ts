import { describe, expect, it } from 'vitest';
import { buildMemoryDistillationRuntimePayload, describeMemoryDistillationStrategy, distillChatMemoryCandidates, explainMemoryDistillationMerge, type MemoryDistillationDebugInfo } from './memoryDistillation';
import type { GroupChat } from '../types/chat';
import type { MemoryItem } from './memoryTypes';

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

  it('projects member names before writing distilled long-term memory candidates', () => {
    const actorId = '3c78729f-e52d-4dde-b27f-01a949960bb8b';
    const targetId = '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321';
    const memories = Array.from({ length: 6 }, (_, index): MemoryItem => ({
      id: `memory-${index}`,
      scope: 'relationship',
      layer: 'episodic',
      kind: index % 2 ? 'bond' : 'resentment',
      ownerId: 'chat-1',
      subjectIds: [actorId, targetId],
      text: `${actorId} → ${targetId} 支持：${actorId} 记得 ${targetId} 上次帮过忙`,
      salience: 0.7,
      confidence: 0.8,
      recency: 0.8,
      reinforcementCount: 1,
      sourceEventIds: [`event-${index}`],
      sourceTag: 'interaction',
      origin: 'runtime',
      createdAt: index,
      updatedAt: index + 1,
    }));

    const candidates = distillChatMemoryCandidates({
      id: 'chat-1',
      name: '羊村大家庭闲聊',
      layeredMemories: memories,
    } as GroupChat, [
      { id: actorId, name: '喜羊羊' },
      { id: targetId, name: '沸羊羊' },
    ]);
    const text = candidates.map((item) => item.text).join(' / ');

    expect(text).toContain('喜羊羊');
    expect(text).toContain('沸羊羊');
    expect(text).not.toContain(actorId);
    expect(text).not.toContain(targetId);
    expect(text).not.toContain('0喜羊羊');
  });

  it('does not distill raw runtime relationship delta evidence as settled memory', () => {
    const memories = Array.from({ length: 6 }, (_, index): MemoryItem => ({
      id: `runtime-delta-${index}`,
      scope: 'relationship',
      layer: 'episodic',
      kind: index % 2 ? 'bond' : 'resentment',
      ownerId: 'chat-1',
      subjectIds: ['char-a', 'char-b'],
      text: `甲 触发关系变化：甲→乙 信任-${index + 1}｜88%`,
      salience: 0.9,
      confidence: 0.9,
      recency: 0.9,
      reinforcementCount: 1,
      sourceEventIds: [`event-${index}`],
      sourceTag: 'relationship_delta',
      origin: 'runtime',
      createdAt: index,
      updatedAt: index + 1,
    }));

    expect(distillChatMemoryCandidates({
      id: 'chat-1',
      name: '群聊',
      layeredMemories: memories,
    } as GroupChat)).toEqual([]);
  });

  it('uses injected now for distilledAt determinism', () => {
    const actorId = 'char-a';
    const targetId = 'char-b';
    const memories = Array.from({ length: 6 }, (_, index): MemoryItem => ({
      id: `memory-${index}`,
      scope: 'relationship',
      layer: 'episodic',
      kind: index % 2 ? 'bond' : 'resentment',
      ownerId: 'chat-1',
      subjectIds: [actorId, targetId],
      text: `${actorId} → ${targetId} 支持`,
      salience: 0.7,
      confidence: 0.8,
      recency: 0.8,
      reinforcementCount: 1,
      sourceEventIds: [`event-${index}`],
      sourceTag: 'interaction',
      origin: 'runtime',
      createdAt: index,
      updatedAt: index + 1,
    }));
    const result = distillChatMemoryCandidates({
      id: 'chat-1',
      name: '群聊',
      layeredMemories: memories,
    } as GroupChat, [], { now: 1777000000000 });

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.distilledAt === 1777000000000)).toBe(true);
  });
});
