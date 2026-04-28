import type { InteractionEventPayload, RelationshipDeltaPayload, RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';

function pairKey(actorId: string, targetId: string) {
  return `${actorId}->${targetId}`;
}

export function inferRelationshipDelta(interaction: InteractionEventPayload): RelationshipDeltaPayload | null {
  if (!interaction.targetId) return null;
  if (interaction.kind === 'support' || interaction.kind === 'defend') {
    return {
      actorId: interaction.actorId,
      targetId: interaction.targetId,
      delta: { affinity: interaction.intensity, respect: interaction.intensity },
      reason: interaction.kind,
    };
  }
  if (interaction.kind === 'challenge' || interaction.kind === 'mock' || interaction.kind === 'dismiss' || interaction.kind === 'pile_on') {
    return {
      actorId: interaction.actorId,
      targetId: interaction.targetId,
      delta: {
        hostility: interaction.intensity,
        contempt: interaction.kind === 'mock' || interaction.kind === 'dismiss' ? interaction.intensity : 0,
      },
      reason: interaction.kind,
    };
  }
  return null;
}

function scoreDirection(delta: RelationshipDeltaPayload['delta']) {
  return (delta.affinity || 0) + (delta.respect || 0) - (delta.hostility || 0) - (delta.contempt || 0);
}

function inferTrend(previous: RelationshipLedgerEntry | undefined, delta: RelationshipDeltaPayload['delta']) {
  const direction = scoreDirection(delta);
  if (!direction) return 'flat';
  if (!previous?.recentEvents.length) return direction > 0 ? 'up' : 'down';
  const recentKinds = previous.recentEvents.slice(-3).map((event) => event.kind);
  const recentPositive = recentKinds.filter((kind) => kind === 'interaction' || kind === 'relationship_delta').length;
  const recentNegative = previous.current.hostility + previous.current.contempt;
  if (direction > 0 && recentNegative > previous.current.affinity + previous.current.respect) return 'volatile';
  if (direction < 0 && recentPositive > 1 && previous.current.affinity + previous.current.respect > recentNegative) return 'volatile';
  return direction > 0 ? 'up' : 'down';
}

export function isMeaningfulRelationshipLedgerEntry(entry: RelationshipLedgerEntry) {
  return entry.current.affinity >= 8
    || entry.current.respect >= 8
    || entry.current.hostility >= 8
    || entry.current.contempt >= 8;
}

export function reduceRelationshipLedger(entries: RelationshipLedgerEntry[], interaction: InteractionEventPayload, evidenceEvent: RuntimeEventV2): RelationshipLedgerEntry[] {
  const delta = inferRelationshipDelta(interaction);
  if (!delta) return entries;
  if (interaction.intensity < 2 || interaction.confidence < 0.85) return entries;
  if (!delta.actorId || !delta.targetId || delta.actorId === delta.targetId) return entries;
  if (/^draft-\d+$/i.test(delta.actorId) || /^draft-\d+$/i.test(delta.targetId)) return entries;
  if (!interaction.evidenceText.trim() || interaction.evidenceText.trim().length < 8) return entries;
  if (interaction.kind === 'support' && interaction.intensity < 3) return entries;
  if ((interaction.kind === 'challenge' || interaction.kind === 'probe') && interaction.intensity < 3) return entries;
  const key = pairKey(delta.actorId, delta.targetId);
  const existing = entries.find((entry) => entry.pairKey === key);
  const nextCurrent = {
    affinity: Math.max(0, Math.min(100, (existing?.current.affinity || 0) + (delta.delta.affinity || 0))),
    respect: Math.max(0, Math.min(100, (existing?.current.respect || 0) + (delta.delta.respect || 0))),
    hostility: Math.max(0, Math.min(100, (existing?.current.hostility || 0) + (delta.delta.hostility || 0))),
    contempt: Math.max(0, Math.min(100, (existing?.current.contempt || 0) + (delta.delta.contempt || 0))),
  };
  const updated: RelationshipLedgerEntry = {
    pairKey: key,
    actorId: delta.actorId,
    targetId: delta.targetId,
    current: nextCurrent,
    trend: inferTrend(existing, delta.delta),
    recentEvents: [...(existing?.recentEvents || []), evidenceEvent].slice(-8),
    lastUpdatedAt: evidenceEvent.createdAt,
  };
  return existing ? entries.map((entry) => entry.pairKey === key ? updated : entry) : [...entries, updated];
}

export function getRelationshipLedgerEntry(entries: RelationshipLedgerEntry[], actorId: string, targetId: string) {
  return entries.find((entry) => entry.actorId === actorId && entry.targetId === targetId) || null;
}

export function summarizeRelationshipDelta(delta: RelationshipDeltaPayload) {
  const parts = [
    delta.delta.affinity ? `亲近 +${delta.delta.affinity}` : null,
    delta.delta.respect ? `尊重 +${delta.delta.respect}` : null,
    delta.delta.hostility ? `敌意 +${delta.delta.hostility}` : null,
    delta.delta.contempt ? `轻视 +${delta.delta.contempt}` : null,
  ].filter(Boolean);
  return parts.join(' / ') || delta.reason;
}

export function calculateRelationshipCurrent(previous: RelationshipLedgerEntry | null, delta: RelationshipDeltaPayload['delta']) {
  return {
    affinity: Math.max(0, Math.min(100, (previous?.current.affinity || 0) + (delta.affinity || 0))),
    respect: Math.max(0, Math.min(100, (previous?.current.respect || 0) + (delta.respect || 0))),
    hostility: Math.max(0, Math.min(100, (previous?.current.hostility || 0) + (delta.hostility || 0))),
    contempt: Math.max(0, Math.min(100, (previous?.current.contempt || 0) + (delta.contempt || 0))),
  };
}

export function getRelationshipDeltaDirection(delta: RelationshipDeltaPayload['delta']) {
  const score = scoreDirection(delta);
  if (!score) return 'flat';
  return score > 0 ? 'up' : 'down';
}

void calculateRelationshipCurrent;
void summarizeRelationshipDelta;
void getRelationshipDeltaDirection;
void getRelationshipLedgerEntry;
