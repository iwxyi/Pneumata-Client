import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipSharedPhraseEventPayload, CompanionshipStyle, SharedPhrase, UserProfileMemoryEventItem, UserProfileMemoryKind } from '../types/companionship';
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
const SHARED_PHRASE_KINDS: SharedPhrase['kind'][] = ['pet_name', 'inside_joke', 'promise_line', 'comfort_line', 'confession_line', 'secret_code', 'other'];
const SHARED_PHRASE_VISIBILITIES: SharedPhrase['visibility'][] = ['private', 'between_actors', 'public_hint'];

function compactText(text: string | undefined | null, max = 140) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function stableEventSeed(parts: Array<string | number | undefined>) {
  const joined = parts.filter((item) => item !== undefined && item !== null && String(item).length > 0).join('|');
  let hash = 0;
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 31 + joined.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
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

function isSharedPhraseKind(value: unknown): value is SharedPhrase['kind'] {
  return typeof value === 'string' && SHARED_PHRASE_KINDS.includes(value as SharedPhrase['kind']);
}

function isSharedPhraseVisibility(value: unknown): value is SharedPhrase['visibility'] {
  return typeof value === 'string' && SHARED_PHRASE_VISIBILITIES.includes(value as SharedPhrase['visibility']);
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

type SharedPhraseDecision = {
  action: 'upsert' | 'reused' | 'suppressed';
  text: string;
  kind: SharedPhrase['kind'];
  visibility: SharedPhrase['visibility'];
  firstSaidBy?: string;
  reason: string;
  evidence: string;
  emotionalWeight: number;
  reuseCount: number;
  confidence: number;
  decisionSource: 'model' | 'local_fallback';
};

function normalizeSharedPhraseDecisions(raw: unknown, userContent: string): SharedPhraseDecision[] {
  const source = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return source
    .map((item): SharedPhraseDecision | null => {
      if (!item || typeof item !== 'object') return null;
      const value = item as Record<string, unknown>;
      if (value.shouldCreate !== true) return null;
      const action = value.action;
      if (action !== 'upsert' && action !== 'reused' && action !== 'suppressed') return null;
      const confidence = normalizeConfidence(value.confidence);
      if (confidence < 0.72) return null;
      const text = compactText(typeof value.text === 'string' ? value.text : '', 80);
      if (!text) return null;
      return {
        action,
        text,
        kind: isSharedPhraseKind(value.kind) ? value.kind : 'other',
        visibility: isSharedPhraseVisibility(value.visibility) ? value.visibility : 'between_actors',
        firstSaidBy: typeof value.firstSaidBy === 'string' && value.firstSaidBy.trim() ? value.firstSaidBy.trim() : undefined,
        reason: compactText(typeof value.reason === 'string' ? value.reason : '模型判断用户消息形成了共同话语事件。', 160),
        evidence: compactText(typeof value.evidence === 'string' ? value.evidence : userContent, 160),
        emotionalWeight: Math.max(0, Math.min(100, Math.round(typeof value.emotionalWeight === 'number' && Number.isFinite(value.emotionalWeight) ? value.emotionalWeight : 64))),
        reuseCount: Math.max(1, Math.min(50, Math.round(typeof value.reuseCount === 'number' && Number.isFinite(value.reuseCount) ? value.reuseCount : 1))),
        confidence,
        decisionSource: 'model',
      };
    })
    .filter((item): item is SharedPhraseDecision => Boolean(item))
    .slice(0, 3);
}

function createSharedPhraseRuntimeEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  decision: SharedPhraseDecision;
}): RuntimeEventV2 {
  const createdAt = params.message.timestamp || Date.now();
  const phraseSeed = stableEventSeed([params.character.id, params.decision.kind, params.decision.text.replace(/\s+/g, '')]);
  const phraseId = `phrase-${params.character.id}-${phraseSeed}`;
  const payload: CompanionshipSharedPhraseEventPayload = {
    eventType: 'companionship_shared_phrase',
    characterId: params.character.id,
    userId: USER_ACTOR_ID,
    phraseId,
    action: params.decision.action,
    text: params.decision.text,
    kind: params.decision.kind,
    participantIds: [params.character.id, USER_ACTOR_ID],
    visibility: params.decision.visibility,
    firstSaidBy: params.decision.firstSaidBy,
    reason: params.decision.reason,
    evidence: params.decision.evidence,
    emotionalWeight: params.decision.emotionalWeight,
    reuseCount: params.decision.reuseCount,
    confidence: params.decision.confidence,
    decisionSource: params.decision.decisionSource,
  };
  return {
    id: `evt_${createdAt}_${stableEventSeed([params.chat.id, payload.eventType, phraseId, payload.action, params.message.id])}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt,
    actorIds: [USER_ACTOR_ID],
    targetIds: [params.character.id],
    evidenceMessageIds: [params.message.id],
    summary: params.decision.action === 'suppressed'
      ? `${params.character.name} 记录用户不想继续使用一句共同话语`
      : `${params.character.name} 记录了一句共同话语`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: [USER_ACTOR_ID, params.character.id],
    payload,
  };
}

function inferLocalSharedPhraseKind(text: string): SharedPhrase['kind'] {
  if (/(叫我|称呼|昵称|喊我)/.test(text)) return 'pet_name';
  if (/(暗号|口令|密语|只有我们|我们之间|共同梗|梗)/.test(text)) return 'inside_joke';
  if (/(约定|承诺|答应|说好|以后.*一起|下次.*一起)/.test(text)) return 'promise_line';
  if (/(别怕|没关系|我在|陪着你|不用硬撑|慢慢来)/.test(text)) return 'comfort_line';
  if (/(喜欢你|爱你|想你|在一起|表白)/.test(text)) return 'confession_line';
  if (/(秘密|小秘密|不能告诉|保密|只告诉)/.test(text)) return 'secret_code';
  return 'other';
}

function buildLocalSharedPhraseDecisions(message: Message): SharedPhraseDecision[] {
  const content = compactText(message.content, 240);
  if (!content) return [];
  const quoted = content.match(/[“"「『](.{1,36}?)[”"」』]/)?.[1]
    || content.match(/(?:暗号|口令|约定|说好|叫我|称呼)[是叫为：:\s]*(.{1,28})/)?.[1];
  if (!quoted) return [];
  const text = compactText(quoted, 80);
  if (!text) return [];
  const action: SharedPhraseDecision['action'] = /(不要|别再|不想|不用).{0,12}(说|用|叫|提|复读|记)/.test(content) ? 'suppressed' : 'upsert';
  const kind = inferLocalSharedPhraseKind(content);
  return [{
    action,
    text,
    kind,
    visibility: kind === 'secret_code' ? 'private' : 'between_actors',
    firstSaidBy: USER_ACTOR_ID,
    reason: action === 'suppressed'
      ? '本地兜底判断用户不想继续复用这句共同话语。'
      : '本地兜底判断用户明确给出一句共同话语。',
    evidence: content,
    emotionalWeight: kind === 'other' ? 44 : 62,
    reuseCount: 1,
    confidence: 0.64,
    decisionSource: 'local_fallback',
  }];
}

function buildSharedPhraseEventsFromDecisions(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  decisions: SharedPhraseDecision[];
}) {
  return params.decisions.map((decision) => createSharedPhraseRuntimeEvent({ ...params, decision }));
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
    '任务：只评估用户这一条新消息对四个运行时模块的结构化影响：关系阶段、关心事项、用户画像记忆、共同话语。',
    '必须保守：玩笑、比喻、角色扮演台词、影视/游戏/别人经历、含糊猜测、临时口嗨，不要创建长期事件。',
    'phase 只在用户明确把自己和当前角色的关系推进、降级、修复或确认时创建。',
    'careTopics 只在用户明确提到自己的计划、重要日期、健康/情绪压力、未完成约定，或明确关闭/拒绝已有关心事项时创建。',
    'userProfile 只记录适合未来自然照顾用户的事实、偏好、边界、日期、计划或稳定压力来源。',
    'sharedPhrases 只在用户明确创造、复用或拒绝一条“我们之间的话”时创建，例如专属称呼、暗号、约定原话、安慰语、心意话语、秘密暗号；不要把普通聊天句子当口头禅。',
    '不要写可见回复内容。只输出 JSON，不要 markdown。',
    '输出结构：{"phase":{"shouldCreate":boolean,"phase":"confessing|confirmed|passionate|deep|cooling|crisis|reconciling|none","style":"romantic|ambiguous|friend|family|mentor|custom|null","confidence":number,"reason":"...","evidence":["..."]},"careTopics":[{"shouldCreate":boolean,"action":"opened|closed|blocked|none","existingTopicId":"可选","topicText":"...","urgency":"low|medium|high","dueInHours":number|null,"confidence":number,"reason":"...","evidence":"..."}],"userProfile":{"shouldCreate":boolean,"items":[{"kind":"display_name|address_preference|schedule_hint|pressure_source|preference|dislike|boundary|important_date|recent_plan|emotional_pattern","text":"第三人称可记忆事实","evidence":"原文证据","confidence":number,"sensitive":boolean}],"reason":"..."},"sharedPhrases":[{"shouldCreate":boolean,"action":"upsert|reused|suppressed|none","text":"共同话语原文","kind":"pet_name|inside_joke|promise_line|comfort_line|confession_line|secret_code|other","visibility":"private|between_actors|public_hint","firstSaidBy":"user|character|mutual|null","emotionalWeight":number,"reuseCount":number,"confidence":number,"reason":"...","evidence":"..."}]}',
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
    sharedPhrases: normalizeSharedPhraseDecisions(parsed.sharedPhrases, params.message.content),
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
    ...buildSharedPhraseEventsFromDecisions({
      chat: params.chat,
      character: params.character,
      message: params.message,
      decisions: buildLocalSharedPhraseDecisions(params.message),
    }),
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
      ...buildSharedPhraseEventsFromDecisions({
        chat: params.chat,
        character: params.character,
        message: params.message,
        decisions: assessment.sharedPhrases,
      }),
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
