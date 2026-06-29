import { classifyActorRefKind, inferSystemAgentSubtypeFromId, resolveActorRuntimeCapabilities, toActorRef } from './actorRefPresentation';
import type { ActorRef } from '../types/runtimeEvent';

export function isUserMemberId(memberId: string | null | undefined) {
  return memberId === 'user';
}

export function canRunAiMemberActions(memberId: string | null | undefined, aiIds: Set<string>) {
  if (!memberId) return false;
  return classifyActorRefKind(memberId, { aiIds }) === 'ai_character';
}

export function resolveMemberActorRef(memberId: string | null | undefined, aiIds: Set<string>): ActorRef | undefined {
  if (!memberId) return undefined;
  return toActorRef(memberId, { aiIds });
}

export function resolveConversationActorRef(
  memberId: string | null | undefined,
  memberIds: Set<string>,
  aiIds: Set<string>,
): ActorRef | undefined {
  if (!memberId) return undefined;
  if (memberId === 'user') return { kind: 'user_persona', id: memberId };
  if (aiIds.has(memberId)) return { kind: 'ai_character', id: memberId };
  const subtype = inferSystemAgentSubtypeFromId(memberId);
  if (subtype) return { kind: 'system_agent', id: memberId, subtype };
  if (memberIds.has(memberId)) return { kind: 'ai_character', id: memberId };
  return toActorRef(memberId, { aiIds });
}

export function canActorRunSessionAction(
  actionType: string,
  actorRef: ActorRef | undefined | null,
) {
  if (!actorRef) return false;
  if (actionType === 'start_private_thread') return actorRef.kind === 'ai_character';
  if (actorRef.kind === 'user_persona') {
    return actionType === 'director_intervention' || actionType === 'attention_followup_user' || actionType === 'apply_calendar_patch_drafts';
  }
  if (actionType === 'mute_member' || actionType === 'unmute_member') {
    const capabilities = new Set(resolveActorRuntimeCapabilities(actorRef));
    return capabilities.has('moderate') || capabilities.has('judge') || capabilities.has('orchestrate');
  }
  if (actorRef.kind === 'ai_character') {
    return actionType !== 'apply_calendar_patch_drafts';
  }
  const capabilities = new Set(resolveActorRuntimeCapabilities(actorRef));
  if (actionType === 'director_intervention' || actionType === 'attention_followup_user') {
    return capabilities.has('guide') || capabilities.has('moderate') || capabilities.has('judge') || capabilities.has('orchestrate');
  }
  if (actionType === 'apply_calendar_patch_drafts') {
    return capabilities.has('moderate') || capabilities.has('judge') || capabilities.has('orchestrate');
  }
  if (actionType === 'ask_question') {
    return capabilities.has('guide') || capabilities.has('moderate') || capabilities.has('judge');
  }
  return capabilities.has('orchestrate');
}
