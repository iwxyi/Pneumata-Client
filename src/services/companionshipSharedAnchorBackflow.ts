import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipRitualEventPayload, CompanionshipSharedAnchorEventPayload, SharedMemoryAnchor } from '../types/companionship';
import type { RuntimeEventV2 } from '../types/runtimeEvent';

const USER_ACTOR_ID = 'user';

function compactText(text: string | undefined | null, max = 120) {
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

function sharedAnchorPayloadOf(event: RuntimeEventV2): CompanionshipSharedAnchorEventPayload | null {
  const payload = event.payload as Partial<CompanionshipSharedAnchorEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_shared_anchor') return null;
  return payload as CompanionshipSharedAnchorEventPayload;
}

function ritualPayloadOf(event: RuntimeEventV2): CompanionshipRitualEventPayload | null {
  const payload = event.payload as Partial<CompanionshipRitualEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_ritual') return null;
  return payload as CompanionshipRitualEventPayload;
}

function formatSharedAnchorTitle(kind: SharedMemoryAnchor['kind']) {
  const titles: Record<SharedMemoryAnchor['kind'], string> = {
    first_time: '第一次',
    confession: '心意确认',
    conflict: '旧冲突',
    repair: '修复痕迹',
    inside_joke: '共同梗',
    shared_secret: '小秘密',
    promise: '未完成约定',
    milestone: '关系里程碑',
  };
  return titles[kind];
}

function classifySharedAnchorFromDistilledMemory(text: string): SharedMemoryAnchor['kind'] | null {
  const normalized = compactText(text, 240);
  if (!normalized) return null;
  if (/(第一次|初次|首次|第一次一起|第一次见|第一次认真)/.test(normalized)) return 'first_time';
  if (/(确认.*心意|表白|告白|在一起|确定关系|喜欢你|互相喜欢)/.test(normalized)) return 'confession';
  if (/(冲突|吵架|冷战|误会|不舒服|受伤|失望|争执|闹别扭|关系裂痕)/.test(normalized)) return 'conflict';
  if (/(和好|说开|修复|道歉|原谅|递台阶|重新靠近|冲突后.*修复)/.test(normalized)) return 'repair';
  if (/(共同梗|只有.*懂|玩笑|梗|口头禅|暗号|秘密口令)/.test(normalized)) return 'inside_joke';
  if (/(小秘密|秘密|只有.*知道|不能告诉|保密|私下约定)/.test(normalized)) return 'shared_secret';
  if (/(说好|约定|答应|承诺|下次一起|以后一起|等.*回来|一起.*补|不再.*越界)/.test(normalized)) return 'promise';
  if (/(里程碑|重要转折|关系变得|开始信任|成为搭档|关系稳定|长期)/.test(normalized)) return 'milestone';
  return null;
}

function createSharedAnchorEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  sourceEvent: RuntimeEventV2;
  kind: SharedMemoryAnchor['kind'];
  participantIds: string[];
  text: string;
  salience?: number;
  confidence?: number;
}): RuntimeEventV2 {
  const participantIds = Array.from(new Set(params.participantIds.filter(Boolean))).slice(0, 6);
  const includesUser = participantIds.includes(USER_ACTOR_ID);
  const anchorId = `anchor-backflow-${stableEventSeed([params.chat.id, params.character.id, params.kind, params.text, participantIds.join(',')])}`;
  const confidence = typeof params.confidence === 'number' && Number.isFinite(params.confidence) ? params.confidence : 0.84;
  const salience = typeof params.salience === 'number' && Number.isFinite(params.salience) ? params.salience : 0.72;
  const payload: CompanionshipSharedAnchorEventPayload = {
    eventType: 'companionship_shared_anchor',
    characterId: params.character.id,
    userId: includesUser ? USER_ACTOR_ID : undefined,
    anchorId,
    action: 'upsert',
    kind: params.kind,
    participantIds,
    title: formatSharedAnchorTitle(params.kind),
    text: params.text,
    salience: Math.round(Math.max(0, Math.min(1, salience)) * 100),
    confidence,
    evidence: params.text,
    sourceEventIds: [params.sourceEvent.id],
    reason: '记忆蒸馏沉淀出稳定共同经历后反写为陪伴共同锚点。',
    decisionSource: 'local_fallback',
  };
  return {
    id: `evt-${anchorId}-${stableEventSeed([params.sourceEvent.id, params.sourceEvent.createdAt])}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt: params.sourceEvent.createdAt || Date.now(),
    actorIds: participantIds,
    targetIds: participantIds,
    summary: `${params.character.name} 记录了一条关系共同锚点`,
    channelId: includesUser ? 'pair-private' : 'relationship-runtime',
    eventClass: 'artifact',
    visibility: includesUser ? 'pair_private' : 'role_private',
    visibleToIds: participantIds,
    evidenceMessageIds: params.sourceEvent.evidenceMessageIds,
    payload,
  };
}

function ritualKindFromAnchorKind(kind: SharedMemoryAnchor['kind']): CompanionshipRitualEventPayload['kind'] | null {
  if (kind === 'inside_joke') return 'inside_joke';
  if (kind === 'repair') return 'reconciliation';
  if (kind === 'milestone' || kind === 'confession' || kind === 'first_time') return 'milestone';
  if (kind === 'promise') return 'anniversary';
  return null;
}

function createRitualEvolutionEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  sourceEvent: RuntimeEventV2;
  anchorPayload: CompanionshipSharedAnchorEventPayload;
}): RuntimeEventV2 | null {
  const kind = params.anchorPayload.kind ? ritualKindFromAnchorKind(params.anchorPayload.kind) : null;
  if (!kind) return null;
  const participantIds = Array.from(new Set((params.anchorPayload.participantIds || [params.character.id, params.anchorPayload.userId || USER_ACTOR_ID]).filter(Boolean))).slice(0, 6);
  if (!participantIds.includes(params.character.id)) return null;
  const includesUser = participantIds.includes(USER_ACTOR_ID);
  const ritualId = `ritual-runtime-anchor-${params.anchorPayload.anchorId}`;
  const content = compactText(params.anchorPayload.text || params.anchorPayload.evidence || params.anchorPayload.title, 180);
  if (!content) return null;
  const payload: CompanionshipRitualEventPayload = {
    eventType: 'companionship_ritual',
    characterId: params.character.id,
    userId: includesUser ? USER_ACTOR_ID : undefined,
    ritualId,
    kind,
    action: 'updated',
    participantIds,
    content,
    evolution: [params.anchorPayload.title, params.anchorPayload.evidence, params.anchorPayload.reason]
      .filter((item): item is string => Boolean(item))
      .map((item) => compactText(item, 120))
      .slice(0, 6),
    reason: '共同锚点沉淀后同步演化关系仪式内容。',
    evidence: params.anchorPayload.evidence || content,
    confidence: params.anchorPayload.confidence,
    decisionSource: params.anchorPayload.decisionSource || 'local_fallback',
  };
  const seed = stableEventSeed([params.chat.id, params.character.id, ritualId, params.sourceEvent.id, content]);
  return {
    id: `evt-ritual-evolution-${seed}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt: params.sourceEvent.createdAt || Date.now(),
    actorIds: participantIds,
    targetIds: participantIds,
    summary: `${params.character.name} 更新了一个关系仪式`,
    channelId: includesUser ? 'pair-private' : 'relationship-runtime',
    eventClass: 'artifact',
    visibility: includesUser ? 'pair_private' : 'role_private',
    visibleToIds: participantIds,
    evidenceMessageIds: params.sourceEvent.evidenceMessageIds,
    payload,
  };
}

function buildSharedAnchorEventFromDistilledMemory(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2[] {
  if (params.event.kind !== 'memory_candidate') return [];
  const payload = params.event.payload as Record<string, unknown> | undefined;
  if (!payload || payload.origin !== 'distilled') return [];
  if (!params.event.targetIds?.includes(params.character.id)) return [];
  const participantIds = Array.from(new Set(params.event.targetIds.filter((id) => id === USER_ACTOR_ID || params.chat.memberIds.includes(id)))).slice(0, 6);
  if (participantIds.includes(USER_ACTOR_ID)) {
    if (!participantIds.includes(params.character.id)) participantIds.unshift(params.character.id);
  } else if (participantIds.length < 2) {
    return [];
  }
  const text = compactText(String(payload.text || params.event.summary || ''), 180);
  const kind = classifySharedAnchorFromDistilledMemory(text);
  if (!kind || !text) return [];
  return [createSharedAnchorEvent({
    chat: params.chat,
    character: params.character,
    sourceEvent: params.event,
    kind,
    participantIds,
    text,
    salience: typeof payload.salience === 'number' ? payload.salience : undefined,
    confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
  })];
}

export function buildSharedAnchorEventsFromCompanionshipEvents(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  events: RuntimeEventV2[];
}): RuntimeEventV2[] {
  const existingAnchorKeys = new Set(params.events
    .map((event) => sharedAnchorPayloadOf(event))
    .filter((payload): payload is CompanionshipSharedAnchorEventPayload => Boolean(payload))
    .map((payload) => [
      payload.characterId,
      payload.kind || 'milestone',
      (payload.participantIds || []).slice().sort().join(','),
      (payload.text || '').replace(/\s+/g, '').slice(0, 64),
    ].join(':')));

  return params.events
    .flatMap((event) => buildSharedAnchorEventFromDistilledMemory({ chat: params.chat, character: params.character, event }))
    .filter((event) => {
      const payload = sharedAnchorPayloadOf(event);
      if (!payload) return false;
      const key = [
        payload.characterId,
        payload.kind || 'milestone',
        (payload.participantIds || []).slice().sort().join(','),
        (payload.text || '').replace(/\s+/g, '').slice(0, 64),
      ].join(':');
      if (existingAnchorKeys.has(key)) return false;
      existingAnchorKeys.add(key);
      return true;
    });
}

export function buildRitualEventsFromSharedAnchorEvents(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  events: RuntimeEventV2[];
}): RuntimeEventV2[] {
  const existingRitualKeys = new Set(params.events
    .map((event) => ritualPayloadOf(event))
    .filter((payload): payload is CompanionshipRitualEventPayload => Boolean(payload))
    .map((payload) => [
      payload.characterId,
      payload.ritualId,
      payload.action,
      (payload.content || '').replace(/\s+/g, '').slice(0, 64),
    ].join(':')));

  return params.events
    .flatMap((event) => {
      const payload = sharedAnchorPayloadOf(event);
      if (!payload || payload.characterId !== params.character.id || payload.action !== 'upsert') return [];
      const ritualEvent = createRitualEvolutionEvent({
        chat: params.chat,
        character: params.character,
        sourceEvent: event,
        anchorPayload: payload,
      });
      return ritualEvent ? [ritualEvent] : [];
    })
    .filter((event) => {
      const payload = ritualPayloadOf(event);
      if (!payload) return false;
      const key = [
        payload.characterId,
        payload.ritualId,
        payload.action,
        (payload.content || '').replace(/\s+/g, '').slice(0, 64),
      ].join(':');
      if (existingRitualKeys.has(key)) return false;
      existingRitualKeys.add(key);
      return true;
    });
}
