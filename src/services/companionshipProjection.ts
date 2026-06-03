import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CharacterCompanionshipState, CompanionshipPhase, CompanionshipProjection, CompanionshipStyle, CarePolicy, IntimacyProjection, PendingCareTopic, PreferredIntimacyStyle, UserBondState, UserProfileMemoryProjection, CompanionshipRuntimeTrace, CompanionshipStatusSignature, SharedMemoryAnchor, UserProfileMemoryEventItem, UserProfileMemoryKind } from '../types/companionship';
import type { Message } from '../types/message';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { readActiveCompanionshipCareTopicsFromEvents } from './directCompanionshipCare';
import { userProfileMemoryPayloadOf } from './directUserProfileMemory';
import { isMemoryAnchorCandidate } from './memoryLifecycle';
import { normalizeRelationshipLedgerEntry } from './relationshipLedger';

const USER_ACTOR_ID = 'user';
const DAY_MS = 24 * 60 * 60 * 1000;

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compactText(text: string | undefined | null, max = 120) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function buildCompanionshipDisplayMembers(
  character: Partial<AICharacter>,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[] = [],
): DisplayTextMember[] {
  const map = new Map<string, string>();
  map.set(USER_ACTOR_ID, '用户');
  if (character.id) map.set(character.id, character.name || '这个角色');
  relatedCharacters.forEach((item) => {
    if (item.id) map.set(item.id, item.name || '成员');
  });
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

function cleanArtifactSeedText(text: string | undefined | null, members: DisplayTextMember[], max = 140) {
  return compactText(sanitizeUserFacingText(text || '', members), max);
}

function resolveCompanionshipActorName(id: string, relatedCharacters: Pick<AICharacter, 'id' | 'name'>[]) {
  if (id === USER_ACTOR_ID) return '用户';
  return relatedCharacters.find((character) => character.id === id)?.name || (id.startsWith('draft-') ? '未命名角色' : '成员');
}

function canProjectCompanionshipArtifacts(character: Partial<AICharacter>): character is AICharacter {
  return Boolean(character.id && (character.layeredMemories?.length || character.relationships?.length || character.memory?.userMemories?.length));
}

function clampRelationshipScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getCharacterToUserLedger(chat: GroupChat, characterId: string): RelationshipLedgerEntry | null {
  const entry = (chat.relationshipLedger || [])
    .map(normalizeRelationshipLedgerEntry)
    .filter((item) => item.actorId === characterId && item.targetId === USER_ACTOR_ID)
    .sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0))[0];
  return entry || null;
}

function getLatestContact(messages: Message[], characterId: string) {
  const visible = messages.filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event');
  const latestUser = visible.slice().reverse().find((item) => item.senderId === USER_ACTOR_ID || item.type === 'user' || item.type === 'god');
  const latestCharacter = visible.slice().reverse().find((item) => item.senderId === characterId && item.type === 'ai');
  const latestMeaningful = visible.slice().reverse().find((item) => item.senderId === characterId || item.senderId === USER_ACTOR_ID || item.type === 'user' || item.type === 'god');
  return {
    lastUserReplyAt: latestUser?.timestamp,
    lastCharacterInitiatedAt: latestCharacter?.timestamp,
    lastMeaningfulContactAt: latestMeaningful?.timestamp || Date.now(),
  };
}

function silenceHours(lastUserReplyAt: number | undefined, now: number) {
  if (!lastUserReplyAt) return 0;
  return Math.max(0, (now - lastUserReplyAt) / (60 * 60 * 1000));
}

function projectIntimacy(entry: RelationshipLedgerEntry | null, messages: Message[], characterId: string, now: number): IntimacyProjection {
  const current = entry?.current || { warmth: 0, competence: 0, trust: 0, threat: 0 };
  const recentUserTurns = messages
    .filter((item) => !item.isDeleted && (item.senderId === USER_ACTOR_ID || item.type === 'user' || item.type === 'god'))
    .slice(-12).length;
  const contacts = getLatestContact(messages, characterId);
  const silence = silenceHours(contacts.lastUserReplyAt, now);
  const semanticIntensity = entry?.derived?.semantic?.intensity || 0;
  const positive = Math.max(0, current.warmth) + Math.max(0, current.trust);
  const tension = Math.max(0, current.threat);
  return {
    attraction: clampScore(current.warmth * 0.72 + current.trust * 0.22 + semanticIntensity * 0.18 - tension * 0.38),
    intimacy: clampScore(current.trust * 0.62 + current.warmth * 0.34 + recentUserTurns * 2.5 - tension * 0.42),
    attachment: clampScore(positive * 0.42 + recentUserTurns * 2.2 + Math.min(18, silence * 0.7) - tension * 0.2),
    longing: clampScore(Math.max(0, current.warmth) * 0.24 + Math.max(0, current.trust) * 0.22 + Math.min(36, silence * 1.4) + recentUserTurns - tension * 0.24),
    exclusivity: clampScore(Math.max(0, current.warmth) * 0.18 + tension * 0.42 + Math.max(0, current.trust) * 0.08),
    security: clampScore(48 + current.trust * 0.58 + current.warmth * 0.18 - tension * 0.78),
  };
}

function inferPhase(intimacy: IntimacyProjection, entry: RelationshipLedgerEntry | null): CompanionshipPhase {
  const stage = entry?.derived?.semantic?.stage || '';
  const labels = entry?.derived?.semantic?.labels || [];
  if (intimacy.security <= 22 && (entry?.current.threat || 0) >= 36) return 'crisis';
  if (intimacy.security <= 34 && (entry?.current.threat || 0) >= 24) return 'cooling';
  if (labels.includes('喜欢') || labels.includes('深度牵挂') || stage === '深度绑定') {
    if (intimacy.attraction >= 58 && intimacy.intimacy >= 52 && intimacy.security >= 42) return 'ambiguous';
    return 'fond';
  }
  if (intimacy.attraction >= 46 && intimacy.intimacy >= 38 && intimacy.security >= 36) return 'fond';
  if (intimacy.attachment >= 28 || intimacy.intimacy >= 24) return 'curious';
  return 'stranger';
}

const COMPANIONSHIP_PHASES: CompanionshipPhase[] = ['stranger', 'curious', 'fond', 'ambiguous', 'confessing', 'confirmed', 'passionate', 'deep', 'cooling', 'crisis', 'reconciling'];
const COMPANIONSHIP_STYLES: CompanionshipStyle[] = ['romantic', 'ambiguous', 'friend', 'family', 'mentor', 'custom'];

function isCompanionshipPhase(value: unknown): value is CompanionshipPhase {
  return typeof value === 'string' && COMPANIONSHIP_PHASES.includes(value as CompanionshipPhase);
}

function isCompanionshipStyle(value: unknown): value is CompanionshipStyle {
  return typeof value === 'string' && COMPANIONSHIP_STYLES.includes(value as CompanionshipStyle);
}

interface ResolvedPhaseEvent {
  phase: CompanionshipPhase;
  style?: CompanionshipStyle;
  enteredAt: number;
  evidence: string[];
  sourceEventId: string;
}

function resolveCompanionshipPhaseEvent(chat: GroupChat, characterId: string): ResolvedPhaseEvent | null {
  const events = (chat.runtimeEventsV2 || [])
    .filter((event): event is RuntimeEventV2 => Boolean(event?.payload))
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const eventType = typeof payload.eventType === 'string' ? payload.eventType : '';
    if (eventType !== 'companionship_phase_event') continue;
    const payloadCharacterId = typeof payload.characterId === 'string' ? payload.characterId : '';
    const payloadUserId = typeof payload.userId === 'string' ? payload.userId : USER_ACTOR_ID;
    if (payloadCharacterId && payloadCharacterId !== characterId) continue;
    if (payloadUserId && payloadUserId !== USER_ACTOR_ID) continue;
    const actorMatches = !event.actorIds?.length || event.actorIds.includes(characterId) || event.actorIds.includes(USER_ACTOR_ID);
    const targetMatches = !event.targetIds?.length || event.targetIds.includes(characterId) || event.targetIds.includes(USER_ACTOR_ID);
    if (!actorMatches || !targetMatches) continue;
    if (!isCompanionshipPhase(payload.phase)) continue;
    const evidence = Array.isArray(payload.evidence)
      ? payload.evidence.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => compactText(item, 120))
      : [];
    const reason = typeof payload.reason === 'string' ? compactText(payload.reason, 120) : '';
    return {
      phase: payload.phase,
      style: isCompanionshipStyle(payload.style) ? payload.style : undefined,
      enteredAt: event.createdAt || Date.now(),
      evidence: [event.summary, reason, ...evidence].filter(Boolean).slice(0, 5),
      sourceEventId: event.id,
    };
  }
  return null;
}

function resolveBondStyle(phase: CompanionshipPhase, explicitStyle?: CompanionshipStyle): CompanionshipStyle {
  if (explicitStyle) return explicitStyle;
  if (phase === 'ambiguous' || phase === 'confessing') return 'ambiguous';
  if (phase === 'confirmed' || phase === 'passionate' || phase === 'deep') return 'romantic';
  return 'friend';
}

function inferPreferredStyle(character: AICharacter, intimacy: IntimacyProjection): PreferredIntimacyStyle {
  if (character.personality.extroversion >= 68 && character.personality.humor >= 58) return 'playful';
  if (character.personality.empathy >= 68 && character.personality.agreeableness >= 58) return 'warm';
  if (intimacy.longing >= 70 && character.personality.neuroticism >= 62) return 'clingy';
  if (character.personality.assertiveness >= 68) return 'direct';
  return 'reserved';
}

function hasBoundary(profile: UserProfileMemoryProjection, patterns: RegExp[]) {
  const text = profile.boundaries.join('\n');
  return patterns.some((pattern) => pattern.test(text));
}

function applyUserBoundariesToCarePolicy(policy: CarePolicy, profile: UserProfileMemoryProjection): CarePolicy {
  const boundaryReasons: string[] = [];
  let next = { ...policy };
  if (hasBoundary(profile, [/不要.*(主动|打扰|私聊|提醒)/, /不想.*(主动|打扰|私聊|提醒)/, /不希望.*(主动|打扰|私聊|提醒)/, /不需要.*(主动|打扰|私聊|提醒)/, /不愿.*(主动|打扰|私聊|提醒)/, /少.*(主动|打扰|私聊|提醒)/])) {
    boundaryReasons.push('user prefers low proactive contact');
    next = {
      ...next,
      dailyInitiationBudget: 0,
      triggerSensitivity: Math.min(next.triggerSensitivity, 18),
      expressionIntensity: Math.min(next.expressionIntensity, 28),
      allowGoodMorning: false,
      allowGoodNight: false,
      allowMissYou: false,
    };
  }
  if (hasBoundary(profile, [/不.*(恋爱|暧昧|情侣|对象|占有|吃醋)/, /不要.*(恋爱|暧昧|情侣|对象|占有|吃醋)/, /不希望.*(恋爱|暧昧|情侣|对象|占有|吃醋)/, /只.*朋友/])) {
    boundaryReasons.push('user does not want romantic framing');
    next = {
      ...next,
      expressionIntensity: Math.min(next.expressionIntensity, 38),
      allowMissYou: false,
    };
  }
  if (hasBoundary(profile, [/不要.*(早安|晚安)/, /不想.*(早安|晚安)/, /不希望.*(早安|晚安)/, /不需要.*(早安|晚安)/, /不愿.*(早安|晚安)/])) {
    boundaryReasons.push('user rejects greeting rituals');
    next = {
      ...next,
      allowGoodMorning: false,
      allowGoodNight: false,
    };
  }
  return {
    ...next,
    boundaryReasons,
  };
}

function parseClockMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinCarePolicyQuietHours(timestamp: number, quietHours: CarePolicy['quietHours']) {
  const start = parseClockMinutes(quietHours.start);
  const end = parseClockMinutes(quietHours.end);
  if (start == null || end == null || start === end) return false;
  const date = new Date(timestamp);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  if (start < end) return minuteOfDay >= start && minuteOfDay < end;
  return minuteOfDay >= start || minuteOfDay < end;
}

function buildCarePolicy(phase: CompanionshipPhase, style: PreferredIntimacyStyle, profile: UserProfileMemoryProjection): CarePolicy {
  const byPhase: Record<CompanionshipPhase, Omit<CarePolicy, 'quietHours'>> = {
    stranger: { dailyInitiationBudget: 0, triggerSensitivity: 18, silenceAnxietyThresholdHours: 96, expressionIntensity: 18, allowGoodMorning: false, allowGoodNight: false, allowMissYou: false, boundaryReasons: [] },
    curious: { dailyInitiationBudget: 1, triggerSensitivity: 30, silenceAnxietyThresholdHours: 72, expressionIntensity: 28, allowGoodMorning: false, allowGoodNight: false, allowMissYou: false, boundaryReasons: [] },
    fond: { dailyInitiationBudget: 1, triggerSensitivity: 46, silenceAnxietyThresholdHours: 48, expressionIntensity: 42, allowGoodMorning: false, allowGoodNight: true, allowMissYou: false, boundaryReasons: [] },
    ambiguous: { dailyInitiationBudget: 2, triggerSensitivity: 62, silenceAnxietyThresholdHours: 24, expressionIntensity: 58, allowGoodMorning: true, allowGoodNight: true, allowMissYou: true, boundaryReasons: [] },
    confessing: { dailyInitiationBudget: 2, triggerSensitivity: 70, silenceAnxietyThresholdHours: 18, expressionIntensity: 68, allowGoodMorning: true, allowGoodNight: true, allowMissYou: true, boundaryReasons: [] },
    confirmed: { dailyInitiationBudget: 3, triggerSensitivity: 76, silenceAnxietyThresholdHours: 16, expressionIntensity: 72, allowGoodMorning: true, allowGoodNight: true, allowMissYou: true, boundaryReasons: [] },
    passionate: { dailyInitiationBudget: 4, triggerSensitivity: 84, silenceAnxietyThresholdHours: 10, expressionIntensity: 84, allowGoodMorning: true, allowGoodNight: true, allowMissYou: true, boundaryReasons: [] },
    deep: { dailyInitiationBudget: 2, triggerSensitivity: 68, silenceAnxietyThresholdHours: 36, expressionIntensity: 64, allowGoodMorning: true, allowGoodNight: true, allowMissYou: true, boundaryReasons: [] },
    cooling: { dailyInitiationBudget: 1, triggerSensitivity: 36, silenceAnxietyThresholdHours: 48, expressionIntensity: 28, allowGoodMorning: false, allowGoodNight: false, allowMissYou: false, boundaryReasons: [] },
    crisis: { dailyInitiationBudget: 0, triggerSensitivity: 18, silenceAnxietyThresholdHours: 96, expressionIntensity: 18, allowGoodMorning: false, allowGoodNight: false, allowMissYou: false, boundaryReasons: [] },
    reconciling: { dailyInitiationBudget: 1, triggerSensitivity: 42, silenceAnxietyThresholdHours: 36, expressionIntensity: 38, allowGoodMorning: false, allowGoodNight: true, allowMissYou: false, boundaryReasons: [] },
  };
  const base = byPhase[phase];
  const styleBoost = style === 'clingy' ? 10 : style === 'direct' ? 6 : style === 'reserved' ? -8 : 0;
  return applyUserBoundariesToCarePolicy({
    ...base,
    triggerSensitivity: clampScore(base.triggerSensitivity + styleBoost),
    expressionIntensity: clampScore(base.expressionIntensity + styleBoost),
    quietHours: { start: '23:30', end: '08:00' },
  }, profile);
}

function readCompanionshipPhaseFromChat(chat: GroupChat | undefined, characterId: string, messages: Message[], now: number): CompanionshipPhase | null {
  if (!chat) return null;
  const ledger = getCharacterToUserLedger(chat, characterId);
  const phaseEvent = resolveCompanionshipPhaseEvent(chat, characterId);
  if (phaseEvent?.phase) return phaseEvent.phase;
  if (!ledger) return null;
  return inferPhase(projectIntimacy(ledger, messages, characterId, now), ledger);
}

function getUserMemoryTexts(character: AICharacter) {
  const manual = character.memory.userMemories || [];
  const layered = (character.layeredMemories || [])
    .filter((item) => item.subjectIds?.includes(USER_ACTOR_ID) || item.sourceTag?.includes('direct_user') || item.text.includes('用户'))
    .sort((a, b) => (b.salience + b.confidence + b.updatedAt / DAY_MS) - (a.salience + a.confidence + a.updatedAt / DAY_MS))
    .slice(0, 4)
    .map((item) => item.summary || item.text);
  return [...manual.slice(-4), ...layered].map((item) => compactText(item, 140)).filter(Boolean);
}

function uniqueTexts(items: string[], max = 6) {
  return Array.from(new Set(items.map((item) => compactText(item, 140)).filter(Boolean))).slice(0, max);
}

function matchAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function collectByPattern(texts: string[], patterns: RegExp[], max = 5) {
  return uniqueTexts(texts.filter((text) => matchAny(text, patterns)), max);
}

function collectProfileEventItems(chat: GroupChat, characterId: string) {
  const byKey = new Map<string, UserProfileMemoryEventItem & { updatedAt: number }>();
  (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact')
    .forEach((event) => {
      const payload = userProfileMemoryPayloadOf(event);
      if (!payload || payload.characterId !== characterId || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return;
      payload.items.forEach((item) => {
        if (!item.text || item.confidence < 0.6) return;
        const key = `${item.kind}:${compactText(item.text, 140)}`;
        const previous = byKey.get(key);
        if (!previous || event.createdAt >= previous.updatedAt) {
          byKey.set(key, { ...item, text: compactText(item.text, 140), evidence: compactText(item.evidence || event.summary, 140), updatedAt: event.createdAt });
        }
      });
    });
  return Array.from(byKey.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}

function profileTextsByKind(items: Array<UserProfileMemoryEventItem & { updatedAt: number }>, kind: UserProfileMemoryKind, max = 5) {
  return uniqueTexts(items.filter((item) => item.kind === kind).map((item) => item.text), max);
}

function extractProfileEventName(text: string | undefined) {
  if (!text) return undefined;
  return text.match(/(?:称呼为|叫做|叫我|名字是|昵称是)[:：]?\s*([^，。；;、\s]{1,12})/)?.[1]
    || text.match(/([^，。；;、\s]{1,12})$/)?.[1];
}

function extractAddressPreference(texts: string[]) {
  return texts
    .map((item) => item.match(/(?:叫我|称呼我|喊我|昵称是|名字是)[:：]?\s*([^，。；;、\s]{1,12})/)?.[1])
    .find(Boolean);
}

function extractForbiddenAddresses(texts: string[]) {
  return uniqueTexts(texts.flatMap((item) => {
    const direct = item.match(/(?:别|不要|不准|别再)\s*(?:叫|喊|称呼)我?[:：]?\s*([^，。；;、\s]{1,12})/)?.[1];
    const quoted = Array.from(item.matchAll(/(?:别|不要|不准|别再).{0,8}[“"']([^”"']{1,12})[”"']/g)).map((match) => match[1]);
    return [direct, ...quoted].filter(Boolean) as string[];
  }), 8);
}

function extractDisplayName(messages: Message[], texts: string[]) {
  const latestUserName = messages
    .filter((item) => !item.isDeleted && (item.senderId === USER_ACTOR_ID || item.type === 'user' || item.type === 'god'))
    .slice()
    .reverse()
    .find((item) => item.senderName && item.senderName !== '用户' && item.senderName !== 'User')?.senderName;
  return latestUserName || texts
    .map((item) => item.match(/(?:我的名字是|我叫)[:：]?\s*([^，。；;、\s]{1,12})/)?.[1])
    .find(Boolean);
}

function buildUserProfileProjection(chat: GroupChat, character: AICharacter, messages: Message[], now: number): UserProfileMemoryProjection {
  const profileItems = collectProfileEventItems(chat, character.id);
  const memoryTexts = getUserMemoryTexts(character);
  const recentUserTexts = messages
    .filter((item) => !item.isDeleted && (item.senderId === USER_ACTOR_ID || item.type === 'user' || item.type === 'god'))
    .slice(-10)
    .map((item) => compactText(item.content, 160));
  const eventTexts = profileItems.map((item) => item.text);
  const fallbackTexts = profileItems.length ? memoryTexts : [...memoryTexts, ...recentUserTexts];
  const allTexts = uniqueTexts([...eventTexts, ...fallbackTexts], 16);
  const eventBoundaries = profileTextsByKind(profileItems, 'boundary');
  const boundaries = uniqueTexts([...eventBoundaries, ...collectByPattern(allTexts, [
    /不要.*(主动|打扰|私聊|提醒|早安|晚安|恋爱|暧昧|情侣|对象|占有|吃醋)/,
    /不想.*(主动|打扰|私聊|提醒|早安|晚安|恋爱|暧昧|情侣|对象|占有|吃醋)/,
    /只.*朋友/,
    /别.*(叫|喊|称呼|主动|打扰|暧昧|恋爱)/,
  ])], 6);
  const addressPreference = extractProfileEventName(profileTextsByKind(profileItems, 'address_preference', 1)[0])
    || extractProfileEventName(profileTextsByKind(profileItems, 'display_name', 1)[0])
    || extractAddressPreference(allTexts);
  const displayName = extractProfileEventName(profileTextsByKind(profileItems, 'display_name', 1)[0])
    || extractDisplayName(messages, allTexts);
  return {
    userId: USER_ACTOR_ID,
    displayName,
    addressPreference,
    scheduleHints: uniqueTexts([...profileTextsByKind(profileItems, 'schedule_hint'), ...collectByPattern(allTexts, [/作息|早睡|熬夜|上班|下班|通勤|周末|晚上|早上|白天/])]),
    pressureSources: uniqueTexts([...profileTextsByKind(profileItems, 'pressure_source'), ...collectByPattern(allTexts, [/压力|焦虑|难受|不舒服|生病|失眠|加班|面试|考试|ddl|截止/])]),
    preferences: uniqueTexts([...profileTextsByKind(profileItems, 'preference'), ...collectByPattern(allTexts, [/喜欢|偏好|想要|爱吃|常去|想试|习惯/])]),
    dislikes: uniqueTexts([...profileTextsByKind(profileItems, 'dislike'), ...collectByPattern(allTexts, [/讨厌|不喜欢|不想|不要|雷点|介意/])]),
    boundaries,
    importantDates: uniqueTexts([...profileTextsByKind(profileItems, 'important_date'), ...collectByPattern(allTexts, [/生日|纪念日|考试|面试|约定|截止|ddl|明天|后天|周末/])]),
    recentPlans: uniqueTexts([...profileTextsByKind(profileItems, 'recent_plan'), ...collectByPattern(allTexts, [/计划|打算|要去|准备|明天|后天|周末|今晚|最近|下次/])]),
    emotionalPatterns: uniqueTexts([...profileTextsByKind(profileItems, 'emotional_pattern'), ...collectByPattern(allTexts, [/低落|焦虑|压力|紧张|开心|难过|生气|委屈|失眠/])]),
    sourceTexts: allTexts,
    confidence: clampScore(Math.min(100, profileItems.length * 18 + memoryTexts.length * 14 + recentUserTexts.length * 6 + boundaries.length * 8)),
    updatedAt: now,
  };
}

function isUserMessage(item: Message) {
  return !item.isDeleted && (item.senderId === USER_ACTOR_ID || item.type === 'user' || item.type === 'god');
}

function isCareClosureText(text: string) {
  return /(结束了|已经好了|搞定了|解决了|不用问|不用提醒|别提醒|别问|过了|没事了|结束啦|完成了|好多了|不难受了|考完|聊完)/.test(text);
}

function isSameCareDomain(topicText: string, closureText: string) {
  const domains = [
    /面试/,
    /考试/,
    /生病|不舒服|难受|失眠/,
    /加班/,
    /ddl|截止/,
    /生日|纪念日|约定/,
  ];
  return domains.some((domain) => domain.test(topicText) && domain.test(closureText));
}

function isCareTopicAnswered(topicText: string, messages: Message[], topicUpdatedAt: number) {
  const laterUserTexts = messages
    .filter((item) => isUserMessage(item) && (item.timestamp || 0) > topicUpdatedAt)
    .map((item) => item.content);
  const domainClosureTexts = messages
    .filter(isUserMessage)
    .map((item) => item.content)
    .filter((text) => isCareClosureText(text) && isSameCareDomain(topicText, text));
  const laterTexts = [...laterUserTexts, ...domainClosureTexts]
    .filter(Boolean)
    .join('\n');
  if (!laterTexts) return false;
  const topicIsInterview = /面试/.test(topicText);
  const topicIsExam = /考试/.test(topicText);
  const topicIsHealth = /(生病|不舒服|难受|失眠)/.test(topicText);
  const genericDone = isCareClosureText(laterTexts);
  if (genericDone) return true;
  if (topicIsInterview && /(面试).{0,12}(结束|过了|通过|没过|搞定|完成|聊完)/.test(laterTexts)) return true;
  if (topicIsExam && /(考试).{0,12}(结束|过了|考完|通过|没过|搞定|完成)/.test(laterTexts)) return true;
  if (topicIsHealth && /(好多了|已经好了|没事了|不难受了|睡着了|睡好了)/.test(laterTexts)) return true;
  return false;
}

function applyCareTopicLifecycle(topics: PendingCareTopic[], profile: UserProfileMemoryProjection, messages: Message[], now: number): PendingCareTopic[] {
  const blocksProactiveCare = hasBoundary(profile, [/不要.*(提醒|问|追问|关心)/, /不想.*(提醒|问|追问|关心)/, /别.*(提醒|问|追问|关心)/]);
  return topics
    .map((topic) => {
      const ageHours = Math.max(0, (now - topic.updatedAt) / (60 * 60 * 1000));
      if (isCareTopicAnswered(topic.text, messages, topic.updatedAt)) {
        return { ...topic, status: 'answered' as const, restraintReason: 'user already followed up or closed the topic' };
      }
      if (blocksProactiveCare) {
        return { ...topic, status: 'blocked' as const, restraintReason: 'user boundary blocks reminders or follow-up questions' };
      }
      const isRecentTimeBound = /(今晚|明天|后天|周末|面试|考试|ddl|截止|约定|要去|准备)/.test(topic.text);
      const staleAfterHours = topic.urgency === 'high' ? 72 : isRecentTimeBound ? 96 : 24 * 14;
      if (ageHours > staleAfterHours) {
        return { ...topic, urgency: 'low' as const, status: 'stale' as const, restraintReason: 'care topic is past its useful follow-up window' };
      }
      return { ...topic, status: 'active' as const };
    })
    .filter((topic) => topic.status === 'active')
    .slice(0, 4);
}

function buildPendingCareTopics(chat: GroupChat, characterId: string, profile: UserProfileMemoryProjection, messages: Message[], now: number): PendingCareTopic[] {
  const runtimeTopics = readActiveCompanionshipCareTopicsFromEvents(chat, characterId, now);
  const memoryTopics = profile.sourceTexts
    .filter((text) => /(考试|面试|加班|生病|不舒服|压力|焦虑|计划|明天|周末|生日|纪念日|约定|想试|要去)/.test(text))
    .filter((text) => !isCareClosureText(text))
    .filter((text) => !runtimeTopics.some((topic) => topic.text === compactText(text, 140)))
    .slice(0, 3)
    .map((text, index) => ({
      id: `memory-${index}`,
      text,
      source: 'memory' as const,
      urgency: /(生病|不舒服|焦虑|压力)/.test(text) ? 'high' as const : 'medium' as const,
      status: 'active' as const,
      updatedAt: now,
    }));
  const recentUser = messages
    .filter(isUserMessage)
    .slice(-6)
    .filter((item) => /(明天|今晚|最近|考试|面试|加班|难受|不舒服|压力|生日|周末|要去|打算)/.test(item.content))
    .filter((item) => !isCareClosureText(item.content))
    .filter((item) => !runtimeTopics.some((topic) => topic.evidence === compactText(item.content, 120) || topic.text === compactText(item.content, 140)))
    .slice(-2)
    .map((item, index) => ({
      id: `recent-${index}`,
      text: compactText(item.content, 140),
      source: 'recent_message' as const,
      urgency: /(难受|不舒服|压力)/.test(item.content) ? 'high' as const : 'medium' as const,
      status: 'active' as const,
      evidence: compactText(item.content, 120),
      updatedAt: item.timestamp || now,
    }));
  return applyCareTopicLifecycle([...runtimeTopics, ...recentUser, ...memoryTopics], profile, messages, now);
}

function buildPhaseEvidence(entry: RelationshipLedgerEntry | null, topics: PendingCareTopic[], phaseEvent: ResolvedPhaseEvent | null = null) {
  const semantic = entry?.derived?.semantic?.summary;
  const recent = entry?.recentEvents?.slice(-2).map((item) => compactText(item.summary, 120)).filter(Boolean) || [];
  const topicEvidence = topics.slice(0, 2).map((item) => `care topic: ${item.text}`);
  const phaseEvidence = phaseEvent ? phaseEvent.evidence.map((item) => `phase event: ${item}`) : [];
  return [...phaseEvidence, semantic, ...recent, ...topicEvidence].filter(Boolean).slice(0, 6) as string[];
}

function buildUserSharedAnchors(character: AICharacter, now: number) {
  return buildSharedMemoryAnchors(character, now)
    .filter((anchor) => anchor.participantIds.includes(USER_ACTOR_ID) || /用户/.test(anchor.text) || /用户/.test(anchor.evidence || ''))
    .slice(0, 3);
}

function formatSharedAnchorForPrompt(anchor: SharedMemoryAnchor) {
  return `${anchor.title}: ${compactText(anchor.text, 96)}`;
}

function getSharedAnchorLabels(character: AICharacter, now: number) {
  return buildUserSharedAnchors(character, now).map(formatSharedAnchorForPrompt);
}

function buildAddressing(profile: UserProfileMemoryProjection, phase: CompanionshipPhase, now: number) {
  const preferred = profile.addressPreference || profile.displayName;
  const forbiddenAddresses = extractForbiddenAddresses(profile.sourceTexts);
  const safePreferred = preferred && !forbiddenAddresses.includes(preferred) ? preferred : undefined;
  const neutralAddress = profile.displayName && !forbiddenAddresses.includes(profile.displayName) ? profile.displayName : '你';
  const isRestrained = phase === 'cooling' || phase === 'crisis' || phase === 'reconciling';
  const currentAddress = isRestrained ? neutralAddress : (safePreferred || neutralAddress);
  return {
    defaultName: '你',
    currentAddress,
    privateAddress: safePreferred || neutralAddress,
    publicAddress: '用户',
    forbiddenAddresses,
    addressHistory: safePreferred ? [{
      value: safePreferred,
      adoptedAt: now,
      reason: isRestrained ? 'user preference kept private while relationship is restrained' : 'user memory preference',
      initiatedBy: 'user' as const,
    }] : [],
  };
}

function buildRememberedPlans(topics: PendingCareTopic[]) {
  return topics
    .filter((item) => item.urgency !== 'high')
    .map((item) => item.text)
    .slice(0, 3);
}

function buildUnresolvedTensions(entry: RelationshipLedgerEntry | null) {
  if (!entry || entry.current.threat < 18) return [];
  return [
    entry.derived?.semantic?.summary || 'relationship tension is present',
    ...(entry.recentEvents || []).slice(-2).map((item) => compactText(item.summary, 120)),
  ].filter(Boolean).slice(0, 3) as string[];
}

function phaseLabel(phase: CompanionshipPhase) {
  const labels: Record<CompanionshipPhase, string> = {
    stranger: 'stranger',
    curious: 'curious',
    fond: 'fond',
    ambiguous: 'ambiguous but unconfirmed',
    confessing: 'confession pending',
    confirmed: 'confirmed relationship',
    passionate: 'passionate phase',
    deep: 'deep stable bond',
    cooling: 'cooling down',
    crisis: 'relationship crisis',
    reconciling: 'reconciling',
  };
  return labels[phase];
}

function statusTone(phase: CompanionshipPhase): CompanionshipStatusSignature['tone'] {
  if (phase === 'crisis') return 'crisis';
  if (phase === 'cooling' || phase === 'reconciling') return 'restrained';
  if (phase === 'ambiguous' || phase === 'confessing') return 'ambiguous';
  if (phase === 'fond' || phase === 'confirmed' || phase === 'passionate' || phase === 'deep') return 'warm';
  if (phase === 'curious') return 'curious';
  return 'distant';
}

function formatSince(timestamp: number | undefined, now: number) {
  if (!timestamp) return '';
  const minutes = Math.max(0, Math.round((now - timestamp) / (60 * 1000)));
  if (minutes < 60) return `${minutes || 1} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function buildStatusText(bond: UserBondState, carePolicy: CarePolicy, now: number) {
  const address = bond.addressing.currentAddress || '你';
  const topic = bond.pendingCareTopics[0]?.text;
  const since = formatSince(bond.lastUserReplyAt, now);
  if (bond.phase === 'crisis') return topic ? `还在意${address}，但现在更需要先把不舒服说清楚。` : `有些受伤和防备，暂时不适合强行靠近。`;
  if (bond.phase === 'cooling') return `还记得${address}，只是现在会更克制一点。`;
  if (carePolicy.boundaryReasons.length) return topic ? `记得${address}提过的事，但会按你的边界轻一点关心。` : `会把关系放在心上，也会尊重${address}设下的边界。`;
  if (topic) return `惦记着${address}提过的事：${compactText(topic, 42)}`;
  if (bond.phase === 'ambiguous') return since ? `${since}之后还会想起${address}，但不会把关系说死。` : `有些想靠近${address}，但还没到确认关系的程度。`;
  if (bond.phase === 'fond') return `对${address}更熟悉了，会自然记住一些小事。`;
  if (bond.phase === 'curious') return `开始把${address}当成需要认真回应的人。`;
  return `还在慢慢认识${address}。`;
}

function buildStatusChips(bond: UserBondState, carePolicy: CarePolicy) {
  return [
    bond.phase === 'ambiguous' ? '暧昧未确认' : '',
    bond.phase === 'fond' ? '关系升温' : '',
    bond.phase === 'curious' ? '开始在意' : '',
    bond.phase === 'cooling' || bond.phase === 'reconciling' ? '克制中' : '',
    bond.phase === 'crisis' ? '需要修复' : '',
    bond.pendingCareTopics.length ? '有关心事项' : '',
    bond.userProfile.boundaries.length ? '有用户边界' : '',
    carePolicy.allowGoodNight ? '可晚安' : '',
  ].filter(Boolean).slice(0, 4);
}

function buildOfflineTrace(bond: UserBondState, carePolicy: CarePolicy, now: number) {
  const silence = silenceHours(bond.lastUserReplyAt, now);
  const address = bond.addressing.currentAddress || '你';
  if (silence < 6) return '';
  if (carePolicy.boundaryReasons.includes('user prefers low proactive contact')) {
    return `想起${address}，但会按你的边界保持安静。`;
  }
  if (bond.phase === 'crisis') return '有话想说，但现在更像是在等一个能好好说开的时机。';
  if (bond.phase === 'cooling' || bond.phase === 'reconciling') return `隔了一阵没聊，还是会留意${address}的反应。`;
  if (bond.pendingCareTopics[0]) return `离线这段时间还惦记着：${compactText(bond.pendingCareTopics[0].text, 38)}`;
  if (bond.phase === 'ambiguous' || bond.phase === 'fond') return `这段时间没说话，也会偶尔想到${address}。`;
  if (bond.phase === 'curious') return `还在想下次该怎么自然地接上${address}的话。`;
  return '';
}

function buildUnsentDraft(bond: UserBondState, carePolicy: CarePolicy, now: number) {
  const silence = silenceHours(bond.lastUserReplyAt, now);
  const address = bond.addressing.currentAddress || '你';
  if (silence < 12) return '';
  if (carePolicy.dailyInitiationBudget <= 0) return '';
  if (bond.phase === 'crisis') return '';
  if (bond.pendingCareTopics[0]) return `本来想问问${address}，${compactText(bond.pendingCareTopics[0].text, 28)}后来怎么样了。`;
  if (bond.phase === 'ambiguous') return `写过一句“刚才想到${address}”，又觉得太直白。`;
  if (bond.phase === 'fond') return `想问${address}今天过得怎么样，又怕显得太突然。`;
  return '';
}

export function buildCompanionshipStatusSignature(params: {
  chat: GroupChat;
  character: AICharacter;
  messages: Message[];
  now?: number;
}): CompanionshipStatusSignature | null {
  const now = params.now || Date.now();
  const projection = buildUserCompanionshipProjection({ ...params, now });
  const bond = projection.userBond;
  if (!bond) return null;
  const sharedAnchorLabels = getSharedAnchorLabels(params.character, now);
  const carePolicy = bond.carePolicy;
  const offlineTrace = buildOfflineTrace(bond, carePolicy, now);
  const unsentDraft = buildUnsentDraft(bond, carePolicy, now);
  return {
    text: buildStatusText(bond, carePolicy, now),
    tone: statusTone(bond.phase),
    chips: buildStatusChips(bond, carePolicy),
    debugLines: [
      `phase=${bond.phase} style=${bond.style}`,
      `address=${bond.addressing.currentAddress} confidence=${bond.userProfile.confidence}`,
      `intimacy attraction=${bond.intimacy.attraction} intimacy=${bond.intimacy.intimacy} longing=${bond.intimacy.longing} security=${bond.intimacy.security}`,
      bond.pendingCareTopics.length ? `care=${bond.pendingCareTopics.map((item) => item.text).join(' / ')}` : '',
      bond.userProfile.boundaries.length ? `boundaries=${bond.userProfile.boundaries.join(' / ')}` : '',
      carePolicy.boundaryReasons.length ? `restraints=${carePolicy.boundaryReasons.join(' / ')}` : '',
      offlineTrace ? `offlineTrace=${offlineTrace}` : '',
      unsentDraft ? `unsentDraft=${unsentDraft}` : '',
      sharedAnchorLabels.length ? `sharedAnchors=${sharedAnchorLabels.join(' / ')}` : '',
      projection.evidence.length ? `evidence=${projection.evidence.join(' / ')}` : '',
    ].filter(Boolean),
    addressing: bond.addressing,
    offlineTrace: offlineTrace || undefined,
    unsentDraft: unsentDraft || undefined,
    updatedAt: now,
  };
}

function buildPromptLines(bond: UserBondState, carePolicy: CarePolicy, evidence: string[], sharedAnchors: SharedMemoryAnchor[]) {
  const intimacy = bond.intimacy;
  const profile = bond.userProfile;
  const lines = [
    `- Bond style: ${bond.style}; phase: ${phaseLabel(bond.phase)}.`,
    `- Intimacy cues: attraction ${intimacy.attraction}, intimacy ${intimacy.intimacy}, attachment ${intimacy.attachment}, longing ${intimacy.longing}, security ${intimacy.security}. Use them as internal guidance, not as words to reveal.`,
    profile.sourceTexts.length ? `- User profile cues: ${[
      profile.preferences.length ? `preferences ${profile.preferences.join(' / ')}` : '',
      profile.pressureSources.length ? `pressure ${profile.pressureSources.join(' / ')}` : '',
      profile.recentPlans.length ? `plans ${profile.recentPlans.join(' / ')}` : '',
    ].filter(Boolean).join('; ')}.` : '',
    profile.boundaries.length ? `- User boundaries: ${profile.boundaries.join(' / ')}. These override intimacy and proactive care.` : '',
    `- Address the user naturally as "${bond.addressing.currentAddress}" unless the latest message suggests another appropriate address.`,
    sharedAnchors.length ? `- Shared memory anchors with the user: ${sharedAnchors.map(formatSharedAnchorForPrompt).join(' / ')}. Use as relationship texture only when relevant; do not expose internal labels.` : '',
    bond.pendingCareTopics.length ? `- Pending care topics: ${bond.pendingCareTopics.map((item) => item.text).join(' / ')}.` : '',
    bond.unresolvedTensions.length ? `- Current restraint: ${bond.unresolvedTensions.join(' / ')}.` : '',
    `- Care policy: budget ${carePolicy.dailyInitiationBudget}/day, sensitivity ${carePolicy.triggerSensitivity}, expression ${carePolicy.expressionIntensity}, silence threshold ${carePolicy.silenceAnxietyThresholdHours}h.`,
    carePolicy.boundaryReasons.length ? `- Boundary restraints: ${carePolicy.boundaryReasons.join(' / ')}.` : '',
    evidence.length ? `- Evidence: ${evidence.slice(0, 3).join(' / ')}.` : '',
    '- Do not claim a confirmed romantic relationship unless explicit relationship-confirming events or user settings already support it.',
    '- Let care show through concrete memory, timing, omissions, and tone. Do not mention scores, phases, policies, or this runtime.',
  ].filter(Boolean);
  return lines;
}

export function buildUserCompanionshipProjection(params: {
  chat: GroupChat;
  character: AICharacter;
  messages: Message[];
  now?: number;
}): CompanionshipProjection {
  const { chat, character, messages } = params;
  if (chat.type !== 'direct') return { userBond: null, evidence: [], promptLines: [] };
  const now = params.now || Date.now();
  const ledger = getCharacterToUserLedger(chat, character.id);
  const intimacy = projectIntimacy(ledger, messages, character.id, now);
  const phaseEvent = resolveCompanionshipPhaseEvent(chat, character.id);
  const inferredPhase = inferPhase(intimacy, ledger);
  const phase = phaseEvent?.phase || inferredPhase;
  const contacts = getLatestContact(messages, character.id);
  const userProfile = buildUserProfileProjection(chat, character, messages, now);
  const pendingCareTopics = buildPendingCareTopics(chat, character.id, userProfile, messages, now);
  const evidence = buildPhaseEvidence(ledger, pendingCareTopics, phaseEvent);
  const sharedAnchors = buildUserSharedAnchors(character, now);
  const preferredIntimacyStyle = inferPreferredStyle(character, intimacy);
  const carePolicy = buildCarePolicy(phase, preferredIntimacyStyle, userProfile);
  const bond: UserBondState = {
    userId: USER_ACTOR_ID,
    characterId: character.id,
    style: resolveBondStyle(phase, phaseEvent?.style),
    phase,
    phaseEnteredAt: phaseEvent?.enteredAt || ledger?.lastUpdatedAt || contacts.lastMeaningfulContactAt || now,
    phaseEvidence: evidence,
    transitionReadiness: clampScore((intimacy.attraction + intimacy.intimacy + intimacy.security) / 3),
    intimacy,
    lastMeaningfulContactAt: contacts.lastMeaningfulContactAt,
    lastUserReplyAt: contacts.lastUserReplyAt,
    lastCharacterInitiatedAt: contacts.lastCharacterInitiatedAt,
    pendingCareTopics,
    rememberedUserPlans: buildRememberedPlans(pendingCareTopics),
    unresolvedTensions: buildUnresolvedTensions(ledger),
    addressing: buildAddressing(userProfile, phase, now),
    userProfile,
    preferredIntimacyStyle,
    carePolicy,
  };
  return {
    userBond: bond,
    evidence: [...sharedAnchors.map(formatSharedAnchorForPrompt), ...evidence].slice(0, 6),
    promptLines: buildPromptLines(bond, carePolicy, evidence, sharedAnchors),
  };
}

export function buildCompanionshipPromptBlock(params: {
  chat: GroupChat;
  character: AICharacter;
  messages: Message[];
  now?: number;
}) {
  const projection = buildUserCompanionshipProjection(params);
  if (!projection.userBond || !projection.promptLines.length) return '';
  return `\n## Companionship Context\n${projection.promptLines.join('\n')}`;
}

function inferCharacterCompanionshipStyle(relation: AICharacter['relationships'][number]): CharacterCompanionshipState['style'] {
  const warmth = relation.warmth || 0;
  const trust = relation.trust || 0;
  const competence = relation.competence || 0;
  const threat = relation.threat || 0;
  const note = relation.note || '';
  if (threat >= 34 && warmth >= 18) return 'rival_with_care';
  if (/(暧昧|心动|喜欢|牵挂|在意)/.test(note) && warmth >= 32 && trust >= 18) return 'romantic_tension';
  if (competence >= 42 && trust >= 28 && warmth < 48) return 'mentor_protege';
  if (warmth >= 58 && trust >= 52 && competence >= 24) return 'partner';
  if (warmth >= 46 && trust >= 36) return 'close_friend';
  if (warmth >= 34 && threat <= 18) return 'sibling_like';
  return threat >= 24 ? 'rival_with_care' : 'close_friend';
}

function extractSharedTexture(note: string, patterns: RegExp[], max = 2) {
  if (!note) return [];
  return patterns
    .map((pattern) => note.match(pattern)?.[0])
    .filter(Boolean)
    .slice(0, max) as string[];
}

function classifySharedMemoryAnchor(text: string): SharedMemoryAnchor['kind'] | null {
  if (/(第一次|初次|第一次说|第一次见|第一次聊|第一次吵|第一次和好)/.test(text)) return 'first_time';
  if (/(表白|告白|说喜欢|确认关系|承认喜欢)/.test(text)) return 'confession';
  if (/(和好|修复|道歉|递台阶|重新靠近|冰释)/.test(text)) return 'repair';
  if (/(吵架|冲突|冷战|误会|翻旧账|决裂|裂痕)/.test(text)) return 'conflict';
  if (/(共同秘密|秘密|小秘密|只有.*知道|不能告诉|保密)/.test(text)) return 'shared_secret';
  if (/(约定|承诺|答应|说好|下次一起|以后一起|等你)/.test(text)) return 'promise';
  if (/(共同梗|暗号|玩笑|只有.*懂|梗)/.test(text)) return 'inside_joke';
  if (/(纪念日|里程碑|生日|重要日子|救场|告别|重逢)/.test(text)) return 'milestone';
  return null;
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

function normalizeAnchorParticipants(ownerId: string, subjectIds: string[] | undefined) {
  const ids = [ownerId, ...(subjectIds || [])]
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(ids)).slice(0, 6);
}

function splitRelationshipNoteAnchorTexts(note: string) {
  return note
    .split(/[。；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
}

export function buildSharedMemoryAnchors(character: AICharacter, now = 0): SharedMemoryAnchor[] {
  const layeredAnchors = (character.layeredMemories || [])
    .filter((item) => isMemoryAnchorCandidate(item))
    .map((item): SharedMemoryAnchor | null => {
      const text = compactText(item.summary || item.text, 180);
      const evidence = compactText(item.evidenceText, 180);
      const kind = classifySharedMemoryAnchor(`${text}\n${evidence}`) || (item.kind === 'conflict' || item.kind === 'resentment' ? 'conflict' : item.kind === 'bond' ? 'milestone' : null);
      if (!kind) return null;
      return {
        id: `memory-${item.id}`,
        kind,
        participantIds: normalizeAnchorParticipants(character.id, item.subjectIds),
        title: formatSharedAnchorTitle(kind),
        text,
        salience: clampRelationshipScore(item.salience * 100),
        confidence: clampRelationshipScore(item.confidence * 100),
        source: 'layered_memory',
        sourceId: item.id,
        evidence,
        createdAt: item.createdAt || now,
        updatedAt: item.updatedAt || item.distilledAt || now,
      };
    })
    .filter((item): item is SharedMemoryAnchor => Boolean(item));

  const relationshipAnchors = (character.relationships || []).flatMap((relation, relationIndex) => {
    if (!relation.characterId || relation.characterId === USER_ACTOR_ID || relation.characterId.startsWith('draft-')) return [];
    return splitRelationshipNoteAnchorTexts(relation.note || '').map((text, noteIndex): SharedMemoryAnchor | null => {
      const kind = classifySharedMemoryAnchor(text);
      if (!kind) return null;
      const positiveWeight = Math.max(0, relation.warmth || 0) + Math.max(0, relation.trust || 0);
      const tensionWeight = Math.max(0, relation.threat || 0);
      return {
        id: `relationship-${relation.characterId}-${relationIndex}-${noteIndex}`,
        kind,
        participantIds: [character.id, relation.characterId].filter(Boolean),
        title: formatSharedAnchorTitle(kind),
        text: compactText(text, 180),
        salience: clampRelationshipScore(42 + positiveWeight * 0.22 + tensionWeight * 0.18),
        confidence: clampRelationshipScore(52 + Math.max(0, relation.trust || 0) * 0.32),
        source: 'relationship_note',
        sourceId: relation.characterId,
        evidence: compactText(relation.note, 180),
        createdAt: relation.updatedAt || now,
        updatedAt: relation.updatedAt || now,
      };
    }).filter((item): item is SharedMemoryAnchor => Boolean(item));
  });

  const seen = new Set<string>();
  return [...layeredAnchors, ...relationshipAnchors]
    .filter((anchor) => {
      const key = `${anchor.kind}:${anchor.participantIds.slice().sort().join(',')}:${anchor.text.replace(/\s+/g, '').slice(0, 48)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.salience + b.confidence + b.updatedAt / DAY_MS) - (a.salience + a.confidence + a.updatedAt / DAY_MS))
    .slice(0, 12);
}

export function buildCharacterCompanionshipStates(character: AICharacter, now = 0): CharacterCompanionshipState[] {
  return (character.relationships || [])
    .filter((relation) => relation.characterId && relation.characterId !== USER_ACTOR_ID && !relation.characterId.startsWith('draft-'))
    .map((relation) => {
      const warmth = relation.warmth || 0;
      const trust = relation.trust || 0;
      const competence = relation.competence || 0;
      const threat = relation.threat || 0;
      const note = relation.note || '';
      const closeness = clampRelationshipScore(warmth * 0.58 + trust * 0.38 - threat * 0.24);
      const protectiveness = clampRelationshipScore(warmth * 0.36 + trust * 0.34 + threat * 0.26);
      const reliance = clampRelationshipScore(trust * 0.46 + competence * 0.42 + warmth * 0.12 - threat * 0.18);
      return {
        actorId: character.id,
        targetId: relation.characterId,
        style: inferCharacterCompanionshipStyle(relation),
        closeness,
        protectiveness,
        reliance,
        sharedSecrets: extractSharedTexture(note, [/共同秘密[^，。；;]*/, /秘密[^，。；;]*/, /只有他们知道[^，。；;]*/]),
        sharedRituals: extractSharedTexture(note, [/共同梗[^，。；;]*/, /约定[^，。；;]*/, /仪式[^，。；;]*/, /暗号[^，。；;]*/]),
        unresolvedCareTopics: extractSharedTexture(note, [/担心[^，。；;]*/, /放心不下[^，。；;]*/, /想帮[^，。；;]*/, /护着[^，。；;]*/]),
        lastCareAt: relation.updatedAt || now,
      };
    })
    .filter((state) => state.closeness >= 24 || state.protectiveness >= 30 || state.reliance >= 28)
    .sort((a, b) => (b.closeness + b.protectiveness + b.reliance) - (a.closeness + a.protectiveness + a.reliance))
    .slice(0, 8);
}

export function buildCompanionshipArtifactSeeds(params: {
  character: Partial<AICharacter>;
  relatedCharacters?: Pick<AICharacter, 'id' | 'name'>[];
  surface?: 'private_diary' | 'public_moment';
  includeUserMemory?: boolean;
  max?: number;
  now?: number;
}): string[] {
  const {
    character,
    relatedCharacters = [],
    surface = 'private_diary',
    includeUserMemory = surface !== 'public_moment',
    max = surface === 'public_moment' ? 4 : 6,
    now = character.updatedAt || character.createdAt || Date.now(),
  } = params;
  if (!canProjectCompanionshipArtifacts(character)) return [];
  const members = buildCompanionshipDisplayMembers(character, relatedCharacters);
  const seeds: string[] = [];
  const isPublic = surface === 'public_moment';

  buildSharedMemoryAnchors(character, now)
    .slice(0, isPublic ? 3 : 4)
    .forEach((anchor) => {
      const text = cleanArtifactSeedText(anchor.text, members, isPublic ? 90 : 140);
      if (!text) return;
      if (isPublic) {
        if (anchor.participantIds.includes(USER_ACTOR_ID)) {
          seeds.push(`公开动态可以只留下“有人懂”的余味，不点名用户，也不写成私密记忆：${text}。`);
        } else if (anchor.kind === 'inside_joke') {
          seeds.push(`公开动态可以像随手提到一个只有熟人懂的梗，不解释来龙去脉：${text}。`);
        } else if (anchor.kind === 'shared_secret') {
          seeds.push(`公开动态可以写成含蓄留白，不泄露秘密本身：${text}。`);
        } else if (anchor.kind === 'promise') {
          seeds.push(`公开动态可以把未完成约定写成一句自然期待：${text}。`);
        } else {
          seeds.push(`公开动态可以带一点关系余味，但不要写成事件报告：${text}。`);
        }
        return;
      }
      const participants = anchor.participantIds
        .map((id) => resolveCompanionshipActorName(id, relatedCharacters))
        .filter((name) => name !== (character.name || '这个角色'))
        .join('和');
      seeds.push(`${participants ? `和${participants}有关的` : ''}${anchor.title}可以成为日记里的私密回声：${text}。`);
    });

  buildCharacterCompanionshipStates(character, now)
    .slice(0, isPublic ? 2 : 3)
    .forEach((state) => {
      const targetName = resolveCompanionshipActorName(state.targetId, relatedCharacters);
      const texture = [
        state.sharedSecrets[0] ? `小秘密：${cleanArtifactSeedText(state.sharedSecrets[0], members, 80)}` : '',
        state.sharedRituals[0] ? `共同梗/约定：${cleanArtifactSeedText(state.sharedRituals[0], members, 80)}` : '',
        state.unresolvedCareTopics[0] ? `放心不下：${cleanArtifactSeedText(state.unresolvedCareTopics[0], members, 80)}` : '',
      ].filter(Boolean).join('；');
      if (isPublic) {
        if (texture) {
          seeds.push(`公开动态可以把和${targetName}之间的关系余波写成一句含蓄状态，不要暴露秘密细节：${texture}。`);
        } else if (state.closeness >= 42 || state.protectiveness >= 42 || state.reliance >= 42) {
          seeds.push(`公开动态可以让人感觉和${targetName}之间有熟悉感、护短或默契，但不要直接说明关系评分。`);
        }
        return;
      }
      if (texture) {
        seeds.push(`对${targetName}的关系纹理可以私下写成余波，不要写成系统记录：${texture}。`);
      } else if (state.closeness >= 42 || state.protectiveness >= 42 || state.reliance >= 42) {
        seeds.push(`对${targetName}可以写一点没有公开说出的在意、护短、信赖或别扭靠近。`);
      }
    });

  if (includeUserMemory) {
    (character.memory?.userMemories || [])
      .filter((text) => /(用户|叫我|喜欢|不喜欢|压力|面试|考试|约定|生日|纪念日|不要|不想)/.test(text))
      .slice(-3)
      .forEach((text) => {
        const cleaned = cleanArtifactSeedText(text, members, isPublic ? 80 : 120);
        if (!cleaned) return;
        seeds.push(isPublic
          ? `公开动态只能把这类用户记忆泛化成“有人/懂的人/一个约定”的余味，不点名用户：${cleaned}。`
          : `关于用户的记忆可以只轻轻影响日记，不要写成评价用户：${cleaned}。`);
      });
  }

  return Array.from(new Set(seeds.filter(Boolean))).slice(0, max);
}

export function buildCompanionshipRuntimeTrace(params: {
  chat: GroupChat;
  character: AICharacter;
  messages: Message[];
  now?: number;
}): CompanionshipRuntimeTrace | null {
  const projection = buildUserCompanionshipProjection(params);
  const bond = projection.userBond;
  if (!bond) return null;
  const profile = bond.userProfile;
  const carePolicy = bond.carePolicy;
  const sharedAnchorLabels = getSharedAnchorLabels(params.character, params.now || Date.now());
  return {
    style: bond.style,
    phase: bond.phase,
    currentAddress: bond.addressing.currentAddress,
    sharedAnchors: sharedAnchorLabels.slice(0, 4),
    pendingCareTopics: bond.pendingCareTopics.map((item) => item.text).slice(0, 4),
    rememberedUserPlans: bond.rememberedUserPlans.slice(0, 4),
    boundaries: profile.boundaries.slice(0, 4),
    boundaryReasons: carePolicy.boundaryReasons.slice(0, 4),
    carePolicy: {
      dailyInitiationBudget: carePolicy.dailyInitiationBudget,
      triggerSensitivity: carePolicy.triggerSensitivity,
      silenceAnxietyThresholdHours: carePolicy.silenceAnxietyThresholdHours,
      expressionIntensity: carePolicy.expressionIntensity,
      allowGoodMorning: carePolicy.allowGoodMorning,
      allowGoodNight: carePolicy.allowGoodNight,
      allowMissYou: carePolicy.allowMissYou,
    },
    evidence: projection.evidence.slice(0, 5),
    intimacy: bond.intimacy,
    userProfileConfidence: profile.confidence,
  };
}

export function buildCompanionshipCarePolicyForCharacter(params: {
  character: AICharacter;
  chat?: GroupChat;
  messages?: Message[];
  phase?: CompanionshipPhase;
  now?: number;
}): CarePolicy {
  const now = params.now || Date.now();
  const messages = params.messages || [];
  const character = {
    ...params.character,
    personality: params.character.personality || { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    memory: params.character.memory || {
      shortTermSummary: '',
      longTerm: [],
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
  } as AICharacter;
  const profileChat = params.chat || ({ runtimeEventsV2: [] } as unknown as GroupChat);
  const userProfile = buildUserProfileProjection(profileChat, character, messages, now);
  const phase = params.phase || readCompanionshipPhaseFromChat(params.chat, character.id, messages, now) || 'curious';
  const intimacy = params.chat
    ? projectIntimacy(getCharacterToUserLedger(params.chat, character.id), messages, character.id, now)
    : {
      attraction: 0,
      intimacy: 0,
      attachment: 0,
      longing: 0,
      exclusivity: 0,
      security: 50,
    };
  const preferredStyle = inferPreferredStyle(character, intimacy);
  return buildCarePolicy(phase, preferredStyle, userProfile);
}

export function shouldBlockUserProactiveContactByCompanionshipPolicy(params: {
  character: AICharacter | null | undefined;
  eventKind: 'check_in' | 'react_to_moment' | 'social_outing' | 'status_update';
  reasonType?: string | null;
  chat?: GroupChat;
  messages?: Message[];
  attentionScore?: number;
  enforceTemporalPolicy?: boolean;
  now?: number;
}): { blocked: boolean; reason?: string; carePolicy?: CarePolicy } {
  if (!params.character) return { blocked: false };
  const now = params.now || Date.now();
  const carePolicy = buildCompanionshipCarePolicyForCharacter({
    character: params.character,
    chat: params.chat,
    messages: params.messages,
    now,
  });
  if (carePolicy.boundaryReasons.includes('user prefers low proactive contact')) {
    return {
      blocked: true,
      reason: 'user prefers low proactive contact',
      carePolicy,
    };
  }
  const reasonType = params.reasonType || '';
  if (carePolicy.boundaryReasons.includes('user rejects greeting rituals') && params.eventKind === 'check_in') {
    if (reasonType === 'world_attention_private_message'
      || reasonType === 'world_attention_followup'
      || reasonType === 'world_attention_followup_question'
      || reasonType === 'attention_check_in') {
      return {
        blocked: true,
        reason: 'user rejects greeting rituals',
        carePolicy,
      };
    }
  }
  const isCalendarReminder = params.eventKind === 'status_update' && reasonType === 'world_attention_calendar_reminder';
  const isImmediateUserPromptedFollowup = reasonType === 'world_attention_private_message'
    || reasonType === 'world_attention_followup'
    || reasonType === 'world_attention_followup_question'
    || reasonType === 'world_attention_invite_activity'
    || reasonType === 'attention_check_in'
    || reasonType === 'attention_followup';
  if (!isCalendarReminder && !isImmediateUserPromptedFollowup && carePolicy.dailyInitiationBudget <= 0) {
    return {
      blocked: true,
      reason: 'companionship proactive budget is zero for current phase',
      carePolicy,
    };
  }
  if (params.enforceTemporalPolicy !== false && !isCalendarReminder && isWithinCarePolicyQuietHours(now, carePolicy.quietHours)) {
    return {
      blocked: true,
      reason: 'companionship quiet hours',
      carePolicy,
    };
  }
  if (!isImmediateUserPromptedFollowup && typeof params.attentionScore === 'number') {
    const requiredScore = carePolicy.triggerSensitivity / 100;
    const reminderRelaxation = params.eventKind === 'status_update' ? 0.16 : 0;
    if (params.attentionScore < Math.max(0.35, requiredScore - reminderRelaxation)) {
      return {
        blocked: true,
        reason: 'companionship trigger sensitivity not met',
        carePolicy,
      };
    }
  }
  return { blocked: false, carePolicy };
}
