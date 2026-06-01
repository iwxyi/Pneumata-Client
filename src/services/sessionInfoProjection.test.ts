import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { projectSessionInfoCards } from './sessionInfoProjection';

describe('sessionInfoProjection', () => {
  it('projects direct semantics card', () => {
    const directChat = normalizeConversation({
      id: 'direct-1',
      type: 'direct',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '私聊',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['a'],
      speed: 1,
      isActive: false,
      allowIntervention: true,
      topicSeed: '',
      governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: false, allowPrivateThreads: false },
      dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
      worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '' },
      directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
    });
    const cards = projectSessionInfoCards({ chat: directChat, chats: [directChat], isZh: true });
    expect(cards[0]?.title).toContain('私聊语义');
  });

  it('projects ai_direct source chat card with action target', () => {
    const groupChat = normalizeConversation({
      id: 'group-1',
      type: 'group',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '主群',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['a', 'b'],
      speed: 1,
      isActive: false,
      allowIntervention: true,
      topicSeed: '',
      governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
      dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
      worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '' },
      directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
    });
    const aiDirect = normalizeConversation({
      ...groupChat,
      id: 'ai-direct-1',
      type: 'ai_direct',
      name: '双人私聊',
      memberIds: ['a', 'b'],
      sourceChatId: 'group-1',
    });
    const cards = projectSessionInfoCards({ chat: aiDirect, chats: [groupChat, aiDirect], isZh: true });
    const sourceCard = cards.find((item) => item.key === 'ai-direct-source-chat');
    expect(sourceCard?.actionChatId).toBe('group-1');
    expect(sourceCard?.description).toContain('主群');
  });
});

