import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipRitualEventPayload, RitualRegistryEntry } from '../types/companionship';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { buildRitualRegistry } from './companionshipProjection';

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

function isDirectUserMessage(chat: GroupChat, message: Message) {
  return chat.type === 'direct' && !message.isDeleted && (message.senderId === USER_ACTOR_ID || message.type === 'user' || message.type === 'god');
}

function isGreetingRitualText(text: string) {
  return /(^|[，。！？\s])(早安|早上好|早呀|晚安|睡啦|睡了|去睡了|我要睡了)([，。！？\s]|$)/.test(text);
}

function createRitualRuntimeEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  ritual: Pick<RitualRegistryEntry, 'id' | 'kind' | 'participantIds'>;
  action: CompanionshipRitualEventPayload['action'];
  reason: string;
  nextAvailableAt?: number;
}): RuntimeEventV2 {
  const createdAt = params.message.timestamp || Date.now();
  const payload: CompanionshipRitualEventPayload = {
    eventType: 'companionship_ritual',
    characterId: params.character.id,
    userId: USER_ACTOR_ID,
    ritualId: params.ritual.id,
    kind: params.ritual.kind,
    action: params.action,
    participantIds: params.ritual.participantIds?.length ? params.ritual.participantIds : [params.character.id, USER_ACTOR_ID],
    reason: compactText(params.reason, 140),
    evidence: compactText(params.message.content, 140),
    nextAvailableAt: params.nextAvailableAt,
    confidence: 0.72,
    decisionSource: 'local_fallback',
  };
  const seed = stableEventSeed([params.chat.id, payload.eventType, payload.ritualId, payload.action, params.message.id]);
  return {
    id: `evt-ritual-${createdAt}-${seed}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt,
    actorIds: [USER_ACTOR_ID],
    targetIds: [params.character.id],
    evidenceMessageIds: [params.message.id],
    summary: params.action === 'performed'
      ? `${params.character.name} 记录了一次自然问候仪式`
      : `${params.character.name} 记录了一次被克制的问候仪式`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: [USER_ACTOR_ID, params.character.id],
    payload,
  };
}

export function buildCompanionshipRitualEventsFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  recentMessages?: Message[];
}): RuntimeEventV2[] {
  if (!isDirectUserMessage(params.chat, params.message)) return [];
  const text = compactText(params.message.content, 240);
  if (!isGreetingRitualText(text)) return [];
  const now = params.message.timestamp || Date.now();
  const rituals = buildRitualRegistry({
    character: params.character,
    chat: params.chat,
    messages: params.recentMessages || [params.message],
    now,
  });
  const greeting = rituals.find((ritual) => ritual.kind === 'daily_greeting');
  if (!greeting) {
    return [createRitualRuntimeEvent({
      chat: params.chat,
      character: params.character,
      message: params.message,
      ritual: {
        id: `ritual-${params.character.id}-daily-greeting`,
        kind: 'daily_greeting',
        participantIds: [params.character.id, USER_ACTOR_ID],
      },
      action: 'suppressed',
      reason: 'user boundary suppresses greeting ritual',
    })];
  }
  if (greeting.executionState === 'cooldown' && greeting.nextAvailableAt && greeting.nextAvailableAt > now) {
    return [createRitualRuntimeEvent({
      chat: params.chat,
      character: params.character,
      message: params.message,
      ritual: greeting,
      action: 'skipped',
      reason: 'greeting ritual is still in cooldown',
      nextAvailableAt: greeting.nextAvailableAt,
    })];
  }
  if (greeting.executionState === 'suppressed') {
    return [createRitualRuntimeEvent({
      chat: params.chat,
      character: params.character,
      message: params.message,
      ritual: greeting,
      action: 'suppressed',
      reason: greeting.boundaryReasons.slice(-1)[0] || 'greeting ritual suppressed by companionship boundary',
      nextAvailableAt: greeting.nextAvailableAt,
    })];
  }
  return [createRitualRuntimeEvent({
    chat: params.chat,
    character: params.character,
    message: params.message,
    ritual: greeting,
    action: 'performed',
    reason: 'user explicitly opened a greeting ritual in direct chat',
    nextAvailableAt: now + (greeting.cooldownHours || 12) * 60 * 60_000,
  })];
}
