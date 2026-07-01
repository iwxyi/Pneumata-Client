type LabelVariant = 'compact' | 'member' | 'insight';
type SurfaceVariant = 'trace' | 'clue';

function isZh(language?: string) {
  return !language || language.startsWith('zh');
}

const INNER_IMPULSE_ZH: Record<LabelVariant, Record<string, string>> = {
  compact: {
    answer: '回应',
    show_off: '证明自己',
    defend_face: '维护面子',
    seek_attention: '想被看见',
    comfort: '安慰',
    repair: '找补/靠近',
    mock: '调侃/挑刺',
    avoid: '回避',
    change_topic: '岔开话题',
    stay_silent: '沉默',
    send_emoji: '发表情',
    withdraw: '撤回/吞话',
  },
  member: {
    answer: '想回应',
    show_off: '想证明自己',
    defend_face: '在维护面子',
    seek_attention: '想被看见',
    comfort: '想接住别人',
    repair: '别扭找补',
    mock: '带点刺',
    avoid: '想躲开',
    change_topic: '想岔开话题',
    stay_silent: '暂时沉默',
    send_emoji: '想用表情带过',
    withdraw: '说了又想吞回去',
  },
  insight: {
    answer: '回应',
    show_off: '表现',
    defend_face: '护住面子',
    seek_attention: '想被看见',
    comfort: '接住对方',
    repair: '别扭找补',
    mock: '带刺调侃',
    avoid: '回避',
    change_topic: '转开话题',
    stay_silent: '沉默',
    send_emoji: '用表情代替话',
    withdraw: '想撤回',
  },
};

const INNER_IMPULSE_EN: Record<LabelVariant, Record<string, string>> = {
  compact: {
    answer: 'Answer',
    show_off: 'Prove self',
    defend_face: 'Save face',
    seek_attention: 'Seek notice',
    comfort: 'Comfort',
    repair: 'Repair',
    mock: 'Tease',
    avoid: 'Avoid',
    change_topic: 'Deflect',
    stay_silent: 'Silent',
    send_emoji: 'Emoji',
    withdraw: 'Withdraw',
  },
  member: {
    answer: 'Wants to answer',
    show_off: 'Wants to prove themself',
    defend_face: 'Defending face',
    seek_attention: 'Wants notice',
    comfort: 'Wants to catch someone',
    repair: 'Awkward repair',
    mock: 'A little sharp',
    avoid: 'Wants to avoid',
    change_topic: 'Wants to deflect',
    stay_silent: 'Holding silence',
    send_emoji: 'Would rather use an emoji',
    withdraw: 'Wants to take it back',
  },
  insight: {
    answer: 'Answer',
    show_off: 'Show',
    defend_face: 'Save face',
    seek_attention: 'Seeking notice',
    comfort: 'Comfort',
    repair: 'Repair',
    mock: 'Tease',
    avoid: 'Avoid',
    change_topic: 'Change topic',
    stay_silent: 'Silent',
    send_emoji: 'Emoji',
    withdraw: 'Withdraw',
  },
};

export function formatInnerImpulseLabel(impulse: string | undefined, language = 'zh', variant: LabelVariant = 'compact') {
  if (!impulse) return isZh(language) ? '未形成' : 'Unsettled';
  const labels = isZh(language) ? INNER_IMPULSE_ZH[variant] : INNER_IMPULSE_EN[variant];
  return labels[impulse] || impulse;
}

export function formatInnerToneLabel(tone: string | undefined, language = 'zh') {
  const zhLabels: Record<string, string> = {
    casual: '随意',
    defensive: '防御',
    teasing: '调侃',
    serious: '认真',
    tired: '疲惫',
    vulnerable: '脆弱',
  };
  const enLabels: Record<string, string> = {
    casual: 'Casual',
    defensive: 'Defensive',
    teasing: 'Teasing',
    serious: 'Serious',
    tired: 'Tired',
    vulnerable: 'Vulnerable',
  };
  if (!tone) return isZh(language) ? '未定' : 'Unset';
  return (isZh(language) ? zhLabels : enLabels)[tone] || tone;
}

export function formatSoulMetricLabel(key: string, language = 'zh') {
  const zhLabels: Record<string, string> = {
    energy: '能量',
    attention: '注意',
    loneliness: '被忽视感',
    repression: '压抑',
    shame: '面子风险',
    envy: '酸意',
    trustInRoom: '房间安全感',
    ignoredStreak: '未被接住',
  };
  const enLabels: Record<string, string> = {
    energy: 'energy',
    attention: 'attention',
    loneliness: 'loneliness',
    repression: 'repression',
    shame: 'shame',
    envy: 'envy',
    trustInRoom: 'room trust',
    ignoredStreak: 'ignored streak',
  };
  return (isZh(language) ? zhLabels : enLabels)[key] || key;
}

export function formatResponseSurfaceKindLabel(value: string | undefined, language = 'zh', variant: SurfaceVariant = 'trace') {
  const zhTrace: Record<string, string> = {
    chat: '聊天气泡',
    professional: '专业表达',
    creative: '创作表达',
    longform: '长文表达',
  };
  const zhClue: Record<string, string> = {
    chat: '普通聊天',
    professional: '专业讨论',
    creative: '创作表达',
    longform: '长段落表达',
  };
  const enLabels: Record<string, string> = {
    chat: 'Chat',
    professional: 'Professional',
    creative: 'Creative',
    longform: 'Longform',
  };
  if (!value) return isZh(language) ? '未定' : 'Unset';
  if (!isZh(language)) return enLabels[value] || value;
  return (variant === 'clue' ? zhClue : zhTrace)[value] || value;
}

export function formatRoleFitLabel(value: string | undefined, language = 'zh', variant: SurfaceVariant = 'trace') {
  const zhTrace: Record<string, string> = {
    limited: '角色不适合长篇',
    ordinary: '普通匹配',
    capable: '角色能力支持',
  };
  const zhClue: Record<string, string> = {
    limited: '角色能力有限',
    ordinary: '角色可普通参与',
    capable: '角色适合展开',
  };
  const enLabels: Record<string, string> = {
    limited: 'Limited fit',
    ordinary: 'Ordinary fit',
    capable: 'Capable fit',
  };
  if (!value) return isZh(language) ? '普通匹配' : 'Ordinary fit';
  if (!isZh(language)) return enLabels[value] || value;
  return (variant === 'clue' ? zhClue : zhTrace)[value] || value;
}

export function formatSurfaceBasisLabel(reason: string, language = 'zh') {
  const zhLabels: Record<string, string> = {
    'topic:creative-task': '主题请求创作',
    'topic:professional-task': '主题请求专业表达',
    'style:roleplay-creative': '演绎倾向支持创作',
    'style:debate-structured': '审议倾向支持结构化',
    'style:brainstorm-structured': '共创倾向支持结构化',
    'style:debate-reasoning': '审议倾向需要推理',
    'style:brainstorm-reasoning': '共创倾向需要推理',
    'style:debate-open-ended': '审议倾向开放表达',
    'style:brainstorm-open-ended': '共创倾向开放表达',
    'style:free': '轻松表达倾向',
    'style:debate': '审议表达倾向',
    'style:brainstorm': '共创表达倾向',
    'style:roleplay': '演绎表达倾向',
    'role:limited': '角色能力限制长文',
    'role:ordinary': '角色普通匹配',
    'role:capable': '角色能力支持长文',
    'mode:interview': '面试模式',
    'mode:classroom': '课堂模式',
    'mode:group_discussion': '观点审议模式',
    'mode:roundtable': '圆桌审议模式',
    'context:chat': '上下文指定聊天',
    'context:professional': '上下文指定专业',
    'context:creative': '上下文指定创作',
    'context:longform': '上下文指定长文',
  };
  if (!isZh(language)) return reason.replace(/[:_]/g, ' ');
  return zhLabels[reason] || reason;
}

export function formatExpressionLengthLabel(length: string | undefined, language = 'zh') {
  const zhLabels: Record<string, string> = {
    micro: '极短',
    short: '短句',
    normal: '常规',
    long: '长句',
  };
  const enLabels: Record<string, string> = {
    micro: 'Micro',
    short: 'Short',
    normal: 'Normal',
    long: 'Long',
  };
  if (!length) return isZh(language) ? '未定' : 'Unset';
  return (isZh(language) ? zhLabels : enLabels)[length] || length;
}
