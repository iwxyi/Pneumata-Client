import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import { projectRelationshipPanelData } from './relationshipPanelProjection';

function member(id: string, name: string, relationships: AICharacter['relationships'] = []): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: {
      openness: 50,
      extroversion: 50,
      agreeableness: 50,
      neuroticism: 50,
      humor: 50,
      creativity: 50,
      assertiveness: 50,
      empathy: 50,
    },
    behavior: {
      proactivity: 50,
      aggressiveness: 50,
      humorIntensity: 50,
      empathyLevel: 50,
      summarizing: 50,
      offTopic: 50,
    },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships,
    memory: {
      longTerm: [],
      shortTermSummary: '',
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
    intervention: {
      allowSpeakAs: true,
      allowDirectorPrompt: true,
      allowPrivateThread: true,
    },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    runtimeEventsV2: [],
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    relationshipLedger: [],
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('relationshipPanelProjection', () => {
  it('projects ledger sections by actor in forward mode', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 8, trust: 7, competence: 5, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 10,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections).toHaveLength(1);
    expect(projection.ledgerSections[0]?.member.id).toBe('a');
    expect(projection.ledgerSections[0]?.sectionKey).toBe('forward-a');
    expect(projection.fallbackSections).toHaveLength(0);
    expect(projection.sectionKeys).toEqual(['forward-a']);
  });

  it('projects ledger sections by target in reverse mode', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 8, trust: 7, competence: 5, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 10,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const projection = projectRelationshipPanelData(chat, members, true);
    expect(projection.ledgerSections).toHaveLength(1);
    expect(projection.ledgerSections[0]?.member.id).toBe('b');
    expect(projection.ledgerSections[0]?.sectionKey).toBe('reverse-b');
    expect(projection.sectionKeys).toEqual(['reverse-b']);
  });

  it('falls back to character relationship notes when no ledger section exists', () => {
    const chat = buildChat();
    const members = [
      member('a', '甲', [{ characterId: 'b', warmth: 3, trust: 2, competence: 1, threat: 0, note: '最近更愿意接话' }]),
      member('b', '乙'),
    ];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections).toHaveLength(0);
    expect(projection.fallbackSections).toHaveLength(1);
    expect(projection.fallbackSections[0]?.member.id).toBe('a');
    expect(projection.fallbackSections[0]?.sectionKey).toBe('fallback-forward-a');
    expect(projection.fallbackSections[0]?.items[0]).toMatchObject({
      characterId: 'b',
      targetName: '乙',
      note: '最近更愿意接话',
    });
  });

  it('includes user as a relationship section member when chat contains user', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      memberIds: ['user', 'a', 'b'],
      relationshipLedger: [{
        pairKey: 'a->user',
        actorId: 'a',
        targetId: 'user',
        current: { warmth: 9, trust: 6, competence: 2, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 11,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const forward = projectRelationshipPanelData(chat, members, false);
    const reverse = projectRelationshipPanelData(chat, members, true);

    expect(forward.ledgerSections[0]?.member.id).toBe('a');
    expect(reverse.ledgerSections[0]?.member.id).toBe('user');
    expect(reverse.ledgerSections[0]?.member.name).toBe('我');
  });
});
