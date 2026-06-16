import type { GroupChat } from '../types/chat';
import type { CompanionshipPrivateThreadScheduleEventPayload } from '../types/companionship';
import type { RuntimeEventV2, SocialEventCandidatePayload } from '../types/runtimeEvent';

export const COMPANIONSHIP_PRIVATE_THREAD_COOLDOWN_MS = 6 * 60 * 60_000;

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
    candidateId: params.candidateEvent?.id,
    privateChatId: params.privateChatId,
    nextAvailableAt: params.nextAvailableAt,
    confidence: params.payload.confidence,
    decisionSource: params.payload.reasonType?.startsWith('companionship_') ? 'local_fallback' : undefined,
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
  const windowMs = params.windowMs || COMPANIONSHIP_PRIVATE_THREAD_COOLDOWN_MS;
  const pairKey = pairKeyOf(params.participantIds);
  return (params.chat.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .map((event) => ({ event, payload: payloadOf(event) }))
    .find(({ event, payload }) => {
      if (!payload) return false;
      if (pairKeyOf(payload.participantIds) !== pairKey) return false;
      if (payload.action === 'suppressed' || payload.action === 'skipped') {
        return typeof payload.nextAvailableAt === 'number' && payload.nextAvailableAt > now;
      }
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
