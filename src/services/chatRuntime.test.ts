import { describe, expect, it } from 'vitest';
import type { GroupChat } from '../types/chat';
import { accumulateChatRuntime } from './chatRuntime';

function buildChat(): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: {} as never,
    modeState: { phase: 'free' },
    name: '测试',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: [],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    runtimeTimeline: [],
  } as GroupChat;
}

describe('chatRuntime', () => {
  it('uses provided now when event createdAt is missing', () => {
    const result = accumulateChatRuntime(
      buildChat(),
      { type: 'system', content: '' },
      [{ eventType: 'test_event', title: '测试', summary: '确定性时间' }],
      { now: 1777000000000 },
    );
    expect(result.runtimeTimeline.at(-1)?.createdAt).toBe(1777000000000);
  });
});

