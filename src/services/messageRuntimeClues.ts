import type { Message } from '../types/message';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { formatInnerImpulseLabel, formatInnerToneLabel, formatResponseSurfaceKindLabel, formatRoleFitLabel, formatSurfaceBasisLabel } from './runtimeDecisionLabels';
import { formatBeatType, formatKnownReason } from './runtimeInsightPresentation';

export interface MessageRuntimeClueSection {
  key: 'memory' | 'inner' | 'surface' | 'director' | 'narrative' | 'feedback';
  label: string;
  promptLabel: string;
  statusKind: 'prompt_context' | 'debug_explanation' | 'soft_signal' | 'applied_signal';
  statusLabel: string;
  statusHint: string;
  items: string[];
}

function cleanRuntimeText(text: string | undefined | null, members: DisplayTextMember[] = []) {
  return sanitizeUserFacingText(text || '', members).trim();
}

function compactItems(items: Array<string | undefined | null>, maxItems = 5, members: DisplayTextMember[] = []) {
  return items.map((item) => cleanRuntimeText(item, members)).filter(Boolean).slice(0, maxItems);
}

function pushSection(
  sections: MessageRuntimeClueSection[],
  section: Omit<MessageRuntimeClueSection, 'items'> & { items: Array<string | undefined | null>; maxItems?: number },
  members: DisplayTextMember[] = [],
) {
  const items = compactItems(section.items, section.maxItems, members);
  if (!items.length) return;
  sections.push({
    key: section.key,
    label: section.label,
    promptLabel: section.promptLabel,
    statusKind: section.statusKind,
    statusLabel: section.statusLabel,
    statusHint: section.statusHint,
    items,
  });
}

export function projectMessageRuntimeClues(message: Pick<Message, 'metadata'> | null | undefined, members: DisplayTextMember[] = []): MessageRuntimeClueSection[] {
  const decision = message?.metadata?.runtimeDecision;
  if (!decision) return [];

  const sections: MessageRuntimeClueSection[] = [];
  const recalled = decision.memoryContext?.recalledArchives || [];
  pushSection(sections, {
    key: 'memory',
    label: '记忆',
    promptLabel: '记忆线索',
    statusKind: 'prompt_context',
    statusLabel: '本轮注入',
    statusHint: '这些旧档已经进入本轮生成上下文，可用于解释角色为什么想起旧事。',
    items: recalled.flatMap((item) => [
      item.summary ? `旧档注入：${item.summary}` : '',
      item.recallReason ? `原因：${item.recallReason}` : '',
    ]),
    maxItems: 8,
  }, members);
  pushSection(sections, {
    key: 'inner',
    label: '内心',
    promptLabel: '内心线索',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮语气、冲动和余波，不等于公开剧情事实。',
    items: decision.innerLife ? [
      decision.innerLife.tone ? `语气倾向：${formatInnerToneLabel(decision.innerLife.tone)}` : '',
      decision.innerLife.impulse ? `表达冲动：${formatInnerImpulseLabel(decision.innerLife.impulse)}` : '',
      decision.innerLife.reason ? `内在原因：${decision.innerLife.reason}` : '',
    ] : [],
  }, members);
  pushSection(sections, {
    key: 'surface',
    label: '表达',
    promptLabel: '表达形态',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮为什么采用闲聊、长文、富文本或专业表达。',
    items: decision.responseSurface ? [
      formatResponseSurfaceKindLabel(decision.responseSurface.kind, 'zh', 'clue'),
      formatRoleFitLabel(decision.responseSurface.roleFit, 'zh', 'clue'),
      decision.responseSurface.allowMarkdown ? '允许富文本' : '',
      ...(decision.responseSurface.basis || []).map((reason) => formatSurfaceBasisLabel(reason)),
    ] : [],
  }, members);
  pushSection(sections, {
    key: 'director',
    label: '调度',
    promptLabel: '调度线索',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮调度和推进压力，不是角色公开说出的事实。',
    items: decision.directorIntent ? [
      decision.directorIntent.beatType ? `推进动作：${formatBeatType(decision.directorIntent.beatType as never)}` : '',
      decision.directorIntent.reason ? `原因：${formatKnownReason(decision.directorIntent.reason)}` : '',
    ] : [],
  }, members);
  pushSection(sections, {
    key: 'narrative',
    label: '叙事线',
    promptLabel: '叙事线索',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮关注了哪些线索，不代表剧情已经确定。',
    items: (decision.narrativeLines || []).map((item) => item.title),
  }, members);
  const feedback = decision.expressionFeedback || [];
  const feedbackApplied = feedback.some((item) => item.applied);
  pushSection(sections, {
    key: 'feedback',
    label: '反馈',
    promptLabel: '表达反馈',
    statusKind: feedbackApplied ? 'applied_signal' : 'soft_signal',
    statusLabel: feedbackApplied ? '已影响' : '已检索',
    statusHint: feedbackApplied
      ? '这些用户表达反馈已经影响本轮提示词或表达约束。'
      : '这些用户表达反馈只是被检索到，属于软信号，不一定影响本轮。',
    items: feedback.map((item) => item.label || item.text),
  }, members);

  return sections;
}

export function formatMessageRuntimeCluesForPrompt(message: Pick<Message, 'metadata'> | null | undefined, members: DisplayTextMember[] = []) {
  return projectMessageRuntimeClues(message, members)
    .map((section) => {
      if (section.key === 'memory') return `${section.promptLabel}：\n${section.items.map((item) => `- ${item}`).join('\n')}`;
      return `${section.promptLabel}：${section.items.join('；')}`;
    })
    .join('\n');
}
