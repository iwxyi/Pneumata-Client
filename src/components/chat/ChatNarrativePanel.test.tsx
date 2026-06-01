import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../../types/chat';

const uuidA = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
const uuidB = '3c78729f-e52d-4dde-b27f-01a949960bb8';

vi.mock('../../services/narrativeProjection', () => ({
  projectNarrativeLines: vi.fn(() => [{
    id: 'line-1',
    conversationId: 'chat-1',
    type: 'relationship',
    title: `${uuidA} 对 ${uuidB}`,
    summary: `Relationship ledger has become salient · ${uuidA} relationship_delta ${uuidB} {"eventType":"room_state_snapshot_v2"}`,
    participantIds: [uuidA, uuidB],
    visibility: 'public',
    status: 'active',
    tension: 0.2,
    momentum: 0.3,
    salience: 0.8,
    sourceEventIds: [],
    openQuestions: [],
    possibleNextBeats: [],
    lastTouchedAt: 1,
  }]),
}));

vi.mock('../../services/runtimeDecision', () => ({
  projectRuntimePressure: vi.fn(() => ({
    narrativeLines: [],
    primaryLine: null,
    directorIntent: null,
  })),
}));

function buildCharacter(id: string, name: string): AICharacter {
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

function buildChat(): GroupChat {
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
    memberIds: [uuidA, uuidB],
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
    lastMessageAt: 2,
  };
}

describe('ChatNarrativePanel', () => {
  it('renders sanitized relationship narrative text without leaking UUID or raw event fields', async () => {
    const memoryStorage = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => memoryStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { memoryStorage.set(key, value); },
        removeItem: (key: string) => { memoryStorage.delete(key); },
        clear: () => { memoryStorage.clear(); },
      },
    });
    const { default: ChatNarrativePanel } = await import('./ChatNarrativePanel');
    const html = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={buildChat()}
        members={[buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')]}
        messages={[]}
      />,
    );

    expect(html).toContain('红太狼');
    expect(html).toContain('灰太狼');
    expect(html).toContain('关系账本中的变化已经足够显著');
    expect(html).toContain('系统事件');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
    expect(html).not.toContain('relationship_delta');
    expect(html).not.toContain('eventType');
    expect(html).not.toContain('Relationship ledger');
  });
});
