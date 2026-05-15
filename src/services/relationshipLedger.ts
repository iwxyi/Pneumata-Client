import { toRelationshipLedgerRecentEvent, type InteractionEventPayload, type RelationshipAxisReason, type RelationshipDeltaPayload, type RelationshipLedgerEntry, type RuntimeEventV2 } from '../types/runtimeEvent';

const MAX_RELATIONSHIP_AXIS_REASONS = 6;
const MAX_RELATIONSHIP_RECENT_EVENTS = 8;

export const RELATIONSHIP_BASELINE = {
  warmth: 0,
  competence: 0,
  trust: 0,
  threat: 0,
} as const;

function pairKey(actorId: string, targetId: string) {
  return `${actorId}->${targetId}`;
}

function clampMetric(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.max(-100, Math.min(100, safeValue));
}

function clampDelta(value: number | undefined) {
  if (!value) return 0;
  return Math.max(-8, Math.min(8, value));
}

function buildBaselineCurrent() {
  return { ...RELATIONSHIP_BASELINE };
}

function hasMeaningfulEvidence(interaction: InteractionEventPayload) {
  return interaction.evidenceText.trim().length >= 8;
}

function scoreDirection(delta: RelationshipDeltaPayload['delta']) {
  return (delta.warmth || 0) + (delta.competence || 0) + (delta.trust || 0) - (delta.threat || 0);
}

function isSelfAssertiveSpeech(text: string) {
  return /我[^，。！？!?]{0,24}(什么时候|何时|才没有|从来不|怎么会|怎么可能|怕过|输过|退过)/.test(text);
}

function inferChallengeTarget(interaction: InteractionEventPayload) {
  if (!interaction.targetId) return interaction.targetId;
  if (isSelfAssertiveSpeech(interaction.evidenceText)) return interaction.actorId;
  return interaction.targetId;
}

export function normalizeCurrent(current?: Partial<RelationshipLedgerEntry['current']> | null) {
  const baseline = buildBaselineCurrent();
  return {
    warmth: clampMetric(typeof current?.warmth === 'number' ? current.warmth : baseline.warmth),
    competence: clampMetric(typeof current?.competence === 'number' ? current.competence : baseline.competence),
    trust: clampMetric(typeof current?.trust === 'number' ? current.trust : baseline.trust),
    threat: clampMetric(typeof current?.threat === 'number' ? current.threat : baseline.threat),
  };
}

function normalizeRuntimeEntryForComputation(entry: RelationshipLedgerEntry | undefined) {
  if (!entry) return undefined;
  return {
    ...entry,
    current: normalizeCurrent(entry.current),
  };
}

export function normalizeRelationshipLedgerEntry(entry: RelationshipLedgerEntry): RelationshipLedgerEntry {
  return {
    ...entry,
    current: normalizeCurrent(entry.current),
  };
}

export function createBaselineRelationshipCurrent() {
  return buildBaselineCurrent();
}

function getCurrentOrBaseline(previous: RelationshipLedgerEntry | null | undefined) {
  return previous?.current || buildBaselineCurrent();
}

function roundDisplayValue(value: number) {
  return Math.round(value);
}

export function roundRelationshipDisplayValue(value: number) {
  return roundDisplayValue(value);
}

export function formatRelationshipNumber(value: number) {
  return String(roundDisplayValue(Number.isFinite(value) ? value : 0));
}

export function formatSignedRelationshipNumber(value: number) {
  const rounded = roundDisplayValue(Number.isFinite(value) ? value : 0);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

export function toRelationshipDisplayDelta(current: RelationshipLedgerEntry['current']) {
  const normalized = normalizeCurrent(current);
  return {
    warmth: roundDisplayValue(normalized.warmth),
    competence: roundDisplayValue(normalized.competence),
    trust: roundDisplayValue(normalized.trust),
    threat: roundDisplayValue(normalized.threat),
  };
}

function dampenTowardSaturation(current: number, delta: number) {
  const saturation = Math.max(0.45, 1 - Math.abs(current) / 140);
  return delta > 0 ? delta * saturation : delta * Math.max(0.55, 1 - Math.abs(current) / 160);
}

function buildAxisReason(axis: RelationshipAxisReason['axis'], value: number, reason: string, evidence: string, createdAt?: number): RelationshipAxisReason {
  return { axis, value, reason, evidence, createdAt };
}

function buildAxisReasons(interaction: InteractionEventPayload, delta: RelationshipDeltaPayload['delta'], createdAt?: number): RelationshipDeltaPayload['axisReasons'] {
  const reasons: NonNullable<RelationshipDeltaPayload['axisReasons']> = {};
  (['warmth', 'competence', 'trust', 'threat'] as const).forEach((axis) => {
    const value = delta[axis] || 0;
    if (!value) return;
    reasons[axis] = [buildAxisReason(axis, value, interaction.kind, interaction.evidenceText, createdAt)];
  });
  return reasons;
}

function appendAxisReasons(previous: RelationshipLedgerEntry | undefined, next: RelationshipDeltaPayload['axisReasons']) {
  const merged: NonNullable<RelationshipLedgerEntry['axisReasons']> = {
    warmth: [...(previous?.axisReasons?.warmth || []), ...(next?.warmth || [])].slice(-MAX_RELATIONSHIP_AXIS_REASONS),
    competence: [...(previous?.axisReasons?.competence || []), ...(next?.competence || [])].slice(-MAX_RELATIONSHIP_AXIS_REASONS),
    trust: [...(previous?.axisReasons?.trust || []), ...(next?.trust || [])].slice(-MAX_RELATIONSHIP_AXIS_REASONS),
    threat: [...(previous?.axisReasons?.threat || []), ...(next?.threat || [])].slice(-MAX_RELATIONSHIP_AXIS_REASONS),
  };
  return merged;
}

function computeDerived(entry: RelationshipLedgerEntry | undefined, current: RelationshipLedgerEntry['current'], axisReasons: NonNullable<RelationshipLedgerEntry['axisReasons']>) {
  const previous = entry?.current;
  const totalMovement = Math.abs(current.warmth) + Math.abs(current.competence) + Math.abs(current.trust) + Math.abs(current.threat);
  const volatility = previous
    ? Math.abs(current.warmth - previous.warmth) + Math.abs(current.competence - previous.competence) + Math.abs(current.trust - previous.trust) + Math.abs(current.threat - previous.threat)
    : totalMovement;
  return {
    stability: Math.max(0, Math.min(100, 100 - volatility * 4)),
    reciprocity: entry?.derived?.reciprocity ?? 0,
    salience: Math.max(0, Math.min(100, totalMovement + Object.values(axisReasons).flat().length * 4)),
  };
}

export function buildRelationshipDisplaySummary(entry: RelationshipLedgerEntry) {
  const delta = toRelationshipDisplayDelta(entry.current);
  const dimensions = [
    { label: '亲和', value: delta.warmth },
    { label: '能力判断', value: delta.competence },
    { label: '信任', value: delta.trust },
    { label: '威胁感', value: delta.threat },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const lead = dimensions[0];
  if (!lead || Math.abs(lead.value) < 4) return '中性';
  return `${lead.label}${lead.value > 0 ? '偏高' : '偏低'}`;
}

export function buildRelationshipEvidenceText(entry: RelationshipLedgerEntry) {
  const summary = entry.recentEvents.at(-1)?.summary || '';
  return summary
    .replace(/^[^\s]+\s(?:support|challenge|mock|dismiss|defend|evade|probe|pile_on|redirect|side_comment)(?:\s→\s[^\s]+)?\s*/, '')
    .replace(/^[:：\-\s]+/, '')
    .trim();
}

export function getDominantRelationshipSummary(current: RelationshipLedgerEntry['current']) {
  return buildRelationshipDisplaySummary({ pairKey: '', actorId: '', targetId: '', current, derived: {}, axisReasons: {}, trend: 'flat', recentEvents: [], lastUpdatedAt: 0 });
}

function passesInteractionGate(interaction: InteractionEventPayload, delta: RelationshipDeltaPayload | null) {
  if (!delta) return false;
  if (interaction.intensity < 2 || interaction.confidence < 0.85) return false;
  if (!delta.actorId || !delta.targetId || delta.actorId === delta.targetId) return false;
  if (/^draft-\d+$/i.test(delta.actorId) || /^draft-\d+$/i.test(delta.targetId)) return false;
  if (!hasMeaningfulEvidence(interaction)) return false;
  if (interaction.kind === 'support' && interaction.intensity < 3) return false;
  if ((interaction.kind === 'challenge' || interaction.kind === 'probe') && interaction.intensity < 3) return false;
  return true;
}

export function inferRelationshipDelta(interaction: InteractionEventPayload): RelationshipDeltaPayload | null {
  if (!interaction.targetId) return null;
  if (interaction.kind === 'support' || interaction.kind === 'defend') {
    const warmth = interaction.intensity + (interaction.tone === 'warm' ? 1 : 0);
    const trust = interaction.intensity + (interaction.confidence >= 0.92 ? 1 : 0);
    const competence = interaction.kind === 'defend' ? 1 + (interaction.tone === 'excited' ? 1 : 0) : (interaction.tone === 'warm' ? 1 : 0);
    const delta = { warmth, competence, trust, threat: 0 };
    return {
      actorId: interaction.actorId,
      targetId: interaction.targetId,
      delta,
      reason: interaction.kind,
      axisReasons: buildAxisReasons(interaction, delta),
      spikeType: interaction.intensity >= 5 ? 'bonding' : 'normal',
    };
  }
  if (interaction.kind === 'challenge' || interaction.kind === 'probe') {
    const targetId = inferChallengeTarget(interaction) || interaction.targetId;
    const selfAssertive = isSelfAssertiveSpeech(interaction.evidenceText);
    const delta = {
      warmth: interaction.kind === 'probe' ? 0 : (interaction.tone === 'annoyed' ? -1 : 0),
      threat: interaction.intensity + (interaction.tone === 'cold' ? 1 : 0),
      competence: interaction.kind === 'probe' ? 0 : (selfAssertive ? -1 : (interaction.tone === 'excited' ? 2 : 1)),
      trust: interaction.kind === 'probe' ? -(1 + (interaction.confidence >= 0.92 ? 1 : 0)) : (selfAssertive ? -2 : -1),
    };
    return {
      actorId: interaction.actorId,
      targetId,
      delta,
      reason: interaction.kind,
      axisReasons: buildAxisReasons(interaction, delta),
      spikeType: interaction.intensity >= 5 ? 'turning_point' : 'normal',
    };
  }
  if (interaction.kind === 'mock' || interaction.kind === 'dismiss' || interaction.kind === 'pile_on') {
    const delta = {
      warmth: -(interaction.intensity + (interaction.tone === 'sarcastic' ? 1 : 0)),
      competence: interaction.kind === 'dismiss' ? -1 : 0,
      trust: -(interaction.intensity + (interaction.kind === 'pile_on' ? 1 : 0)),
      threat: interaction.intensity + (interaction.kind === 'mock' || interaction.kind === 'dismiss' ? 1 : 0),
    };
    return {
      actorId: interaction.actorId,
      targetId: interaction.targetId,
      delta,
      reason: interaction.kind,
      axisReasons: buildAxisReasons(interaction, delta),
      spikeType: interaction.intensity >= 5 ? 'rupture' : 'normal',
    };
  }
  return null;
}

function inferTrend(previous: RelationshipLedgerEntry | undefined, delta: RelationshipDeltaPayload['delta']) {
  const direction = scoreDirection(delta);
  if (!direction) return 'flat';
  if (!previous?.recentEvents.length) return direction > 0 ? 'up' : 'down';
  const recentKinds = previous.recentEvents.slice(-3).map((event) => event.kind);
  const recentPositive = recentKinds.filter((kind) => kind === 'interaction' || kind === 'relationship_delta').length;
  const recentNegative = previous.current.threat;
  if (direction > 0 && recentNegative > previous.current.warmth + previous.current.trust) return 'volatile';
  if (direction < 0 && recentPositive > 1 && previous.current.warmth + previous.current.trust > recentNegative) return 'volatile';
  return direction > 0 ? 'up' : 'down';
}

export function isMeaningfulRelationshipLedgerEntry(entry: RelationshipLedgerEntry) {
  const normalized = normalizeRelationshipLedgerEntry(entry);
  const delta = toRelationshipDisplayDelta(normalized.current);
  return delta.warmth !== 0
    || delta.competence !== 0
    || delta.trust !== 0
    || delta.threat !== 0;
}

function buildNextTrust(current: RelationshipLedgerEntry['current'], delta: RelationshipDeltaPayload['delta']) {
  return clampMetric(current.trust + dampenTowardSaturation(current.trust, clampDelta(delta.trust)));
}

function applyContradictionCheck(previous: RelationshipLedgerEntry | undefined, nextCurrent: RelationshipLedgerEntry['current']) {
  if (!previous) return nextCurrent;
  if (nextCurrent.warmth + nextCurrent.competence + nextCurrent.trust > 210 && nextCurrent.threat > 60) {
    return {
      ...nextCurrent,
      threat: clampMetric(nextCurrent.threat - 8),
    };
  }
  return nextCurrent;
}

export function reduceRelationshipLedger(entries: RelationshipLedgerEntry[], interaction: InteractionEventPayload, evidenceEvent: RuntimeEventV2): RelationshipLedgerEntry[] {
  const maybeDelta = inferRelationshipDelta(interaction);
  if (!passesInteractionGate(interaction, maybeDelta) || !maybeDelta) return entries;
  const delta = maybeDelta;
  const key = pairKey(delta.actorId, delta.targetId);
  const existing = entries.find((entry) => entry.pairKey === key);
  const normalizedExisting = normalizeRuntimeEntryForComputation(existing);
  const current = getCurrentOrBaseline(normalizedExisting);
  const nextCurrent = applyContradictionCheck(normalizedExisting, {
    warmth: clampMetric(current.warmth + dampenTowardSaturation(current.warmth, clampDelta(delta.delta.warmth))),
    competence: clampMetric(current.competence + dampenTowardSaturation(current.competence, clampDelta(delta.delta.competence))),
    trust: buildNextTrust(current, delta.delta),
    threat: clampMetric(current.threat + dampenTowardSaturation(current.threat, clampDelta(delta.delta.threat))),
  });
  const axisReasons = appendAxisReasons(normalizedExisting, delta.axisReasons);
  const updated: RelationshipLedgerEntry = {
    pairKey: key,
    actorId: delta.actorId,
    targetId: delta.targetId,
    current: nextCurrent,
    derived: computeDerived(normalizedExisting, nextCurrent, axisReasons),
    axisReasons,
    trend: inferTrend(normalizedExisting, delta.delta),
    recentEvents: [...(normalizedExisting?.recentEvents || []), toRelationshipLedgerRecentEvent(evidenceEvent)].slice(-MAX_RELATIONSHIP_RECENT_EVENTS),
    lastUpdatedAt: evidenceEvent.createdAt,
  };
  return existing ? entries.map((entry) => entry.pairKey === key ? updated : entry) : [...entries, updated];
}

export function getRelationshipLedgerEntry(entries: RelationshipLedgerEntry[], actorId: string, targetId: string) {
  return entries.find((entry) => entry.actorId === actorId && entry.targetId === targetId) || null;
}

export function summarizeRelationshipDelta(delta: RelationshipDeltaPayload) {
  const ranked = [
    { label: '亲和', value: delta.delta.warmth || 0 },
    { label: '能力判断', value: delta.delta.competence || 0 },
    { label: '信任', value: delta.delta.trust || 0 },
    { label: '威胁感', value: delta.delta.threat || 0 },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const lead = ranked[0];
  return lead ? `${lead.label} ${formatSignedRelationshipNumber(lead.value)}` : delta.reason;
}

export function calculateRelationshipCurrent(previous: RelationshipLedgerEntry | null, delta: RelationshipDeltaPayload['delta']) {
  const normalizedPrevious = normalizeRuntimeEntryForComputation(previous || undefined);
  const current = getCurrentOrBaseline(normalizedPrevious);
  return {
    warmth: clampMetric(current.warmth + dampenTowardSaturation(current.warmth, clampDelta(delta.warmth))),
    competence: clampMetric(current.competence + dampenTowardSaturation(current.competence, clampDelta(delta.competence))),
    trust: buildNextTrust(current, delta),
    threat: clampMetric(current.threat + dampenTowardSaturation(current.threat, clampDelta(delta.threat))),
  };
}

export function replayRelationshipLedger(interactions: Array<{ interaction: InteractionEventPayload; event: RuntimeEventV2 }>) {
  return interactions.reduce<RelationshipLedgerEntry[]>((entries, item) => reduceRelationshipLedger(entries, item.interaction, item.event), []);
}

export function getRelationshipDeltaDirection(delta: RelationshipDeltaPayload['delta']) {
  const score = scoreDirection(delta);
  if (!score) return 'flat';
  return score > 0 ? 'up' : 'down';
}
