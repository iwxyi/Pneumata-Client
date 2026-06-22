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
  | 'palace_intrigue_story'
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

export interface RoomTemplateFieldDefinition {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'single_select';
  required?: boolean;
  advanced?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

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
  storyBackground?: string;
  storyDirection?: string;
  storyOutline?: string;
  werewolfRoleConfig?: string;
  werewolfPostGameMode?: string;
  mysteryScript?: string;
  mysteryRoleMappingMode?: string;
}

export interface RoomTemplateConfigGroup {
  key: string;
  label: string;
  description?: string;
  fields: RoomTemplateFieldDefinition[];
}

export interface RoomTemplateDefinition {
  key: RoomTemplateKey;
  label: string;
  description: string;
  sellingPoints?: string[];
  structure: RoomTemplateStructure;
  category: RoomTemplateCategory;
  categoryLabel: string;
  sessionKind: SessionKind;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  topicPlaceholder: string;
  defaults?: RoomTemplateDefaults;
  configGroups?: RoomTemplateConfigGroup[];
}

export interface RoomTemplatePreview {
  hook: string;
  direction: string;
  readerPromise: string;
  firstChapterGoal: string;
  trackedAssets: string[];
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
    configGroups: [
      {
        key: 'social-advanced',
        label: '互动规则',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下线程', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowCliques', label: '允许小圈子', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowMockery', label: '允许冲突和嘲讽', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'companion-advanced',
        label: '陪伴互动规则',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下线程', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowCliques', label: '允许小圈子', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowMockery', label: '允许尖锐表达', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'watch-party-advanced',
        label: '伴看互动规则',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下吐槽', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowCliques', label: '允许站队小圈子', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowMockery', label: '允许犀利吐槽', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
  }),
  createTemplate({
    key: 'story_reader',
    label: '故事房',
    description: '用选项和角色反应推动故事分支。',
    sellingPoints: ['关键选择留后果', '线索账本', '章节回看'],
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '例如：雨夜旧医院、失踪名单、枕下长剑',
    defaults: {
      storyBranchMode: 'guided',
      initialPhase: 'scene',
      goalLabel: '主线剧情',
      allowPrivateThreads: false,
      allowCliques: false,
      allowMockery: false,
      storyBackground: '雨夜，旧医院停电后仍有一层楼亮着灯。三名角色为了各自的秘密来到这里，失踪名单上却多出一个不该存在的名字。',
      storyDirection: '悬疑推进：围绕失踪名单、停电记录和角色隐瞒展开，让用户在追问、搜证、保护或冒险之间做关键选择。',
      storyOutline: '开场建立旧医院和失踪名单；第一轮制造停电与脚步声压力；随后让用户选择追问知情者、检查血迹或进入档案室。',
    },
    configGroups: [
      {
        key: 'story-required',
        label: '故事主设定',
        fields: [
          { key: 'storyBackground', label: '背景设定', kind: 'textarea', required: true, placeholder: '世界背景、时间地点、主要关系' },
          { key: 'storyDirection', label: '发展方向', kind: 'textarea', required: true, placeholder: '希望更偏恋爱、悬疑、成长、修罗场还是冒险' },
        ],
      },
      {
        key: 'story-optional',
        label: '补充设定',
        fields: [
          { key: 'storyOutline', label: '剧情提纲', kind: 'textarea', placeholder: '可选：写下你已有的大纲、伏笔或关键转折' },
        ],
      },
    ],
  }),
  createTemplate({
    key: 'campus_story',
    label: '校园群像',
    description: '适合校园、宿舍、社团群像互动。',
    sellingPoints: ['友情裂缝', '匿名线索', '站队变化'],
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '例如：社团招新夜、宿舍停电、匿名告白墙',
    defaults: {
      storyBranchMode: 'guided',
      allowPrivateThreads: false,
      allowCliques: true,
      allowMockery: false,
      storyBackground: '开学周的夜晚，社团招新名单被人调换，宿舍群里突然出现一张匿名照片。几名学生都在照片角落里留下了无法解释的痕迹。',
      storyDirection: '校园群像推进：围绕社团竞争、友情裂缝和匿名照片展开，让用户在维护关系、追查真相和公开质问之间做选择。',
      storyOutline: '开场从招新名单异常切入；让角色在宿舍、社团办公室和告白墙之间移动；每个选择都影响信任、站队和秘密暴露。',
    },
    configGroups: [
      {
        key: 'campus-story-required',
        label: '校园主设定',
        fields: [
          { key: 'storyBackground', label: '校园背景', kind: 'textarea', required: true, placeholder: '学校、宿舍、社团、人物关系' },
          { key: 'storyDirection', label: '剧情方向', kind: 'textarea', required: true, placeholder: '成长、群像、社团竞争、友情或恋爱' },
        ],
      },
      {
        key: 'campus-story-optional',
        label: '可选补充',
        fields: [
          { key: 'storyOutline', label: '事件提纲', kind: 'textarea', placeholder: '例如：开学周、社团招新、晚自习冲突' },
        ],
      },
    ],
  }),
  createTemplate({
    key: 'romance_story',
    label: '恋爱剧情',
    description: '适合暧昧、恋爱、修罗场和关系推进剧情。',
    sellingPoints: ['关系拉扯', '选择影响信任', '修罗场回看'],
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '例如：重逢晚宴、误发语音、雨夜送伞',
    defaults: {
      storyBranchMode: 'guided',
      allowPrivateThreads: false,
      allowCliques: false,
      allowMockery: false,
      storyBackground: '一场临时取消的订婚宴后，旧情人和现任同时出现在同一间包厢。桌上的手机亮起，误发的语音把三年前的分手真相重新推到所有人面前。',
      storyDirection: '情感拉扯推进：围绕误会、旧账、吃醋和保护欲展开，让用户在坦白、试探、回避或当众追问之间做选择。',
      storyOutline: '开场建立包厢重逢和误发语音；第一轮让沉默变成压力；后续选择影响信任、占有欲和关系走向。',
    },
    configGroups: [
      {
        key: 'romance-story-required',
        label: '关系主设定',
        fields: [
          { key: 'storyBackground', label: '关系背景', kind: 'textarea', required: true, placeholder: '人物关系、相识过程、当前气氛' },
          { key: 'storyDirection', label: '情感方向', kind: 'textarea', required: true, placeholder: '暧昧、拉扯、修罗场、破镜重圆等' },
        ],
      },
      {
        key: 'romance-story-optional',
        label: '可选补充',
        fields: [
          { key: 'storyOutline', label: '关键节点', kind: 'textarea', placeholder: '例如：表白、误会、吃醋、和好' },
        ],
      },
    ],
  }),
  createTemplate({
    key: 'palace_intrigue_story',
    label: '权谋宅斗',
    description: '适合侯府、宫廷、家族秘密和多方试探。',
    sellingPoints: ['太后试探', '侯府旧账', '名声代价'],
    structure: 'conversation',
    category: 'story',
    categoryLabel: '互动故事',
    sessionKind: createTemplateSessionKind('group', 'scripted_play', { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' }),
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    topicPlaceholder: '例如：新婚夜、太后密诏、侯府旧账',
    defaults: {
      storyBranchMode: 'guided',
      allowPrivateThreads: false,
      allowCliques: true,
      allowMockery: false,
      storyBackground: '新婚夜的侯府喜帐还未撤下，枕下却藏着一把淬毒短剑。太后密诏、军器监烙印和顾家旧账同时浮出水面，每个来请安的人都像是在替不同势力探口风。',
      storyDirection: '权谋宅斗推进：围绕太后试探、侯府旧账、枕下毒剑和贴身丫鬟的隐瞒展开，让用户在示弱、逼问、结盟、反试探和保全名声之间做关键选择。',
      storyOutline: '开场从新婚房中的毒剑和军器监烙印切入；第一轮让贴身丫鬟、婆母和太后口信形成三方压力；后续选择影响顾家信任、宫中态度和女主能否掌握主动权。',
    },
    configGroups: [
      {
        key: 'palace-intrigue-required',
        label: '权谋主设定',
        fields: [
          { key: 'storyBackground', label: '局势背景', kind: 'textarea', required: true, placeholder: '侯府、宫廷、婚事、家族旧账或势力关系' },
          { key: 'storyDirection', label: '博弈方向', kind: 'textarea', required: true, placeholder: '宅斗、权谋、宫廷试探、家族秘密、名声危机等' },
        ],
      },
      {
        key: 'palace-intrigue-optional',
        label: '可选补充',
        fields: [
          { key: 'storyOutline', label: '关键伏笔', kind: 'textarea', placeholder: '例如：太后密诏、嫁妆账册、毒物来源、旧案翻出' },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'discussion-required',
        label: '讨论主设定',
        fields: [
          { key: 'discussionRoundsTarget', label: '目标发言轮次', kind: 'number', required: true },
        ],
      },
      {
        key: 'discussion-advanced',
        label: '讨论风格',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下线程', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowCliques', label: '允许结盟与小圈子', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowMockery', label: '允许尖锐或嘲讽', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'roundtable-required',
        label: '圆桌主设定',
        fields: [
          { key: 'discussionRoundsTarget', label: '目标轮次', kind: 'number', required: true },
        ],
      },
      {
        key: 'roundtable-advanced',
        label: '圆桌规则',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下线程', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'debate-required',
        label: '辩论主设定',
        fields: [
          { key: 'discussionRoundsTarget', label: '目标轮次', kind: 'number', required: true },
        ],
      },
      {
        key: 'debate-advanced',
        label: '辩论规则',
        fields: [
          { key: 'allowCliques', label: '允许结盟', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowMockery', label: '允许尖锐交锋', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'brainstorm-required',
        label: '共创主设定',
        fields: [
          { key: 'discussionRoundsTarget', label: '目标轮次', kind: 'number', required: true },
        ],
      },
      {
        key: 'brainstorm-advanced',
        label: '共创规则',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下小组讨论', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'retrospective-required',
        label: '复盘主设定',
        fields: [
          { key: 'discussionRoundsTarget', label: '目标轮次', kind: 'number', required: true },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'study-required',
        label: '学习主设定',
        fields: [
          { key: 'studyGoalLabel', label: '学习目标', kind: 'text', required: true, placeholder: '例如：雅思口语 7.5' },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'interview-required',
        label: '训练主设定',
        fields: [
          { key: 'studyGoalLabel', label: '训练目标', kind: 'text', required: true, placeholder: '例如：前端工程师一面模拟' },
        ],
      },
      {
        key: 'interview-advanced',
        label: '训练风格',
        fields: [
          { key: 'allowMockery', label: '允许尖锐追问', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'writing-required',
        label: '写作主设定',
        fields: [
          { key: 'studyGoalLabel', label: '写作目标', kind: 'text', required: true, placeholder: '例如：申请文书、小说开篇、产品长文' },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'agent-required',
        label: '任务主设定',
        fields: [
          { key: 'agentGoalLabel', label: '任务目标', kind: 'textarea', required: true, placeholder: '希望这个房间最终完成什么' },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'research-agent-required',
        label: '研究主设定',
        fields: [
          { key: 'agentGoalLabel', label: '研究目标', kind: 'textarea', required: true, placeholder: '明确要研究什么、沉淀什么' },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'multi-agent-required',
        label: '协作主设定',
        fields: [
          { key: 'agentGoalLabel', label: '协作目标', kind: 'textarea', required: true, placeholder: '最终要一起完成什么' },
        ],
      },
      {
        key: 'multi-agent-advanced',
        label: '协作风格',
        fields: [
          { key: 'allowCliques', label: '允许形成小组分工', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'startup-required',
        label: '战情主设定',
        fields: [
          { key: 'agentGoalLabel', label: '战情目标', kind: 'textarea', required: true, placeholder: '本轮创业协作要达成什么' },
        ],
      },
      {
        key: 'startup-advanced',
        label: '协作规则',
        fields: [
          { key: 'allowCliques', label: '允许小组分工', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'content-required',
        label: '内容主设定',
        fields: [
          { key: 'agentGoalLabel', label: '内容目标', kind: 'textarea', required: true, placeholder: '这次内容协作要产出什么' },
        ],
      },
      {
        key: 'content-advanced',
        label: '协作规则',
        fields: [
          { key: 'allowCliques', label: '允许角色分工', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'board-required',
        label: '棋盘主设定',
        fields: [
          { key: 'boardColumns', label: '棋盘列数', kind: 'number', required: true },
          { key: 'boardRows', label: '棋盘行数', kind: 'number', required: true },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'board-review-required',
        label: '棋局主设定',
        fields: [
          { key: 'boardColumns', label: '棋盘列数', kind: 'number', required: true },
          { key: 'boardRows', label: '棋盘行数', kind: 'number', required: true },
        ],
      },
    ],
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
    defaults: { deductionFactionCount: 2, allowPrivateThreads: false, allowCliques: true, allowMockery: true, werewolfRoleConfig: '', werewolfPostGameMode: 'free_talk' },
    configGroups: [
      {
        key: 'werewolf-required',
        label: '本局规则',
        fields: [
          { key: 'deductionFactionCount', label: '阵营数量', kind: 'number', required: true },
          { key: 'werewolfRoleConfig', label: '角色分配方案', kind: 'textarea', required: true, placeholder: '例如：2狼、1预言家、1女巫、其余平民' },
        ],
      },
      {
        key: 'werewolf-advanced',
        label: '进阶流程',
        fields: [
          { key: 'werewolfPostGameMode', label: '结束后交流', kind: 'single_select', advanced: true, options: [{ label: '自由交流', value: 'free_talk' }, { label: '复盘总结', value: 'review' }, { label: '直接重开', value: 'restart' }] },
        ],
      },
    ],
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
    defaults: { deductionFactionCount: 3, allowPrivateThreads: false, allowCliques: true, allowMockery: true, werewolfRoleConfig: '', werewolfPostGameMode: 'review' },
    configGroups: [
      {
        key: 'social-deduction-required',
        label: '对抗主设定',
        fields: [
          { key: 'deductionFactionCount', label: '阵营数量', kind: 'number', required: true },
          { key: 'werewolfRoleConfig', label: '身份规则', kind: 'textarea', required: true, placeholder: '写下身份、人数和特殊规则' },
        ],
      },
      {
        key: 'social-deduction-advanced',
        label: '对局尾声',
        fields: [
          { key: 'werewolfPostGameMode', label: '结束后交流', kind: 'single_select', advanced: true, options: [{ label: '自由交流', value: 'free_talk' }, { label: '复盘总结', value: 'review' }, { label: '直接重开', value: 'restart' }] },
        ],
      },
    ],
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
    defaults: { mysteryClueCount: 6, allowPrivateThreads: false, allowCliques: true, allowMockery: false, mysteryScript: '', mysteryRoleMappingMode: 'alias' },
    configGroups: [
      {
        key: 'mystery-required',
        label: '剧本主设定',
        fields: [
          { key: 'mysteryScript', label: '剧本内容 / 背景', kind: 'textarea', required: true, placeholder: '输入案件背景、人物关系、冲突和关键秘密' },
          { key: 'mysteryClueCount', label: '线索数量', kind: 'number', required: true },
        ],
      },
      {
        key: 'mystery-advanced',
        label: '身份映射与展示',
        fields: [
          { key: 'mysteryRoleMappingMode', label: '群内昵称显示', kind: 'single_select', advanced: true, options: [{ label: '原名（身份名）', value: 'alias' }, { label: '只显示身份名', value: 'role_only' }, { label: '保持原名', value: 'original' }] },
        ],
      },
    ],
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
    defaults: { mysteryClueCount: 8, allowPrivateThreads: false, allowCliques: true, allowMockery: false, mysteryScript: '', mysteryRoleMappingMode: 'alias' },
    configGroups: [
      {
        key: 'courtroom-required',
        label: '案件主设定',
        fields: [
          { key: 'mysteryScript', label: '案件背景 / 证据框架', kind: 'textarea', required: true, placeholder: '案件背景、证据点、争议焦点' },
          { key: 'mysteryClueCount', label: '证据数量', kind: 'number', required: true },
        ],
      },
      {
        key: 'courtroom-advanced',
        label: '身份展示',
        fields: [
          { key: 'mysteryRoleMappingMode', label: '群内昵称显示', kind: 'single_select', advanced: true, options: [{ label: '原名（身份名）', value: 'alias' }, { label: '只显示身份名', value: 'role_only' }, { label: '保持原名', value: 'original' }] },
        ],
      },
    ],
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
    configGroups: [
      {
        key: 'simulation-advanced',
        label: '世界互动规则',
        fields: [
          { key: 'allowPrivateThreads', label: '允许私下线程', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowCliques', label: '允许结盟和派系', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
          { key: 'allowMockery', label: '允许冲突和嘲讽', kind: 'single_select', advanced: true, options: [{ label: '允许', value: 'true' }, { label: '关闭', value: 'false' }] },
        ],
      },
    ],
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

function compactPreviewText(value: string | undefined, maxLength: number) {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildRoomTemplatePreview(template: RoomTemplateDefinition): RoomTemplatePreview | null {
  if (template.sessionKind.scenarioId !== 'story-reader') return null;
  const hook = compactPreviewText(template.defaults?.storyBackground, 86);
  const direction = compactPreviewText(template.defaults?.storyDirection, 86);
  const firstChapterGoal = compactPreviewText(template.defaults?.storyOutline?.split(/[；;]/)[0], 72);
  const trackedAssets = (template.sellingPoints || []).slice(0, 3);
  const readerPromise = compactPreviewText(trackedAssets.length
    ? `你的选择会影响${trackedAssets.join('、')}，并在章节回看里留下结果。`
    : '', 72);
  if (!hook || !direction || !readerPromise || !firstChapterGoal || trackedAssets.length < 3) return null;
  return { hook, direction, readerPromise, firstChapterGoal, trackedAssets };
}

export function hasTemplateDefault<K extends keyof RoomTemplateDefaults>(
  defaults: RoomTemplateDefaults | undefined,
  key: K,
): defaults is RoomTemplateDefaults & Required<Pick<RoomTemplateDefaults, K>> {
  return defaults?.[key] !== undefined;
}
