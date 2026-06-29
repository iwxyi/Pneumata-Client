import type { ChatStyle, DiscussionMode, GroupChat, RuntimeEvolutionIntensity, SessionKind } from '../types/chat';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  DEFAULT_OPEN_CHAT_MODE_CONFIG,
  DEFAULT_OPEN_CHAT_MODE_STATE,
  createDefaultSessionKind,
} from '../types/chat';
import { getRoomTemplateDefaultsBySessionKind, hasTemplateDefault } from './roomTemplates';
import { normalizeRuntimeSeedLines } from './runtimeSeed';

export interface ChatDraftInput {
  type: 'group' | 'direct';
  name: string;
  topic: string;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  sessionKind?: SessionKind;
  discussionRoundsTarget?: number;
  storyBranchMode?: 'guided' | 'open';
  storyBackground?: string;
  storyDirection?: string;
  storyOutline?: string;
  studyGoalLabel?: string;
  agentGoalLabel?: string;
  boardColumns?: number;
  werewolfRoleConfig?: string;
  werewolfPostGameMode?: string;
  mysteryScript?: string;
  mysteryRoleMappingMode?: string;
  boardRows?: number;
  deductionFactionCount?: number;
  mysteryClueCount?: number;
  memberIds: string[];
  operatorIds?: string[];
  showRoleActions: boolean;
  seedMemoryText: string;
  seedArtifactText: string;
  ownerCharacterId: string | null;
  adminCharacterIds: string[];
  autoModeration: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
  allowCliques: boolean;
  allowMockery: boolean;
  mood: string;
  focus: string;
  recentEvent: string;
  allowSpeakAs: boolean;
  allowDirectorMode: boolean;
  allowEventInjection: boolean;
  allowForcedReply: boolean;
}

export function composeGroupMemberIds(memberIds: string[], includeUserAsMember: boolean) {
  const normalized = stripUserMemberId(memberIds);
  if (!includeUserAsMember) return normalized;
  return Array.from(new Set([...normalized, 'user']));
}

export function stripUserMemberId(memberIds: string[]) {
  return Array.from(new Set(memberIds.filter((id) => id && id !== 'user')));
}

export interface OperatorIdsNormalizationResult {
  normalizedIds: string[];
  effectiveIds: string[];
  filteredCount: number;
}

export function normalizeOperatorIdsInput(rawValue: string, memberIds: string[]): OperatorIdsNormalizationResult {
  const normalizedMemberIds = new Set(Array.from(new Set(memberIds.filter(Boolean))));
  const normalizedIds = Array.from(new Set(
    rawValue
      .split(/[,\n，]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
  const effectiveIds = normalizedIds.filter((id) => id !== 'user' && !normalizedMemberIds.has(id));
  return {
    normalizedIds,
    effectiveIds,
    filteredCount: normalizedIds.length - effectiveIds.length,
  };
}

function buildRuntimeSeed(input: Pick<ChatDraftInput, 'seedMemoryText' | 'seedArtifactText'>) {
  return {
    notes: normalizeRuntimeSeedLines(input.seedMemoryText, 'note'),
    artifacts: normalizeRuntimeSeedLines(input.seedArtifactText, 'artifact'),
  };
}

function compactDraftText(value: string | undefined, max = 1200) {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function compactStorySeedAsset(value: string | undefined, max = 56) {
  const text = compactDraftText(value, max + 20).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function splitStorySeedSentences(text: string) {
  return (text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [text])
    .map((part) => compactStorySeedAsset(part, 96))
    .filter(Boolean);
}

function pickLastMatch(texts: string[], pattern: RegExp) {
  for (const text of texts.slice().reverse()) {
    pattern.lastIndex = 0;
    const matches = Array.from(text.matchAll(pattern));
    const match = matches.at(-1)?.[0];
    if (match) return match;
  }
  return '';
}

function pickFirstMatch(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern))[0]?.[0] || '';
}

function pickLastMatchingSentence(sentences: string[], pattern: RegExp) {
  return sentences.slice().reverse().find((sentence) => {
    pattern.lastIndex = 0;
    return pattern.test(sentence);
  }) || '';
}

function pickFirstMatchingSentence(sentences: string[], pattern: RegExp) {
  return sentences.find((sentence) => {
    pattern.lastIndex = 0;
    return pattern.test(sentence);
  }) || '';
}

function mergeStorySeedAssets(items: string[], limit = 4) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const compact = compactStorySeedAsset(item);
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    result.push(compact);
    if (result.length >= limit) break;
  }
  return result;
}

function inferInitialSceneTime(seedTexts: string[]) {
  return compactStorySeedAsset(
    pickLastMatch(seedTexts, /雨夜|深夜|凌晨|清晨|黄昏|傍晚|夜里|白天|天亮|天黑|黎明|午后|开学周|此刻|现在|昨晚|今早|第二天/g),
    16,
  );
}

function inferInitialSceneLocation(seedTexts: string[], subject: string) {
  const text = seedTexts.join(' / ');
  const locationPattern = /(?:旧医院走廊|旧医院|地下档案室|封锁(?:的)?旧住院楼|旧住院楼|走廊尽头|宿舍群|宿舍|社团办公室|告白墙|校园|学校|医院|旧楼|走廊|病房|档案室|地下室|住院楼|新婚房|喜房|侯府喜帐|侯府|妆台|宫中|宫门|宫殿|太后寝宫|内宅|正院|祠堂|账房|房间|门口|院子|街|巷|车站|教室|办公室|实验室|仓库|码头|森林|城堡)/g;
  return compactStorySeedAsset(
    pickFirstMatch(text, locationPattern) || subject,
    32,
  );
}

function inferInitialVisibleThreat(sentences: string[]) {
  const sentence = pickFirstMatchingSentence(sentences, /(危险|威胁|血迹|异常|失踪|隐瞒|暴露|封锁|锁住|停电|真相|秘密|脚步声|敲击声|匿名|调换|无法解释|竞争|裂缝|质问|冒险)/);
  return compactStorySeedAsset(sentence, 56);
}

function inferInitialSeedAssets(sentences: string[]) {
  const clues = sentences.filter((sentence) => /(线索|证据|记录|名单|钥匙|档案|病历|血迹|痕迹|照片|录音|门缝|脚印|异常|真相|告白墙|停电|密诏|诏书|账册|账本|嫁妆|烙印|军器监|毒剑|短剑|毒物|玉佩|信物|口信)/.test(sentence));
  const stakes = sentences.filter((sentence) => /(危险|代价|风险|威胁|暴露|失去|来不及|安全|封锁|秘密|隐瞒|失踪|竞争|裂缝|公开质问|冒险|真相|旧账|吃醋|保护欲|误会|名声|赐婚|太后|宫中|侯府|家族|顾家|势力|试探|毒|淬毒|保全)/.test(sentence));
  const relationshipShifts = sentences.filter((sentence) => /(信任|怀疑|保护|隐瞒|背叛|靠近|疏远|敌意|动摇|试探|质问|承认|否认|友情|关系|站队|旧情人|现任|旧账|吃醋|保护欲|误会|拉扯|结盟|示弱|逼问|婆母|丫鬟|女主|太后|顾家|探口风)/.test(sentence));
  return {
    clues: mergeStorySeedAssets(clues, 4),
    stakes: mergeStorySeedAssets(stakes, 4),
    relationshipShifts: mergeStorySeedAssets(relationshipShifts, 3),
  };
}

function inferInitialOpenQuestions(subject: string, direction: string, sentences: string[]) {
  const questions: string[] = [];
  const add = (question: string) => {
    const compact = compactStorySeedAsset(question, 72);
    if (compact && !questions.includes(compact)) questions.push(compact);
  };
  const text = sentences.join(' / ');
  if (/(失踪|名单)/.test(text)) add('失踪名单上不该存在的名字来自哪里？');
  if (/停电/.test(text)) add('停电期间到底是谁改变了现场？');
  if (/(匿名|照片|告白墙)/.test(text)) add('匿名照片是谁发出来的，又想逼谁暴露？');
  if (/(误发|语音|三年前|分手真相|订婚宴)/.test(text)) add('误发语音为什么会把旧真相重新翻出来？');
  if (/(太后|密诏|宫中|侯府|顾家|军器监)/.test(text)) add('太后和侯府各自在试探谁，又想逼谁先露底？');
  if (/(毒剑|短剑|淬毒|毒物|烙印)/.test(text)) add('枕下毒剑到底是谁放进去的？');
  if (/(账册|账本|嫁妆|旧账)/.test(text)) add('侯府旧账里藏着哪一笔不能见光的交易？');
  if (/(隐瞒|秘密|无法解释|真相)/.test(text)) add(`${subject || '这个故事'}里最先暴露的秘密会牵连谁？`);
  if (subject) add(`${subject}背后真正隐藏着什么？`);
  else if (direction) add(`${direction}会把角色推向什么转折？`);
  return questions.slice(0, 3);
}

function buildInitialStoryAssets(input: Pick<ChatDraftInput, 'name' | 'topic' | 'storyBackground' | 'storyDirection' | 'storyOutline'>) {
  const name = compactDraftText(input.name);
  const topic = compactDraftText(input.topic);
  const background = compactDraftText(input.storyBackground);
  const direction = compactDraftText(input.storyDirection);
  const outline = compactDraftText(input.storyOutline);
  const subject = topic || name;
  const seedTexts = [subject, background, direction, outline].filter(Boolean);
  const seedSentences = splitStorySeedSentences(seedTexts.join('。'));
  const initialSeedAssets = inferInitialSeedAssets(seedSentences);
  const storyGoal = subject && direction
    ? `围绕「${subject}」推进：${direction}`
    : direction || subject;
  const storySituation = [background, subject && !background.includes(subject) ? `当前开场：${subject}` : '']
    .filter(Boolean)
    .join(' / ');
  const openQuestions = inferInitialOpenQuestions(subject, direction, seedSentences);
  const chapterMemory = [subject ? `开场：${subject}` : '', outline ? `提纲：${outline}` : '']
    .filter(Boolean)
    .join(' / ');
  const currentScene = subject || background
    ? {
        location: inferInitialSceneLocation(seedTexts, subject) || undefined,
        time: inferInitialSceneTime(seedTexts) || undefined,
        visibleThreat: inferInitialVisibleThreat(seedSentences) || undefined,
        summary: storySituation || subject || background,
        updatedAt: Date.now(),
      }
    : null;
  return {
    storyGoal,
    storySituation,
    currentScene,
    openQuestions,
    clues: initialSeedAssets.clues,
    stakes: initialSeedAssets.stakes,
    relationshipShifts: initialSeedAssets.relationshipShifts,
    chapterMemory,
  };
}

function resolveDiscussionMode(sessionKind: Pick<SessionKind, 'scenarioId'>, fallback?: DiscussionMode): DiscussionMode | null {
  if (sessionKind.scenarioId === 'roundtable-discussion') return 'roundtable';
  if (sessionKind.scenarioId === 'debate-arena') return 'debate';
  if (sessionKind.scenarioId === 'brainstorm-workshop') return 'brainstorm';
  if (sessionKind.scenarioId === 'retrospective-room') return 'retrospective';
  if (sessionKind.scenarioId === 'group-discussion') return fallback || 'open';
  return null;
}

function isDiscussionScenario(sessionKind: Pick<SessionKind, 'scenarioId'>) {
  return Boolean(resolveDiscussionMode(sessionKind));
}

function isOrderedDiscussionMode(mode: DiscussionMode | null) {
  return mode === 'roundtable' || mode === 'debate';
}

function buildDiscussionRoleAssignments(memberIds: string[], mode: DiscussionMode | null) {
  if (mode !== 'debate') return [];
  return memberIds
    .filter((memberId) => memberId !== 'user')
    .map((memberId, index) => {
      const roleId = index % 3 === 0 ? 'affirmative' : index % 3 === 1 ? 'negative' : 'reviewer';
      return {
        actorId: memberId,
        roleId,
        factionId: roleId === 'affirmative' ? 'pro' : roleId === 'negative' ? 'con' : 'review',
        summary: roleId === 'affirmative'
          ? '优先提出支持论据并回应反方挑战'
          : roleId === 'negative'
            ? '优先提出反对论据并检验正方漏洞'
            : '优先比较双方论据质量并提出判准',
      };
    });
}

export function buildGroupChatDraft(input: ChatDraftInput): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const sessionKind = input.sessionKind || createDefaultSessionKind('group', 'open_chat');
  const templateDefaults = getRoomTemplateDefaultsBySessionKind(sessionKind);
  const isStoryReader = sessionKind.scenarioId === 'story-reader';
  const discussionMode = resolveDiscussionMode(sessionKind, templateDefaults.discussionMode);
  const isDiscussionRoom = isDiscussionScenario(sessionKind);
  const initialStoryAssets = isStoryReader ? buildInitialStoryAssets(input) : null;
  const mode = sessionKind.scenarioId === 'group-discussion'
    ? 'group_discussion'
    : isOrderedDiscussionMode(discussionMode)
      ? 'roundtable'
      : isDiscussionRoom
        ? 'group_discussion'
      : sessionKind.scenarioId === 'story-reader'
        ? 'scripted_play'
        : sessionKind.scenarioId === 'ielts-coach'
          ? 'classroom'
          : sessionKind.scenarioId === 'single-agent-workflow' || sessionKind.scenarioId === 'multi-agent-workflow'
            ? 'agent_workflow'
            : sessionKind.scenarioId === 'board-game'
              ? 'board_game'
              : sessionKind.scenarioId === 'werewolf-classic'
                ? 'werewolf'
                : sessionKind.scenarioId === 'murder-mystery'
                  ? 'murder_mystery'
                  : 'open_chat';
  return {
    type: 'group',
    mode,
    sessionKind,
    modeConfig: {
      ...DEFAULT_OPEN_CHAT_MODE_CONFIG,
      showRoleActions: isStoryReader ? false : input.showRoleActions,
    },
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    scenarioPackage: {
      scenarioId: sessionKind.scenarioId,
      label: sessionKind.scenarioId,
    },
    scenarioState: {
      turnOrder: input.memberIds,
      currentTurnActorId: isOrderedDiscussionMode(discussionMode)
        ? input.memberIds.filter((id) => id !== 'user')[0] || null
        : null,
      board: sessionKind.scenarioId === 'board-game'
        ? { schema: { kind: 'grid', columns: input.boardColumns || 8, rows: input.boardRows || 8 }, pieces: [] }
        : null,
      factions: sessionKind.scenarioId === 'werewolf-classic'
        ? Array.from({ length: Math.max(2, input.deductionFactionCount || 2) }, (_, index) => ({ factionId: `faction-${index + 1}`, label: `阵营${index + 1}` }))
        : [],
      phase: templateDefaults.initialPhase
        || (discussionMode === 'roundtable'
          ? 'roundtable'
          : discussionMode === 'debate'
            ? 'debate'
            : discussionMode === 'brainstorm'
              ? 'brainstorm'
              : discussionMode === 'retrospective'
                ? 'retrospective'
          : sessionKind.scenarioId === 'board-game'
            ? 'board'
            : sessionKind.scenarioId === 'werewolf-classic'
              ? 'night'
              : sessionKind.scenarioId === 'murder-mystery'
                ? 'investigation'
                : undefined),
      goals: templateDefaults.goalLabel || isDiscussionRoom || sessionKind.scenarioId === 'werewolf-classic' || sessionKind.scenarioId === 'murder-mystery' || sessionKind.scenarioId === 'board-game'
        ? [{
            goalId: isDiscussionRoom ? 'discussion-goal' : `${sessionKind.family}-goal`,
            label: templateDefaults.goalLabel
              || (sessionKind.scenarioId === 'board-game'
                ? input.topic.trim() || input.name.trim()
                : sessionKind.scenarioId === 'werewolf-classic'
                  ? input.topic.trim() || '找出对手阵营'
                  : sessionKind.scenarioId === 'murder-mystery'
                    ? input.topic.trim() || '还原案件真相'
                    : input.studyGoalLabel?.trim() || input.agentGoalLabel?.trim() || input.topic.trim() || input.name.trim()),
            status: 'active',
            progress: 0,
          }]
        : [],
      progress: templateDefaults.progressLabel || isDiscussionRoom
        ? [{
            key: isDiscussionRoom ? 'speeches' : `${sessionKind.family}-progress`,
            label: templateDefaults.progressLabel || (discussionMode === 'roundtable' ? '圆桌发言' : '发言轮次'),
            value: 0,
            target: templateDefaults.progressTarget || (input.discussionRoundsTarget || 100),
          }]
        : sessionKind.scenarioId === 'werewolf-classic'
          ? [{ key: 'deduction-progress', label: '推理进度', value: 0, target: 100 }]
          : sessionKind.scenarioId === 'murder-mystery'
            ? [{ key: 'mystery-progress', label: '搜证进度', value: 0, target: input.mysteryClueCount || 6 }]
            : [],
      branches: isStoryReader
        ? []
        : hasTemplateDefault(templateDefaults, 'mysteryClueCount')
          ? Array.from({ length: Math.max(1, input.mysteryClueCount || templateDefaults.mysteryClueCount || 6) }, (_, index) => ({ branchId: `clue-${index + 1}`, label: `线索${index + 1}`, status: index === 0 ? 'available' : 'locked' }))
          : [],
      seats: input.memberIds.map((memberId, index) => ({ seatId: `seat-${index + 1}`, seatIndex: index, actorId: memberId })),
      roleAssignments: buildDiscussionRoleAssignments(input.memberIds, discussionMode),
      discussionMode: discussionMode || undefined,
      storyBackground: input.storyBackground || '',
      storyDirection: input.storyDirection || '',
      storyGoal: isStoryReader ? initialStoryAssets?.storyGoal : undefined,
      storySituation: isStoryReader ? initialStoryAssets?.storySituation : undefined,
      currentScene: isStoryReader ? initialStoryAssets?.currentScene : undefined,
      storyOutline: input.storyOutline || '',
      storyBeatKind: isStoryReader ? 'establish' : undefined,
      storyChoicePolicy: isStoryReader ? 'forbid' : undefined,
      storyBeatReason: isStoryReader ? 'establish scene before choices' : undefined,
      readerRole: isStoryReader ? (input.memberIds.includes('user') ? 'participant' : 'director') : undefined,
      storyProtocolDiagnostics: isStoryReader ? [] : undefined,
      openQuestions: isStoryReader ? initialStoryAssets?.openQuestions || [] : undefined,
      clues: isStoryReader ? initialStoryAssets?.clues || [] : undefined,
      stakes: isStoryReader ? initialStoryAssets?.stakes || [] : undefined,
      relationshipShifts: isStoryReader ? initialStoryAssets?.relationshipShifts || [] : undefined,
      choiceHistory: isStoryReader ? [] : undefined,
      chapterMemory: isStoryReader ? initialStoryAssets?.chapterMemory || '' : undefined,
      chapterRecap: isStoryReader ? null : undefined,
      storyChapters: isStoryReader ? [] : undefined,
      werewolfRoleConfig: input.werewolfRoleConfig || '',
      werewolfPostGameMode: input.werewolfPostGameMode || 'free_talk',
      mysteryScript: input.mysteryScript || '',
      mysteryRoleMappingMode: input.mysteryRoleMappingMode || 'alias',
    },
    channels: [{ channelId: 'public', visibility: 'public', label: 'Public' }],
    layoutState: { slots: input.memberIds.map((memberId, index) => ({ slotId: `slot-${index + 1}`, x: index, y: 0, actorId: memberId })) },
    judgeAgent: { enabled: false, style: 'assistive' },
    name: input.name.trim(),
    topic: input.topic.trim(),
    style: input.style,
    runtimeEvolutionIntensity: input.runtimeEvolutionIntensity,
    memberIds: input.memberIds,
    operatorIds: input.operatorIds || [],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: isStoryReader ? false : input.showRoleActions,
    topicSeed: '',
    runtimeSeed: buildRuntimeSeed(input),
    governance: {
      ...DEFAULT_CONVERSATION_GOVERNANCE,
      ownerCharacterId: input.ownerCharacterId,
      adminCharacterIds: input.adminCharacterIds,
      autoModeration: input.autoModeration,
      allowMute: input.allowMute,
      allowPrivateThreads: input.allowPrivateThreads,
    },
    dramaRules: {
      ...DEFAULT_CONVERSATION_DRAMA_RULES,
      allowCliques: input.allowCliques,
      allowMockery: input.allowMockery,
    },
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      mood: input.mood,
      focus: input.focus,
      recentEvent: input.recentEvent,
    },
    directorControls: {
      ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
      allowSpeakAs: input.allowSpeakAs,
      allowDirectorMode: input.allowDirectorMode,
      allowEventInjection: input.allowEventInjection,
      allowForcedReply: input.allowForcedReply,
    },
  };
}

export function buildDirectChatDraft(characterId: string, characterName: string): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const sessionKind = createDefaultSessionKind('direct', 'open_chat');
  return {
    type: 'direct',
    mode: 'open_chat',
    sessionKind,
    modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
    modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
    scenarioPackage: { scenarioId: sessionKind.scenarioId, label: sessionKind.scenarioId },
    scenarioState: {
      turnOrder: [characterId],
      currentTurnActorId: null,
      board: null,
      factions: [],
      seats: [{ seatId: 'seat-1', seatIndex: 0, actorId: characterId }],
      roleAssignments: [],
    },
    channels: [{ channelId: 'public', visibility: 'public', label: 'Public' }],
    layoutState: { slots: [{ slotId: 'slot-1', x: 0, y: 0, actorId: characterId }] },
    judgeAgent: { enabled: false, style: 'assistive' },
    name: characterName,
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: [characterId],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    governance: { ...DEFAULT_CONVERSATION_GOVERNANCE, allowMute: false, allowPrivateThreads: false },
    dramaRules: { ...DEFAULT_CONVERSATION_DRAMA_RULES, allowCliques: false, allowMockery: false },
    worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood: 'private', focus: '', recentEvent: '' },
    directorControls: { ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, allowEventInjection: false, allowForcedReply: false },
  };
}
