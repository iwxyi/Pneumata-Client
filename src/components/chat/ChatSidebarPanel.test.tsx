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
      choiceHistory: [{
        branchId: 'ask-nurse',
        label: `${uuidA} 追问护士`,
        outcome: `${uuidB} 承认停电时有人进入档案室`,
        impact: `${uuidA} 和 ${uuidB} 的信任出现裂缝`,
        choiceEpoch: 2,
      }],
      chapterRecap: {
        title: '血迹名单',
        summary: '旧医院的线索开始收束。',
        discoveredClues: ['病历被撕掉一页'],
        unresolvedQuestions: [`${uuidB} 为什么隐瞒停电记录？`],
        changedRelationships: [`${uuidA} 开始怀疑 ${uuidB}`],
        stakes: ['暴露位置'],
        lastChoiceLabels: [`${uuidA} 追问护士`],
        choiceImpacts: [`${uuidA} 和 ${uuidB} 的信任出现裂缝`],
        updatedAt: 4,
        beatCount: 3,
      },
      storyProtocolDiagnostics: [
        {
          code: 'choice_required_missing',
          message: '模型在必须形成关键抉择的节拍没有输出 2-4 个合格候选项。',
          level: 'error',
          beatKind: 'decision',
          choicePolicy: 'require',
          choiceEpoch: 3,
          createdAt: 5,
        },
        {
          code: 'chapter_title_missing',
          message: '章节索引已创建，但模型尚未提供协议化章节标题。',
          level: 'warn',
          beatKind: 'pressure',
          choicePolicy: 'forbid',
          choiceEpoch: 2,
          createdAt: 6,
        },
      ],
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

async function renderPanel(rightPanelTab: string, chat: GroupChat = buildStoryChat()) {
  const { default: ChatSidebarPanel } = await import('./ChatSidebarPanel');
  return renderToStaticMarkup(
    <ChatSidebarPanel
      chat={chat}
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
    expect(html).toContain('伏笔回看');
    expect(html).toContain('本章用到：病历被撕掉一页');
    expect(html).toContain('仍待回答：护士 为什么隐瞒停电记录？');
    expect(html).toContain('选择影响：林医生 和 护士 的信任出现裂缝');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('uses chapter recap and choice impacts as clue wall assets', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      ...(chat.scenarioState || {}),
      openQuestions: [],
      clues: [],
      stakes: [],
      chapterRecap: {
        title: '血迹名单',
        summary: '旧医院的线索开始收束。',
        discoveredClues: ['病历被撕掉一页'],
        unresolvedQuestions: [`${uuidB} 为什么隐瞒停电记录？`],
        changedRelationships: [],
        stakes: ['暴露位置'],
        lastChoiceLabels: [],
        choiceImpacts: [`${uuidA} 和 ${uuidB} 的信任出现裂缝`],
        updatedAt: 4,
        beatCount: 3,
      },
      choiceHistory: [{
        branchId: 'ask-nurse',
        label: `${uuidA} 追问护士`,
        impact: `${uuidA} 和 ${uuidB} 的信任出现裂缝`,
        choiceEpoch: 2,
      }],
    };
    const html = await renderPanel('clues', chat);

    expect(html).toContain('1 个悬念');
    expect(html).toContain('1 条线索');
    expect(html).toContain('1 个风险');
    expect(html).toContain('追踪：护士 为什么隐瞒停电记录？');
    expect(html).toContain('最近线索：病历被撕掉一页');
    expect(html).toContain('当前风险：暴露位置');
    expect(html).toContain('选择影响');
    expect(html).toContain('林医生 和 护士 的信任出现裂缝');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('renders chapter choice outcomes as replayable story consequences', async () => {
    const html = await renderPanel('chapters');

    expect(html).toContain('第 1 章 · 血迹名单');
    expect(html).toContain('关键选择：林医生 追问护士');
    expect(html).toContain('已选：林医生 追问护士');
    expect(html).toContain('结果：护士 承认停电时有人进入档案室');
    expect(html).toContain('影响：林医生 和 护士 的信任出现裂缝');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('uses chapter recap choice labels when chapter key choices are missing', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      ...(chat.scenarioState || {}),
      storyChapters: [{
        id: 'chapter-1',
        index: 1,
        title: '血迹名单',
        status: 'active',
        startMessageId: 'story-message-1',
        startBeatId: 'beat-1',
        summary: '旧医院的线索开始收束。',
        openedAt: 1,
      }],
      chapterRecap: {
        title: '血迹名单',
        summary: '旧医院的线索开始收束。',
        discoveredClues: [],
        unresolvedQuestions: [],
        changedRelationships: [],
        stakes: [],
        lastChoiceLabels: [`${uuidA} 追问护士`],
        choiceImpacts: [`${uuidA} 和 ${uuidB} 的信任出现裂缝`],
        updatedAt: 4,
        beatCount: 3,
      },
    };
    const html = await renderPanel('chapters', chat);

    expect(html).toContain('关键选择：林医生 追问护士');
    expect(html).toContain('已选：林医生 追问护士');
    expect(html).toContain('结果：护士 承认停电时有人进入档案室');
    expect(html).toContain('影响：林医生 和 护士 的信任出现裂缝');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('assigns timestamped choice history to the matching chapter window', async () => {
    const chat = buildStoryChat();
    chat.scenarioState = {
      ...(chat.scenarioState || {}),
      chapterRecap: null,
      choiceHistory: [
        {
          branchId: 'early',
          label: `${uuidA} 追问护士`,
          outcome: `${uuidB} 承认停电时有人进入档案室`,
          impact: `${uuidA} 和 ${uuidB} 的信任出现裂缝`,
          choiceEpoch: 2,
          chosenAt: 12,
        },
        {
          branchId: 'late',
          label: `${uuidB} 去地下档案室`,
          outcome: `${uuidB} 找到缺页病历`,
          impact: `${uuidB} 掌握新的谈判筹码`,
          choiceEpoch: 3,
          chosenAt: 32,
        },
      ],
      storyChapters: [
        {
          id: 'chapter-1',
          index: 1,
          title: '血迹名单',
          status: 'completed',
          startMessageId: 'story-message-1',
          endMessageId: 'story-message-2',
          startBeatId: 'beat-1',
          endBeatId: 'beat-2',
          openedAt: 10,
          closedAt: 20,
        },
        {
          id: 'chapter-2',
          index: 2,
          title: '地下档案',
          status: 'active',
          startMessageId: 'story-message-3',
          startBeatId: 'beat-3',
          openedAt: 30,
        },
      ],
    };
    const html = await renderPanel('chapters', chat);

    expect(html).toContain('第 1 章 · 血迹名单');
    expect(html).toContain('关键选择：林医生 追问护士');
    expect(html).toContain('结果：护士 承认停电时有人进入档案室');
    expect(html).toContain('第 2 章 · 地下档案');
    expect(html).toContain('关键选择：护士 去地下档案室');
    expect(html).toContain('结果：护士 找到缺页病历');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('renders role summary and relationship pressure without raw ids', async () => {
    const { default: ChatSidebarPanel } = await import('./ChatSidebarPanel');
    const html = await renderPanel('roles');

    expect(html).toContain('1 位在场');
    expect(html).toContain('2 条关系变化');
    expect(html).toContain('场上压力：护士 门外还有脚步声');
    expect(html).toContain('阵营：医院旧案');
    expect(html).toContain('林医生');
    expect(html).toContain('在场');
    expect(html).toContain('护士');
    expect(html).toContain('林医生 开始怀疑 护士');
    expect(html).toContain('林医生 和 护士 的信任出现裂缝');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('renders story protocol diagnostics only in developer story panel', async () => {
    const { useSettingsStore } = await import('../../stores/useSettingsStore');
    useSettingsStore.setState((state) => ({
      ...state,
      developerMode: true,
      developerUI: { ...state.developerUI, showAdvancedRuntimePanels: true },
    }));
    const developerHtml = await renderPanel('developer');
    const normalHtml = await renderPanel('clues');

    expect(developerHtml).toContain('故事协议诊断');
    expect(developerHtml).toContain('1 错误');
    expect(developerHtml).toContain('1 警告');
    expect(developerHtml).toContain('必须抉择时缺少选项');
    expect(developerHtml).toContain('章节标题缺失');
    expect(developerHtml).toContain('节拍：decision');
    expect(normalHtml).not.toContain('故事协议诊断');
  });
});
