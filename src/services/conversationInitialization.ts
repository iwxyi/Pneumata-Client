import type { AICharacter } from '../types/character';
import type { GroupChat, ConversationInitializationState } from '../types/chat';

// v3 persists explicit room roles, authority, duty, affiliation, and other
// structural relationship evidence alongside the directional relationship axes.
export const CONVERSATION_INITIALIZATION_VERSION = 3 as const;

export interface ConversationInitializationRequirement {
  required: boolean;
  fingerprint: string;
  status: 'ready' | 'pending' | 'failed';
}

function getEligibleMembers(chat: Pick<GroupChat, 'memberIds'>, characters: AICharacter[]) {
  const characterById = new Map(characters.map((character) => [character.id, character]));
  return Array.from(new Set(chat.memberIds))
    .filter((memberId) => memberId !== 'user')
    .map((memberId) => characterById.get(memberId))
    .filter((character): character is AICharacter => Boolean(character && !character.deletedAt && !character.isPreset));
}

export function buildConversationMemberFingerprint(chat: Pick<GroupChat, 'memberIds'>, _characters: AICharacter[]) {
  // Use the declared room membership, not only already-loaded character
  // records. This keeps the room blocked during detail hydration, so an
  // automatic opening cannot outrun relationship initialization.
  // Keep the character argument part of the contract for callers that build
  // the fingerprint while records are hydrating; the declared ids remain the
  // stable identity used to invalidate stale completion records.
  void _characters;
  return Array.from(new Set(chat.memberIds))
    .filter((memberId) => memberId !== 'user')
    .sort()
    .join('|');
}

export function getConversationInitializationRequirement(chat: Pick<GroupChat, 'type' | 'memberIds' | 'modeState'>, characters: AICharacter[]): ConversationInitializationRequirement {
  const fingerprint = buildConversationMemberFingerprint(chat, characters);
  // A legacy room can retain member ids for characters that were later
  // deleted. There is no relationship work to perform when fewer than two
  // eligible characters remain, so do not leave the room waiting forever for
  // an initialization pass that cannot produce any input.
  if (chat.type !== 'group' || getEligibleMembers(chat, characters).length < 2) {
    return { required: false, fingerprint, status: 'ready' };
  }
  const state = chat.modeState.initialization;
  if (
    state?.version === CONVERSATION_INITIALIZATION_VERSION
    && state.status === 'completed'
    && state.memberFingerprint === fingerprint
  ) {
    return { required: false, fingerprint, status: 'ready' };
  }
  return {
    required: true,
    fingerprint,
    status: state?.status === 'failed' && state.memberFingerprint === fingerprint ? 'failed' : 'pending',
  };
}

export function createConversationInitializationState(
  status: ConversationInitializationState['status'],
  memberFingerprint: string,
  now = Date.now(),
  forceRelationshipRefresh = false,
): ConversationInitializationState {
  return {
    version: CONVERSATION_INITIALIZATION_VERSION,
    status,
    memberFingerprint,
    attemptedAt: status === 'completed' ? undefined : now,
    completedAt: status === 'completed' ? now : undefined,
    forceRelationshipRefresh: forceRelationshipRefresh || undefined,
  };
}

export function getInitializationMembers(chat: Pick<GroupChat, 'memberIds'>, characters: AICharacter[]) {
  return getEligibleMembers(chat, characters);
}
