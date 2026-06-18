import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipAddressingEventPayload, CompanionshipIntimateConflictEventPayload, CompanionshipPhaseEventPayload, CompanionshipRitualEventPayload, CompanionshipSharedAnchorEventPayload, CompanionshipSharedPhraseEventPayload, UserProfileMemoryEventItem, SharedMemoryAnchor } from '../types/companionship';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { userProfileMemoryPayloadOf } from './directUserProfileMemory';

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

function phasePayloadOf(event: RuntimeEventV2): CompanionshipPhaseEventPayload | null {
  const payload = event.payload as Partial<CompanionshipPhaseEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_phase_event') return null;
  return payload as CompanionshipPhaseEventPayload;
}

function intimateConflictPayloadOf(event: RuntimeEventV2): CompanionshipIntimateConflictEventPayload | null {
  const payload = event.payload as Partial<CompanionshipIntimateConflictEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_intimate_conflict') return null;
  return payload as CompanionshipIntimateConflictEventPayload;
}

function addressingPayloadOf(event: RuntimeEventV2): CompanionshipAddressingEventPayload | null {
  const payload = event.payload as Partial<CompanionshipAddressingEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_addressing') return null;
  return payload as CompanionshipAddressingEventPayload;
}

function sharedPhrasePayloadOf(event: RuntimeEventV2): CompanionshipSharedPhraseEventPayload | null {
  const payload = event.payload as Partial<CompanionshipSharedPhraseEventPayload> | undefined;
  if (!payload || payload.eventType !== 'companionship_shared_phrase') return null;
  return payload as CompanionshipSharedPhraseEventPayload;
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
    sourceMessageIds: sourceMessageIdsFromEvent(params.sourceEvent),
    reason: '记忆蒸馏沉淀出稳定共同经历后反写为陪伴共同锚点。',
    decisionSource: decisionSourceFromEvent(params.sourceEvent),
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
    sourceMessageIds: normalizeSourceMessageIds(params.anchorPayload.sourceMessageIds, params.sourceEvent.evidenceMessageIds),
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

function createRuntimeRitualEvolutionEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  sourceEvent: RuntimeEventV2;
  ritualId: string;
  kind: CompanionshipRitualEventPayload['kind'];
  content: string;
  evolution: string[];
  reason: string;
  evidence: string;
  participantIds?: string[];
  confidence?: number;
  decisionSource?: CompanionshipRitualEventPayload['decisionSource'];
  action?: CompanionshipRitualEventPayload['action'];
}): RuntimeEventV2 | null {
  const content = compactText(params.content, 180);
  if (!content) return null;
  const participantIds = Array.from(new Set((params.participantIds?.length ? params.participantIds : [params.character.id, USER_ACTOR_ID]).filter(Boolean))).slice(0, 6);
  if (!participantIds.includes(params.character.id)) return null;
  const includesUser = participantIds.includes(USER_ACTOR_ID);
  const payload: CompanionshipRitualEventPayload = {
    eventType: 'companionship_ritual',
    characterId: params.character.id,
    userId: includesUser ? USER_ACTOR_ID : undefined,
    ritualId: params.ritualId,
    kind: params.kind,
    action: params.action || 'updated',
    participantIds,
    content,
    evolution: params.evolution.map((item) => compactText(item, 120)).filter(Boolean).slice(0, 6),
    reason: params.reason,
    evidence: compactText(params.evidence, 160),
    sourceMessageIds: sourceMessageIdsFromEvent(params.sourceEvent),
    confidence: params.confidence,
    decisionSource: params.decisionSource || 'local_fallback',
  };
  const seed = stableEventSeed([params.chat.id, params.character.id, params.ritualId, params.sourceEvent.id, content]);
  return {
    id: `evt-ritual-runtime-evolution-${seed}`,
    conversationId: params.chat.id,
    kind: 'artifact',
    createdAt: params.sourceEvent.createdAt || Date.now(),
    actorIds: participantIds,
    targetIds: participantIds,
    summary: `${params.character.name} 根据关系变化更新了一个关系仪式`,
    channelId: includesUser ? 'pair-private' : 'relationship-runtime',
    eventClass: 'artifact',
    visibility: includesUser ? 'pair_private' : 'role_private',
    visibleToIds: participantIds,
    evidenceMessageIds: params.sourceEvent.evidenceMessageIds,
    payload,
  };
}

function ritualEventFromPhaseEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2 | null {
  const payload = phasePayloadOf(params.event);
  if (!payload || payload.characterId !== params.character.id || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return null;
  if (payload.action === 'revoked') return null;
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.72;
  if (confidence < 0.72) return null;
  const evidence = [...(payload.evidence || []), payload.reason || params.event.summary].filter(Boolean).join(' / ');
  if (payload.phase === 'confirmed' || payload.phase === 'passionate' || payload.phase === 'deep') {
    return createRuntimeRitualEvolutionEvent({
      chat: params.chat,
      character: params.character,
      sourceEvent: params.event,
      ritualId: `ritual-runtime-phase-${params.character.id}-${payload.phase}`,
      kind: 'milestone',
      content: payload.phase === 'deep'
        ? '长期稳定陪伴后，重要日常可以被温和记住，但不需要夸张重复确认。'
        : '关系确认后，可以把重要表达沉淀成只在合适时轻轻带过的里程碑。',
      evolution: [payload.phase || '', payload.style || '', evidence],
      reason: '关系阶段变化触发关系仪式演化。',
      evidence,
      confidence,
      decisionSource: payload.decisionSource,
    });
  }
  if (payload.phase === 'reconciling') {
    return createRuntimeRitualEvolutionEvent({
      chat: params.chat,
      character: params.character,
      sourceEvent: params.event,
      ritualId: `ritual-runtime-phase-${params.character.id}-reconciling`,
      kind: 'reconciliation',
      content: '修复期优先用低压、给台阶的方式确认彼此还愿意好好说话。',
      evolution: [payload.phase || '', evidence],
      reason: '关系进入修复期后同步演化和好仪式。',
      evidence,
      confidence,
      decisionSource: payload.decisionSource,
    });
  }
  return null;
}

function ritualEventFromIntimateConflictEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2 | null {
  const payload = intimateConflictPayloadOf(params.event);
  if (!payload || payload.characterId !== params.character.id || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return null;
  if (payload.action !== 'repair_attempted' && payload.action !== 'resolved') return null;
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.74;
  if (confidence < 0.68) return null;
  const evidence = [...(payload.evidence || []), payload.summary || params.event.summary].filter(Boolean).join(' / ');
  return createRuntimeRitualEvolutionEvent({
    chat: params.chat,
    character: params.character,
    sourceEvent: params.event,
    ritualId: `ritual-runtime-conflict-${params.character.id}-${payload.action}`,
    kind: 'reconciliation',
    content: payload.action === 'resolved'
      ? '冲突说开后，可以把“以后不靠沉默试探”作为温和的和好提醒。'
      : '修复尝试出现时，先递台阶、少追问，用一句轻的话把关系接回来。',
    evolution: [payload.kind, payload.summary || '', evidence],
    reason: '亲密冲突修复事件触发和好仪式演化。',
    evidence,
    confidence,
    decisionSource: payload.decisionSource,
  });
}

function ritualEventFromAddressingEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2 | null {
  const payload = addressingPayloadOf(params.event);
  if (!payload || payload.characterId !== params.character.id || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return null;
  if (payload.action !== 'set_current' && payload.action !== 'set_private' && payload.action !== 'update') return null;
  const address = compactText(payload.privateAddress || payload.currentAddress, 48);
  if (!address) return null;
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.82;
  if (confidence < 0.7) return null;
  return createRuntimeRitualEvolutionEvent({
    chat: params.chat,
    character: params.character,
    sourceEvent: params.event,
    ritualId: `ritual-runtime-addressing-${params.character.id}-${stableEventSeed([address])}`,
    kind: 'pet_name',
    content: `在私下或合适场景中使用“${address}”这个称呼，但关系紧张或用户边界变化时保持克制。`,
    evolution: [payload.currentAddress || '', payload.privateAddress || '', payload.evidence || '', payload.reason || ''],
    reason: '称呼变化触发专属称呼仪式演化。',
    evidence: payload.evidence || payload.reason || address,
    confidence,
    decisionSource: payload.decisionSource,
  });
}

function ritualKindFromSharedPhraseKind(kind: CompanionshipSharedPhraseEventPayload['kind']): CompanionshipRitualEventPayload['kind'] | null {
  if (kind === 'inside_joke' || kind === 'secret_code') return 'inside_joke';
  if (kind === 'promise_line') return 'anniversary';
  if (kind === 'comfort_line') return 'reconciliation';
  if (kind === 'confession_line') return 'milestone';
  if (kind === 'pet_name') return 'pet_name';
  return null;
}

function ritualEventFromSharedPhraseEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2 | null {
  const payload = sharedPhrasePayloadOf(params.event);
  if (!payload || payload.characterId !== params.character.id) return null;
  if (payload.action !== 'upsert' && payload.action !== 'reused') return null;
  const kind = ritualKindFromSharedPhraseKind(payload.kind || 'other');
  if (!kind) return null;
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.76;
  if (confidence < 0.68) return null;
  const participantIds = Array.from(new Set((payload.participantIds || [params.character.id, payload.userId || USER_ACTOR_ID]).filter(Boolean))).slice(0, 6);
  if (!participantIds.includes(params.character.id)) return null;
  const text = compactText(payload.text || payload.evidence, 120);
  if (!text) return null;
  const contentByKind: Record<CompanionshipRitualEventPayload['kind'], string> = {
    daily_greeting: text,
    anniversary: `围绕“${text}”这个约定保留温和提醒，不在不合适时机机械追问。`,
    inside_joke: `“${text}”可以作为共同梗或暗号，在合适场景轻轻带过，不公开泄露私密含义。`,
    pet_name: `在私下或合适场景中使用“${text}”这个称呼，但尊重用户边界和当前关系气氛。`,
    reconciliation: `把“${text}”作为修复关系时的低压表达，优先递台阶而不是翻旧账。`,
    milestone: `把“${text}”沉淀为关系里程碑，只在自然回望时轻轻提起。`,
  };
  return createRuntimeRitualEvolutionEvent({
    chat: params.chat,
    character: params.character,
    sourceEvent: params.event,
    ritualId: `ritual-runtime-phrase-${params.character.id}-${payload.phraseId || stableEventSeed([text, kind, participantIds.join(',')])}`,
    kind,
    content: contentByKind[kind],
    evolution: [payload.text || '', payload.evidence || '', payload.reason || ''],
    reason: '共同话语稳定后触发关系仪式演化。',
    evidence: payload.evidence || payload.reason || text,
    participantIds,
    confidence,
    decisionSource: payload.decisionSource,
  });
}

function strongestProfileItem(items: UserProfileMemoryEventItem[], kinds: UserProfileMemoryEventItem['kind'][]) {
  return items
    .filter((item) => kinds.includes(item.kind) && item.confidence >= 0.7 && item.text)
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function isGreetingBoundary(text: string) {
  return /(不要|不想|别|不用|不需要|少).{0,12}(早安|晚安|问候|仪式|每天|每日|主动|打扰)/.test(text);
}

function ritualEventFromUserProfileMemoryEvent(params: {
  chat: GroupChat;
  character: Pick<AICharacter, 'id' | 'name'>;
  event: RuntimeEventV2;
}): RuntimeEventV2 | null {
  const payload = userProfileMemoryPayloadOf(params.event);
  if (!payload || payload.characterId !== params.character.id || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return null;
  if (payload.action !== 'upsert') return null;
  const importantDate = strongestProfileItem(payload.items, ['important_date', 'recent_plan']);
  if (importantDate) {
    return createRuntimeRitualEvolutionEvent({
      chat: params.chat,
      character: params.character,
      sourceEvent: params.event,
      ritualId: `ritual-runtime-profile-date-${params.character.id}-${stableEventSeed([importantDate.kind, importantDate.text])}`,
      kind: 'anniversary',
      content: `记住这件事：“${compactText(importantDate.text, 96)}”。适合时温和提醒或回望，不把它变成压力。`,
      evolution: [importantDate.text, importantDate.evidence, payload.reason || ''],
      reason: '用户画像中的重要日期或近期计划触发关系仪式演化。',
      evidence: importantDate.evidence || payload.evidence || importantDate.text,
      confidence: importantDate.confidence,
      decisionSource: payload.decisionSource,
    });
  }
  const schedule = strongestProfileItem(payload.items, ['schedule_hint']);
  if (schedule) {
    return createRuntimeRitualEvolutionEvent({
      chat: params.chat,
      character: params.character,
      sourceEvent: params.event,
      ritualId: `ritual-runtime-profile-greeting-${params.character.id}`,
      kind: 'daily_greeting',
      content: `问候节奏参考用户作息：“${compactText(schedule.text, 96)}”。早安晚安要顺着真实时间和状态，不机械打卡。`,
      evolution: [schedule.text, schedule.evidence, payload.reason || ''],
      reason: '用户画像中的作息线索触发日常问候仪式演化。',
      evidence: schedule.evidence || payload.evidence || schedule.text,
      confidence: schedule.confidence,
      decisionSource: payload.decisionSource,
    });
  }
  const boundary = strongestProfileItem(payload.items, ['boundary']);
  if (boundary && isGreetingBoundary(boundary.text)) {
    return createRuntimeRitualEvolutionEvent({
      chat: params.chat,
      character: params.character,
      sourceEvent: params.event,
      ritualId: `ritual-runtime-profile-greeting-${params.character.id}`,
      kind: 'daily_greeting',
      action: 'suppressed',
      content: `尊重用户边界：${compactText(boundary.text, 96)}`,
      evolution: [boundary.text, boundary.evidence, payload.reason || ''],
      reason: '用户画像边界要求减少问候或关系仪式。',
      evidence: boundary.evidence || payload.evidence || boundary.text,
      confidence: boundary.confidence,
      decisionSource: payload.decisionSource,
    });
  }
  return null;
}

function buildSharedAnchorEventFromDistilledMemory(params: {
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

export function buildRitualEventsFromRelationshipRuntimeEvents(params: {
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
    .flatMap((event) => [
      ritualEventFromPhaseEvent({ chat: params.chat, character: params.character, event }),
      ritualEventFromIntimateConflictEvent({ chat: params.chat, character: params.character, event }),
      ritualEventFromAddressingEvent({ chat: params.chat, character: params.character, event }),
      ritualEventFromSharedPhraseEvent({ chat: params.chat, character: params.character, event }),
      ritualEventFromUserProfileMemoryEvent({ chat: params.chat, character: params.character, event }),
    ])
    .filter((event): event is RuntimeEventV2 => Boolean(event))
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
