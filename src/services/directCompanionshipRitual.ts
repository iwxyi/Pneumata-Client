import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipRitualEventPayload, RitualRegistryEntry } from '../types/companionship';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
import { buildRitualRegistry } from './companionshipProjection';
import { getCompanionshipRuntimeConfig } from './companionshipRuntimeConfig';
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

function isDirectUserMessage(chat: GroupChat, message: Message) {
  return chat.type === 'direct' && !message.isDeleted && (message.senderId === USER_ACTOR_ID || message.type === 'user' || message.type === 'god');
}

function isGreetingRitualText(text: string) {
  return /(^|[，。！？\s])(早安|早上好|早呀|晚安|睡啦|睡了|去睡了|我要睡了)([，。！？\s]|$)/.test(text);
}

function cleanJsonCandidate(raw: string) {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  return object?.[0] || text;
}

type RitualDecisionSource = 'model' | 'local_fallback';
type CompanionshipRitualDecision = {
  shouldCreate: boolean;
  confidence: number;
  reason: string;
  evidence: string;
  decisionSource: RitualDecisionSource;
};

function buildLocalGreetingRitualDecision(text: string): CompanionshipRitualDecision | null {
  if (!isGreetingRitualText(text)) return null;
  return {
    shouldCreate: true,
    confidence: 0.72,
    reason: '本地兜底判断用户明确开启早安/晚安关系仪式。',
    evidence: compactText(text, 140),
    decisionSource: 'local_fallback',
  };
}

function normalizeModelRitualDecision(raw: unknown, userContent: string): CompanionshipRitualDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.shouldCreate !== true) return null;
  if (value.kind !== 'daily_greeting') return null;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence > 1 ? value.confidence / 100 : value.confidence))
    : 0;
  if (confidence < 0.72) return null;
  return {
    shouldCreate: true,
    confidence,
    reason: compactText(typeof value.reason === 'string' ? value.reason : '模型判断用户明确开启早安/晚安关系仪式。', 160),
    evidence: compactText(typeof value.evidence === 'string' ? value.evidence : userContent, 160),
    decisionSource: 'model',
  };
}

async function judgeGreetingRitualWithModel(params: {
  config: APIConfig;
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  recentMessages?: Message[];
}): Promise<CompanionshipRitualDecision | null> {
  const recentTranscript = (params.recentMessages || [])
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-8)
    .map((item) => `${item.senderName || item.senderId}: ${compactText(item.content, 160)}`)
    .join('\n');
  const systemPrompt = [
    '你是亲密陪伴运行时的关系仪式裁决器。',
    '任务：只判断“用户这一条新消息”是否明确开启早安/晚安类关系仪式。',
    'daily_greeting 只包含用户直接对当前角色说早安、早上好、晚安、睡了、准备睡等问候或睡前收尾。',
    '不要把转述、剧情、歌词、玩笑、讨论别人、要求角色不要早晚安、或普通时间描述当成仪式。',
    '这里只裁决是否形成关系仪式触发；冷却、用户边界和设置由后续系统处理。',
    '返回 JSON: {"shouldCreate":boolean,"kind":"daily_greeting|none","confidence":number,"reason":"...","evidence":"..."}',
    'confidence 取 0-1。拿不准必须 shouldCreate=false 或 confidence<0.72。',
  ].join('\n');
  const payload = {
    chatName: params.chat.name,
    character: {
      id: params.character.id,
      name: params.character.name,
      background: params.character.background || '',
      speakingStyle: params.character.speakingStyle || '',
    },
    recentTranscript,
    userMessage: params.message.content,
  };
  const raw = await generateJsonResponse(params.config, systemPrompt, [{ role: 'user', content: JSON.stringify(payload) }], {
    aiUsage: { type: 'companionship_ritual', label: '陪伴仪式分析', scope: 'chat', resourceId: params.chat.id },
  });
  return normalizeModelRitualDecision(JSON.parse(cleanJsonCandidate(raw)) as unknown, params.message.content);
}

function createRitualRuntimeEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  ritual: Pick<RitualRegistryEntry, 'id' | 'kind' | 'participantIds'> & Partial<Pick<RitualRegistryEntry, 'content' | 'evolution'>>;
  action: CompanionshipRitualEventPayload['action'];
  reason: string;
  evidence: string;
  confidence: number;
  decisionSource: RitualDecisionSource;
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
    content: params.action === 'performed' ? compactText(params.ritual.content, 180) : undefined,
    evolution: params.action === 'performed' ? (params.ritual.evolution || []).map((item) => compactText(item, 120)).filter(Boolean).slice(0, 6) : undefined,
    reason: compactText(params.reason, 140),
    evidence: compactText(params.evidence, 140),
    sourceMessageIds: params.message.id ? [params.message.id] : [],
    nextAvailableAt: params.nextAvailableAt,
    confidence: params.confidence,
    decisionSource: params.decisionSource,
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

function buildCompanionshipRitualEventsFromDecision(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  decision: CompanionshipRitualDecision;
  recentMessages?: Message[];
}): RuntimeEventV2[] {
  if (!getCompanionshipRuntimeConfig().enableRelationshipRituals) return [];
  if (!isDirectUserMessage(params.chat, params.message)) return [];
  const now = params.message.timestamp || Date.now();
  if (getCompanionshipRuntimeConfig().ritualKindToggles.daily_greeting === false) {
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
      reason: 'daily greeting rituals disabled by settings',
      evidence: params.decision.evidence,
      confidence: params.decision.confidence,
      decisionSource: params.decision.decisionSource,
    })];
  }
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
      evidence: params.decision.evidence,
      confidence: params.decision.confidence,
      decisionSource: params.decision.decisionSource,
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
      evidence: params.decision.evidence,
      confidence: params.decision.confidence,
      decisionSource: params.decision.decisionSource,
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
      evidence: params.decision.evidence,
      confidence: params.decision.confidence,
      decisionSource: params.decision.decisionSource,
      nextAvailableAt: greeting.nextAvailableAt,
    })];
  }
  return [createRitualRuntimeEvent({
    chat: params.chat,
    character: params.character,
    message: params.message,
    ritual: greeting,
    action: 'performed',
    reason: params.decision.reason || 'user explicitly opened a greeting ritual in direct chat',
    evidence: params.decision.evidence,
    confidence: params.decision.confidence,
    decisionSource: params.decision.decisionSource,
    nextAvailableAt: now + (greeting.cooldownHours || 12) * 60 * 60_000,
  })];
}

export function buildCompanionshipRitualEventsFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  recentMessages?: Message[];
}): RuntimeEventV2[] {
  const text = compactText(params.message.content, 240);
  const decision = buildLocalGreetingRitualDecision(text);
  return decision ? buildCompanionshipRitualEventsFromDecision({ ...params, decision }) : [];
}

export async function resolveCompanionshipRitualEventsFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  textApiConfig?: APIConfig | null;
  recentMessages?: Message[];
}): Promise<RuntimeEventV2[]> {
  if (!getCompanionshipRuntimeConfig().enableRelationshipRituals) return [];
  if (!isDirectUserMessage(params.chat, params.message)) return [];
  if (params.textApiConfig) {
    try {
      const decision = await judgeGreetingRitualWithModel({
        config: params.textApiConfig,
        chat: params.chat,
        character: params.character,
        message: params.message,
        recentMessages: params.recentMessages,
      });
      return decision ? buildCompanionshipRitualEventsFromDecision({ ...params, decision }) : [];
    } catch (error) {
      reportRecoverableWarning({
        location: 'companionship:ritual-model-fallback',
        error,
        message: '关系仪式模型裁决失败，已退回本地保守判断。',
        extra: {
          chatId: params.chat.id,
          characterId: params.character.id,
          messageId: params.message.id,
          messagePreview: compactText(params.message.content, 80),
          fallback: 'local_fallback',
        },
      });
    }
  }
  return buildCompanionshipRitualEventsFromDirectUserMessage(params);
}
