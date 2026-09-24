import { toRelationshipLedgerRecentEvent, type InteractionEventPayload, type RelationshipAxes, type RelationshipAxisReason, type RelationshipDeltaPayload, type RelationshipLedgerEntry, type RuntimeEventV2 } from '../types/runtimeEvent';
import type { AICharacter } from '../types/character';

const MAX_RELATIONSHIP_AXIS_REASONS = 6;
const MAX_RELATIONSHIP_RECENT_EVENTS = 8;
const RELATIONSHIP_MIN_CONFIDENCE = 0.85;
const RELATIONSHIP_MIN_INTENSITY = 2;

export const RELATIONSHIP_BASELINE = {
  warmth: 0,
  competence: 0,
  trust: 0,
  threat: 0,
  attachment: 0,
  deference: 0,
} as const;

function pairKey(actorId: string, targetId: string) {
  return `${actorId}->${targetId}`;
}

function clampMetric(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.max(-100, Math.min(100, safeValue));
}

function clampDelta(value: number | undefined, limit = 8) {
  if (!value) return 0;
  return Math.max(-limit, Math.min(limit, value));
}

function buildBaselineCurrent(): RelationshipAxes {
  return { ...RELATIONSHIP_BASELINE };
}

function normalizeAxes(value?: Partial<RelationshipAxes> | null): RelationshipAxes {
  const baseline = buildBaselineCurrent();
  return {
    warmth: clampMetric(typeof value?.warmth === 'number' ? value.warmth : baseline.warmth),
    competence: clampMetric(typeof value?.competence === 'number' ? value.competence : baseline.competence),
    trust: clampMetric(typeof value?.trust === 'number' ? value.trust : baseline.trust),
    threat: clampMetric(typeof value?.threat === 'number' ? value.threat : baseline.threat),
    attachment: clampMetric(typeof value?.attachment === 'number' ? value.attachment : baseline.attachment || 0),
    deference: clampMetric(typeof value?.deference === 'number' ? value.deference : baseline.deference || 0),
  };
}

export function resolveEffectiveRelationshipAxes(baseline: RelationshipAxes, adjustment: RelationshipAxes): RelationshipAxes {
  return {
    warmth: clampMetric(baseline.warmth + adjustment.warmth),
    competence: clampMetric(baseline.competence + adjustment.competence),
    trust: clampMetric(baseline.trust + adjustment.trust),
    threat: clampMetric(baseline.threat + adjustment.threat),
    attachment: clampMetric((baseline.attachment || 0) + (adjustment.attachment || 0)),
    deference: clampMetric((baseline.deference || 0) + (adjustment.deference || 0)),
  };
}

function hasMeaningfulEvidence(interaction: InteractionEventPayload) {
  return interaction.evidenceText.trim().length >= 8;
}

function scoreDirection(delta: RelationshipDeltaPayload['delta']) {
  return (delta.warmth || 0) + (delta.competence || 0) + (delta.trust || 0) - (delta.threat || 0) + (delta.attachment || 0) * 0.35 - (delta.deference || 0) * 0.1;
}

export function normalizeCurrent(current?: Partial<RelationshipLedgerEntry['current']> | null) {
  return normalizeAxes(current);
}

function normalizeRuntimeEntryForComputation(entry: RelationshipLedgerEntry | undefined) {
  if (!entry) return undefined;
  return {
    ...entry,
    current: normalizeCurrent(entry.current),
  };
}

export function normalizeRelationshipLedgerEntry(entry: RelationshipLedgerEntry): RelationshipLedgerEntry {
  // Legacy entries stored only the final current value. Preserve that value
  // as their frozen baseline rather than inventing an adjustment history.
  const baseline = entry.baseline ? normalizeAxes(entry.baseline) : normalizeAxes(entry.current);
  const adjustment = entry.baseline ? normalizeAxes(entry.adjustment) : buildBaselineCurrent();
  const current = resolveEffectiveRelationshipAxes(baseline, adjustment);
  const axisReasons = entry.axisReasons || {};
  const recentEvents = Array.isArray(entry.recentEvents) ? entry.recentEvents.filter(Boolean) : [];
  const trend = entry.trend === 'up' || entry.trend === 'down' || entry.trend === 'volatile' || entry.trend === 'flat'
    ? entry.trend
    : 'flat';
  const lastUpdatedAt = Number.isFinite(entry.lastUpdatedAt) ? entry.lastUpdatedAt : 0;
  return {
    ...entry,
    baseline,
    adjustment,
    current,
    axisReasons,
    trend,
    recentEvents,
    lastUpdatedAt,
    derived: {
      ...(entry.derived || {}),
      semantic: entry.derived?.semantic || buildRelationshipSemanticProfile(current, axisReasons),
    },
  };
}

/**
 * Rebase a room ledger onto freshly inferred character defaults without
 * discarding room-local changes accumulated in `adjustment`.
 */
export function refreshRelationshipLedgerBaselines(
  ledger: RelationshipLedgerEntry[],
  characters: AICharacter[],
  memberIds: string[],
  now = Date.now(),
): RelationshipLedgerEntry[] {
  const roomIds = new Set(memberIds);
  const characterById = new Map(characters.map((character) => [character.id, character] as const));
  const zero = buildBaselineCurrent();
  return ledger.map((entry) => {
    if (!roomIds.has(entry.actorId) || !roomIds.has(entry.targetId)) return entry;
    const normalized = normalizeRelationshipLedgerEntry(entry);
    const authored = characterById.get(entry.actorId)?.relationships.find((relation) => relation.characterId === entry.targetId);
    const baseline = authored
      ? {
        warmth: authored.warmth ?? 0,
        competence: authored.competence ?? 0,
        trust: authored.trust ?? 0,
        threat: authored.threat ?? 0,
        attachment: authored.attachment ?? 0,
        deference: authored.deference ?? 0,
      }
      : zero;
    const adjustment = zero;
    const current = resolveEffectiveRelationshipAxes(baseline, adjustment);
    return {
      ...normalized,
      baseline,
      adjustment,
      current,
      derived: computeDerived(normalized, current, normalized.axisReasons || {}),
      lastUpdatedAt: now,
    };
  });
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
    attachment: roundDisplayValue(normalized.attachment || 0),
    deference: roundDisplayValue(normalized.deference || 0),
  };
}

function dampenTowardSaturation(current: number, delta: number) {
  const saturation = Math.max(0.45, 1 - Math.abs(current) / 140);
  return delta > 0 ? delta * saturation : delta * Math.max(0.55, 1 - Math.abs(current) / 160);
}

function buildAxisReason(axis: RelationshipAxisReason['axis'], value: number, reason: string, evidence: string, createdAt?: number): RelationshipAxisReason {
  return { axis, value, reason, evidence, createdAt };
}

function buildAxisReasons(interaction: InteractionEventPayload, delta: RelationshipDeltaPayload['delta'], createdAt?: number, reason = interaction.relationship?.stance || interaction.kind): RelationshipDeltaPayload['axisReasons'] {
  const reasons: NonNullable<RelationshipDeltaPayload['axisReasons']> = {};
  (['warmth', 'competence', 'trust', 'threat'] as const).forEach((axis) => {
    const value = delta[axis] || 0;
    if (!value) return;
    reasons[axis] = [buildAxisReason(axis, value, reason, interaction.evidenceText, createdAt)];
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

function buildRelationshipSemanticProfile(current: RelationshipLedgerEntry['current'], axisReasons: NonNullable<RelationshipLedgerEntry['axisReasons']>) {
  const warmth = current.warmth || 0;
  const trust = current.trust || 0;
  const threat = current.threat || 0;
  const competence = current.competence || 0;
  const closeness = warmth + trust;
  const tension = threat - Math.max(0, warmth) * 0.35;
  const labels: string[] = [];

  if (closeness >= 70 && threat < 28) labels.push('亲密', '依赖');
  else if (closeness >= 42 && threat < 35) labels.push('好感', '亲近');
  else if (warmth >= 24 && trust >= 18) labels.push('欣赏');

  if (warmth >= 35 && trust >= 32 && threat <= 18) labels.push('喜欢');
  if (warmth >= 50 && trust >= 45 && threat <= 14) labels.push('深度牵挂');
  if (competence >= 30 && trust >= 18) labels.push('认可');
  if (competence <= -24) labels.push('轻视');
  if (trust <= -30) labels.push('失望');
  if (threat >= 28 && trust <= 8) labels.push('戒备');
  if (threat >= 44 && warmth <= 8) labels.push('厌烦');
  if (threat >= 62 && warmth < -8) labels.push('憎恶');
  if (threat >= 36 && competence >= 18) labels.push('竞争心');
  if (threat >= 32 && warmth >= 24) labels.push('又在意又防备');

  const recentReasons = Object.values(axisReasons).flat().slice(-4).map((item) => item.reason);
  if (recentReasons.includes('defend')) labels.push('保护欲');
  if (recentReasons.includes('support') && warmth >= 18) labels.push('同盟感');
  if ((recentReasons.includes('challenge') || recentReasons.includes('mock')) && threat >= 22) labels.push('裂痕');

  const uniqueLabels = Array.from(new Set(labels)).slice(0, 4);
  const stage = tension >= 58 ? '破裂边缘'
    : tension >= 34 ? '紧张对峙'
      : uniqueLabels.includes('又在意又防备') ? '复杂拉扯'
        : closeness >= 72 ? '深度绑定'
          : closeness >= 40 ? '关系升温'
            : uniqueLabels.includes('同盟感') ? '同盟形成'
              : '普通互动';
  const intensity = Math.max(0, Math.min(100, Math.abs(closeness) * 0.55 + Math.max(0, tension) * 0.75 + Math.abs(competence) * 0.2));
  const summary = uniqueLabels.length ? `${stage}：${uniqueLabels.join('、')}` : stage;
  return { stage, labels: uniqueLabels, summary, intensity };
}

function computeDerived(entry: RelationshipLedgerEntry | undefined, current: RelationshipLedgerEntry['current'], axisReasons: NonNullable<RelationshipLedgerEntry['axisReasons']>, semanticLabels?: string[], semanticStance?: string) {
  const previous = entry?.current;
  const totalMovement = Math.abs(current.warmth) + Math.abs(current.competence) + Math.abs(current.trust) + Math.abs(current.threat);
  const volatility = previous
    ? Math.abs(current.warmth - previous.warmth) + Math.abs(current.competence - previous.competence) + Math.abs(current.trust - previous.trust) + Math.abs(current.threat - previous.threat)
    : totalMovement;
  return {
    stability: Math.max(0, Math.min(100, 100 - volatility * 4)),
    reciprocity: entry?.derived?.reciprocity ?? 0,
    salience: Math.max(0, Math.min(100, totalMovement + Object.values(axisReasons).flat().length * 4)),
    semantic: semanticLabels?.length
      ? { ...buildRelationshipSemanticProfile(current, axisReasons), labels: semanticLabels.slice(0, 6), summary: semanticStance || semanticLabels.join('、') }
      : buildRelationshipSemanticProfile(current, axisReasons),
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
  if (interaction.intensity < RELATIONSHIP_MIN_INTENSITY || interaction.confidence < RELATIONSHIP_MIN_CONFIDENCE) return false;
  if (!delta.actorId || !delta.targetId || delta.actorId === delta.targetId) return false;
  if (/^draft-\d+$/i.test(delta.actorId) || /^draft-\d+$/i.test(delta.targetId)) return false;
  if (!hasMeaningfulEvidence(interaction)) return false;
  if (interaction.kind === 'support' && interaction.intensity < 3) return false;
  if ((interaction.kind === 'challenge' || interaction.kind === 'probe') && interaction.intensity < 3) return false;
  return true;
}

export function canApplyRelationshipInteraction(interaction: InteractionEventPayload, delta: RelationshipDeltaPayload | null) {
  return passesInteractionGate(interaction, delta);
}

export function inferRelationshipDelta(interaction: InteractionEventPayload): RelationshipDeltaPayload | null {
  if (!interaction.targetId) return null;
  if (interaction.relationship) {
    const delta = interaction.relationship.delta;
    return {
      actorId: interaction.actorId,
      targetId: interaction.targetId,
      delta,
      reason: interaction.relationship.stance || interaction.kind,
      axisReasons: buildAxisReasons(interaction, delta, undefined, interaction.relationship.stance || interaction.kind),
      semanticLabels: interaction.relationship.labels,
      semanticStance: interaction.relationship.stance,
      spikeType: Math.max(Math.abs(delta.warmth), Math.abs(delta.competence), Math.abs(delta.trust), Math.abs(delta.threat)) >= 5 ? 'turning_point' : 'normal',
    };
  }
  // Immediate social impact and long-lived relationship change are separate.
  // Only the model-authored relationship assessment may move the six axes.
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
    || delta.threat !== 0
    || delta.attachment !== 0
    || delta.deference !== 0;
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
  return reduceRelationshipLedgerWithDelta(entries, delta, evidenceEvent);
}

export function reduceRelationshipLedgerWithDelta(entries: RelationshipLedgerEntry[], delta: RelationshipDeltaPayload, evidenceEvent: RuntimeEventV2): RelationshipLedgerEntry[] {
  const key = pairKey(delta.actorId, delta.targetId);
  const existing = entries.find((entry) => entry.pairKey === key);
  if (existing?.recentEvents?.some((event) => event.id === evidenceEvent.id)) return entries;
  const normalizedExisting = normalizeRuntimeEntryForComputation(existing);
  const current = getCurrentOrBaseline(normalizedExisting);
  const nextCurrent = applyContradictionCheck(normalizedExisting, {
    warmth: clampMetric(current.warmth + dampenTowardSaturation(current.warmth, clampDelta(delta.delta.warmth))),
    competence: clampMetric(current.competence + dampenTowardSaturation(current.competence, clampDelta(delta.delta.competence))),
    trust: buildNextTrust(current, delta.delta),
    threat: clampMetric(current.threat + dampenTowardSaturation(current.threat, clampDelta(delta.delta.threat))),
    attachment: clampMetric((current.attachment || 0) + dampenTowardSaturation(current.attachment || 0, clampDelta(delta.delta.attachment, 2))),
    deference: clampMetric((current.deference || 0) + dampenTowardSaturation(current.deference || 0, clampDelta(delta.delta.deference, 2))),
  });
  const baseline = normalizedExisting?.baseline || buildBaselineCurrent();
  const adjustment: RelationshipAxes = {
    warmth: nextCurrent.warmth - baseline.warmth,
    competence: nextCurrent.competence - baseline.competence,
    trust: nextCurrent.trust - baseline.trust,
    threat: nextCurrent.threat - baseline.threat,
    attachment: (nextCurrent.attachment || 0) - (baseline.attachment || 0),
    deference: (nextCurrent.deference || 0) - (baseline.deference || 0),
  };
  const axisReasons = appendAxisReasons(normalizedExisting, delta.axisReasons);
  const updated: RelationshipLedgerEntry = {
    pairKey: key,
    actorId: delta.actorId,
    targetId: delta.targetId,
    baseline,
    adjustment,
    current: nextCurrent,
    derived: computeDerived(normalizedExisting, nextCurrent, axisReasons, delta.semanticLabels, delta.semanticStance),
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
    attachment: clampMetric((current.attachment || 0) + dampenTowardSaturation(current.attachment || 0, clampDelta(delta.attachment, 2))),
    deference: clampMetric((current.deference || 0) + dampenTowardSaturation(current.deference || 0, clampDelta(delta.deference, 2))),
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
