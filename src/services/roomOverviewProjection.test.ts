import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import { projectRoomOverviewRows } from './roomOverviewProjection';

function member(id: string, name: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
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
    memberIds: ['a'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    runtimeEventsV2: [],
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('roomOverviewProjection', () => {
  it('projects stage row even when structured room state is missing', () => {
    const rows = projectRoomOverviewRows(buildChat(), [member('a', '甲')]);
    expect(rows).toEqual([{ key: 'overview-stage', label: '阶段', value: '自由聊天' }]);
  });

  it('projects both room and stage rows with readable room status labels', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      worldState: {
        ...buildChat().worldState,
        phase: 'warming',
        structuredRoomState: {
          heat: 78,
          cohesion: -12,
          topicDrift: 40,
          alliances: [],
          conflictPairs: [],
          pileOnTarget: null,
          dominantThread: null,
          silencedActors: [],
        },
      },
    });
    const rows = projectRoomOverviewRows(chat, [member('a', '甲')]);
    expect(rows).toEqual([
      { key: 'overview-room', label: '局势', value: '互动很热 / 氛围分散 / 话题有点发散' },
      { key: 'overview-stage', label: '阶段', value: 'warming' },
    ]);
  });
});
