import { describe, expect, it } from 'vitest';
import { canActorRunSessionAction, canRunAiMemberActions, isUserMemberId, resolveConversationActorRef } from '../../services/memberActionPolicy';

describe('MemberList action visibility guards', () => {
  it('recognizes user member id and blocks ai-only actions', () => {
    expect(isUserMemberId('user')).toBe(true);
  });

  it('does not treat ai members as user member', () => {
    expect(isUserMemberId('a')).toBe(false);
    expect(isUserMemberId('char-1')).toBe(false);
    expect(isUserMemberId('')).toBe(false);
    expect(isUserMemberId(null)).toBe(false);
    expect(isUserMemberId(undefined)).toBe(false);
  });

  it('allows ai-only actions only for ai members', () => {
    const aiIds = new Set(['a', 'char-1']);
    expect(canRunAiMemberActions('a', aiIds)).toBe(true);
    expect(canRunAiMemberActions('user', aiIds)).toBe(false);
    expect(canRunAiMemberActions('host_moderator', aiIds)).toBe(false);
    expect(canRunAiMemberActions(null, aiIds)).toBe(false);
  });

  it('classifies conversation actors and applies action capability policy', () => {
    const aiIds = new Set(['a', 'char-1']);
    const memberIds = new Set(['a', 'user', 'host_moderator']);
    expect(resolveConversationActorRef('a', memberIds, aiIds)).toEqual({ kind: 'ai_character', id: 'a' });
    expect(resolveConversationActorRef('user', memberIds, aiIds)).toEqual({ kind: 'user_persona', id: 'user' });
    expect(resolveConversationActorRef('host_moderator', memberIds, aiIds)).toEqual({ kind: 'system_agent', id: 'host_moderator', subtype: 'host' });
    expect(canActorRunSessionAction('start_private_thread', resolveConversationActorRef('a', memberIds, aiIds))).toBe(true);
    expect(canActorRunSessionAction('start_private_thread', resolveConversationActorRef('user', memberIds, aiIds))).toBe(false);
    expect(canActorRunSessionAction('director_intervention', resolveConversationActorRef('host_moderator', memberIds, aiIds))).toBe(true);
  });
});
