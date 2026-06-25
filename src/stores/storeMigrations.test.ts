import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE, type GroupChat } from '../types/chat';
import { migrateChatStoreState, migrateSettingsStoreState, migrateUiStoreState } from './storeMigrations';

function chatWithCohesion(cohesion: number): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '群聊',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: [],
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
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      structuredRoomState: {
        heat: 20,
        cohesion,
        topicDrift: 0,
        dominantThread: null,
        alliances: [],
        conflictPairs: [],
        pileOnTarget: null,
        silencedActors: [],
      },
    },
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  };
}

describe('storeMigrations', () => {
  it('migrates old room cohesion from 50-centered scale to signed scale', () => {
    const migrated = migrateChatStoreState({ chats: [chatWithCohesion(50), chatWithCohesion(64), chatWithCohesion(42)] });

    expect(migrated?.chats?.[0]?.worldState.structuredRoomState?.cohesion).toBe(0);
    expect(migrated?.chats?.[1]?.worldState.structuredRoomState?.cohesion).toBe(14);
    expect(migrated?.chats?.[2]?.worldState.structuredRoomState?.cohesion).toBe(-8);
  });

  it('keeps valid chat reading positions while dropping invalid entries', () => {
    const migrated = migrateUiStoreState({
      rightPanelTab: 'chapters',
      chatReadingPositions: {
        'story-1': { messageId: 'message-2', offsetTop: 42, pinned: false, updatedAt: 123, sourceTimestamp: 456 },
        broken: { messageId: 123, offsetTop: 'bad' },
      },
    });

    expect(migrated?.rightPanelTab).toBe('chapters');
    expect(migrated?.chatReadingPositions).toEqual({
      'story-1': { messageId: 'message-2', offsetTop: 42, pinned: false, updatedAt: 123, sourceTimestamp: 456 },
    });
  });

  it('keeps story room sidebar tab values during migration', () => {
    expect(migrateUiStoreState({ rightPanelTab: 'clues' })?.rightPanelTab).toBe('clues');
    expect(migrateUiStoreState({ rightPanelTab: 'roles' })?.rightPanelTab).toBe('roles');
    expect(migrateUiStoreState({ rightPanelTab: 'developer' })?.rightPanelTab).toBe('developer');
  });

  it('enables human appraisal by default for older developer UI settings', () => {
    const migrated = migrateSettingsStoreState({
      developerUI: {
        showMemoryDebug: true,
      },
    });

    expect(migrated?.developerUI).toMatchObject({
      showMemoryDebug: true,
      enableHumanAppraisal: true,
    });
  });
});
