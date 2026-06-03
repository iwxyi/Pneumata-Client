import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipCareTopicEventPayload, PendingCareTopic } from '../types/companionship';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';

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

function dueAtFor(text: string, createdAt: number) {
  if (/今晚/.test(text)) return createdAt + 12 * 60 * 60_000;
  if (/明天|面试|考试|ddl|截止/.test(text)) return createdAt + 48 * 60 * 60_000;
  if (/后天|周末|生日|纪念日|约定/.test(text)) return createdAt + 96 * 60 * 60_000;
  if (/(生病|不舒服|难受|压力|焦虑|紧张)/.test(text)) return createdAt + 72 * 60 * 60_000;
  return createdAt + 14 * 24 * 60 * 60_000;
}

function isCareOpeningText(text: string) {
  if (isCareClosureText(text)) return false;
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
      dueAt: dueAtFor(text, params.message.timestamp || now),
    },
  }));
  return events;
}
