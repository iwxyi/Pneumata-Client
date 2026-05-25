import type { Message } from '../types/message';
import { sanitizeUserFacingText } from './displayTextSanitizer';
import { formatBeatType, formatKnownReason } from './runtimeInsightPresentation';

export interface MessageRuntimeClueSection {
  key: 'memory' | 'inner' | 'surface' | 'director' | 'narrative' | 'feedback';
  label: string;
  promptLabel: string;
  items: string[];
}

function cleanRuntimeText(text: string | undefined | null) {
  return sanitizeUserFacingText(text || '').trim();
}

function formatResponseSurfaceKind(value: string | undefined) {
  const labels: Record<string, string> = {
    chat: '普通聊天',
    professional: '专业讨论',
    creative: '创作表达',
    longform: '长段落表达',
  };
  return value ? labels[value] || cleanRuntimeText(value) : '';
}

function formatRoleFit(value: string | undefined) {
  const labels: Record<string, string> = {
    limited: '角色能力有限',
    ordinary: '角色可普通参与',
    capable: '角色适合展开',
  };
  return value ? labels[value] || cleanRuntimeText(value) : '';
}

function formatInnerTone(value: string | undefined) {
  const labels: Record<string, string> = {
    casual: '随意',
    defensive: '防御',
    teasing: '调侃',
    serious: '认真',
    tired: '疲惫',
    vulnerable: '脆弱',
  };
  return value ? labels[value] || cleanRuntimeText(value) : '';
}

function formatInnerImpulse(value: string | undefined) {
  const labels: Record<string, string> = {
    answer: '回应',
    show_off: '证明自己',
    defend_face: '维护面子',
    seek_attention: '想被看见',
    comfort: '安慰',
    repair: '找补/靠近',
    mock: '调侃/挑刺',
    avoid: '回避',
    stay_silent: '沉默',
  };
  return value ? labels[value] || cleanRuntimeText(value) : '';
}

function formatSurfaceBasis(reason: string) {
  const labels: Record<string, string> = {
    'topic:creative-task': '主题请求创作',
    'topic:professional-task': '主题请求专业表达',
    'style:roleplay-creative': '角色扮演风格支持创作',
    'style:debate-structured': '辩论风格支持结构化',
    'style:brainstorm-structured': '头脑风暴支持结构化',
    'style:debate-reasoning': '辩论风格需要推理',
    'style:brainstorm-reasoning': '头脑风暴需要推理',
    'style:free': '自由聊天风格',
    'style:debate': '辩论风格',
    'style:brainstorm': '头脑风暴风格',
    'style:roleplay': '角色扮演风格',
    'role:limited': '角色能力限制长文',
    'role:ordinary': '角色普通匹配',
    'role:capable': '角色能力支持长文',
    'mode:interview': '面试模式',
    'mode:classroom': '课堂模式',
    'mode:group_discussion': '小组讨论模式',
    'mode:roundtable': '圆桌模式',
    'context:chat': '上下文指定聊天',
    'context:professional': '上下文指定专业',
    'context:creative': '上下文指定创作',
    'context:longform': '上下文指定长文',
  };
  return labels[reason] || cleanRuntimeText(reason);
}

function compactItems(items: Array<string | undefined | null>, maxItems = 5) {
  return items.map((item) => cleanRuntimeText(item)).filter(Boolean).slice(0, maxItems);
}

function pushSection(
  sections: MessageRuntimeClueSection[],
  section: Omit<MessageRuntimeClueSection, 'items'> & { items: Array<string | undefined | null>; maxItems?: number },
) {
  const items = compactItems(section.items, section.maxItems);
  if (!items.length) return;
  sections.push({
    key: section.key,
    label: section.label,
    promptLabel: section.promptLabel,
    items,
  });
}

export function projectMessageRuntimeClues(message: Pick<Message, 'metadata'> | null | undefined): MessageRuntimeClueSection[] {
  const decision = message?.metadata?.runtimeDecision;
  if (!decision) return [];

  const sections: MessageRuntimeClueSection[] = [];
  const recalled = decision.memoryContext?.recalledArchives || [];
  pushSection(sections, {
    key: 'memory',
    label: '记忆',
    promptLabel: '记忆线索',
    items: recalled.flatMap((item) => [
      item.summary ? `旧档注入：${item.summary}` : '',
      item.recallReason ? `原因：${item.recallReason}` : '',
    ]),
    maxItems: 8,
  });
  pushSection(sections, {
    key: 'inner',
    label: '内心',
    promptLabel: '内心线索',
    items: decision.innerLife ? [
      decision.innerLife.tone ? `语气倾向：${formatInnerTone(decision.innerLife.tone)}` : '',
      decision.innerLife.impulse ? `表达冲动：${formatInnerImpulse(decision.innerLife.impulse)}` : '',
      decision.innerLife.reason ? `内在原因：${decision.innerLife.reason}` : '',
    ] : [],
  });
  pushSection(sections, {
    key: 'surface',
    label: '表达',
    promptLabel: '表达形态',
    items: decision.responseSurface ? [
      formatResponseSurfaceKind(decision.responseSurface.kind),
      formatRoleFit(decision.responseSurface.roleFit),
      decision.responseSurface.allowMarkdown ? '允许富文本' : '',
      ...(decision.responseSurface.basis || []).map(formatSurfaceBasis),
    ] : [],
  });
  pushSection(sections, {
    key: 'director',
    label: '调度',
    promptLabel: '调度线索',
    items: decision.directorIntent ? [
      decision.directorIntent.beatType ? `推进动作：${formatBeatType(decision.directorIntent.beatType as never)}` : '',
      decision.directorIntent.reason ? `原因：${formatKnownReason(decision.directorIntent.reason)}` : '',
    ] : [],
  });
  pushSection(sections, {
    key: 'narrative',
    label: '叙事线',
    promptLabel: '叙事线索',
    items: (decision.narrativeLines || []).map((item) => item.title),
  });
  pushSection(sections, {
    key: 'feedback',
    label: '反馈',
    promptLabel: '表达反馈',
    items: (decision.expressionFeedback || []).map((item) => item.label || item.text),
  });

  return sections;
}

export function formatMessageRuntimeCluesForPrompt(message: Pick<Message, 'metadata'> | null | undefined) {
  return projectMessageRuntimeClues(message)
    .map((section) => {
      if (section.key === 'memory') return `${section.promptLabel}：\n${section.items.map((item) => `- ${item}`).join('\n')}`;
      return `${section.promptLabel}：${section.items.join('；')}`;
    })
    .join('\n');
}
