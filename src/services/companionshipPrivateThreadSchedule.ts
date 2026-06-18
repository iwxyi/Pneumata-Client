import type { GroupChat } from '../types/chat';
import type { CompanionshipPrivateThreadScheduleEventPayload, PrivateThreadScheduleDiagnostic } from '../types/companionship';
import type { RuntimeEventV2, SocialEventCandidatePayload } from '../types/runtimeEvent';
import { getCompanionshipRuntimeConfig } from './companionshipRuntimeConfig';

export const COMPANIONSHIP_PRIVATE_THREAD_COOLDOWN_MS = 6 * 60 * 60_000;

export function getCompanionshipPrivateThreadCooldownMs() {
  const hours = getCompanionshipRuntimeConfig().privateThreadCooldownHours;
  if (!Number.isFinite(hours)) return COMPANIONSHIP_PRIVATE_THREAD_COOLDOWN_MS;
  return Math.max(0, Math.min(168, Math.round(hours * 100) / 100)) * 60 * 60_000;
}

function pairKeyOf(ids: string[]) {
  return ids.filter(Boolean).slice().sort().join('::');
}

function payloadOf(event: RuntimeEventV2): CompanionshipPrivateThreadScheduleEventPayload | null {
  const payload = event.payload as Partial<CompanionshipPrivateThreadScheduleEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_private_thread_schedule') return null;
  if (!payload.actorId || !payload.targetId || !Array.isArray(payload.participantIds)) return null;
  return payload as CompanionshipPrivateThreadScheduleEventPayload;
}

export function buildCompanionshipPrivateThreadScheduleEvent(params: {
  chat: GroupChat;
  candidateEvent?: RuntimeEventV2;
  payload: SocialEventCandidatePayload;
  action: CompanionshipPrivateThreadScheduleEventPayload['action'];
  privateChatId?: string;
  nextAvailableAt?: number;
  createdAt?: number;
}): RuntimeEventV2 {
  const targetId = params.payload.participantIds.find((id) => id !== params.payload.initiatorId) || params.payload.targetIds?.[0] || '';
  const createdAt = params.createdAt || Date.now();
  const schedulePayload: CompanionshipPrivateThreadScheduleEventPayload = {
    eventType: 'companionship_private_thread_schedule',
    actorId: params.payload.initiatorId,
    targetId,
    participantIds: params.payload.participantIds,
    action: params.action,
    reasonType: params.payload.reasonType,
    triggerReason: params.payload.triggerReason,
    openingMessage: params.payload.openingMessage,
    dedupeKey: params.payload.dedupeKey,
    reason: params.action === 'suppressed'
      ? 'character companionship AI private threads disabled by settings'
      : params.action === 'skipped'
      ? 'character companionship AI private thread schedule cooling down'
      : undefined,
    candidateId: params.candidateEvent?.id,
    privateChatId: params.privateChatId,
    nextAvailableAt: params.nextAvailableAt,
    confidence: params.payload.confidence,
    decisionSource: params.payload.decisionSource,
  };
  return {
    id: `evt-companionship-private-thread-${createdAt}-${pairKeyOf(params.payload.participantIds)}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt,
    actorIds: [params.payload.initiatorId],
    targetIds: params.payload.participantIds.filter((id) => id !== params.payload.initiatorId),
    summary: params.action === 'opened' ? '角色陪伴私聊已进入冷却' : '角色陪伴私聊调度状态更新',
    visibility: 'role_private',
    visibleToIds: params.payload.participantIds,
    payload: schedulePayload as unknown as Record<string, unknown>,
  };
}

export function getRecentCompanionshipPrivateThreadSchedule(params: {
  chat: GroupChat;
  participantIds: string[];
  now?: number;
  windowMs?: number;
}) {
  const now = params.now || Date.now();
  const windowMs = params.windowMs ?? getCompanionshipPrivateThreadCooldownMs();
  if (windowMs <= 0) return null;
  const pairKey = pairKeyOf(params.participantIds);
  return (params.chat.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .map((event) => ({ event, payload: payloadOf(event) }))
    .find(({ event, payload }) => {
      if (!payload) return false;
      if (pairKeyOf(payload.participantIds) !== pairKey) return false;
      if (payload.action === 'skipped') {
        return typeof payload.nextAvailableAt === 'number' && payload.nextAvailableAt > now;
      }
      if (payload.action === 'suppressed') return false;
      if (payload.action !== 'opened' && payload.action !== 'candidate_created') return false;
      return now - event.createdAt < windowMs;
    }) || null;
}

export function isCompanionshipPrivateThreadPairCoolingDown(params: {
  chat: GroupChat;
  participantIds: string[];
  now?: number;
  windowMs?: number;
}) {
  return Boolean(getRecentCompanionshipPrivateThreadSchedule(params));
}

export function buildCompanionshipPrivateThreadScheduleDiagnostics(params: {
  chat: GroupChat;
  characterId?: string;
  now?: number;
  limit?: number;
}): PrivateThreadScheduleDiagnostic[] {
  const now = params.now || Date.now();
  const cooldownMs = getCompanionshipPrivateThreadCooldownMs();
  return (params.chat.runtimeEventsV2 || [])
    .map((event): PrivateThreadScheduleDiagnostic | null => {
      const payload = payloadOf(event);
      if (!payload) return null;
      if (params.characterId && !payload.participantIds.includes(params.characterId)) return null;
      const nextAvailableAt = typeof payload.nextAvailableAt === 'number' ? payload.nextAvailableAt : undefined;
      const isCoolingDown = payload.action === 'skipped'
        ? Boolean(nextAvailableAt && nextAvailableAt > now)
        : (payload.action === 'opened' || payload.action === 'candidate_created')
          && cooldownMs > 0
          && now - event.createdAt < cooldownMs;
      return {
        id: event.id,
        actorId: payload.actorId,
        targetId: payload.targetId,
        participantIds: payload.participantIds,
        action: payload.action,
        reasonType: payload.reasonType,
        triggerReason: payload.triggerReason,
        openingMessage: payload.openingMessage,
        reason: payload.reason,
        candidateId: payload.candidateId,
        privateChatId: payload.privateChatId,
        dedupeKey: payload.dedupeKey,
        nextAvailableAt,
        isCoolingDown,
        confidence: payload.confidence,
        decisionSource: payload.decisionSource,
        occurredAt: event.createdAt,
      };
    })
    .filter((item): item is PrivateThreadScheduleDiagnostic => Boolean(item))
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, Math.max(1, params.limit || 8));
}
