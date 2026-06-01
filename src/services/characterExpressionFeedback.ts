import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { MemoryCandidate } from './memoryTypes';
import { consolidateMemoryCandidates } from './memoryConsolidation';
import { accumulateCharacterRuntime } from './characterRuntime';

export type ExpressionFeedbackKind = 'out_of_character' | 'too_long' | 'too_formal' | 'too_assistant' | 'fits_character' | 'length_ok';
export type ExpressionFeedbackMenuGroupKey = 'negative' | 'positive';

const FEEDBACK_LABELS: Record<ExpressionFeedbackKind, string> = {
  out_of_character: '不像这个角色',
  too_long: '回复太长',
  too_formal: '语气太正式',
  too_assistant: '太像助手',
  fits_character: '这次像角色',
  length_ok: '长度合适',
};

export const EXPRESSION_FEEDBACK_MENU_GROUPS: Array<{
  key: ExpressionFeedbackMenuGroupKey;
  title: string;
  items: Array<{ kind: ExpressionFeedbackKind; label: string }>;
}> = [
  {
    key: 'negative',
    title: '需要调整',
    items: [
      { kind: 'out_of_character', label: '不像角色' },
      { kind: 'too_long', label: '太长' },
      { kind: 'too_formal', label: '太正式' },
      { kind: 'too_assistant', label: '太像助手' },
    ],
  },
  {
    key: 'positive',
    title: '正向校准',
    items: [
      { kind: 'fits_character', label: '像角色了' },
      { kind: 'length_ok', label: '长度合适' },
    ],
  },
];

function normalizeSnippet(content: string, maxLength = 72) {
  return content.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildSourceEventId(characterId: string, message: Pick<Message, 'id' | 'content'>, kind: ExpressionFeedbackKind) {
  return `expression_feedback:${characterId}:${kind}:${message.id || normalizeSnippet(message.content, 24)}`;
}

function buildFeedbackMemoryText(kind: ExpressionFeedbackKind, message: Pick<Message, 'content' | 'metadata'>) {
  const snippet = normalizeSnippet(message.metadata?.withdrawal?.originalContent || message.content);
  const evidence = snippet ? `；反例是“${snippet}”` : '';
  if (kind === 'out_of_character') return `用户反馈：这类表达不像本人，后续需要更贴合角色身份、年龄感、关系立场和说话习惯${evidence}`;
  if (kind === 'too_long') return `用户反馈：这类回复偏长，后续除非任务明确需要长文，否则应更克制、更像即时聊天${evidence}`;
  if (kind === 'too_formal') return `用户反馈：这类语气偏正式，后续需要减少报告腔和模板化结构，保留角色自己的口吻${evidence}`;
  if (kind === 'too_assistant') return `用户反馈：这类回复太像通用助手，后续要减少中立总结、服务式措辞和标准答案腔，回到角色视角${evidence}`;
  if (kind === 'fits_character') return `用户反馈：这次表达像角色本人，可作为角色身份、年龄感、关系立场和说话习惯的正向校准${evidence}`;
  return `用户反馈：这次长度合适，可作为聊天节奏和展开程度的正向校准${evidence}`;
}

function buildFeedbackCandidate(character: AICharacter, message: Message, kind: ExpressionFeedbackKind): MemoryCandidate {
  return {
    scope: 'character_self',
    layerHint: kind === 'out_of_character' || kind === 'too_assistant' || kind === 'fits_character' ? 'episodic' : 'working',
    kind: kind === 'too_assistant' ? 'taboo' : kind === 'length_ok' ? 'status_shift' : 'trait_evidence',
    ownerId: character.id,
    text: buildFeedbackMemoryText(kind, message),
    evidenceText: message.metadata?.withdrawal?.originalContent || message.content,
    sourceEventIds: [buildSourceEventId(character.id, message, kind)],
    sourceTag: 'expression_feedback',
    scoreBreakdown: {
      stability: kind === 'out_of_character' ? 0.68 : 0.58,
      recurrence: 0.58,
      impact: 0.78,
      specificity: 0.82,
      durability: kind === 'too_long' ? 0.55 : 0.68,
    },
  };
}

export function buildExpressionFeedbackPatch(params: {
  character: AICharacter;
  message: Message;
  kind: ExpressionFeedbackKind;
  now?: number;
}) {
  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? Math.round(params.now) : Date.now();
  const candidate = buildFeedbackCandidate(params.character, params.message, params.kind);
  return {
    layeredMemories: consolidateMemoryCandidates(params.character.layeredMemories || [], [candidate]),
    runtimeTimeline: accumulateCharacterRuntime(params.character, {
      type: 'memory',
      text: `用户反馈：${FEEDBACK_LABELS[params.kind]}`,
      createdAt: now,
    }),
  } satisfies Partial<AICharacter>;
}

export function getExpressionFeedbackLabel(kind: ExpressionFeedbackKind) {
  return FEEDBACK_LABELS[kind];
}
