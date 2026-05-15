import { describe, expect, it } from 'vitest';
import type { InteractionEventPayload, RuntimeEventV2 } from '../types/runtimeEvent';
import { RELATIONSHIP_BASELINE, reduceRelationshipLedger, replayRelationshipLedger } from './relationshipLedger';

function buildEvent(interaction: InteractionEventPayload): RuntimeEventV2 {
  return {
    id: `evt-${interaction.actorId}-${interaction.targetId}`,
    conversationId: 'chat-1',
    kind: 'interaction',
    createdAt: Date.now(),
    actorIds: [interaction.actorId],
    targetIds: interaction.targetId ? [interaction.targetId] : undefined,
    summary: interaction.evidenceText,
    visibility: 'public',
    payload: interaction,
  };
}

describe('relationshipLedger', () => {
  it('tracks trust and tension for meaningful interactions', () => {
    const interaction: InteractionEventPayload = {
      kind: 'support',
      actorId: 'a',
      targetId: 'b',
      intensity: 4,
      tone: 'warm',
      evidenceText: '我支持你刚才那个更具体的方案。',
      confidence: 0.92,
    };

    const result = reduceRelationshipLedger([], interaction, buildEvent(interaction));
    expect(result).toHaveLength(1);
    expect(result[0].current.warmth).toBe(5);
    expect(result[0].current.competence).toBe(1);
    expect(result[0].current.trust).toBeGreaterThanOrEqual(5);
    expect(result[0].current.threat).toBe(0);
  });

  it('starts new runtime ledger entries from the shared neutral baseline', () => {
    const interaction: InteractionEventPayload = {
      kind: 'challenge',
      actorId: 'a',
      targetId: 'b',
      intensity: 3,
      tone: 'cold',
      evidenceText: '这个推断我不同意，证据还不够。',
      confidence: 0.9,
    };

    const result = reduceRelationshipLedger([], interaction, buildEvent(interaction));
    expect(result[0].current.warmth).toBe(0);
    expect(result[0].current.competence).toBe(1);
    expect(result[0].current.threat).toBe(4);
    expect(result[0].current.trust).toBe(-1);
  });

  it('normalizes legacy zero-based runtime entries before applying new deltas', () => {
    const interaction: InteractionEventPayload = {
      kind: 'support',
      actorId: 'a',
      targetId: 'b',
      intensity: 3,
      tone: 'warm',
      evidenceText: '这个方向我支持，继续往下拆。',
      confidence: 0.94,
    };

    const result = reduceRelationshipLedger([{
      pairKey: 'a->b',
      actorId: 'a',
      targetId: 'b',
      current: { warmth: 0, competence: 0, trust: 0, threat: 0 },
      trend: 'flat',
      recentEvents: [],
      lastUpdatedAt: 1,
    }], interaction, buildEvent(interaction));

    expect(result[0].current.warmth).toBe(4);
    expect(result[0].current.competence).toBe(1);
    expect(result[0].current.trust).toBe(4);
  });

  it('rejects weak or low-confidence interactions', () => {
    const interaction: InteractionEventPayload = {
      kind: 'support',
      actorId: 'a',
      targetId: 'b',
      intensity: 1,
      tone: 'warm',
      evidenceText: '行。',
      confidence: 0.4,
    };

    const result = reduceRelationshipLedger([], interaction, buildEvent(interaction));
    expect(result).toEqual([]);
  });

  it('replays ledger deterministically from interaction history', () => {
    const first: InteractionEventPayload = {
      kind: 'support', actorId: 'a', targetId: 'b', intensity: 4, tone: 'warm', evidenceText: '这个点我站你。', confidence: 0.93,
    };
    const second: InteractionEventPayload = {
      kind: 'challenge', actorId: 'a', targetId: 'b', intensity: 4, tone: 'annoyed', evidenceText: '但你后面这句我不同意。', confidence: 0.91,
    };

    const replayed = replayRelationshipLedger([
      { interaction: first, event: buildEvent(first) },
      { interaction: second, event: buildEvent(second) },
    ]);

    expect(replayed).toHaveLength(1);
    expect(replayed[0].current.threat).toBeGreaterThan(0);
    expect(['down', 'volatile']).toContain(replayed[0].trend);
  });

  it('stores only lightweight recent event snapshots in relationship ledger', () => {
    const interaction: InteractionEventPayload = {
      kind: 'challenge',
      actorId: 'a',
      targetId: 'b',
      intensity: 4,
      tone: 'annoyed',
      evidenceText: '你这句我不同意，而且理由站不住。',
      confidence: 0.93,
    };

    const heavyEvent: RuntimeEventV2 = {
      ...buildEvent(interaction),
      payload: {
        ...interaction,
        giant: 'x'.repeat(50_000),
      },
    };

    const result = reduceRelationshipLedger([], interaction, heavyEvent);
    const recentEvent = result[0]?.recentEvents[0];
    expect(recentEvent).toEqual({
      id: heavyEvent.id,
      kind: heavyEvent.kind,
      createdAt: heavyEvent.createdAt,
      summary: heavyEvent.summary,
      actorIds: heavyEvent.actorIds,
      targetIds: heavyEvent.targetIds,
    });
    expect(JSON.stringify(recentEvent).length).toBeLessThan(500);
  });
});
