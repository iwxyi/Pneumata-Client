import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
} from '../../types/chat';

const uuidA = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
const uuidB = '3c78729f-e52d-4dde-b27f-01a949960bb8';

vi.mock('@mui/material', async () => {
  const React = await import('react');
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => ({
    children,
    label,
  }: { children?: React.ReactNode; label?: React.ReactNode }) => React.createElement(tag, null, children ?? label);
  return {
    Box: passthrough('div'),
    Chip: passthrough('span'),
    Stack: passthrough('div'),
    Typography: passthrough('span'),
  };
});

vi.mock('../common/FloatingSegmentedTabs', async () => {
  const React = await import('react');
  return {
    default: ({ items }: { items?: Array<{ value: string; label: React.ReactNode }> }) => React.createElement(
      'nav',
      null,
      items?.map((item) => React.createElement('button', { key: item.value, type: 'button' }, item.label)),
    ),
  };
});

vi.mock('../controls/MemberList', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, '普通成员列表') };
});

vi.mock('../controls/RelationshipPanel', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, '关系面板') };
});

vi.mock('./ChatRuntimePanel', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, '运行态面板') };
});

vi.mock('./ChatNarrativePanel', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, '故事主面板') };
});

vi.mock('./ChatPrivateInfoCard', async () => {
  const React = await import('react');
  return { ChatPrivateInfoCard: () => React.createElement('div', null, '私密信息') };
});

beforeEach(async () => {
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
  const { useSettingsStore } = await import('../../stores/useSettingsStore');
  useSettingsStore.setState((state) => ({
    ...state,
    developerMode: false,
    developerUI: { ...state.developerUI, showAdvancedRuntimePanels: false },
  }));
});

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

function buildStoryChat(): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'scripted_play',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
    name: '故事房',
    topic: '旧医院',
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
    scenarioState: {
      phase: 'scene',
      currentScene: {
        location: '地下档案室',
        time: '清晨',
        presentActorIds: [uuidA],
        visibleThreat: `${uuidB} 门外还有脚步声`,
        summary: '档案室门外有人靠近。',
        updatedAt: 3,
      },
      openQuestions: [`${uuidB} 为什么隐瞒停电记录？`],
      clues: ['病历被撕掉一页'],
      stakes: ['暴露位置'],
      relationshipShifts: [`${uuidA} 开始怀疑 ${uuidB}`],
      roleAssignments: [
        { actorId: uuidA, roleId: 'protagonist' },
        { actorId: uuidB, roleId: 'suspect' },
      ],
      factions: [{ factionId: 'hospital', label: '医院旧案' }],
      storyChapters: [{
        id: 'chapter-1',
        index: 1,
        title: '血迹名单',
        status: 'active',
        startMessageId: 'story-message-1',
        startBeatId: 'beat-1',
        summary: '旧医院的线索开始收束。',
        keyChoices: [`${uuidA} 追问护士`],
        openedAt: 1,
      }],
    },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 2,
  };
}

async function renderPanel(rightPanelTab: string) {
  const { default: ChatSidebarPanel } = await import('./ChatSidebarPanel');
  return renderToStaticMarkup(
    <ChatSidebarPanel
      chat={buildStoryChat()}
      members={[buildCharacter(uuidA, '林医生'), buildCharacter(uuidB, '护士')]}
      messages={[]}
      thinkingId={null}
      rightPanelTab={rightPanelTab}
      setRightPanelTab={() => undefined}
      showMemberTab
      showRuntimeTab
      privatePayloads={[]}
      onSpeakAs={() => undefined}
    />,
  );
}

describe('ChatSidebarPanel story room panels', () => {
  it('uses story-specific tabs instead of ordinary group chat tabs', async () => {
    const { default: ChatSidebarPanel } = await import('./ChatSidebarPanel');
    const html = renderToStaticMarkup(
      <ChatSidebarPanel
        chat={buildStoryChat()}
        members={[buildCharacter(uuidA, '林医生'), buildCharacter(uuidB, '护士')]}
        messages={[]}
        thinkingId={null}
        rightPanelTab="narrative"
        setRightPanelTab={() => undefined}
        showMemberTab
        showRuntimeTab
        privatePayloads={[]}
        onSpeakAs={() => undefined}
      />,
    );

    expect(html).toContain('故事');
    expect(html).toContain('章节');
    expect(html).toContain('线索');
    expect(html).toContain('角色 2');
    expect(html).not.toContain('成员 2');
    expect(html).not.toContain('运行态');
  });

  it('renders clue summary with sanitized story assets', async () => {
    const { default: ChatSidebarPanel } = await import('./ChatSidebarPanel');
    const html = await renderPanel('clues');

    expect(html).toContain('1 个悬念');
    expect(html).toContain('1 条线索');
    expect(html).toContain('1 个风险');
    expect(html).toContain('追踪：护士 为什么隐瞒停电记录？');
    expect(html).toContain('最近线索：病历被撕掉一页');
    expect(html).toContain('当前风险：暴露位置');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('renders role summary and relationship pressure without raw ids', async () => {
    const { default: ChatSidebarPanel } = await import('./ChatSidebarPanel');
    const html = await renderPanel('roles');

    expect(html).toContain('1 位在场');
    expect(html).toContain('1 条关系变化');
    expect(html).toContain('场上压力：护士 门外还有脚步声');
    expect(html).toContain('阵营：医院旧案');
    expect(html).toContain('林医生');
    expect(html).toContain('在场');
    expect(html).toContain('护士');
    expect(html).toContain('林医生 开始怀疑 护士');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });
});
