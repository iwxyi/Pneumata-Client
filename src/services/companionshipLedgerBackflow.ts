import type { GroupChat } from '../types/chat';
import type { CompanionshipIntimateConflictEventPayload, CompanionshipPromiseEventPayload, CompanionshipSharedSecretEventPayload } from '../types/companionship';
import type { RelationshipDeltaPayload, RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import { reduceRelationshipLedgerWithDelta } from './relationshipLedger';

const USER_ACTOR_ID = 'user';

function clampDelta(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-8, Math.min(8, value));
}

function companionshipPayload(event: RuntimeEventV2) {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload.eventType !== 'string' || !payload.eventType.startsWith('companionship_')) return null;
  return payload;
}

function participantsIncludeUser(payload: { participantIds?: string[]; userId?: string; characterId?: string }) {
  return payload.userId === USER_ACTOR_ID || (payload.participantIds || []).includes(USER_ACTOR_ID);
}

function buildDeltaEvent(event: RuntimeEventV2, payload: Record<string, unknown>, delta: RelationshipDeltaPayload['delta'], reason: string): RelationshipDeltaPayload | null {
  const characterId = typeof payload.characterId === 'string' ? payload.characterId : '';
  if (!characterId) return null;
  const normalizedDelta = {
    warmth: clampDelta(delta.warmth || 0),
    competence: clampDelta(delta.competence || 0),
    trust: clampDelta(delta.trust || 0),
    threat: clampDelta(delta.threat || 0),
  };
  if (!normalizedDelta.warmth && !normalizedDelta.competence && !normalizedDelta.trust && !normalizedDelta.threat) return null;
  const evidence = event.summary || String(payload.evidence || payload.reason || reason);
  return {
    actorId: characterId,
    targetId: USER_ACTOR_ID,
    delta: normalizedDelta,
    reason,
    axisReasons: {
      warmth: normalizedDelta.warmth ? [{ axis: 'warmth', value: normalizedDelta.warmth, reason, evidence, createdAt: event.createdAt }] : [],
      competence: normalizedDelta.competence ? [{ axis: 'competence', value: normalizedDelta.competence, reason, evidence, createdAt: event.createdAt }] : [],
      trust: normalizedDelta.trust ? [{ axis: 'trust', value: normalizedDelta.trust, reason, evidence, createdAt: event.createdAt }] : [],
      threat: normalizedDelta.threat ? [{ axis: 'threat', value: normalizedDelta.threat, reason, evidence, createdAt: event.createdAt }] : [],
    },
    spikeType: Math.abs(normalizedDelta.trust) + Math.abs(normalizedDelta.threat) >= 8 ? 'turning_point' : 'normal',
  };
}

export function buildCompanionshipRelationshipDelta(event: RuntimeEventV2): RelationshipDeltaPayload | null {
  const rawPayload = companionshipPayload(event);
  if (!rawPayload) return null;
  if (rawPayload.eventType === 'companionship_promise') {
    const payload = rawPayload as unknown as CompanionshipPromiseEventPayload;
    if (!payload.userId && payload.characterId !== event.targetIds?.[0] && payload.characterId !== event.actorIds?.[0]) return null;
    if (payload.action === 'fulfilled') {
      return buildDeltaEvent(event, rawPayload, {
        warmth: 2,
        trust: payload.promiseKind === 'boundary_agreement' || payload.promiseKind === 'repair_agreement' ? 3 : 2,
        threat: -1,
      }, 'companionship_promise_fulfilled');
    }
    if (payload.action === 'blocked' || payload.action === 'stale') {
      return buildDeltaEvent(event, rawPayload, {
        warmth: payload.promiseKind === 'boundary_agreement' ? -2 : -1,
        trust: payload.promiseKind === 'boundary_agreement' || payload.promiseKind === 'repair_agreement' ? -3 : -2,
        threat: payload.promiseKind === 'boundary_agreement' ? 3 : 1,
      }, payload.action === 'blocked' ? 'companionship_promise_blocked' : 'companionship_promise_stale');
    }
    return null;
  }
  if (rawPayload.eventType === 'companionship_shared_secret') {
    const payload = rawPayload as unknown as CompanionshipSharedSecretEventPayload;
    if (!participantsIncludeUser(payload)) return null;
    if (payload.action === 'confessed') {
      const protective = payload.consequenceKind === 'protective_confession';
      return buildDeltaEvent(event, rawPayload, {
        warmth: protective ? 2 : 1,
        trust: protective ? 3 : 2,
        threat: -1,
      }, protective ? 'companionship_secret_protective_confession' : 'companionship_secret_confession');
    }
    if (payload.action === 'leaked') {
      if (payload.consequenceKind === 'misunderstanding') {
        return buildDeltaEvent(event, rawPayload, { trust: -1, threat: 1 }, 'companionship_secret_misunderstanding');
      }
      if (payload.consequenceKind === 'accidental_leak') {
        return buildDeltaEvent(event, rawPayload, { warmth: -1, trust: -2, threat: 2 }, 'companionship_secret_accidental_leak');
      }
      return buildDeltaEvent(event, rawPayload, { warmth: -2, trust: -4, threat: 4 }, 'companionship_secret_intentional_breach');
    }
    return null;
  }
  if (rawPayload.eventType === 'companionship_intimate_conflict') {
    const payload = rawPayload as unknown as CompanionshipIntimateConflictEventPayload;
    if (!participantsIncludeUser({ participantIds: payload.participantIds, userId: payload.userId, characterId: payload.characterId })) return null;
    if (payload.action === 'resolved' || payload.action === 'repair_attempted') {
      return buildDeltaEvent(event, rawPayload, { warmth: 2, trust: 3, threat: -3 }, 'companionship_conflict_repair');
    }
    if (payload.action === 'opened' || payload.action === 'reopened') {
      const severity = Math.max(0, Math.min(100, Number(payload.severity || 0)));
      return buildDeltaEvent(event, rawPayload, {
        warmth: severity >= 70 ? -3 : -1,
        trust: severity >= 70 ? -4 : -2,
        threat: severity >= 70 ? 4 : 2,
      }, 'companionship_conflict_opened');
    }
  }
  return null;
}

export function reduceRelationshipLedgerWithCompanionshipEvent(entries: RelationshipLedgerEntry[], event: RuntimeEventV2): RelationshipLedgerEntry[] {
  const delta = buildCompanionshipRelationshipDelta(event);
  if (!delta) return entries;
  return reduceRelationshipLedgerWithDelta(entries, delta, { ...event, kind: 'relationship_delta' });
}

export function applyCompanionshipLedgerBackflow(chat: GroupChat, event: RuntimeEventV2): RelationshipLedgerEntry[] {
  return reduceRelationshipLedgerWithCompanionshipEvent(chat.relationshipLedger || [], event);
}
