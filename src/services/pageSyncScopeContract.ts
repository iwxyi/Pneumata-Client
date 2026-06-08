import type { SyncChangeScope } from './api';
import { isReservedNonCharacterActorId } from './actorRefPresentation';

export type PageSyncSurface = 'chat-detail' | 'moments' | 'calendar';

export interface ChatDetailScopeInput {
  chatId: string;
  memberIds?: string[];
}

export interface PageSyncScopeContract {
  surface: PageSyncSurface;
  localFirst: boolean;
  initialBackgroundScopes: SyncChangeScope[];
  deferredScopes: SyncChangeScope[];
}

export function getSyncableCharacterMemberIds(memberIds: string[] | undefined) {
  return Array.from(new Set((memberIds || []).filter((memberId) => !isReservedNonCharacterActorId(memberId))));
}

export function getChatDetailSyncScopeContract(input: ChatDetailScopeInput): PageSyncScopeContract {
  const characterScopes = getSyncableCharacterMemberIds(input.memberIds).map((memberId) => `characters.detail:${memberId}` as const);
  return {
    surface: 'chat-detail',
    localFirst: true,
    initialBackgroundScopes: [
      `chats.detail:${input.chatId}`,
      `messages.window:${input.chatId}`,
      ...characterScopes,
    ],
    deferredScopes: [],
  };
}

export function getMomentsSyncScopeContract(): PageSyncScopeContract {
  return {
    surface: 'moments',
    localFirst: true,
    initialBackgroundScopes: ['world-runtime.window', 'characters.summary'],
    deferredScopes: ['artifacts.summary'],
  };
}

export function getCalendarSyncScopeContract(): PageSyncScopeContract {
  return {
    surface: 'calendar',
    localFirst: true,
    initialBackgroundScopes: ['world-runtime.window', 'characters.summary'],
    deferredScopes: [],
  };
}

