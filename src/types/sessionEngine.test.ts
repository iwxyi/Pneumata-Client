import { describe, expect, it } from 'vitest';
import { normalizeConversation, type GroupChat } from './chat';
import { createDefaultConversationActionSchema, createDefaultConversationActions, createDefaultConversationParticipants } from './sessionEngine';

function buildChat(patch: Partial<GroupChat> = {}) {
  return normalizeConversation({
    ...patch,
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
  });
}

describe('default conversation action schema', () => {
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

  it('omits director intervention when director mode is disabled', () => {
    const conversation = buildChat({ directorControls: { allowSpeakAs: true, allowDirectorMode: false, allowEventInjection: true, allowForcedReply: true } });
    const participants = createDefaultConversationParticipants(conversation);
    const schema = createDefaultConversationActionSchema({ conversation, participants });
    expect(schema?.actions.map((action) => action.type)).toEqual(['start_private_thread']);
  });
});
