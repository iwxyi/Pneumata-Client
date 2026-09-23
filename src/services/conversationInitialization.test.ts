import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { buildConversationMemberFingerprint, createConversationInitializationState, getConversationInitializationRequirement } from './conversationInitialization';

function character(id: string): AICharacter {
  return {
    id,
    name: id,
    avatar: '',
    background: '',
    speakingStyle: '',
    personality: '',
    expertise: [],
    relationships: [],
    runtimeTimeline: [],
    createdAt: 1,
    updatedAt: 1,
  } as AICharacter;
}

function group(modeState: GroupChat['modeState'] = { phase: 'free' }, memberIds = ['a', 'b', 'user']): Pick<GroupChat, 'type' | 'memberIds' | 'modeState'> {
  return { type: 'group', memberIds, modeState };
}

describe('conversation initialization lifecycle', () => {
  it('requires legacy multi-member groups to initialize', () => {
    const members = [character('a'), character('b')];
    expect(getConversationInitializationRequirement(group(), members)).toMatchObject({
      required: true,
      fingerprint: 'a|b',
      status: 'pending',
    });
  });

  it('accepts a completed analysis even when it inferred no relationship patches', () => {
    const members = [character('a'), character('b')];
    const fingerprint = buildConversationMemberFingerprint(group(), members);
    const state = createConversationInitializationState('completed', fingerprint, 123);

    expect(getConversationInitializationRequirement(group({ phase: 'free', initialization: state }), members)).toEqual({
      required: false,
      fingerprint,
      status: 'ready',
    });
  });

  it('makes a completed room pending again when members change', () => {
    const originalMembers = [character('a'), character('b')];
    const originalFingerprint = buildConversationMemberFingerprint(group(), originalMembers);
    const state = createConversationInitializationState('completed', originalFingerprint, 123);
    const changedMembers = [character('a'), character('b'), character('c')];

    expect(getConversationInitializationRequirement(group({ phase: 'free', initialization: state }, ['a', 'b', 'c']), changedMembers)).toMatchObject({
      required: true,
      fingerprint: 'a|b|c',
      status: 'pending',
    });
  });

  it('keeps a failed attempt blocked until the user retries', () => {
    const members = [character('a'), character('b')];
    const fingerprint = buildConversationMemberFingerprint(group(), members);
    const failed = createConversationInitializationState('failed', fingerprint, 123);

    expect(getConversationInitializationRequirement(group({ phase: 'free', initialization: failed }), members)).toMatchObject({
      required: true,
      status: 'failed',
    });
  });

  it('treats an interrupted running marker as pending on the next entry', () => {
    const members = [character('a'), character('b')];
    const fingerprint = buildConversationMemberFingerprint(group(), members);
    const running = createConversationInitializationState('running', fingerprint, 123);

    expect(getConversationInitializationRequirement(group({ phase: 'free', initialization: running }), members)).toMatchObject({
      required: true,
      status: 'pending',
    });
  });

  it('does not gate one-character or non-group conversations', () => {
    const oneMember = [character('a')];
    expect(getConversationInitializationRequirement(group({ phase: 'free' }, ['a']), oneMember).required).toBe(false);
    expect(getConversationInitializationRequirement({ ...group(), type: 'direct' }, [character('a'), character('b')]).required).toBe(false);
  });
});
