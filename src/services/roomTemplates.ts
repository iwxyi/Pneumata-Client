import type { ChatStyle, GroupChat, RuntimeEvolutionIntensity, SessionKind } from '../types/chat';
import { createDefaultSessionKind } from '../types/chat';

export type RoomTemplateStructure = 'conversation' | 'analysis' | 'study' | 'agent' | 'deduction' | 'mystery' | 'board_game' | 'simulation';
export type RoomTemplateCategory =
  | 'social'
  | 'story'
  | 'debate'
  | 'meeting'
  | 'language'
  | 'coaching'
  | 'solo_agent'
  | 'multi_agent'
  | 'strategy'
  | 'party_game'
  | 'case_play'
  | 'world';

export type RoomTemplateKey =
  | 'open_chat'
  | 'companion_hangout'
  | 'fandom_watch_party'
  | 'group_discussion'
  | 'roundtable_discussion'
  | 'debate_arena'
  | 'brainstorm_workshop'
  | 'retrospective_room'
  | 'story_reader'
  | 'campus_story'
  | 'romance_story'
  | 'ielts_coach'
  | 'interview_prep'
  | 'writing_coach'
  | 'single_agent_workflow'
  | 'research_agent_room'
  | 'multi_agent_workflow'
  | 'startup_war_room'
  | 'content_studio'
  | 'board_game'
  | 'chess_study_board'
  | 'werewolf'
  | 'social_deduction_party'
  | 'murder_mystery'
  | 'courtroom_case'
  | 'social_simulation';

export interface RoomTemplateDefaults {
  discussionRoundsTarget?: number;
  storyBranchMode?: 'guided' | 'open';
  studyGoalLabel?: string;
  agentGoalLabel?: string;
  boardColumns?: number;
  boardRows?: number;
  deductionFactionCount?: number;
  mysteryClueCount?: number;
  initialPhase?: string;
  progressLabel?: string;
  progressTarget?: number;
  goalLabel?: string;
  allowPrivateThreads?: boolean;
  allowCliques?: boolean;
  allowMockery?: boolean;
}

export interface RoomTemplateDefinition {
  key: RoomTemplateKey;
  label: string;
  description: string;
  structure: RoomTemplateStructure;
  category: RoomTemplateCategory;
  categoryLabel: string;
  sessionKind: SessionKind;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  topicPlaceholder: string;
  defaults?: RoomTemplateDefaults;
}

function createTemplateSessionKind(type: GroupChat['type'], mode: GroupChat['mode'], patch: Partial<SessionKind>): SessionKind {
  return {
    ...createDefaultSessionKind(type, mode),
    ...patch,
  };
}

function createTemplate(definition: RoomTemplateDefinition): RoomTemplateDefinition {
  return definition;
}

export const ROOM_TEMPLATES: RoomTemplateDefinition[] = [
  createTemplate({
    key: 'open_chat',
    label: '自由群聊',
    description: '开放聊天、关系推进、自由互动。',
    structure: 'conversation',
    category: 'social',
    categoryLabel: '社交互动',
    sessionKind: createTemplateSessionKind('group', 'open_chat', { family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text', topology: 'group' }),
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入一个话题，让角色开始自由互动',
    defaults: { allowPrivateThreads: true, allowCliques: true, allowMockery: true },
  }),
  createTemplate({
    key: 'companion_hangout',
    label: '陪伴闲聊',
    description: '更轻松、偏陪伴和日常生活感。',
    structure: 'conversation',
    category: 'social',
    categoryLabel: '社交互动',
    sessionKind: createTemplateSessionKind('group', 'open_chat', { family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text', topology: 'group' }),
    style: 'free',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入今天发生的事、心情或想一起聊的话题',
    defaults: { allowPrivateThreads: true, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'fandom_watch_party',
    label: '追剧追番房',
    description: '适合边看边聊、角色实时评论和站队。',
    structure: 'conversation',
    category: 'social',
    categoryLabel: '社交互动',
    sessionKind: createTemplateSessionKind('group', 'open_chat', { family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入你们正在追的剧、番或节目',
    defaults: { allowPrivateThreads: true, allowCliques: true, allowMockery: true },
  }),
  createTemplate({
    key: 'story_reader',
    label: '故事房',
    description: '用选项和角色反应推动故事分支。',
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入故事开场或当前剧情节点',
    defaults: { storyBranchMode: 'guided', initialPhase: 'scene', goalLabel: '主线剧情', allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'campus_story',
    label: '校园群像',
    description: '适合校园、宿舍、社团群像互动。',
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入校园背景、角色关系和开场事件',
    defaults: { storyBranchMode: 'guided', allowPrivateThreads: false, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'romance_story',
    label: '恋爱剧情',
    description: '适合暧昧、恋爱、修罗场和关系推进剧情。',
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入关系设定、情感冲突或剧情节点',
    defaults: { storyBranchMode: 'guided', allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'group_discussion',
    label: '小组讨论',
    description: '强调发言承接、观点推进和阶段性总结。',
    structure: 'analysis',
    category: 'debate',
    categoryLabel: '讨论辩论',
    sessionKind: createTemplateSessionKind('group', 'group_discussion', { family: 'analysis', scenarioId: 'group-discussion', surfaceProfile: 'text', topology: 'group' }),
    style: 'brainstorm',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入讨论议题，例如：AI 会取代哪些职业？',
    defaults: { discussionRoundsTarget: 6, initialPhase: 'discussion', goalLabel: '小组讨论', progressLabel: '发言轮次', allowPrivateThreads: true, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'roundtable_discussion',
    label: '圆桌讨论',
    description: '更强调轮流发言、集中观点和主持节奏。',
    structure: 'analysis',
    category: 'debate',
    categoryLabel: '讨论辩论',
    sessionKind: createTemplateSessionKind('group', 'roundtable', { family: 'analysis', scenarioId: 'roundtable-discussion', surfaceProfile: 'text', topology: 'table' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入圆桌议题，例如：未来教育会如何变化？',
    defaults: { discussionRoundsTarget: 4, allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'debate_arena',
    label: '辩论场',
    description: '更强调对立立场、反驳和论证推进。',
    structure: 'analysis',
    category: 'debate',
    categoryLabel: '讨论辩论',
    sessionKind: createTemplateSessionKind('group', 'roundtable', { family: 'analysis', scenarioId: 'roundtable-discussion', surfaceProfile: 'text', topology: 'table' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入正反命题，例如：AI 应该拥有法律人格吗？',
    defaults: { discussionRoundsTarget: 5, allowPrivateThreads: false, allowCliques: true, allowMockery: true },
  }),
  createTemplate({
    key: 'brainstorm_workshop',
    label: '头脑风暴',
    description: '适合灵感发散、点子扩展和共创。',
    structure: 'analysis',
    category: 'meeting',
    categoryLabel: '会议协作',
    sessionKind: createTemplateSessionKind('group', 'group_discussion', { family: 'analysis', scenarioId: 'group-discussion', surfaceProfile: 'text', topology: 'group' }),
    style: 'brainstorm',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入创意主题，例如：设计一个未来校园产品',
    defaults: { discussionRoundsTarget: 8, allowPrivateThreads: true, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'retrospective_room',
    label: '复盘会',
    description: '适合项目、比赛、学习后的复盘。',
    structure: 'analysis',
    category: 'meeting',
    categoryLabel: '会议协作',
    sessionKind: createTemplateSessionKind('group', 'group_discussion', { family: 'analysis', scenarioId: 'group-discussion', surfaceProfile: 'text', topology: 'group' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入要复盘的项目、活动或结果',
    defaults: { discussionRoundsTarget: 4, allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'ielts_coach',
    label: '雅思陪练',
    description: '适合陪学、训练、目标推进和反馈。',
    structure: 'study',
    category: 'language',
    categoryLabel: '语言考试',
    sessionKind: createTemplateSessionKind('group', 'classroom', { family: 'study', scenarioId: 'ielts-coach', surfaceProfile: 'form', topology: 'group' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入学习目标，例如：雅思口语 7.5',
    defaults: { studyGoalLabel: '雅思口语 7.5', initialPhase: 'learning', progressLabel: '学习进度', progressTarget: 100, allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'interview_prep',
    label: '面试训练',
    description: '适合模拟面试、追问和反馈。',
    structure: 'study',
    category: 'coaching',
    categoryLabel: '训练辅导',
    sessionKind: createTemplateSessionKind('group', 'interview', { family: 'study', scenarioId: 'ielts-coach', surfaceProfile: 'form', topology: 'group' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入岗位、方向或训练目标',
    defaults: { studyGoalLabel: '完成一轮结构化面试训练', allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'writing_coach',
    label: '写作辅导',
    description: '适合论文、文案、作文和长期写作改进。',
    structure: 'study',
    category: 'coaching',
    categoryLabel: '训练辅导',
    sessionKind: createTemplateSessionKind('group', 'classroom', { family: 'study', scenarioId: 'ielts-coach', surfaceProfile: 'form', topology: 'group' }),
    style: 'free',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入写作目标，例如：完成一篇申请文书',
    defaults: { studyGoalLabel: '完成一篇高质量写作任务', allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'single_agent_workflow',
    label: '单Agent房',
    description: '适合任务拆解、执行和持续推进。',
    structure: 'agent',
    category: 'solo_agent',
    categoryLabel: '单Agent执行',
    sessionKind: createTemplateSessionKind('group', 'agent_workflow', { family: 'agent', scenarioId: 'single-agent-workflow', surfaceProfile: 'dashboard', topology: 'team' }),
    style: 'free',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入任务目标，例如：写一份产品分析报告',
    defaults: { agentGoalLabel: '完成任务并输出结果', initialPhase: 'planning', progressLabel: '任务进度', progressTarget: 100, allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'research_agent_room',
    label: '研究助手房',
    description: '适合调研、资料整理和持续产出。',
    structure: 'agent',
    category: 'solo_agent',
    categoryLabel: '单Agent执行',
    sessionKind: createTemplateSessionKind('group', 'agent_workflow', { family: 'agent', scenarioId: 'single-agent-workflow', surfaceProfile: 'dashboard', topology: 'team' }),
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入调研主题，例如：AI 陪伴产品市场格局',
    defaults: { agentGoalLabel: '完成研究并沉淀结论', allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'multi_agent_workflow',
    label: '多Agent房',
    description: '适合程序员、产品、测试、市场等多角色协作。',
    structure: 'agent',
    category: 'multi_agent',
    categoryLabel: '多Agent协作',
    sessionKind: createTemplateSessionKind('group', 'agent_workflow', { family: 'agent', scenarioId: 'multi-agent-workflow', surfaceProfile: 'dashboard', topology: 'team' }),
    style: 'brainstorm',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入协作目标，例如：从0到1设计一款产品',
    defaults: { agentGoalLabel: '多角色协作推进目标', allowPrivateThreads: false, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'startup_war_room',
    label: '创业战情室',
    description: '适合多角色围绕产品、增长、融资做协作。',
    structure: 'agent',
    category: 'multi_agent',
    categoryLabel: '多Agent协作',
    sessionKind: createTemplateSessionKind('group', 'agent_workflow', { family: 'agent', scenarioId: 'multi-agent-workflow', surfaceProfile: 'dashboard', topology: 'team' }),
    style: 'brainstorm',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入创业目标、产品阶段或当前问题',
    defaults: { agentGoalLabel: '围绕创业目标完成协作拆解', allowPrivateThreads: false, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'content_studio',
    label: '内容工作室',
    description: '适合作者、编辑、运营、设计协作出内容。',
    structure: 'agent',
    category: 'multi_agent',
    categoryLabel: '多Agent协作',
    sessionKind: createTemplateSessionKind('group', 'agent_workflow', { family: 'agent', scenarioId: 'multi-agent-workflow', surfaceProfile: 'dashboard', topology: 'team' }),
    style: 'brainstorm',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入选题、栏目或需要共创的内容目标',
    defaults: { agentGoalLabel: '完成一次内容共创与交付', allowPrivateThreads: false, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'board_game',
    label: '棋盘房',
    description: '适合下棋、推演和回合制对局。',
    structure: 'board_game',
    category: 'strategy',
    categoryLabel: '棋盘策略',
    sessionKind: createTemplateSessionKind('group', 'board_game', { family: 'board_game', scenarioId: 'board-game', surfaceProfile: 'board', topology: 'table' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入棋局目标或玩法说明',
    defaults: { boardColumns: 8, boardRows: 8, allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'chess_study_board',
    label: '棋局复盘',
    description: '适合讲解棋路、训练推演和策略分析。',
    structure: 'board_game',
    category: 'strategy',
    categoryLabel: '棋盘策略',
    sessionKind: createTemplateSessionKind('group', 'board_game', { family: 'board_game', scenarioId: 'board-game', surfaceProfile: 'board', topology: 'table' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入棋谱、局势或复盘目标',
    defaults: { boardColumns: 8, boardRows: 8, allowPrivateThreads: false, allowCliques: false, allowMockery: false },
  }),
  createTemplate({
    key: 'werewolf',
    label: '狼人杀',
    description: '支持身份、阵营、昼夜与投票的推理对抗玩法。',
    structure: 'deduction',
    category: 'party_game',
    categoryLabel: '派对推理',
    sessionKind: createTemplateSessionKind('group', 'werewolf', { family: 'deduction', scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid', topology: 'table' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入本局规则说明或背景设定',
    defaults: { deductionFactionCount: 2, allowPrivateThreads: false, allowCliques: true, allowMockery: true },
  }),
  createTemplate({
    key: 'social_deduction_party',
    label: '社交推理局',
    description: '适合带私密身份、怀疑与联盟变化的对抗局。',
    structure: 'deduction',
    category: 'party_game',
    categoryLabel: '派对推理',
    sessionKind: createTemplateSessionKind('group', 'werewolf', { family: 'deduction', scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid', topology: 'table' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入局内设定、身份规则或背景故事',
    defaults: { deductionFactionCount: 3, allowPrivateThreads: false, allowCliques: true, allowMockery: true },
  }),
  createTemplate({
    key: 'murder_mystery',
    label: '剧本杀',
    description: '支持角色卡、线索、搜证和私密信息的剧情玩法。',
    structure: 'mystery',
    category: 'case_play',
    categoryLabel: '案件剧本',
    sessionKind: createTemplateSessionKind('group', 'murder_mystery', { family: 'mystery', scenarioId: 'murder-mystery', surfaceProfile: 'hybrid', topology: 'table' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '输入剧本背景或案件设定',
    defaults: { mysteryClueCount: 6, allowPrivateThreads: false, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'courtroom_case',
    label: '法庭案件房',
    description: '适合法庭辩论、证据比对和案件还原。',
    structure: 'mystery',
    category: 'case_play',
    categoryLabel: '案件剧本',
    sessionKind: createTemplateSessionKind('group', 'murder_mystery', { family: 'mystery', scenarioId: 'murder-mystery', surfaceProfile: 'hybrid', topology: 'table' }),
    style: 'debate',
    runtimeEvolutionIntensity: 'balanced',
    topicPlaceholder: '输入案件、证据方向或法庭议题',
    defaults: { mysteryClueCount: 8, allowPrivateThreads: false, allowCliques: true, allowMockery: false },
  }),
  createTemplate({
    key: 'social_simulation',
    label: '世界模拟房',
    description: '适合社区、校园、公司、论坛等长期世界演化。',
    structure: 'simulation',
    category: 'world',
    categoryLabel: '世界模拟',
    sessionKind: createTemplateSessionKind('group', 'open_chat', { family: 'simulation', scenarioId: 'open-chat', surfaceProfile: 'timeline', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'fast',
    topicPlaceholder: '输入世界背景、群体关系和初始事件',
    defaults: { allowPrivateThreads: true, allowCliques: true, allowMockery: true },
  }),
];

export function getRoomTemplate(key: RoomTemplateKey) {
  return ROOM_TEMPLATES.find((item) => item.key === key) || ROOM_TEMPLATES[0];
}

export function listTemplateStructures() {
  return Array.from(new Map(ROOM_TEMPLATES.map((item) => [item.structure, item])).values()).map((item) => ({
    value: item.structure,
    label: item.categoryLabel,
    family: item.sessionKind.family,
  }));
}

export function listTemplateCategories(structure: RoomTemplateStructure) {
  return Array.from(new Map(ROOM_TEMPLATES.filter((item) => item.structure === structure).map((item) => [item.category, item])).values()).map((item) => ({
    value: item.category,
    label: item.categoryLabel,
  }));
}

export function listTemplatesByStructureAndCategory(structure: RoomTemplateStructure, category: RoomTemplateCategory) {
  return ROOM_TEMPLATES.filter((item) => item.structure === structure && item.category === category);
}

export function findRoomTemplateBySessionKind(sessionKind: Pick<SessionKind, 'scenarioId' | 'family'>) {
  return ROOM_TEMPLATES.find((item) => item.sessionKind.scenarioId === sessionKind.scenarioId && item.sessionKind.family === sessionKind.family) || null;
}

export function getRoomTemplateDefaultsBySessionKind(sessionKind: Pick<SessionKind, 'scenarioId' | 'family'>) {
  return findRoomTemplateBySessionKind(sessionKind)?.defaults || {};
}

export function getRoomTemplateKeyBySessionKind(sessionKind: Pick<SessionKind, 'scenarioId' | 'family'>) {
  return findRoomTemplateBySessionKind(sessionKind)?.key || null;
}

export function hasTemplateDefault<K extends keyof RoomTemplateDefaults>(
  defaults: RoomTemplateDefaults | undefined,
  key: K,
): defaults is RoomTemplateDefaults & Required<Pick<RoomTemplateDefaults, K>> {
  return defaults?.[key] !== undefined;
}
