import { describe, expect, it } from 'vitest';
import { normalizeConversation, type GroupChat } from './chat';
import {
  createDefaultConversationActionSchema,
  createDefaultConversationActions,
  createDefaultConversationParticipants,
  createIntentId,
  defaultInputSurfacesForConversation,
  normalizeSurfaceSubmissionWithMetadata,
} from './sessionEngine';

function buildChat(patch: Partial<GroupChat> = {}) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  });
}

describe('default conversation action schema', () => {
  it('treats user member as user persona participant', () => {
    const conversation = buildChat({ memberIds: ['user', 'a'] });
    const participants = createDefaultConversationParticipants(conversation);
    const userParticipant = participants.find((item) => item.entityRefId === 'user');
    expect(userParticipant?.entityType).toBe('user');
    expect(userParticipant?.roleKey).toBe('user_persona');
  });

  it('exposes director intervention and private thread actions for open group chats', () => {
    const conversation = buildChat();
    const participants = createDefaultConversationParticipants(conversation);
    const actions = createDefaultConversationActions({ conversation, participants });
    const schema = createDefaultConversationActionSchema({ conversation, participants });
    expect(actions.map((action) => action.type)).toEqual(['speak', 'director_intervention', 'start_private_thread']);
    expect(schema?.actions.map((action) => action.type)).toEqual(['director_intervention', 'start_private_thread']);
    const director = schema?.actions.find((action) => action.type === 'director_intervention');
    expect(director?.fields?.map((field) => field.key)).toEqual(['intent', 'targetId', 'maxTurns', 'prompt']);
    expect(director?.fields?.find((field) => field.key === 'intent')?.options?.map((option) => option.value)).toContain('force_reply');
  });

  it('infers system agent participant subtype and capabilities from member id', () => {
    const conversation = buildChat({ memberIds: ['host_moderator', 'a'] });
    const participants = createDefaultConversationParticipants(conversation);
    const host = participants.find((item) => item.entityRefId === 'host_moderator');
    expect(host?.entityType).toBe('system_agent');
    expect(host?.roleKey).toBe('host');
    expect(host?.displayName).toBe('主持人');
    expect(host?.flags.actorRefKind).toBe('system_agent');
    expect(host?.flags.systemAgentSubtype).toBe('host');
    expect(host?.flags.actorCapabilities).toBe('moderate');
  });

  it('supports non-member operator actors via operatorIds', () => {
    const conversation = buildChat({ memberIds: ['a', 'b'], operatorIds: ['host_moderator'] });
    const participants = createDefaultConversationParticipants(conversation);
    const host = participants.find((item) => item.entityRefId === 'host_moderator');
    expect(host?.entityType).toBe('system_agent');
    expect(host?.flags.isOperator).toBe(true);
    expect(host?.flags.channelRole).toBe('operator');
    expect(host?.seatIndex).toBeUndefined();
  });

  it('uses speak capability for direct conversation default text surface', () => {
    const directConversation = buildChat({ type: 'direct', memberIds: ['user', 'a'] });
    const surfaces = defaultInputSurfacesForConversation(directConversation);
    expect(surfaces[0]?.type).toBe('text');
    expect(surfaces[0]?.capability).toBe('speak');
    expect(surfaces[0]?.mode).toBe('memberSpeak');
  });

  it('keeps direct conversation text surface in speak mode even without user member', () => {
    const directConversation = buildChat({ type: 'direct', memberIds: ['a'] });
    const surfaces = defaultInputSurfacesForConversation(directConversation);
    expect(surfaces[0]?.type).toBe('text');
    expect(surfaces[0]?.capability).toBe('speak');
    expect(surfaces[0]?.mode).toBe('memberSpeak');
  });

  it('keeps AI private thread text surface out of guide mode', () => {
    const privateThread = buildChat({ type: 'ai_direct', memberIds: ['a', 'b'] });
    const surfaces = defaultInputSurfacesForConversation(privateThread);
    expect(surfaces[0]?.type).toBe('text');
    expect(surfaces[0]?.capability).toBe('speak');
    expect(surfaces[0]?.mode).toBe('memberSpeak');
  });

  it('uses member-speak mode for group chats when user is a member', () => {
    const conversation = buildChat({ type: 'group', memberIds: ['user', 'a', 'b'] });
    const surfaces = defaultInputSurfacesForConversation(conversation);
    expect(surfaces[0]?.type).toBe('text');
    expect(surfaces[0]?.capability).toBe('speak');
    expect(surfaces[0]?.mode).toBe('memberSpeak');
  });

  it('disables director intervention when only observe-capability system agents exist', () => {
    const conversation = buildChat({ memberIds: ['runtime_orchestrator', 'a'] });
    const participants = createDefaultConversationParticipants(conversation);
    const actions = createDefaultConversationActions({ conversation, participants });
    const schema = createDefaultConversationActionSchema({ conversation, participants });
    expect(actions.map((action) => action.type)).toEqual(['speak']);
    expect(schema).toBeNull();
  });

  it('keeps private-thread actor options AI-only when user persona is in the group', () => {
    const conversation = buildChat({ memberIds: ['user', 'a', 'b'] });
    const participants = createDefaultConversationParticipants(conversation);
    const schema = createDefaultConversationActionSchema({ conversation, participants });
    const threadAction = schema?.actions.find((action) => action.type === 'start_private_thread');
    const actorOptions = threadAction?.fields?.find((field) => field.key === 'actorId')?.options?.map((option) => option.value) || [];
    expect(actorOptions).toEqual(['a', 'b']);
  });

  it('hides private-thread actions when fewer than two AI participants are available', () => {
    const conversation = buildChat({ memberIds: ['user', 'a'] });
    const participants = createDefaultConversationParticipants(conversation);
    const actions = createDefaultConversationActions({ conversation, participants });
    const schema = createDefaultConversationActionSchema({ conversation, participants });
    expect(actions.map((action) => action.type)).toEqual(['speak', 'director_intervention']);
    expect(schema?.actions.map((action) => action.type)).toEqual(['director_intervention']);
  });

  it('omits director intervention when director mode is disabled', () => {
    const conversation = buildChat({ directorControls: { allowSpeakAs: true, allowDirectorMode: false, allowEventInjection: true, allowForcedReply: true } });
    const participants = createDefaultConversationParticipants(conversation);
    const schema = createDefaultConversationActionSchema({ conversation, participants });
    expect(schema?.actions.map((action) => action.type)).toEqual(['start_private_thread']);
  });
});

describe('session intent metadata', () => {
  it('supports deterministic intent id generation with now=0', () => {
    const id = createIntentId({ now: 0, random: () => 0.5 });
    expect(id).toBe('intent_0_i00000');
  });

  it('attaches deterministic metadata intent id for surface submission', () => {
    const result = normalizeSurfaceSubmissionWithMetadata(
      { key: 'chat', type: 'text', label: '聊天' },
      { content: 'hello', actorId: 'a' },
      { now: 0, random: () => 0.5 },
    );
    expect(result.intent.payload.intentId).toBe('intent_0_i00000');
    expect(result.intent.payload.surfaceType).toBe('text');
  });
});
