import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { UserProfileMemoryEventItem, UserProfileMemoryEventPayload, UserProfileMemoryKind } from '../types/companionship';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
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

function isMemoryKind(value: unknown): value is UserProfileMemoryKind {
  return typeof value === 'string' && MEMORY_KINDS.includes(value as UserProfileMemoryKind);
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function isLikelyNonUserSensitiveCue(text: string) {
  return /(压力锅|紧张刺激|剧情.*(压力|紧张)|游戏.*(压力|紧张)|电影.*(压力|紧张)|角色.*(不舒服|难受|焦虑|低落)|别人.*(不舒服|难受|焦虑|低落)|他说.*(不舒服|难受|焦虑|低落)|她说.*(不舒服|难受|焦虑|低落))/.test(text);
}

function hasExplicitUserSensitiveCue(text: string) {
  return /(我|自己|最近|这几天|今天|今晚|昨晚|明天|上班|工作|学校|考试|面试|睡|身体|胃|头).{0,18}(生病|不舒服|难受|失眠|压力|焦虑|紧张|委屈|低落)|(生病|不舒服|难受|失眠|压力|焦虑|紧张|委屈|低落).{0,18}(我|自己|最近|这几天|今天|今晚|昨晚|明天|上班|工作|学校|考试|面试|睡|身体|胃|头)/.test(text);
}

function normalizeModelItems(raw: unknown, userContent: string): UserProfileMemoryEventItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const value = raw as Record<string, unknown>;
  if (value.shouldCreate !== true) return [];
  const items = Array.isArray(value.items) ? value.items : [];
  return items
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

function dedupeItems(items: UserProfileMemoryEventItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildLocalFallbackItems(text: string): UserProfileMemoryEventItem[] {
  const items: UserProfileMemoryEventItem[] = [];
  const address = text.match(/(?:叫我|称呼我|喊我|昵称是|我的名字是|我叫)[:：]?\s*([^，。；;、\s]{1,12})/)?.[1];
  if (address) {
    items.push({
      kind: 'address_preference',
      text: `用户希望被称呼为${address}`,
      evidence: text,
      confidence: 0.62,
    });
  }
  if (/(不要|不想|别).{0,12}(主动|打扰|私聊|提醒|早安|晚安|恋爱|暧昧|情侣|对象|占有|吃醋|追问|关心)/.test(text)) {
    items.push({
      kind: 'boundary',
      text,
      evidence: text,
      confidence: 0.62,
      sensitive: true,
    });
  }
  if (/(明天|后天|今晚|周末|要去|打算|计划|准备|面试|考试|ddl|截止|纪念日|生日)/.test(text)) {
    items.push({
      kind: /(生日|纪念日|考试|面试|ddl|截止)/.test(text) ? 'important_date' : 'recent_plan',
      text,
      evidence: text,
      confidence: 0.62,
      sensitive: /(生日|纪念日|面试|考试)/.test(text),
    });
  }
  if (!isLikelyNonUserSensitiveCue(text) && hasExplicitUserSensitiveCue(text)) {
    items.push({
      kind: /(生病|不舒服|难受|失眠)/.test(text) ? 'pressure_source' : 'emotional_pattern',
      text,
      evidence: text,
      confidence: 0.62,
      sensitive: true,
    });
  }
  return dedupeItems(items).slice(0, 4);
}

function createUserProfileMemoryEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  items: UserProfileMemoryEventItem[];
  decisionSource: UserProfileMemoryEventPayload['decisionSource'];
  reason: string;
}): RuntimeEventV2 | null {
  const items = dedupeItems(params.items).filter((item) => item.text && item.confidence >= 0.6);
  if (!items.length) return null;
  const createdAt = params.message.timestamp || Date.now();
  const seed = stableEventSeed([params.chat.id, params.character.id, params.message.id, items.map((item) => `${item.kind}:${item.text}`).join('|')]);
  const payload: UserProfileMemoryEventPayload = {
    eventType: 'companionship_user_profile_memory',
    characterId: params.character.id,
    userId: USER_ACTOR_ID,
    action: 'upsert',
    items,
    reason: params.reason,
    evidence: compactText(params.message.content, 180),
    confidence: Math.max(...items.map((item) => item.confidence)),
    decisionSource: params.decisionSource,
  };
  return {
    id: `evt-user-profile-${createdAt}-${seed}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt,
    actorIds: [USER_ACTOR_ID],
    targetIds: [params.character.id],
    evidenceMessageIds: [params.message.id],
    summary: `${params.character.name} 记录了用户画像线索`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: [USER_ACTOR_ID, params.character.id],
    payload,
  };
}

async function judgeUserProfileMemoryWithModel(params: {
  config: APIConfig;
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  recentMessages?: Message[];
}): Promise<UserProfileMemoryEventItem[]> {
  const recentTranscript = (params.recentMessages || [])
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-8)
    .map((item) => `${item.senderName || item.senderId}: ${compactText(item.content, 160)}`)
    .join('\n');
  const systemPrompt = [
    '你是亲密陪伴运行时的用户画像记忆裁决器。',
    '任务：只判断“用户这一条新消息”是否包含适合角色长期或近期记住的用户画像事实。',
    '可记录类别：display_name/address_preference/schedule_hint/pressure_source/preference/dislike/boundary/important_date/recent_plan/emotional_pattern。',
    '必须保守：玩笑、比喻、影视/游戏/别人经历、角色扮演台词、临时情绪口嗨、含糊猜测都不要记录。',
    '敏感事实如生日、健康、现实关系、工作学习压力、情绪困扰、边界偏好必须有直接证据和较高置信度。',
    '不要把“压力锅”“紧张刺激”“角色说不舒服”等非用户本人事实记为 pressure/emotional。',
    '返回 JSON: {"shouldCreate":boolean,"items":[{"kind":"...","text":"用第三人称短句写成可记忆事实","evidence":"原文证据","confidence":number,"sensitive":boolean}],"reason":"..."}',
    'confidence 取 0-1。拿不准必须 shouldCreate=false 或 confidence<0.7。',
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
  const raw = await generateJsonResponse(params.config, systemPrompt, [{ role: 'user', content: JSON.stringify(payload) }]);
  return normalizeModelItems(JSON.parse(cleanJsonCandidate(raw)) as unknown, params.message.content);
}

export function userProfileMemoryPayloadOf(event: RuntimeEventV2): UserProfileMemoryEventPayload | null {
  const payload = event.payload as Partial<UserProfileMemoryEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_user_profile_memory' || !payload.characterId || !payload.action || !Array.isArray(payload.items)) return null;
  return payload as UserProfileMemoryEventPayload;
}

export function buildUserProfileMemoryEventFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
}): RuntimeEventV2 | null {
  if (!isDirectUserMessage(params.chat, params.message)) return null;
  const text = compactText(params.message.content, 240);
  if (!text) return null;
  return createUserProfileMemoryEvent({
    chat: params.chat,
    character: params.character,
    message: params.message,
    items: buildLocalFallbackItems(text),
    decisionSource: 'local_fallback',
    reason: 'local fallback extracted explicit user profile cues',
  });
}

export async function resolveUserProfileMemoryEventFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  textApiConfig?: APIConfig | null;
  recentMessages?: Message[];
}): Promise<RuntimeEventV2 | null> {
  if (!isDirectUserMessage(params.chat, params.message)) return null;
  if (params.textApiConfig) {
    try {
      const items = await judgeUserProfileMemoryWithModel({
        config: params.textApiConfig,
        chat: params.chat,
        character: params.character,
        message: params.message,
        recentMessages: params.recentMessages,
      });
      return createUserProfileMemoryEvent({
        chat: params.chat,
        character: params.character,
        message: params.message,
        items,
        decisionSource: 'model',
        reason: 'model extracted explicit user profile cues',
      });
    } catch (error) {
      reportRecoverableWarning({
        location: 'companionship:user-profile-model-fallback',
        error,
        message: '用户画像模型裁决失败，已退回本地保守判断。',
        extra: {
          chatId: params.chat.id,
          characterId: params.character.id,
          messageId: params.message.id,
          messagePreview: compactText(params.message.content, 80),
          fallback: 'local_fallback',
        },
      });
      return buildUserProfileMemoryEventFromDirectUserMessage(params);
    }
  }
  return buildUserProfileMemoryEventFromDirectUserMessage(params);
}
