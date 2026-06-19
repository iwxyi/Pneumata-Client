import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../../types/chat';

const uuidA = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
const uuidB = '3c78729f-e52d-4dde-b27f-01a949960bb8';

vi.mock('@mui/material', async () => {
  const React = await import('react');
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => ({ children, label }: { children?: React.ReactNode; label?: React.ReactNode }) => React.createElement(tag, null, children ?? label);
  return {
    Box: passthrough('div'),
    Chip: passthrough('span'),
    Stack: passthrough('div'),
    Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Typography: passthrough('span'),
  };
});

vi.mock('../common/SurfaceCard', async () => {
  const React = await import('react');
  return { default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children) };
});

vi.mock('../common/SectionHeader', async () => {
  const React = await import('react');
  return { default: ({ title, action }: { title?: React.ReactNode; action?: React.ReactNode }) => React.createElement('div', null, title, action) };
});

vi.mock('../common/StatChipRow', async () => {
  const React = await import('react');
  return { default: ({ chips }: { chips?: Array<{ label?: React.ReactNode; value?: React.ReactNode }> }) => React.createElement('div', null, chips?.map((chip, index) => React.createElement('span', { key: index }, chip.label, chip.value))) };
});

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

beforeEach(async () => {
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

  it('renders story room assets as chapter memory without raw ids', async () => {
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
    const chat = {
      ...buildChat(),
      mode: 'scripted_play' as const,
      sessionKind: { family: 'conversation' as const, scenarioId: 'story-reader', surfaceProfile: 'hybrid' as const, topology: 'group' as const },
      scenarioState: {
        phase: 'scene',
        storyGoal: `${uuidA} 查清旧医院失踪案`,
        storySituation: `${uuidB} 刚从地下档案室逃出来`,
        currentScene: {
          location: `${uuidB} 所在的地下档案室`,
          time: '清晨',
          presentActorIds: [uuidA, uuidB],
          visibleThreat: '门外还有脚步声',
          summary: `${uuidB} 刚从地下档案室逃出来`,
          updatedAt: 3,
        },
        storyBeatKind: 'pressure' as const,
        chapterMemory: `${uuidA} 在旧医院发现血迹`,
        openQuestions: [`${uuidB} 为什么隐瞒停电记录？`],
        clues: ['地下档案室的病历被撕掉一页'],
        stakes: ['暴露位置'],
        relationshipShifts: [`${uuidA} 开始怀疑 ${uuidB}`],
        choiceEpoch: 2,
        branches: [
          { branchId: 'chosen', label: `${uuidA} 追问护士`, status: 'chosen' as const, choiceEpoch: 2, risk: '激怒护士', reward: '得到线索' },
          { branchId: 'alt', label: `${uuidB} 去地下档案室`, status: 'completed' as const, choiceEpoch: 2, intent: '探索', risk: '暴露位置', reward: '找到病历' },
        ],
        choiceHistory: [{ branchId: 'chosen', label: `${uuidA} 追问护士`, risk: '激怒护士', reward: '得到线索', outcome: '护士承认停电时有人进入档案室', impact: '关系变化：护士开始怀疑林医生', choiceEpoch: 2 }],
        chapterRecap: {
          title: '新的抉择点',
          summary: `${uuidA} 在旧医院发现血迹`,
          discoveredClues: ['地下档案室的病历被撕掉一页'],
          unresolvedQuestions: [`${uuidB} 为什么隐瞒停电记录？`],
          changedRelationships: [`${uuidA} 开始怀疑 ${uuidB}`],
          stakes: ['暴露位置'],
          lastChoiceLabels: [`${uuidA} 追问护士`],
          choiceImpacts: ['关系变化：护士开始怀疑林医生'],
          updatedAt: 2,
          beatCount: 0,
        },
      },
    } satisfies GroupChat;
    const html = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={chat}
        members={[buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')]}
        messages={[]}
      />,
    );

    expect(html).toContain('新的抉择点');
    expect(html).toContain('主线推进');
    expect(html).toContain('当前目标：红太狼 查清旧医院失踪案');
    expect(html).toContain('加压');
    expect(html).not.toContain('pressure');
    expect(html).toContain('回顾线索');
    expect(html).toContain('回顾悬念');
    expect(html).toContain('回顾选择');
    expect(html).toContain('回顾影响');
    expect(html).toContain('关键抉择');
    expect(html).toContain('节点 2');
    expect(html).toContain('已选');
    expect(html).toContain('结果：护士承认停电时有人进入档案室');
    expect(html).toContain('影响：关系变化：护士开始怀疑林医生');
    expect(html).toContain('未走路径：灰太狼 去地下档案室');
    expect(html).not.toContain('已走路径');
    expect(html).not.toContain('当时还可以选择');
    expect(html).toContain('红太狼 在旧医院发现血迹');
    expect(html).toContain('当前处境：灰太狼 刚从地下档案室逃出来');
    expect(html).toContain('章节结算');
    expect(html).toContain('发现：地下档案室的病历被撕掉一页');
    expect(html).toContain('关系：红太狼 开始怀疑 灰太狼');
    expect(html).toContain('结果：护士承认停电时有人进入档案室');
    expect(html).toContain('影响：关系变化：护士开始怀疑林医生');
    expect(html).toContain('未解：灰太狼 为什么隐瞒停电记录？');
    expect(html).toContain('当前场景');
    expect(html).toContain('地点：灰太狼 所在的地下档案室');
    expect(html).toContain('时间：清晨');
    expect(html).toContain('压力：门外还有脚步声');
    expect(html).not.toContain('在场：');
    expect(html).toContain('灰太狼 去地下档案室');
    expect(html).not.toContain('最近选择');
    expect(html).toContain('影响：关系变化：护士开始怀疑林医生');
    expect(html).toContain('灰太狼 为什么隐瞒停电记录？');
    expect(html).toContain('地下档案室的病历被撕掉一页');
    expect(html).toContain('暴露位置');
    expect(html).not.toContain('风险：激怒护士');
    expect(html).not.toContain('风险：暴露位置');
    expect(html).not.toContain('收益：得到线索');
    expect(html).not.toContain('收益：找到病历');
    expect(html).not.toContain('意图：探索');
    expect(html).not.toContain(uuidA);
    expect(html).not.toContain(uuidB);
  });

  it('renders story progress states for choice and branch phases', async () => {
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
    const baseStoryChat = {
      ...buildChat(),
      mode: 'scripted_play' as const,
      sessionKind: { family: 'conversation' as const, scenarioId: 'story-reader', surfaceProfile: 'hybrid' as const, topology: 'group' as const },
    };
    const members = [buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')];

    const choiceHtml = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={{ ...baseStoryChat, scenarioState: { phase: 'choice', storyBeatKind: 'decision' as const } }}
        members={members}
        messages={[]}
      />,
    );
    expect(choiceHtml).toContain('等待你的选择');
    expect(choiceHtml).toContain('当前章节已经推进到抉择点');
    expect(choiceHtml).toContain('抉择');

    const branchHtml = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={{
          ...baseStoryChat,
          scenarioState: {
            phase: 'branch',
            storyBeatKind: 'consequence' as const,
            selectedChoice: { branchId: 'ask', label: `${uuidA} 追问月奴`, prompt: '追问月奴', choiceEpoch: 2 },
          },
        }}
        members={members}
        messages={[]}
      />,
    );
    expect(branchHtml).toContain('正在兑现选择');
    expect(branchHtml).toContain('刚才选择了：红太狼 追问月奴');
    expect(branchHtml).toContain('后果');
    expect(branchHtml).not.toContain(uuidA);
  });

  it('uses the latest chapter recap assets in story settlement', async () => {
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
    const chat = {
      ...buildChat(),
      mode: 'scripted_play' as const,
      sessionKind: { family: 'conversation' as const, scenarioId: 'story-reader', surfaceProfile: 'hybrid' as const, topology: 'group' as const },
      scenarioState: {
        phase: 'scene',
        storyGoal: '去地下档案室确认名单缺页',
        choiceHistory: [{ branchId: 'ask', label: '追问护士', outcome: '护士承认有人改过值班表', impact: '旧影响', choiceEpoch: 2 }],
        chapterRecap: {
          title: '阶段回顾',
          summary: '旧医院的线索开始收束。',
          discoveredClues: ['旧线索：门口有水迹', '新线索：值班表被撕掉一页'],
          unresolvedQuestions: ['旧问题：门后是谁？', '新问题：名单缺页被谁拿走？'],
          changedRelationships: ['旧关系：林医生犹豫', '新关系：护士开始相信林医生'],
          stakes: ['暴露位置'],
          lastChoiceLabels: ['追问护士'],
          choiceImpacts: ['旧影响：护士沉默', '新影响：护士愿意带路'],
          updatedAt: 2,
          beatCount: 4,
        },
      },
    } satisfies GroupChat;

    const html = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={chat}
        members={[buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')]}
        messages={[]}
      />,
    );

    expect(html).toContain('章节结算');
    expect(html).toContain('发现：新线索：值班表被撕掉一页');
    expect(html).toContain('关系：新关系：护士开始相信林医生');
    expect(html).toContain('影响：新影响：护士愿意带路');
    expect(html).toContain('未解：新问题：名单缺页被谁拿走？');
    expect(html).toContain('下一步：去地下档案室确认名单缺页');
    expect(html).not.toContain('发现：旧线索：门口有水迹');
    expect(html).not.toContain('关系：旧关系：林医生犹豫');
    expect(html).not.toContain('影响：旧影响：护士沉默');
    expect(html).not.toContain('未解：旧问题：门后是谁？');
  });

  it('renders multiple story choices as one clear review trail without debug leakage', async () => {
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
    const chat = {
      ...buildChat(),
      mode: 'scripted_play' as const,
      sessionKind: { family: 'conversation' as const, scenarioId: 'story-reader', surfaceProfile: 'hybrid' as const, topology: 'group' as const },
      scenarioState: {
        phase: 'scene',
        storyGoal: '确认旧医院名单缺页的去向',
        storyBeatKind: 'new_pressure' as const,
        branches: [
          { branchId: 'ask-nurse', label: '追问护士昨晚停电记录', status: 'chosen' as const, choiceEpoch: 2, intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
          { branchId: 'follow-blood', label: '跟着血迹去旧住院楼', status: 'completed' as const, choiceEpoch: 2, intent: '追踪', risk: '暴露位置', reward: '找到异常脚印' },
          { branchId: 'open-file', label: '打开被封存的病历柜', status: 'chosen' as const, choiceEpoch: 4, intent: '揭露', risk: '触发警报', reward: '拿到缺页名单' },
          { branchId: 'protect-nurse', label: '先带护士离开走廊', status: 'completed' as const, choiceEpoch: 4, intent: '保护', risk: '错过黑衣人', reward: '换取护士信任' },
        ],
        choiceHistory: [
          {
            branchId: 'ask-nurse',
            label: '追问护士昨晚停电记录',
            intent: '逼问',
            risk: '激怒护士',
            reward: '得到停电线索',
            outcome: '护士承认停电前有人改过值班表',
            impact: '林医生开始相信护士隐瞒了关键名单',
            choiceEpoch: 2,
          },
          {
            branchId: 'open-file',
            label: '打开被封存的病历柜',
            intent: '揭露',
            risk: '触发警报',
            reward: '拿到缺页名单',
            outcome: '柜门后的警报灯亮起，缺页名单被红太狼抢先收进衣袋',
            impact: '保安正在赶来，但失踪者姓名第一次变得完整',
            choiceEpoch: 4,
          },
        ],
        chapterRecap: {
          title: '阶段回顾',
          summary: '旧医院的秘密开始指向被撕掉的名单。',
          discoveredClues: ['缺页名单藏在封存病历柜里'],
          unresolvedQuestions: ['是谁提前改过值班表？'],
          changedRelationships: ['护士开始愿意配合红太狼'],
          stakes: ['保安正在赶来'],
          lastChoiceLabels: ['打开被封存的病历柜'],
          choiceImpacts: ['保安正在赶来，但失踪者姓名第一次变得完整'],
          updatedAt: 5,
          beatCount: 8,
        },
      },
    } satisfies GroupChat;

    const html = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={chat}
        members={[buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')]}
        messages={[]}
      />,
    );

    expect(html).toContain('关键抉择');
    expect(html).toContain('节点 2');
    expect(html).toContain('节点 4');
    expect(html).toContain('追问护士昨晚停电记录');
    expect(html).toContain('打开被封存的病历柜');
    expect(html).toContain('结果：护士承认停电前有人改过值班表');
    expect(html).toContain('影响：林医生开始相信护士隐瞒了关键名单');
    expect(html).toContain('结果：柜门后的警报灯亮起，缺页名单被红太狼抢先收进衣袋');
    expect(html).toContain('影响：保安正在赶来，但失踪者姓名第一次变得完整');
    expect(html).toContain('未走路径：跟着血迹去旧住院楼');
    expect(html).toContain('未走路径：先带护士离开走廊');
    expect(html).not.toContain('最近选择');
    expect(html).not.toContain('意图：');
    expect(html).not.toContain('风险：');
    expect(html).not.toContain('收益：');
    expect(html).not.toContain('逼问');
    expect(html).not.toContain('触发警报');
    expect(html).not.toContain('拿到缺页名单');
  });

  it('shows story quality trace only in developer advanced mode', async () => {
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
    const { useSettingsStore } = await import('../../stores/useSettingsStore');
    const chat = {
      ...buildChat(),
      mode: 'scripted_play' as const,
      sessionKind: { family: 'conversation' as const, scenarioId: 'story-reader', surfaceProfile: 'hybrid' as const, topology: 'group' as const },
      scenarioState: {
        phase: 'scene',
        storyGoal: '追查旧医院停电真相',
      },
    } satisfies GroupChat;
    const messages = [{
      id: 'story-quality-message',
      chatId: chat.id,
      type: 'ai' as const,
      senderId: 'narrator',
      senderName: '旁白',
      content: '他们继续往前走。',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      metadata: {
        storyQuality: {
          score: 58,
          labels: ['has_narration', 'has_story_hook'],
          gaps: ['weak_concrete_scene', 'no_character_speech'],
        },
      },
    }];

    const normalHtml = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={chat}
        members={[buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')]}
        messages={messages}
      />,
    );
    expect(normalHtml).not.toContain('故事质量');
    expect(normalHtml).not.toContain('质量 58');
    expect(normalHtml).not.toContain('场景细节弱');

    useSettingsStore.setState({
      developerMode: true,
      developerUI: { ...useSettingsStore.getState().developerUI, showAdvancedRuntimePanels: true },
    });
    const developerHtml = renderToStaticMarkup(
      <ChatNarrativePanel
        hideTitle
        chat={chat}
        members={[buildCharacter(uuidA, '红太狼'), buildCharacter(uuidB, '灰太狼')]}
        messages={messages}
      />,
    );
    expect(developerHtml).toContain('故事质量');
    expect(developerHtml).toContain('质量 58');
    expect(developerHtml).toContain('旁白');
    expect(developerHtml).toContain('悬念钩子');
    expect(developerHtml).toContain('待补：场景细节弱 / 缺少角色气泡');
  });

});
