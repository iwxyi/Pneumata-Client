import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { projectSessionInfoCards } from './sessionInfoProjection';

describe('sessionInfoProjection', () => {
  it('does not project direct semantics card', () => {
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
    expect(cards).toEqual([]);
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
    expect(cards.some((item) => item.key === 'ai-direct-semantics')).toBe(false);
    expect(sourceCard?.actionChatId).toBe('group-1');
    expect(sourceCard?.description).toContain('主群');
  });

  it('sanitizes source chat name in ai_direct source card', () => {
    const uuid = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
    const groupChat = normalizeConversation({
      id: 'group-2',
      type: 'group',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: `${uuid} {"eventType":"room_state_snapshot_v2"}`,
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
      id: 'ai-direct-2',
      type: 'ai_direct',
      name: '双人私聊',
      sourceChatId: 'group-2',
    });
    const cards = projectSessionInfoCards({ chat: aiDirect, chats: [groupChat, aiDirect], isZh: true });
    const sourceCard = cards.find((item) => item.key === 'ai-direct-source-chat');
    expect(sourceCard?.description).toContain('系统事件');
    expect(sourceCard?.description).not.toContain(uuid);
    expect(sourceCard?.description).not.toContain('eventType');
  });

  it('maps user/member ids in source chat description when member context is provided', () => {
    const groupChat = normalizeConversation({
      id: 'group-3',
      type: 'group',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: 'user 与 a 的小组',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['user', 'a'],
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
      id: 'ai-direct-3',
      type: 'ai_direct',
      name: '双人私聊',
      sourceChatId: 'group-3',
    });
    const cards = projectSessionInfoCards({
      chat: aiDirect,
      chats: [groupChat, aiDirect],
      members: [{ id: 'a', name: '甲' }] as never,
      isZh: true,
    });
    const sourceCard = cards.find((item) => item.key === 'ai-direct-source-chat');
    expect(sourceCard?.description).toContain('我 与 甲');
    expect(sourceCard?.description).not.toContain('user 与 a');
  });

  it('projects deliberation progress without presenting it as a fixed limit', () => {
    const chat = normalizeConversation({
      id: 'deliberation-1',
      type: 'group',
      mode: 'group_discussion',
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      scenarioState: {
        phase: 'deliberation',
        progress: [{ key: 'speeches', label: '审议发言', value: 2, target: 5 }],
      },
      name: '观点审议',
      topic: '是否要重构推荐系统',
      style: 'debate',
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

    const cards = projectSessionInfoCards({ chat, chats: [chat], isZh: true });
    expect(cards).toContainEqual(expect.objectContaining({
      key: 'discussion-progress',
      title: '审议进展',
      description: '2/5',
    }));
    expect(cards.some((item) => item.title.includes('上限'))).toBe(false);
  });
});
