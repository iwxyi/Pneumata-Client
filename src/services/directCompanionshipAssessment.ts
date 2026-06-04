import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipStyle, UserProfileMemoryEventItem, UserProfileMemoryKind } from '../types/companionship';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
import {
  buildCompanionshipCareTopicEventsFromDecision,
  buildCompanionshipCareTopicEventsFromDirectUserMessage,
  readActiveCompanionshipCareTopicsFromEvents,
  type CompanionshipCareTopicDecision,
} from './directCompanionshipCare';
import {
  buildCompanionshipPhaseEventFromDirectUserMessage,
  buildCompanionshipPhaseEventFromDecision,
  type CompanionshipPhaseDecision,
} from './directCompanionshipPhase';
import {
  buildUserProfileMemoryEventFromDirectUserMessage,
  createUserProfileMemoryEvent,
} from './directUserProfileMemory';
import { reportRecoverableWarning } from './diagnostics';

const USER_ACTOR_ID = 'user';
const MEMORY_KINDS: UserProfileMemoryKind[] = [
  'display_name',
  'address_preference',
  'schedule_hint',
  'pressure_source',
  'preference',
  'dislike',
  'boundary',
  'important_date',
  'recent_plan',
  'emotional_pattern',
];
const PHASES: CompanionshipPhaseDecision['phase'][] = ['stranger', 'curious', 'fond', 'ambiguous', 'confessing', 'confirmed', 'passionate', 'deep', 'cooling', 'crisis', 'reconciling'];
const STYLES: CompanionshipStyle[] = ['romantic', 'ambiguous', 'friend', 'family', 'mentor', 'custom'];

function compactText(text: string | undefined | null, max = 140) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function cleanJsonCandidate(raw: string) {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  return object?.[0] || text;
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function isDirectUserMessage(chat: GroupChat, message: Message) {
  return chat.type === 'direct' && !message.isDeleted && (message.senderId === USER_ACTOR_ID || message.type === 'user' || message.type === 'god');
}

function isPhase(value: unknown): value is CompanionshipPhaseDecision['phase'] {
  return typeof value === 'string' && PHASES.includes(value as CompanionshipPhaseDecision['phase']);
}

function isStyle(value: unknown): value is CompanionshipStyle {
  return typeof value === 'string' && STYLES.includes(value as CompanionshipStyle);
}

function isCareAction(value: unknown): value is CompanionshipCareTopicDecision['action'] {
  return value === 'opened' || value === 'closed' || value === 'blocked';
}

function isUrgency(value: unknown): value is CompanionshipCareTopicDecision['urgency'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isMemoryKind(value: unknown): value is UserProfileMemoryKind {
  return typeof value === 'string' && MEMORY_KINDS.includes(value as UserProfileMemoryKind);
}

function buildRecentTranscript(messages: Message[]) {
  return messages
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-8)
    .map((item) => `${item.senderName || item.senderId}: ${compactText(item.content, 160)}`)
    .join('\n');
}

function normalizePhase(raw: unknown, userContent: string): CompanionshipPhaseDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.shouldCreate !== true || !isPhase(value.phase)) return null;
  const confidence = normalizeConfidence(value.confidence);
  if (confidence < 0.7) return null;
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => compactText(item, 120)).slice(0, 3)
    : [];
  return {
    phase: value.phase,
    style: isStyle(value.style) ? value.style : undefined,
    reason: compactText(typeof value.reason === 'string' ? value.reason : '模型判断用户明确表达了关系阶段变化。', 160),
    confidence,
    evidence: evidence.length ? evidence : [compactText(userContent, 120)],
    decisionSource: 'model',
  };
}

function normalizeCare(raw: unknown, userContent: string, createdAt: number): CompanionshipCareTopicDecision[] {
  const source = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return source
    .map((item): CompanionshipCareTopicDecision | null => {
      if (!item || typeof item !== 'object') return null;
      const value = item as Record<string, unknown>;
      if (value.shouldCreate !== true || !isCareAction(value.action)) return null;
      const confidence = normalizeConfidence(value.confidence);
      if (confidence < 0.68) return null;
      const topicText = compactText(typeof value.topicText === 'string' ? value.topicText : userContent, 140);
      if (!topicText) return null;
      const dueInHours = typeof value.dueInHours === 'number' && Number.isFinite(value.dueInHours)
        ? Math.max(1, Math.min(24 * 30, value.dueInHours))
        : null;
      return {
        action: value.action,
        topicText,
        topicId: typeof value.existingTopicId === 'string' && value.existingTopicId.trim() ? value.existingTopicId.trim() : undefined,
        urgency: isUrgency(value.urgency) ? value.urgency : 'low',
        reason: compactText(typeof value.reason === 'string' ? value.reason : '模型判断用户消息形成了关心事项事件。', 160),
        evidence: compactText(typeof value.evidence === 'string' ? value.evidence : userContent, 160),
        confidence,
        dueAt: value.action === 'opened' && dueInHours ? createdAt + dueInHours * 60 * 60_000 : undefined,
        decisionSource: 'model',
      };
    })
    .filter((item): item is CompanionshipCareTopicDecision => Boolean(item))
    .slice(0, 3);
}

function normalizeProfileItems(raw: unknown, userContent: string): UserProfileMemoryEventItem[] {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (!value || value.shouldCreate !== true || !Array.isArray(value.items)) return [];
  return value.items
    .map((item): UserProfileMemoryEventItem | null => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      if (!isMemoryKind(entry.kind)) return null;
      const confidence = normalizeConfidence(entry.confidence);
      if (confidence < 0.7) return null;
      const text = compactText(typeof entry.text === 'string' ? entry.text : '', 140);
      if (!text) return null;
      return {
        kind: entry.kind,
        text,
        evidence: compactText(typeof entry.evidence === 'string' ? entry.evidence : userContent, 140),
        confidence,
        sensitive: entry.sensitive === true,
      };
    })
    .filter((item): item is UserProfileMemoryEventItem => Boolean(item))
    .slice(0, 4);
}

async function runModelAssessment(params: {
  config: APIConfig;
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  recentMessages?: Message[];
}) {
  const activeTopics = readActiveCompanionshipCareTopicsFromEvents(params.chat, params.character.id, params.message.timestamp || Date.now());
  const systemPrompt = [
    '你是亲密陪伴 direct runtime 的合并评估器。',
    '任务：只评估用户这一条新消息对三个运行时模块的结构化影响：关系阶段、关心事项、用户画像记忆。',
    '必须保守：玩笑、比喻、角色扮演台词、影视/游戏/别人经历、含糊猜测、临时口嗨，不要创建长期事件。',
    'phase 只在用户明确把自己和当前角色的关系推进、降级、修复或确认时创建。',
    'careTopics 只在用户明确提到自己的计划、重要日期、健康/情绪压力、未完成约定，或明确关闭/拒绝已有关心事项时创建。',
    'userProfile 只记录适合未来自然照顾用户的事实、偏好、边界、日期、计划或稳定压力来源。',
    '不要写可见回复内容。只输出 JSON，不要 markdown。',
    '输出结构：{"phase":{"shouldCreate":boolean,"phase":"confessing|confirmed|passionate|deep|cooling|crisis|reconciling|none","style":"romantic|ambiguous|friend|family|mentor|custom|null","confidence":number,"reason":"...","evidence":["..."]},"careTopics":[{"shouldCreate":boolean,"action":"opened|closed|blocked|none","existingTopicId":"可选","topicText":"...","urgency":"low|medium|high","dueInHours":number|null,"confidence":number,"reason":"...","evidence":"..."}],"userProfile":{"shouldCreate":boolean,"items":[{"kind":"display_name|address_preference|schedule_hint|pressure_source|preference|dislike|boundary|important_date|recent_plan|emotional_pattern","text":"第三人称可记忆事实","evidence":"原文证据","confidence":number,"sensitive":boolean}],"reason":"..."}}',
    'confidence 取 0-1；拿不准必须 shouldCreate=false 或 confidence 低于对应阈值。',
  ].join('\n');
  const payload = {
    chatName: params.chat.name,
    character: {
      id: params.character.id,
      name: params.character.name,
      background: params.character.background || '',
      speakingStyle: params.character.speakingStyle || '',
    },
    activeCareTopics: activeTopics.map((topic) => ({
      id: topic.id,
      text: topic.text,
      urgency: topic.urgency,
      evidence: topic.evidence || '',
    })),
    recentTranscript: buildRecentTranscript(params.recentMessages || []),
    userMessage: params.message.content,
  };
  const raw = await generateJsonResponse(params.config, systemPrompt, [{ role: 'user', content: JSON.stringify(payload) }]);
  const parsed = JSON.parse(cleanJsonCandidate(raw)) as Record<string, unknown>;
  return {
    phase: normalizePhase(parsed.phase, params.message.content),
    care: normalizeCare(parsed.careTopics, params.message.content, params.message.timestamp || Date.now()),
    profileItems: normalizeProfileItems(parsed.userProfile, params.message.content),
    activeTopics,
  };
}

function buildLocalFallbackEvents(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  now?: number;
}) {
  return [
    buildCompanionshipPhaseEventFromDirectUserMessage(params),
    ...buildCompanionshipCareTopicEventsFromDirectUserMessage(params),
    buildUserProfileMemoryEventFromDirectUserMessage(params),
  ].filter((event): event is RuntimeEventV2 => Boolean(event));
}

export async function resolveDirectCompanionshipAssessmentEvents(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  textApiConfig?: APIConfig | null;
  recentMessages?: Message[];
  now?: number;
}): Promise<RuntimeEventV2[]> {
  if (!isDirectUserMessage(params.chat, params.message)) return [];
  if (!params.textApiConfig) return buildLocalFallbackEvents(params);
  try {
    const assessment = await runModelAssessment({
      config: params.textApiConfig,
      chat: params.chat,
      character: params.character,
      message: params.message,
      recentMessages: params.recentMessages,
    });
    return [
      assessment.phase ? buildCompanionshipPhaseEventFromDecision({ ...params, decision: assessment.phase }) : null,
      ...assessment.care.flatMap((decision) => buildCompanionshipCareTopicEventsFromDecision({
        chat: params.chat,
        character: params.character,
        message: params.message,
        decision,
        activeTopics: assessment.activeTopics,
      })),
      assessment.profileItems.length ? createUserProfileMemoryEvent({
        chat: params.chat,
        character: params.character,
        message: params.message,
        items: assessment.profileItems,
        decisionSource: 'model',
        reason: 'combined direct runtime assessment extracted explicit user profile cues',
      }) : null,
    ].filter((event): event is RuntimeEventV2 => Boolean(event));
  } catch (error) {
    reportRecoverableWarning({
      location: 'companionship:direct-assessment-model-fallback',
      error,
      message: '亲密陪伴合并评估失败，已退回本地保守判断。',
      extra: {
        chatId: params.chat.id,
        characterId: params.character.id,
        messageId: params.message.id,
        messagePreview: compactText(params.message.content, 80),
        fallback: 'local_fallback',
      },
    });
    return buildLocalFallbackEvents(params);
  }
}
