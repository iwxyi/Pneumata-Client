import type { GroupChat } from '../types/chat';
import type { RuntimeEventPayload } from './runtimeEventFactory';
import { normalizeRuntimeEvent } from './runtimeEventFactory';

export function buildPrivateSessionEvent(chat: GroupChat, payload: Omit<RuntimeEventPayload, 'visibilityScope' | 'visibleToRoles' | 'visibleToIds'>): RuntimeEventPayload {
  if (chat.type === 'ai_direct') {
    return normalizeRuntimeEvent({
      ...payload,
      visibilityScope: 'pair_private',
      visibleToRoles: ['pair_private'],
      visibleToIds: chat.memberIds,
    });
  }

  if (chat.type === 'direct') {
    return normalizeRuntimeEvent({
      ...payload,
      visibilityScope: 'pair_private',
      visibleToRoles: ['user_private'],
      visibleToIds: chat.memberIds,
    });
  }

  return normalizeRuntimeEvent(payload);
}

export function projectSessionRecentEvent(chat: GroupChat, viewerRole?: string | null) {
  if (chat.type === 'group') return chat.worldState.recentEvent;
  if (chat.type === 'direct' || chat.type === 'ai_direct') {
    return viewerRole === 'pair_private' || viewerRole === 'user_private' || !viewerRole
      ? chat.worldState.recentEvent
      : '';
  }
  return chat.worldState.recentEvent;
}

export function canRevealPrivateThreadSummary(chat: GroupChat, viewerRole?: string | null) {
  if (chat.type === 'group') return true;
  return viewerRole === 'pair_private' || viewerRole === 'user_private' || !viewerRole;
}
