import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../../types/chat';
import { ChatPrivateInfoCard } from './ChatPrivateInfoCard';

const mockSettingsState = {
  developerMode: false,
  developerUI: {
    showMemoryDebug: false,
    showCompanionshipDebug: false,
  },
};

vi.mock('../../stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState),
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

function buildChat(type: GroupChat['type']): GroupChat {
  return {
    id: 'chat-1',
    type,
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '测试会话',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['mei'],
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
  };
}

describe('ChatPrivateInfoCard', () => {
  it('does not render ai direct thread semantics card', () => {
    const html = renderToStaticMarkup(
      <ChatPrivateInfoCard
        chat={{ ...buildChat('ai_direct'), memberIds: ['mei', 'hui'] }}
        members={[buildCharacter('mei', '美羊羊'), buildCharacter('hui', '灰太狼')]}
        directMemoryContext={null}
      />,
    );
    expect(html).not.toContain('AI 私聊线程');
    expect(html).not.toContain('可持续自动推进');
    expect(html).not.toContain('发起者 美羊羊');
    expect(html).not.toContain('对象 灰太狼');
  });

  it('renders direct memory axis and debug details only in developer memory debug mode', () => {
    mockSettingsState.developerMode = true;
    mockSettingsState.developerUI.showMemoryDebug = true;

    const html = renderToStaticMarkup(
      <ChatPrivateInfoCard
        chat={buildChat('direct')}
        members={[buildCharacter('mei', '美羊羊')]}
        directMemoryContext={{
          targetSummary: '优先检索角色对灰太狼的关系记忆',
          memoryVisibility: '仅开发者可见',
          recentRelationshipChanges: [],
          recentMemoryWrites: [{ id: 'm1', text: '和灰太狼的误会缓和', layer: 'character', scope: 'global' }],
          sourceTagSummary: 'direct_user_message × 2',
          targetResolutionLabel: '来自人工点名',
          targetResolution: '目标锁定灰太狼',
          companionshipStatus: {
            text: '惦记着小夏提过的事：明天面试有点紧张。',
            tone: 'ambiguous',
            chips: ['暧昧未确认', '有关心事项'],
            debugLines: ['phase=ambiguous style=ambiguous', 'intimacy attraction=72 intimacy=68 longing=50 security=76'],
            updatedAt: 1,
          },
        }}
      />,
    );

    expect(html).toContain('单聊记忆主轴');
    expect(html).toContain('优先读取自己的长期记忆');
    expect(html).toContain('惦记着小夏提过的事');
    expect(html).toContain('暧昧未确认');
    expect(html).toContain('有关心事项');
    expect(html).toContain('来源：direct_user_message × 2');
    expect(html).toContain('判断方式：来自人工点名');
    expect(html).toContain('目标识别：目标锁定灰太狼');
    expect(html).toContain('陪伴：phase=ambiguous style=ambiguous');

    mockSettingsState.developerMode = false;
    mockSettingsState.developerUI.showMemoryDebug = false;
    mockSettingsState.developerUI.showCompanionshipDebug = false;
  });

  it('renders companionship debug lines with companionship diagnostics enabled', () => {
    mockSettingsState.developerMode = true;
    mockSettingsState.developerUI.showMemoryDebug = false;
    mockSettingsState.developerUI.showCompanionshipDebug = true;

    const html = renderToStaticMarkup(
      <ChatPrivateInfoCard
        chat={buildChat('direct')}
        members={[buildCharacter('mei', '美羊羊')]}
        directMemoryContext={{
          targetSummary: '',
          memoryVisibility: '仅开发者可见',
          recentRelationshipChanges: [],
          sourceTagSummary: 'direct_user_message × 2',
          targetResolutionLabel: '来自人工点名',
          targetResolution: '目标锁定灰太狼',
          companionshipStatus: {
            text: '记得你们说好周末一起看电影。',
            tone: 'warm',
            chips: ['有未完成约定'],
            debugLines: ['promises=周末一起看电影', 'diagnostics=care-topic local_fallback confidence=0.42'],
            updatedAt: 1,
          },
        }}
      />,
    );

    expect(html).toContain('陪伴：promises=周末一起看电影');
    expect(html).toContain('陪伴：diagnostics=care-topic local_fallback confidence=0.42');
    expect(html).not.toContain('来源：direct_user_message × 2');
    expect(html).not.toContain('目标识别：目标锁定灰太狼');

    mockSettingsState.developerMode = false;
    mockSettingsState.developerUI.showCompanionshipDebug = false;
  });

  it('renders companionship status without developer debug lines in normal mode', () => {
    const html = renderToStaticMarkup(
      <ChatPrivateInfoCard
        chat={buildChat('direct')}
        members={[buildCharacter('mei', '美羊羊')]}
        directMemoryContext={{
          targetSummary: '',
          memoryVisibility: '仅开发者可见',
          recentRelationshipChanges: [],
          companionshipStatus: {
            text: '开始把你当成需要认真回应的人。',
            tone: 'curious',
            chips: ['开始在意'],
            debugLines: ['phase=curious style=friend'],
            updatedAt: 1,
          },
        }}
      />,
    );

    expect(html).toContain('开始把你当成需要认真回应的人');
    expect(html).toContain('开始在意');
    expect(html).not.toContain('phase=curious');
  });
});
