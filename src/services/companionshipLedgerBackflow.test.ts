import { describe, expect, it } from 'vitest';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import { reduceRelationshipLedgerWithCompanionshipEvent } from './companionshipLedgerBackflow';

function event(overrides: Partial<RuntimeEventV2>): RuntimeEventV2 {
  return {
    id: 'evt-companionship',
    conversationId: 'chat-1',
    kind: 'artifact',
    createdAt: 1_000,
    actorIds: ['user'],
    targetIds: ['char-a'],
    summary: '陪伴事件',
    eventClass: 'artifact',
    visibility: 'pair_private',
    payload: {},
    ...overrides,
  };
}

function ledgerEntry(): RelationshipLedgerEntry {
  return {
    pairKey: 'char-a->user',
    actorId: 'char-a',
    targetId: 'user',
    current: { warmth: 20, competence: 0, trust: 18, threat: 2 },
    derived: {},
    axisReasons: {},
    trend: 'flat',
    recentEvents: [],
    lastUpdatedAt: 900,
  };
}

describe('companionshipLedgerBackflow', () => {
  it('writes different relationship ledger effects for secret misunderstanding and intentional breach', () => {
    const misunderstanding = event({
      id: 'evt-secret-misunderstanding',
      payload: {
        eventType: 'companionship_shared_secret',
        characterId: 'char-a',
        userId: 'user',
        secretId: 'secret-1',
        action: 'leaked',
        consequenceKind: 'misunderstanding',
        participantIds: ['char-a', 'user'],
        privateText: '误会造成的小秘密泄露。',
      },
    });
    const breach = event({
      id: 'evt-secret-breach',
      payload: {
        eventType: 'companionship_shared_secret',
        characterId: 'char-a',
        userId: 'user',
        secretId: 'secret-2',
        action: 'leaked',
        consequenceKind: 'intentional_breach',
        participantIds: ['char-a', 'user'],
        privateText: '主动越界造成的小秘密泄露。',
      },
    });

    const afterMisunderstanding = reduceRelationshipLedgerWithCompanionshipEvent([ledgerEntry()], misunderstanding)[0];
    const afterBreach = reduceRelationshipLedgerWithCompanionshipEvent([ledgerEntry()], breach)[0];

    expect(afterMisunderstanding.current.trust).toBeGreaterThan(afterBreach.current.trust);
    expect(afterMisunderstanding.current.threat).toBeLessThan(afterBreach.current.threat);
    expect(afterBreach.recentEvents[0]).toMatchObject({ id: 'evt-secret-breach', kind: 'relationship_delta' });
  });

  it('backs fulfilled promises and conflict repair into the relationship ledger without duplicating events', () => {
    const promise = event({
      id: 'evt-promise-fulfilled',
      payload: {
        eventType: 'companionship_promise',
        characterId: 'char-a',
        userId: 'user',
        promiseId: 'promise-1',
        promiseText: '以后吵架先说开。',
        action: 'fulfilled',
        promiseKind: 'repair_agreement',
      },
    });
    const repair = event({
      id: 'evt-conflict-resolved',
      createdAt: 1_100,
      payload: {
        eventType: 'companionship_intimate_conflict',
        characterId: 'char-a',
        userId: 'user',
        action: 'resolved',
        kind: 'reconciliation',
        participantIds: ['char-a', 'user'],
      },
    });

    const afterPromise = reduceRelationshipLedgerWithCompanionshipEvent([ledgerEntry()], promise);
    const afterRepair = reduceRelationshipLedgerWithCompanionshipEvent(afterPromise, repair);
    const afterDuplicate = reduceRelationshipLedgerWithCompanionshipEvent(afterRepair, repair);
    const entry = afterDuplicate[0];

    expect(entry.current.warmth).toBeGreaterThan(ledgerEntry().current.warmth);
    expect(entry.current.trust).toBeGreaterThan(ledgerEntry().current.trust);
    expect(entry.current.threat).toBeLessThan(ledgerEntry().current.threat);
    expect(entry.recentEvents.map((item) => item.id)).toEqual(['evt-promise-fulfilled', 'evt-conflict-resolved']);
  });
});
