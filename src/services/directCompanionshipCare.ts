import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipCareTopicEventPayload, PendingCareTopic } from '../types/companionship';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
import { reportRecoverableWarning } from './diagnostics';

const USER_ACTOR_ID = 'user';

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

function createCareTopicRuntimeEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  payload: CompanionshipCareTopicEventPayload;
  summary: string;
}): RuntimeEventV2 {
  const createdAt = params.message.timestamp || Date.now();
  const seed = stableEventSeed([
    params.chat.id,
    params.payload.eventType,
    params.payload.topicId,
    params.payload.action,
    params.message.id,
  ]);
  return {
    id: `evt_${createdAt}_${seed}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt,
    actorIds: [USER_ACTOR_ID],
    targetIds: [params.character.id],
    evidenceMessageIds: [params.message.id],
    summary: params.summary,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: [USER_ACTOR_ID, params.character.id],
    payload: params.payload,
  };
}

function isDirectUserMessage(chat: GroupChat, message: Message) {
  return chat.type === 'direct' && !message.isDeleted && (message.senderId === USER_ACTOR_ID || message.type === 'user' || message.type === 'god');
}

function isCareClosureText(text: string) {
  return /(结束了|已经好了|搞定了|解决了|不用问|不用提醒|别提醒|别问|过了|没事了|结束啦|完成了|好多了|不难受了|考完|聊完)/.test(text);
}

function isCareBlockText(text: string) {
  return /(不用|不要|别|不想).{0,8}(提醒|追问|问|关心)/.test(text);
}

function isLikelyNonUserCareCue(text: string) {
  return /(压力锅|紧张刺激|剧情.*(压力|紧张)|游戏.*(压力|紧张)|电影.*(压力|紧张)|角色.*(不舒服|难受|焦虑|低落)|别人.*(不舒服|难受|焦虑|低落)|他说.*(不舒服|难受|焦虑|低落)|她说.*(不舒服|难受|焦虑|低落))/.test(text);
}

function hasExplicitUserCareCue(text: string) {
  if (/(明天|今晚|后天|周末|要去|打算|计划|约定|准备|面试|考试|加班|ddl|截止|生日|纪念日)/.test(text)) return true;
  return /(我|自己|最近|这几天|今天|今晚|昨晚|明天|上班|工作|学校|考试|面试|睡|身体|胃|头).{0,18}(生病|不舒服|难受|失眠|压力|焦虑|紧张|委屈|低落)|(生病|不舒服|难受|失眠|压力|焦虑|紧张|委屈|低落).{0,18}(我|自己|最近|这几天|今天|今晚|昨晚|明天|上班|工作|学校|考试|面试|睡|身体|胃|头)/.test(text);
}

function detectCareDomain(text: string) {
  if (/面试/.test(text)) return 'interview';
  if (/考试|考完/.test(text)) return 'exam';
  if (/生病|不舒服|难受|失眠|好多了|不难受了/.test(text)) return 'health';
  if (/加班/.test(text)) return 'overtime';
  if (/ddl|截止/.test(text)) return 'deadline';
  if (/生日|纪念日/.test(text)) return 'important_date';
  if (/周末|今晚|明天|后天|要去|打算|计划|约定|准备/.test(text)) return 'plan';
  if (/压力|焦虑|紧张|委屈|低落/.test(text)) return 'emotion';
  return 'general';
}

function topicIdFor(characterId: string, text: string) {
  const domain = detectCareDomain(text);
  const normalized = compactText(text.replace(/[，。！？!?、\s]/g, ''), 36);
  return `care-${characterId}-${domain}-${stableEventSeed([normalized])}`;
}

function urgencyFor(text: string): PendingCareTopic['urgency'] {
  if (/(生病|不舒服|难受|失眠|压力|焦虑|紧张|委屈|低落)/.test(text)) return 'high';
  if (/(明天|今晚|后天|面试|考试|ddl|截止|生日|纪念日|约定)/.test(text)) return 'medium';
  return 'low';
}

function isCareUrgency(value: unknown): value is PendingCareTopic['urgency'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function dueAtFor(text: string, createdAt: number) {
  if (/今晚/.test(text)) return createdAt + 12 * 60 * 60_000;
  if (/明天|面试|考试|ddl|截止/.test(text)) return createdAt + 48 * 60 * 60_000;
  if (/后天|周末|生日|纪念日|约定/.test(text)) return createdAt + 96 * 60 * 60_000;
  if (/(生病|不舒服|难受|压力|焦虑|紧张)/.test(text)) return createdAt + 72 * 60 * 60_000;
  return createdAt + 14 * 24 * 60 * 60_000;
}

function isCareOpeningText(text: string) {
  if (isCareClosureText(text)) return false;
  if (isLikelyNonUserCareCue(text)) return false;
  if (!hasExplicitUserCareCue(text)) return false;
  return /(明天|今晚|最近|考试|面试|加班|难受|不舒服|压力|焦虑|紧张|生日|纪念日|周末|要去|打算|计划|约定|准备|ddl|截止)/.test(text);
}

function carePayloadOf(event: RuntimeEventV2): CompanionshipCareTopicEventPayload | null {
  const payload = event.payload as Partial<CompanionshipCareTopicEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_care_topic' || !payload.topicId || !payload.topicText || !payload.action) return null;
  return payload as CompanionshipCareTopicEventPayload;
}

function isSameCareDomain(topicText: string, closureText: string) {
  const topicDomain = detectCareDomain(topicText);
  const closureDomain = detectCareDomain(closureText);
  if (closureDomain === 'general') return true;
  return topicDomain === closureDomain || topicDomain === 'general';
}

type CareTopicDecisionSource = 'model' | 'local_fallback';
export type CompanionshipCareTopicDecision = {
  action: 'opened' | 'closed' | 'blocked';
  topicText: string;
  topicId?: string;
  urgency: PendingCareTopic['urgency'];
  reason: string;
  evidence: string;
  confidence: number;
  dueAt?: number;
  decisionSource: CareTopicDecisionSource;
};

function normalizeModelCareDecision(raw: unknown, userContent: string, createdAt: number): CompanionshipCareTopicDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const shouldCreate = value.shouldCreate === true;
  const action = typeof value.action === 'string' ? value.action : '';
  if (!shouldCreate || action === 'none') return null;
  if (action !== 'opened' && action !== 'closed' && action !== 'blocked') return null;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence > 1 ? value.confidence / 100 : value.confidence))
    : 0;
  if (confidence < 0.68) return null;
  const topicText = compactText(typeof value.topicText === 'string' ? value.topicText : userContent, 140);
  if (!topicText) return null;
  const dueInHours = typeof value.dueInHours === 'number' && Number.isFinite(value.dueInHours)
    ? Math.max(1, Math.min(24 * 30, value.dueInHours))
    : null;
  return {
    action,
    topicText,
    topicId: typeof value.existingTopicId === 'string' && value.existingTopicId.trim() ? value.existingTopicId.trim() : undefined,
    urgency: isCareUrgency(value.urgency) ? value.urgency : urgencyFor(topicText),
    reason: compactText(typeof value.reason === 'string' ? value.reason : '模型判断用户消息形成了关心事项事件。', 160),
    evidence: compactText(typeof value.evidence === 'string' ? value.evidence : userContent, 160),
    confidence,
    dueAt: action === 'opened'
      ? (dueInHours ? createdAt + dueInHours * 60 * 60_000 : dueAtFor(topicText, createdAt))
      : undefined,
    decisionSource: 'model',
  };
}

function findMatchingActiveTopic(activeTopics: PendingCareTopic[], decision: Pick<CompanionshipCareTopicDecision, 'topicId' | 'topicText'>) {
  if (decision.topicId) {
    const byId = activeTopics.find((topic) => topic.id === decision.topicId);
    if (byId) return byId;
  }
  return activeTopics.find((topic) => isSameCareDomain(topic.text, decision.topicText)) || activeTopics[0] || null;
}

export function buildCompanionshipCareTopicEventsFromDecision(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  decision: CompanionshipCareTopicDecision;
  activeTopics: PendingCareTopic[];
}): RuntimeEventV2[] {
  if (params.decision.action === 'opened') {
    const topicId = topicIdFor(params.character.id, params.decision.topicText);
    if (params.activeTopics.some((topic) => topic.id === topicId)) return [];
    return [createCareTopicRuntimeEvent({
      chat: params.chat,
      character: params.character,
      message: params.message,
      summary: `${params.character.name} 记录了一个需要后续关心的用户事项`,
      payload: {
        eventType: 'companionship_care_topic',
        characterId: params.character.id,
        userId: USER_ACTOR_ID,
        topicId,
        topicText: params.decision.topicText,
        action: 'opened',
        urgency: params.decision.urgency,
        reason: params.decision.reason,
        evidence: params.decision.evidence,
        sourceMessageIds: params.message.id ? [params.message.id] : [],
        dueAt: params.decision.dueAt || dueAtFor(params.decision.topicText, params.message.timestamp || Date.now()),
        confidence: params.decision.confidence,
        decisionSource: params.decision.decisionSource,
      },
    })];
  }
  const topic = findMatchingActiveTopic(params.activeTopics, params.decision);
  if (!topic) return [];
  return [createCareTopicRuntimeEvent({
    chat: params.chat,
    character: params.character,
    message: params.message,
    summary: params.decision.action === 'blocked'
      ? `${params.character.name} 记录用户关闭了一个关心事项提醒`
      : `${params.character.name} 记录用户完成了一个关心事项`,
    payload: {
      eventType: 'companionship_care_topic',
      characterId: params.character.id,
      userId: USER_ACTOR_ID,
      topicId: topic.id,
      topicText: topic.text,
      action: params.decision.action,
      urgency: topic.urgency,
      reason: params.decision.reason,
      evidence: params.decision.evidence,
      sourceMessageIds: params.message.id ? [params.message.id] : [],
      confidence: params.decision.confidence,
      decisionSource: params.decision.decisionSource,
    },
  })];
}

async function judgeCareTopicWithModel(params: {
  config: APIConfig;
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  activeTopics: PendingCareTopic[];
  recentMessages?: Message[];
}): Promise<CompanionshipCareTopicDecision | null> {
  const recentTranscript = (params.recentMessages || [])
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-8)
    .map((item) => `${item.senderName || item.senderId}: ${compactText(item.content, 160)}`)
    .join('\n');
  const systemPrompt = [
    '你是亲密陪伴运行时的关心事项裁决器。',
    '任务：只判断“用户这一条新消息”是否应该创建或关闭一个后续关心事项。',
    'opened：用户明确提到自己的计划、重要日期、健康/情绪压力、未完成约定，并且之后适合自然问一句。',
    'closed：用户明确说某个已有事项结束、搞定、好多了、已经完成。',
    'blocked：用户明确表示不想被提醒、别问、别追问、不要关心这个事项。',
    'none：玩笑、比喻、泛泛表达、影视/游戏/别人经历、压力锅/紧张刺激等非用户真实后续事项，或信息不足。',
    '必须保守：拿不准就 none 或 confidence<0.68。',
    '返回 JSON: {"shouldCreate":boolean,"action":"opened|closed|blocked|none","existingTopicId":"可选，关闭已有事项时使用","topicText":"...","urgency":"low|medium|high","dueInHours":number|null,"confidence":number,"reason":"...","evidence":"..."}',
  ].join('\n');
  const payload = {
    chatName: params.chat.name,
    character: {
      id: params.character.id,
      name: params.character.name,
      background: params.character.background || '',
      speakingStyle: params.character.speakingStyle || '',
    },
    activeTopics: params.activeTopics.map((topic) => ({
      id: topic.id,
      text: topic.text,
      urgency: topic.urgency,
      evidence: topic.evidence || '',
    })),
    recentTranscript,
    userMessage: params.message.content,
  };
  const raw = await generateJsonResponse(params.config, systemPrompt, [{ role: 'user', content: JSON.stringify(payload) }]);
  return normalizeModelCareDecision(JSON.parse(cleanJsonCandidate(raw)) as unknown, params.message.content, params.message.timestamp || Date.now());
}

export function readActiveCompanionshipCareTopicsFromEvents(chat: GroupChat, characterId: string, now = Date.now()): PendingCareTopic[] {
  const byId = new Map<string, { event: RuntimeEventV2; payload: CompanionshipCareTopicEventPayload }>();
  (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact')
    .forEach((event) => {
      const payload = carePayloadOf(event);
      if (!payload || payload.characterId !== characterId || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return;
      const previous = byId.get(payload.topicId);
      if (!previous || event.createdAt >= previous.event.createdAt) byId.set(payload.topicId, { event, payload });
    });
  return Array.from(byId.values())
    .filter(({ payload }) => payload.action === 'opened' && (!payload.dueAt || payload.dueAt >= now))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
    .map(({ event, payload }) => ({
      id: payload.topicId,
      text: compactText(payload.topicText, 140),
      source: 'runtime_event' as const,
      urgency: payload.urgency,
      status: 'active' as const,
      evidence: payload.evidence || event.summary,
      sourceMessageIds: [
        ...(Array.isArray(payload.sourceMessageIds) ? payload.sourceMessageIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())) : []),
        ...(event.evidenceMessageIds || []),
      ].filter((id, index, list) => list.indexOf(id) === index).slice(0, 8),
      updatedAt: event.createdAt,
    }))
    .slice(0, 4);
}

export function readSuppressedCompanionshipCareTopicTextsFromEvents(chat: GroupChat, characterId: string): string[] {
  const byId = new Map<string, { event: RuntimeEventV2; payload: CompanionshipCareTopicEventPayload }>();
  (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact')
    .forEach((event) => {
      const payload = carePayloadOf(event);
      if (!payload || payload.characterId !== characterId || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return;
      const previous = byId.get(payload.topicId);
      if (!previous || event.createdAt >= previous.event.createdAt) byId.set(payload.topicId, { event, payload });
    });
  return Array.from(byId.values())
    .filter(({ payload }) => payload.action !== 'opened')
    .map(({ payload }) => compactText(payload.topicText, 140))
    .filter(Boolean);
}

export function readDueCompanionshipCareTopicsFromEvents(chat: GroupChat, characterId: string, now = Date.now()): PendingCareTopic[] {
  const byId = new Map<string, { event: RuntimeEventV2; payload: CompanionshipCareTopicEventPayload }>();
  (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact')
    .forEach((event) => {
      const payload = carePayloadOf(event);
      if (!payload || payload.characterId !== characterId || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return;
      const previous = byId.get(payload.topicId);
      if (!previous || event.createdAt >= previous.event.createdAt) byId.set(payload.topicId, { event, payload });
    });
  return Array.from(byId.values())
    .filter(({ payload }) => payload.action === 'opened' && typeof payload.dueAt === 'number' && payload.dueAt <= now)
    .sort((left, right) => {
      const leftDueAt = left.payload.dueAt || left.event.createdAt;
      const rightDueAt = right.payload.dueAt || right.event.createdAt;
      return leftDueAt - rightDueAt;
    })
    .map(({ event, payload }) => ({
      id: payload.topicId,
      text: compactText(payload.topicText, 140),
      source: 'runtime_event' as const,
      urgency: payload.urgency,
      status: 'active' as const,
      evidence: payload.evidence || event.summary,
      updatedAt: event.createdAt,
    }))
    .slice(0, 4);
}

export function readStaleCompanionshipCareTopicsFromEvents(chat: GroupChat, characterId: string, now = Date.now()): PendingCareTopic[] {
  const byId = new Map<string, { event: RuntimeEventV2; payload: CompanionshipCareTopicEventPayload }>();
  (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact')
    .forEach((event) => {
      const payload = carePayloadOf(event);
      if (!payload || payload.characterId !== characterId || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return;
      const previous = byId.get(payload.topicId);
      if (!previous || event.createdAt >= previous.event.createdAt) byId.set(payload.topicId, { event, payload });
    });
  return Array.from(byId.values())
    .filter(({ payload }) => {
      if (payload.action !== 'opened' || typeof payload.dueAt !== 'number') return false;
      const staleAfterMs = payload.urgency === 'high' ? 7 * 24 * 60 * 60_000 : 14 * 24 * 60 * 60_000;
      return now - payload.dueAt > staleAfterMs;
    })
    .sort((left, right) => (left.payload.dueAt || left.event.createdAt) - (right.payload.dueAt || right.event.createdAt))
    .map(({ event, payload }) => ({
      id: payload.topicId,
      text: compactText(payload.topicText, 140),
      source: 'runtime_event' as const,
      urgency: payload.urgency,
      status: 'stale' as const,
      restraintReason: 'care topic is past its useful follow-up window',
      evidence: payload.evidence || event.summary,
      updatedAt: event.createdAt,
    }))
    .slice(0, 4);
}

export function buildCompanionshipCareTopicEventsFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  now?: number;
}): RuntimeEventV2[] {
  if (!isDirectUserMessage(params.chat, params.message)) return [];
  const text = compactText(params.message.content, 240);
  if (!text) return [];
  const now = params.now || params.message.timestamp || Date.now();
  const activeTopics = readActiveCompanionshipCareTopicsFromEvents(params.chat, params.character.id, now);
  const events: RuntimeEventV2[] = [];

  if (isCareClosureText(text) && activeTopics.length) {
    const matched = activeTopics.filter((topic) => isCareBlockText(text) || isSameCareDomain(topic.text, text)).slice(0, 2);
    matched.forEach((topic) => {
      const blocked = isCareBlockText(text);
      events.push(createCareTopicRuntimeEvent({
        chat: params.chat,
        character: params.character,
        message: params.message,
        summary: blocked
          ? `${params.character.name} 记录用户关闭了一个关心事项提醒`
          : `${params.character.name} 记录用户完成了一个关心事项`,
        payload: {
          eventType: 'companionship_care_topic',
          characterId: params.character.id,
          userId: USER_ACTOR_ID,
          topicId: topic.id,
          topicText: topic.text,
          action: blocked ? 'blocked' : 'closed',
          urgency: topic.urgency,
          reason: blocked ? 'user rejected reminders or follow-up questions' : 'user closed or answered the pending care topic',
          evidence: text,
          sourceMessageIds: params.message.id ? [params.message.id] : [],
          confidence: 0.62,
          decisionSource: 'local_fallback',
        },
      }));
    });
    return events;
  }

  if (!isCareOpeningText(text)) return events;
  const topicId = topicIdFor(params.character.id, text);
  if (activeTopics.some((topic) => topic.id === topicId)) return events;
  events.push(createCareTopicRuntimeEvent({
    chat: params.chat,
    character: params.character,
    message: params.message,
    summary: `${params.character.name} 记录了一个需要后续关心的用户事项`,
    payload: {
      eventType: 'companionship_care_topic',
      characterId: params.character.id,
      userId: USER_ACTOR_ID,
      topicId,
      topicText: text,
      action: 'opened',
      urgency: urgencyFor(text),
      reason: 'user mentioned a plan, pressure source, health state, date, or unfinished promise',
      evidence: text,
      sourceMessageIds: params.message.id ? [params.message.id] : [],
      dueAt: dueAtFor(text, params.message.timestamp || now),
      confidence: 0.62,
      decisionSource: 'local_fallback',
    },
  }));
  return events;
}

export async function resolveCompanionshipCareTopicEventsFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  textApiConfig?: APIConfig | null;
  recentMessages?: Message[];
  now?: number;
}): Promise<RuntimeEventV2[]> {
  if (!isDirectUserMessage(params.chat, params.message)) return [];
  const now = params.now || params.message.timestamp || Date.now();
  const activeTopics = readActiveCompanionshipCareTopicsFromEvents(params.chat, params.character.id, now);
  if (params.textApiConfig) {
    try {
      const decision = await judgeCareTopicWithModel({
        config: params.textApiConfig,
        chat: params.chat,
        character: params.character,
        message: params.message,
        activeTopics,
        recentMessages: params.recentMessages,
      });
      if (!decision) return [];
      return buildCompanionshipCareTopicEventsFromDecision({
        chat: params.chat,
        character: params.character,
        message: params.message,
        decision,
        activeTopics,
      });
    } catch (error) {
      reportRecoverableWarning({
        location: 'companionship:care-topic-model-fallback',
        error,
        message: '关心事项模型裁决失败，已退回本地保守判断。',
        extra: {
          chatId: params.chat.id,
          characterId: params.character.id,
          messageId: params.message.id,
          messagePreview: compactText(params.message.content, 80),
          fallback: 'local_fallback',
        },
      });
      return buildCompanionshipCareTopicEventsFromDirectUserMessage(params);
    }
  }
  return buildCompanionshipCareTopicEventsFromDirectUserMessage(params);
}
