import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type {
  CompanionshipAddressingEventPayload,
  CompanionshipIntimateConflictEventPayload,
  CompanionshipPhaseEventPayload,
  CompanionshipPromiseEventPayload,
  CompanionshipSharedPhraseEventPayload,
  SharedPhrase,
} from '../types/companionship';
import type { RuntimeEventV2 } from '../types/runtimeEvent';

const USER_ACTOR_ID = 'user';

function compactText(text: string | undefined | null, max = 96) {
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

function quoteOrMeaningfulText(text: string | undefined | null, fallback?: string) {
  const source = text || '';
  const quoted = source.match(/[“"「『](.{1,36}?)[”"」』]/)?.[1];
  if (quoted) return compactText(quoted, 72);
  const cleaned = compactText(source, 72);
  if (/(喜欢你|想你|在一起|慢慢来|我在|说好|约定|叫我|称呼|别冷战|说开|别怕|陪着你)/.test(cleaned)) return cleaned;
  return compactText(fallback, 72);
}

function sharedPhrasePayloadOf(event: RuntimeEventV2): CompanionshipSharedPhraseEventPayload | null {
  const payload = event.payload as Partial<CompanionshipSharedPhraseEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_shared_phrase') return null;
  return payload as CompanionshipSharedPhraseEventPayload;
}

function createSharedPhraseEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  sourceEvent: RuntimeEventV2;
  text: string;
  kind: SharedPhrase['kind'];
  visibility?: SharedPhrase['visibility'];
  firstSaidBy?: string;
  reason: string;
  evidence?: string;
  emotionalWeight?: number;
}): RuntimeEventV2 {
  const phraseId = `phrase-backflow-${stableEventSeed([params.chat.id, params.character.id, params.kind, params.text])}`;
  const payload: CompanionshipSharedPhraseEventPayload = {
    eventType: 'companionship_shared_phrase',
    characterId: params.character.id,
    userId: USER_ACTOR_ID,
    phraseId,
    action: 'upsert',
    text: params.text,
    kind: params.kind,
    participantIds: [params.character.id, USER_ACTOR_ID],
    visibility: params.visibility || 'between_actors',
    firstSaidBy: params.firstSaidBy,
    reason: params.reason,
    evidence: params.evidence || params.sourceEvent.summary,
    emotionalWeight: params.emotionalWeight || 64,
    reuseCount: 1,
    confidence: 0.86,
  };
  return {
    id: `evt-${phraseId}-${stableEventSeed([params.sourceEvent.id])}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt: params.sourceEvent.createdAt || Date.now(),
    actorIds: [params.character.id, USER_ACTOR_ID],
    targetIds: [params.character.id, USER_ACTOR_ID],
    summary: `${params.character.name} 记录了一句关系里的共同话语`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: [USER_ACTOR_ID, params.character.id],
    evidenceMessageIds: params.sourceEvent.evidenceMessageIds,
    payload,
  };
}

export function buildSharedPhraseEventsFromCompanionshipEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  event: RuntimeEventV2;
}): RuntimeEventV2[] {
  if (sharedPhrasePayloadOf(params.event)) return [];
  const payload = params.event.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload.eventType !== 'string' || !payload.eventType.startsWith('companionship_')) return [];
  if (payload.characterId !== params.character.id) return [];
  if (payload.eventType === 'companionship_addressing') {
    const addressing = payload as unknown as CompanionshipAddressingEventPayload;
    if (addressing.action !== 'update' && addressing.action !== 'set_current' && addressing.action !== 'set_private') return [];
    const text = compactText(addressing.privateAddress || addressing.currentAddress, 32);
    if (!text) return [];
    return [createSharedPhraseEvent({
      ...params,
      sourceEvent: params.event,
      text,
      kind: 'pet_name',
      firstSaidBy: addressing.initiatedBy === 'character' ? params.character.id : addressing.initiatedBy === 'user' ? USER_ACTOR_ID : undefined,
      reason: '称呼事件派生专属称呼共同话语。',
      evidence: addressing.evidence || addressing.reason,
      emotionalWeight: 66,
    })];
  }
  if (payload.eventType === 'companionship_promise') {
    const promise = payload as unknown as CompanionshipPromiseEventPayload;
    if (promise.action !== 'opened' && promise.action !== 'fulfilled') return [];
    const text = quoteOrMeaningfulText(promise.promiseText);
    if (!text) return [];
    return [createSharedPhraseEvent({
      ...params,
      sourceEvent: params.event,
      text,
      kind: 'promise_line',
      firstSaidBy: 'mutual',
      reason: '约定事件派生约定话语。',
      evidence: promise.evidence || promise.reason,
      emotionalWeight: promise.action === 'fulfilled' ? 72 : 64,
    })];
  }
  if (payload.eventType === 'companionship_phase_event') {
    const phase = payload as unknown as CompanionshipPhaseEventPayload;
    if (phase.phase !== 'confessing' && phase.phase !== 'confirmed' && phase.phase !== 'passionate' && phase.phase !== 'deep') return [];
    const evidenceText = (phase.evidence || []).join('\n');
    const text = quoteOrMeaningfulText(evidenceText || phase.reason, phase.phase === 'confirmed' ? '确认彼此心意' : '把心意说出口');
    if (!text) return [];
    return [createSharedPhraseEvent({
      ...params,
      sourceEvent: params.event,
      text,
      kind: 'confession_line',
      firstSaidBy: phase.initiatedBy === 'character' ? params.character.id : phase.initiatedBy === 'user' ? USER_ACTOR_ID : 'mutual',
      reason: '关系阶段事件派生心意话语。',
      evidence: evidenceText || phase.reason,
      emotionalWeight: phase.phase === 'deep' || phase.phase === 'passionate' ? 78 : 70,
    })];
  }
  if (payload.eventType === 'companionship_intimate_conflict') {
    const conflict = payload as unknown as CompanionshipIntimateConflictEventPayload;
    if (conflict.action !== 'repair_attempted' && conflict.action !== 'resolved') return [];
    const evidenceText = (conflict.evidence || []).join('\n');
    const text = quoteOrMeaningfulText(evidenceText || conflict.summary, conflict.action === 'resolved' ? '慢慢来，我们说开' : '慢慢来，我在');
    if (!text) return [];
    return [createSharedPhraseEvent({
      ...params,
      sourceEvent: params.event,
      text,
      kind: 'comfort_line',
      firstSaidBy: 'mutual',
      reason: '冲突修复事件派生安慰话语。',
      evidence: evidenceText || conflict.summary,
      emotionalWeight: conflict.action === 'resolved' ? 74 : 68,
    })];
  }
  return [];
}

export function buildSharedPhraseEventsFromCompanionshipEvents(params: {
  chat: GroupChat;
  character: AICharacter;
  events: RuntimeEventV2[];
}): RuntimeEventV2[] {
  const existingIds = new Set(params.events.map((event) => event.id));
  const existingPhraseKeys = new Set(params.events
    .map((event) => sharedPhrasePayloadOf(event))
    .filter((item): item is CompanionshipSharedPhraseEventPayload => Boolean(item))
    .map((payload) => `${payload.kind || 'other'}:${payload.text.replace(/\s+/g, '')}`));
  return params.events
    .flatMap((event) => buildSharedPhraseEventsFromCompanionshipEvent({ chat: params.chat, character: params.character, event }))
    .filter((event) => {
      if (existingIds.has(event.id)) return false;
      const payload = sharedPhrasePayloadOf(event);
      const key = payload ? `${payload.kind || 'other'}:${payload.text.replace(/\s+/g, '')}` : event.id;
      if (existingPhraseKeys.has(key)) return false;
      existingPhraseKeys.add(key);
      existingIds.add(event.id);
      return true;
    });
}
