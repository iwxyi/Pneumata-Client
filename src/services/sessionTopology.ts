import type { GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';

export function getConversationChannelId(chat: Pick<GroupChat, 'type'>) {
  if (chat.type === 'ai_direct') return 'pair-private';
  if (chat.type === 'direct') return 'user-private';
  return 'public';
}

export function getDerivedPublicChannelId() {
  return 'public';
}

export function getModeratorChannelId() {
  return 'moderator';
}

export function getRoleChannelId(roleId?: string | null) {
  return roleId ? `${roleId}-private` : 'role-private';
}

export function getVisibilityChannelId(visibility?: RuntimeEventV2['visibility'], roleId?: string | null) {
  if (visibility === 'pair_private') return 'pair-private';
  if (visibility === 'moderator_only') return getModeratorChannelId();
  if (visibility === 'role_private') return getRoleChannelId(roleId);
  return getDerivedPublicChannelId();
}

export function buildThreadRef(sourceChatId?: string | null, chatId?: string) {
  return sourceChatId || chatId || undefined;
}

export function isPrivateConversation(chat: Pick<GroupChat, 'type'>) {
  return chat.type === 'direct' || chat.type === 'ai_direct';
}

export function isDerivedPublicVisibility(visibility?: RuntimeEventV2['visibility']) {
  return visibility === 'derived_public';
}

export function isModeratorVisibility(visibility?: RuntimeEventV2['visibility']) {
  return visibility === 'moderator_only';
}

export function isRoleVisibility(visibility?: RuntimeEventV2['visibility']) {
  return visibility === 'role_private';
}

export function isPairVisibility(visibility?: RuntimeEventV2['visibility']) {
  return visibility === 'pair_private';
}
