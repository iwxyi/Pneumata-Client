import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { projectFactionAffiliations, projectFactionClusters } from './factionProjection';

function buildCharacter(id: string, name: string, group?: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    group,
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildChat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b', 'c'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    sourceChatId: null,
    sourceMemberIds: [],
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: DEFAULT_CONVERSATION_WORLD_STATE,
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  };
}

describe('factionProjection', () => {
  it('projects scenario role assignments as faction affiliations', () => {
    const chat = buildChat({
      scenarioState: {
        factions: [{ factionId: 'panel', label: '面试方' }],
        roleAssignments: [
          { actorId: 'a', roleId: 'interviewer', factionId: 'panel' },
          { actorId: 'b', roleId: 'interviewer', factionId: 'panel' },
        ],
      },
    });
    const affiliations = projectFactionAffiliations({ chat, characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')] });
    expect(affiliations).toHaveLength(2);
    expect(affiliations[0].factionId).toBe('panel');
    expect(affiliations[0].confidence).toBeGreaterThan(0.7);
  });

  it('clusters ordinary character groups into soft factions', () => {
    const clusters = projectFactionClusters({
      chat: buildChat(),
      characters: [buildCharacter('a', '甲', '现实派'), buildCharacter('b', '乙', '现实派'), buildCharacter('c', '丙', '理想派')],
    });
    expect(clusters.some((cluster) => cluster.factionId === 'group:现实派')).toBe(true);
    const cluster = clusters.find((item) => item.factionId === 'group:现实派');
    expect(cluster?.memberIds).toEqual(['a', 'b']);
  });
});
