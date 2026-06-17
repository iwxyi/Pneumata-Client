import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation, type DriverMessageCommitTransition } from '../types/chat';
import { DEFAULT_API_CONFIG } from '../types/settings';
import type { AICharacter } from '../types/character';
import { buildChatCommitTransition } from './chatCommitRuntime';

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'ai_direct',
    mode: 'open_chat',
    name: 'AI私聊',
    topic: '',
    style: 'free',
    memberIds: ['a', 'b'],
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    runtimeEvolutionIntensity: 'balanced',
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
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

describe('chatCommitRuntime', () => {
  it('preserves chat runtime deltas returned by the session engine', async () => {
    const chat = buildChat();
    const runtimeDelta: NonNullable<DriverMessageCommitTransition['chatRuntimeDelta']> = {
      relationshipLedger: {
        orderedPairKeys: ['a->b'],
        upserts: [{
          pairKey: 'a->b',
          actorId: 'a',
          targetId: 'b',
          current: { warmth: 4, competence: 0, trust: 3, threat: 0 },
          derived: {},
          axisReasons: {},
          trend: 'up',
          recentEvents: [],
          lastUpdatedAt: 10,
        }],
      },
    };
    const onCommit = vi.fn().mockResolvedValue({
      chatPatch: {},
      chatRuntimeDelta: runtimeDelta,
      characterPatches: [],
      runtimeEvents: [],
    } satisfies DriverMessageCommitTransition);

    const transition = await buildChatCommitTransition({
      api: DEFAULT_API_CONFIG,
      chat,
      characters: [{ id: 'a', name: '甲' } as AICharacter, { id: 'b', name: '乙' } as AICharacter],
      message: { type: 'ai', senderId: 'a', content: '我理解你的意思。' },
      previousAiMessage: null,
      onCommit,
    });

    expect(transition.chatRuntimeDelta).toBe(runtimeDelta);
    expect(transition.chatRuntimeDelta?.relationshipLedger?.upserts[0]?.pairKey).toBe('a->b');
  });
});
