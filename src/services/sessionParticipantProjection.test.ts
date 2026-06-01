import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { projectNonAiParticipantBadges, projectSessionParticipantTopology } from './sessionParticipantProjection';

describe('sessionParticipantProjection', () => {
  it('projects user and system-agent badges with capabilities', () => {
    const chat = normalizeConversation({
      id: 'chat-1',
      type: 'group',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '群聊',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['user', 'host_moderator', 'a'],
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
    const badges = projectNonAiParticipantBadges(chat, [{ id: 'a', name: '甲' } as never], true);
    expect(badges.map((item) => item.label)).toEqual(['用户', '主持人']);
    expect(badges[0]?.capabilityLabels).toContain('发言');
    expect(badges[1]?.capabilityLabels).toContain('主持');
  });

  it('splits members and operators for topology projection', () => {
    const chat = normalizeConversation({
      id: 'chat-2',
      type: 'group',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '群聊',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['user', 'topic_guide_bot', 'host_moderator', 'a'],
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
    const projection = projectSessionParticipantTopology(chat, [{ id: 'a', name: '甲' } as never], true);
    expect(projection.memberBadges.map((item) => item.label)).toEqual(['用户']);
    expect(projection.operatorBadges.map((item) => item.label)).toEqual(['话题引导', '主持人']);
  });

  it('projects operator badges even when operator is not in memberIds', () => {
    const chat = normalizeConversation({
      id: 'chat-3',
      type: 'group',
      mode: 'open_chat',
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
      modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
      name: '群聊',
      topic: '',
      style: 'free',
      runtimeEvolutionIntensity: 'balanced',
      memberIds: ['user', 'a', 'b'],
      operatorIds: ['host_moderator'],
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
    const projection = projectSessionParticipantTopology(chat, [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] as never, true);
    expect(projection.operatorBadges.map((item) => item.label)).toEqual(['主持人']);
  });
});
