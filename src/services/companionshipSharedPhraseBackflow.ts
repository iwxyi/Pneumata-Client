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

function normalizeSourceMessageIds(...sources: Array<unknown>): string[] {
  return sources
    .flatMap((source) => Array.isArray(source) ? source : [])
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    .filter((id, index, list) => list.indexOf(id) === index)
    .slice(0, 8);
}

function sourceMessageIdsFromEvent(event: RuntimeEventV2): string[] {
  const payload = event.payload as { sourceMessageIds?: unknown } | undefined;
  return normalizeSourceMessageIds(payload?.sourceMessageIds, event.evidenceMessageIds);
}

function decisionSourceFromEvent(event: RuntimeEventV2): 'model' | 'local_fallback' {
  const payload = event.payload as { decisionSource?: unknown } | undefined;
  return payload?.decisionSource === 'model' || payload?.decisionSource === 'local_fallback'
    ? payload.decisionSource
    : 'local_fallback';
}

function confidenceFromEvent(event: RuntimeEventV2, fallback = 0.86) {
  const payload = event.payload as { confidence?: unknown } | undefined;
  return typeof payload?.confidence === 'number' && Number.isFinite(payload.confidence)
    ? Math.max(0, Math.min(1, payload.confidence > 1 ? payload.confidence / 100 : payload.confidence))
    : fallback;
}

function normalizedScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function isDistilledMemoryBackflowEligible(payload: Record<string, unknown>) {
  const confidence = normalizedScore(payload.confidence);
  if (confidence !== null && confidence < 0.72) return false;
  const salience = normalizedScore(payload.salience);
  if (salience !== null && salience < 0.45) return false;
  return true;
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
  character: Pick<AICharacter, 'id' | 'name'>;
  sourceEvent: RuntimeEventV2;
  text: string;
  kind: SharedPhrase['kind'];
  participantIds?: string[];
  visibility?: SharedPhrase['visibility'];
  firstSaidBy?: string;
  reason: string;
  evidence?: string;
  emotionalWeight?: number;
  phraseId?: string;
  action?: CompanionshipSharedPhraseEventPayload['action'];
  reuseCount?: number;
}): RuntimeEventV2 {
  const participantIds = Array.from(new Set((params.participantIds?.length ? params.participantIds : [params.character.id, USER_ACTOR_ID]).filter(Boolean))).slice(0, 6);
  const includesUser = participantIds.includes(USER_ACTOR_ID);
  const phraseId = params.phraseId || `phrase-backflow-${stableEventSeed([params.chat.id, params.character.id, params.kind, params.text, participantIds.join(',')])}`;
  const action = params.action || 'upsert';
  const payload: CompanionshipSharedPhraseEventPayload = {
    eventType: 'companionship_shared_phrase',
    characterId: params.character.id,
    userId: includesUser ? USER_ACTOR_ID : undefined,
    phraseId,
    action,
    text: params.text,
    kind: params.kind,
    participantIds,
    visibility: params.visibility || 'between_actors',
    firstSaidBy: params.firstSaidBy,
    reason: params.reason,
    evidence: params.evidence || params.sourceEvent.summary,
    sourceMessageIds: sourceMessageIdsFromEvent(params.sourceEvent),
    emotionalWeight: params.emotionalWeight || 64,
    reuseCount: params.reuseCount || 1,
    confidence: confidenceFromEvent(params.sourceEvent),
    decisionSource: decisionSourceFromEvent(params.sourceEvent),
  };
  return {
    id: `evt-${phraseId}-${stableEventSeed([params.sourceEvent.id, action, params.reuseCount])}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt: params.sourceEvent.createdAt || Date.now(),
    actorIds: participantIds,
    targetIds: participantIds,
    summary: `${params.character.name} 记录了一句关系里的共同话语`,
    channelId: includesUser ? 'pair-private' : 'relationship-runtime',
    eventClass: 'artifact',
    visibility: includesUser ? 'pair_private' : 'role_private',
    visibleToIds: participantIds,
    evidenceMessageIds: params.sourceEvent.evidenceMessageIds,
    payload,
  };
}

function classifySharedPhraseFromDistilledMemory(text: string): Pick<SharedPhrase, 'kind' | 'visibility'> | null {
  const normalized = compactText(text, 220);
  if (!normalized) return null;
  if (/(称呼|叫.*[“"「『].{1,16}[”"」』]|昵称|专属称呼)/.test(normalized)) return { kind: 'pet_name', visibility: 'between_actors' };
  if (/(暗号|秘密口令|小秘密|只有.*知道|不能告诉|保密)/.test(normalized)) return { kind: 'secret_code', visibility: 'private' };
  if (/(说好|约定|答应|下次一起|以后一起|等.*回来|一起.*补)/.test(normalized)) return { kind: 'promise_line', visibility: 'between_actors' };
  if (/(慢慢来|我在|别怕|陪着你|不用硬撑|可以难过|先抱一下|安慰)/.test(normalized)) return { kind: 'comfort_line', visibility: 'private' };
  if (/(喜欢你|想你|在一起|确认.*心意|表白|心意)/.test(normalized)) return { kind: 'confession_line', visibility: 'private' };
  if (/(共同梗|只有.*懂|玩笑|梗|口头禅)/.test(normalized)) return { kind: 'inside_joke', visibility: 'public_hint' };
  return null;
}

function buildSharedPhraseEventFromDistilledMemory(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2[] {
  if (params.event.kind !== 'memory_candidate') return [];
  const payload = params.event.payload as Record<string, unknown> | undefined;
  if (!payload || payload.origin !== 'distilled') return [];
  if (!isDistilledMemoryBackflowEligible(payload)) return [];
  if (!params.event.targetIds?.includes(params.character.id)) return [];
  const participantIds = Array.from(new Set(params.event.targetIds.filter((id) => id === USER_ACTOR_ID || params.chat.memberIds.includes(id)))).slice(0, 6);
  if (participantIds.includes(USER_ACTOR_ID)) {
    if (!participantIds.includes(params.character.id)) participantIds.unshift(params.character.id);
  } else if (participantIds.length < 2) {
    return [];
  }
  const text = String(payload.text || params.event.summary || '');
  const classification = classifySharedPhraseFromDistilledMemory(text);
  if (!classification) return [];
  const phraseText = quoteOrMeaningfulText(text);
  if (!phraseText) return [];
  return [createSharedPhraseEvent({
    ...params,
    sourceEvent: params.event,
    text: phraseText,
    kind: classification.kind,
    participantIds,
    visibility: classification.visibility,
    firstSaidBy: 'mutual',
    reason: '记忆蒸馏沉淀出稳定共同话语后反写为陪伴运行时事件。',
    evidence: text,
    emotionalWeight: classification.kind === 'secret_code' || classification.kind === 'confession_line' ? 76 : 68,
  })];
}

export function buildSharedPhraseEventsFromCompanionshipEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2[] {
  if (sharedPhrasePayloadOf(params.event)) return [];
  const memoryBackflowEvents = buildSharedPhraseEventFromDistilledMemory(params);
  if (memoryBackflowEvents.length) return memoryBackflowEvents;
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
  character: Pick<AICharacter, 'id' | 'name'>;
  events: RuntimeEventV2[];
}): RuntimeEventV2[] {
  const existingIds = new Set(params.events.map((event) => event.id));
  const phraseKeyOf = (payload: CompanionshipSharedPhraseEventPayload) => [
    payload.characterId,
    payload.kind || 'other',
    payload.text.replace(/\s+/g, ''),
    (payload.participantIds || []).slice().sort().join(','),
  ].join(':');
  const existingPhraseByKey = new Map(params.events
    .map((event) => sharedPhrasePayloadOf(event))
    .filter((item): item is CompanionshipSharedPhraseEventPayload => Boolean(item))
    .map((payload) => [phraseKeyOf(payload), payload]));
  return params.events
    .flatMap((event) => buildSharedPhraseEventsFromCompanionshipEvent({ chat: params.chat, character: params.character, event }))
    .map((event) => {
      const payload = sharedPhrasePayloadOf(event);
      if (!payload) return event;
      const key = phraseKeyOf(payload);
      const existing = existingPhraseByKey.get(key);
      if (!existing || existing.phraseId === payload.phraseId) return event;
      return createSharedPhraseEvent({
        chat: params.chat,
        character: params.character,
        sourceEvent: event,
        text: payload.text,
        kind: payload.kind || 'other',
        participantIds: payload.participantIds,
        visibility: payload.visibility,
        firstSaidBy: payload.firstSaidBy,
        reason: '共同话语再次被长期记忆或运行时证据确认，记录为复用强化。',
        evidence: payload.evidence,
        emotionalWeight: Math.max(payload.emotionalWeight || 64, existing.emotionalWeight || 64),
        phraseId: existing.phraseId,
        action: 'reused',
        reuseCount: (existing.reuseCount || 1) + 1,
      });
    })
    .filter((event) => {
      if (existingIds.has(event.id)) return false;
      const payload = sharedPhrasePayloadOf(event);
      const key = payload ? phraseKeyOf(payload) : event.id;
      const existing = payload ? existingPhraseByKey.get(key) : null;
      if (existing && payload?.action !== 'reused') return false;
      existingPhraseByKey.set(key, payload || existing || ({} as CompanionshipSharedPhraseEventPayload));
      existingIds.add(event.id);
      return true;
    });
}
