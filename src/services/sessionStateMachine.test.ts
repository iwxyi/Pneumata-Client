import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { SessionEngineDefinition } from '../types/sessionEngine';
import { getCurrentSessionPhase } from './sessionStateMachine';

const engine: SessionEngineDefinition = {
  key: 'test',
  createInitialConfig: () => ({}),
  createInitialState: () => ({}),
  buildParticipants: () => [],
  getPhaseDefinitions: () => [
    { key: 'scene', label: 'Scene', allowedActions: ['speak'] },
    { key: 'branch', label: 'Branch', allowedActions: ['branch_choose'] },
  ],
  getVisiblePanels: () => [],
  getAvailableActions: () => [],
  onMessageCommitted: () => ({ chatPatch: {}, characterPatches: [], runtimeEvents: [] }),
};

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'scripted_play',
    sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: 'story',
    topic: '',
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    memberIds: ['a'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    scenarioState: { phase: 'branch' },
    worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('getCurrentSessionPhase', () => {
  it('prefers scenario phase over generic world phase', () => {
    expect(getCurrentSessionPhase(engine, buildChat()).key).toBe('branch');
  });
});
