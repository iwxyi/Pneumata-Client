import type { AICharacter } from '../types/character';
import type { Message, MessageMetadata } from '../types/message';
import type { UserGuidanceIntent } from './userGuidanceIntent';

export type GuidanceExecutionReason = NonNullable<NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['guidanceExecution']>['finalReason']>;
export type GuidanceRejectionReason = NonNullable<NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['guidanceExecution']>['rejectedReasons']>[number];

export interface GuidanceExecutionEvaluation {
  matched: boolean;
  reason: GuidanceExecutionReason;
}

export interface GuidanceExecutionOptions {
  mediaCapabilities?: {
    image?: boolean;
    audio?: boolean;
  };
}

const GUIDANCE_STOP_WORDS = new Set([
  '新话题',
  '换话题',
  '换个',
  '话题',
  '讨论',
  '聊聊',
  '说说',
  '继续',
  '回到',
  '围绕',
  '一下',
  '这个',
  '那个',
  '什么',
  '怎么',
  '应该',
  '有没有',
  '是不是',
]);

function normalizeForComparison(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?:：；;"“”'‘’（）()[\]{}<>《》]/g, '').toLowerCase();
}

export function normalizeGuidanceMatchText(text: string) {
  return normalizeForComparison(text);
}

function stripGuidancePrefix(text: string) {
  return text.replace(/^(新话题|换个话题|切换话题|回到|继续说|讨论|聊聊)[:：]*/i, '');
}

export function extractGuidanceMatchTokens(text: string) {
  const normalized = normalizeGuidanceMatchText(stripGuidancePrefix(text));
  const tokens: string[] = [];
  const chunks = normalized.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{3,}/gi) || [];
  for (const chunk of chunks) {
    if (/^[a-z0-9_]+$/i.test(chunk)) {
      tokens.push(chunk.toLowerCase());
      continue;
    }
    if (chunk.length <= 4) {
      tokens.push(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length - 1; index += 1) {
      tokens.push(chunk.slice(index, index + 2));
    }
  }
  return tokens
    .map((token) => token.trim())
    .filter((token, index, array) => token.length >= 2 && !GUIDANCE_STOP_WORDS.has(token) && array.indexOf(token) === index);
}

function extractGuidanceTopicChars(text: string) {
  const normalized = normalizeGuidanceMatchText(stripGuidancePrefix(text));
  const stopChars = new Set(Array.from('新换个话题讨论聊聊说说继续回到围绕一下这个那个什么怎么应该吗呢吧的了吗有无'));
  return Array.from(new Set(Array.from(normalized).filter((char) => /[\u4e00-\u9fff]/.test(char) && !stopChars.has(char))));
}

function topicGuidanceMatchesContent(content: string, guidance: UserGuidanceIntent) {
  const normalizedContent = normalizeGuidanceMatchText(content);
  const tokens = extractGuidanceMatchTokens(guidance.focusText || guidance.rawText);
  if (tokens.length) {
    const matched = tokens.filter((token) => normalizedContent.includes(token.toLowerCase()));
    if (matched.length >= Math.min(2, tokens.length)) return true;
    if (matched.some((token) => token.length >= 3)) return true;
    return false;
  }
  const topicChars = extractGuidanceTopicChars(guidance.focusText || guidance.rawText);
  if (!topicChars.length) return true;
  return topicChars.filter((char) => normalizedContent.includes(char)).length >= Math.min(2, topicChars.length);
}

function isQuestionGuidance(guidance: UserGuidanceIntent) {
  const text = guidance.focusText || guidance.rawText;
  return /[?？]|吗|是否|是不是|有没有|有无|该不该|应不应该|应该不应该|能不能|要不要|为什么|怎么|如何|哪/.test(text);
}

function hasFocusedQuestionAnswerMove(content: string, guidance: UserGuidanceIntent) {
  if (!isQuestionGuidance(guidance)) return true;
  const guidanceText = guidance.focusText || guidance.rawText;
  const normativeQuestion = /(过错|应该|该不该|应不应该|应该不应该|对错|对不对|错|道德|责任|权利|合理|不合理|该抓|不该抓)/.test(guidanceText);
  if (!normativeQuestion) {
    return /(我觉得|我认为|要看|取决于|关键|问题是|至少|先分清|分情况|因为|所以|不是|可以|不能|能不能|为什么|怎么|如何|[?？])/.test(content);
  }
  return /(过错|应该|不应该|该不该|不该|对错|对不对|错|没错|合理|不合理|生存|本能|食物链|自然法则|法则|伤害|责任|权利|道德|立场|我觉得|我认为|不能只说|要看|取决于|先分清|分情况|关键|问题是)/.test(content);
}

function characterNamesByIds(ids: string[] | undefined, characters: AICharacter[] | undefined) {
  if (!characters?.length || !ids?.length) return [];
  return ids
    .map((id) => characters.find((character) => character.id === id)?.name)
    .filter(Boolean) as string[];
}

function isGenericImageSubject(text: string) {
  const normalized = normalizeGuidanceMatchText(text);
  if (!normalized) return true;
  return /^(当前话题|这张图|一张图|图片|照片|相片|图|发图|发一张图|发个图|发图片)$/.test(normalized);
}

function buildImageSubjectTerms(guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  const request = guidance.mediaRequest;
  if (!request) return [];
  const subjectNames = characterNamesByIds(request.subjectActorIds, characters);
  const subjectText = subjectNames.length ? subjectNames.join('、') : request.subjectText;
  if (!subjectText || isGenericImageSubject(subjectText)) return [];
  return extractGuidanceMatchTokens(subjectText);
}

function imageSubjectMatchesText(text: string, guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  const terms = buildImageSubjectTerms(guidance, characters);
  if (!terms.length) return true;
  const normalized = normalizeGuidanceMatchText(text);
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function hasImageUnableText(content: string) {
  if (/(发不了|发不出|没法发|无法发|不能发|生成不了|画不了|拍不了|没法生成|无法生成|图片模型|没有图片能力)/i.test(content)) {
    return true;
  }
  return false;
}

function hasImageCompletionText(content: string) {
  if (/(来啦|来了|发来|发给|给你看|你看|看这|这张|出图|生成好|生成了|画好|画好了|画完|拍好|拍好了|做好了|弄好了)/i.test(content)) {
    return true;
  }
  return /我把.{0,24}(图|图片|照片|相片|证件照|海报|插画|头像|表情包).{0,24}(画|拍|做|生成|发)/i.test(content)
    || /我把.{0,24}(画|拍|做|生成).{0,24}(好|完|出来|发)/i.test(content);
}

function hasConcreteImageAction(content: string) {
  return hasImageUnableText(content) || hasImageCompletionText(content);
}

function hasImageAttachment(message: Pick<Message, 'metadata'>) {
  return Boolean(
    message.metadata?.generationDecision?.image?.shouldGenerate
    || message.metadata?.attachments?.some((attachment) => attachment.kind === 'image' && attachment.status !== 'deleted' && attachment.status !== 'failed'),
  );
}

function getMessageRuntimeGuidance(message: Pick<Message, 'metadata'>): UserGuidanceIntent | null {
  const guidance = message.metadata?.runtimeDecision?.directorIntent?.userGuidance;
  if (!guidance || typeof guidance.kind !== 'string') return null;
  return guidance as UserGuidanceIntent;
}

function isSameGuidance(left: UserGuidanceIntent | null | undefined, right: UserGuidanceIntent | null | undefined) {
  if (!left || !right) return false;
  return left.kind === right.kind && left.rawText === right.rawText;
}

function imageAttachmentMatchesGuidance(message: Pick<Message, 'metadata'>, guidance: UserGuidanceIntent, characters?: AICharacter[]) {
  if (!hasImageAttachment(message)) return false;
  if (isSameGuidance(getMessageRuntimeGuidance(message), guidance)) return true;
  const attachments = message.metadata?.attachments || [];
  if (!attachments.length) return !buildImageSubjectTerms(guidance, characters).length;
  return attachments.some((attachment) => {
    const text = `${attachment.altText || ''} ${attachment.promptText || ''}`;
    return imageSubjectMatchesText(text, guidance, characters);
  });
}

function evaluateMediaGuidanceContent(content: string, guidance: UserGuidanceIntent, characters?: AICharacter[], options?: GuidanceExecutionOptions): GuidanceExecutionReason {
  const request = guidance.mediaRequest;
  if (!request) return 'matched';
  if (hasImageUnableText(content)) return 'matched';
  if (request.kind === 'image' && options?.mediaCapabilities?.image === false) return 'missing_requested_image';
  if (!hasConcreteImageAction(content)) return 'missing_requested_image';
  if (!imageSubjectMatchesText(content, guidance, characters)) return 'missing_requested_subject';
  return 'matched';
}

export function evaluateGuidanceGeneratedContent(
  content: string,
  guidance: UserGuidanceIntent | null | undefined,
  speaker: Pick<AICharacter, 'id'> | string | null | undefined,
  characters?: AICharacter[],
  options?: GuidanceExecutionOptions,
): GuidanceExecutionEvaluation {
  if (!guidance) return { matched: true, reason: 'matched' };
  if (!normalizeGuidanceMatchText(content)) return { matched: false, reason: 'empty_content' };
  const speakerId = typeof speaker === 'string' ? speaker : speaker?.id;
  if (guidance.actorIds.length && (!speakerId || !guidance.actorIds.includes(speakerId))) return { matched: false, reason: 'wrong_speaker' };
  if (guidance.kind === 'media_request') {
    const reason = evaluateMediaGuidanceContent(content, guidance, characters, options);
    return { matched: reason === 'matched', reason };
  }
  const matched = topicGuidanceMatchesContent(content, guidance);
  if (matched && !hasFocusedQuestionAnswerMove(content, guidance)) {
    return { matched: false, reason: 'missing_question_answer' };
  }
  if (matched) return { matched: true, reason: 'matched' };
  return {
    matched: false,
    reason: guidance.kind === 'direct_reply' ? 'missing_direct_reply_focus' : 'missing_topic_focus',
  };
}

export function evaluateGuidanceMessage(message: Message, guidance: UserGuidanceIntent, characters?: AICharacter[]): GuidanceExecutionEvaluation {
  if (message.type !== 'ai' || message.isDeleted) return { matched: false, reason: 'empty_content' };
  if (guidance.actorIds.length && !guidance.actorIds.includes(message.senderId)) return { matched: false, reason: 'wrong_speaker' };
  if (guidance.kind === 'media_request' && imageAttachmentMatchesGuidance(message, guidance, characters)) {
    return { matched: true, reason: 'matched' };
  }
  if (guidance.kind === 'media_request' && hasImageCompletionText(message.content || '') && !hasImageUnableText(message.content || '')) {
    return { matched: false, reason: 'missing_requested_image' };
  }
  return evaluateGuidanceGeneratedContent(message.content || '', guidance, message.senderId, characters);
}
