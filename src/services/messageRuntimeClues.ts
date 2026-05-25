import type { Message } from '../types/message';
import { sanitizeUserFacingText } from './displayTextSanitizer';
import { formatInnerImpulseLabel, formatInnerToneLabel, formatResponseSurfaceKindLabel, formatRoleFitLabel, formatSurfaceBasisLabel } from './runtimeDecisionLabels';
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
      decision.innerLife.tone ? `语气倾向：${formatInnerToneLabel(decision.innerLife.tone)}` : '',
      decision.innerLife.impulse ? `表达冲动：${formatInnerImpulseLabel(decision.innerLife.impulse)}` : '',
      decision.innerLife.reason ? `内在原因：${decision.innerLife.reason}` : '',
    ] : [],
  });
  pushSection(sections, {
    key: 'surface',
    label: '表达',
    promptLabel: '表达形态',
    items: decision.responseSurface ? [
      formatResponseSurfaceKindLabel(decision.responseSurface.kind, 'zh', 'clue'),
      formatRoleFitLabel(decision.responseSurface.roleFit, 'zh', 'clue'),
      decision.responseSurface.allowMarkdown ? '允许富文本' : '',
      ...(decision.responseSurface.basis || []).map((reason) => formatSurfaceBasisLabel(reason)),
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
