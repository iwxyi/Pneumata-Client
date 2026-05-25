import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { DirectorBeatType } from './directorIntent';
import { resolveDirectorIntent, type DirectorIntent, type PendingReplyLike } from './directorIntent';
import { projectNarrativeLines, selectPrimaryNarrativeLine, type NarrativeLineProjection } from './narrativeProjection';
import { getGuidanceTargetActorIds, parseUserGuidanceIntent, type UserGuidanceIntent } from './userGuidanceIntent';

export interface RuntimePressureProjection {
  narrativeLines: NarrativeLineProjection[];
  primaryLine: NarrativeLineProjection | null;
  directorIntent: DirectorIntent | null;
}

interface HumanGuidanceResolution {
  intent: DirectorIntent | null;
  timestamp: number | null;
}

export function shouldUseFreeSpeechRuntimeDecision(chat: GroupChat) {
  if (chat.type !== 'group') return false;
  if (chat.scenarioState?.currentTurnActorId) return false;
  const freeSpeaking = chat.modeConfig?.freeSpeaking;
  return freeSpeaking !== false;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function resolveDirectorBeatType(intent: unknown): DirectorBeatType {
  if (intent === 'force_reply') return 'answer';
  if (intent === 'cool_down') return 'cool_down';
  if (intent === 'reveal') return 'reveal';
  if (intent === 'inject_event') return 'invite';
  if (intent === 'redirect') return 'deflect';
  if (intent === 'summarize') return 'summarize';
  if (intent === 'escalate') return 'escalate';
  return 'invite';
}

function uniqueKnownActorIds(ids: unknown, characters: AICharacter[]) {
  if (!Array.isArray(ids)) return [];
  const knownIds = new Set(characters.map((character) => character.id));
  return ids.filter((id, index, array): id is string => typeof id === 'string' && knownIds.has(id) && array.indexOf(id) === index);
}

function countAiResponsesAfter(messages: Message[], timestamp: number) {
  return messages.filter((message) => message.type === 'ai' && !message.isDeleted && message.timestamp > timestamp).length;
}

function getAiRespondersAfter(messages: Message[], timestamp: number) {
  return new Set(messages.filter((message) => message.type === 'ai' && !message.isDeleted && message.timestamp > timestamp).map((message) => message.senderId));
}

function isExplicitPersistentGuidance(guidance: UserGuidanceIntent) {
  if (guidance.actorIds.length) return true;
  if (guidance.kind === 'media_request') return true;
  return /(新话题|换个话题|切换话题|聊聊|讨论|围绕|回到|别聊|继续说|请|让|帮|指定|点名|安排)/i.test(guidance.rawText);
}

function guidanceIntentToDirectorIntent(guidance: UserGuidanceIntent, targetActorIds: string[]): DirectorIntent {
  return {
    source: 'user_message',
    beatType: guidance.beatType,
    targetActorIds,
    pressure: guidance.pressure,
    reason: guidance.reason,
    userGuidance: guidance,
  };
}

function getLatestHumanGuidanceResolution(characters: AICharacter[], messages: Message[], now: number): HumanGuidanceResolution {
  const humanMessages = messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god'))
    .slice()
    .reverse();

  for (const message of humanMessages) {
    const guidance = parseUserGuidanceIntent(message.content, characters);
    if (!guidance || !isExplicitPersistentGuidance(guidance)) continue;
    if (now > message.timestamp + 10 * 60_000) return { intent: null, timestamp: message.timestamp };

    const respondedActorIds = getAiRespondersAfter(messages, message.timestamp);
    if (guidance.actorIds.length) {
      const pendingActorIds = uniqueKnownActorIds(guidance.actorIds.filter((actorId) => !respondedActorIds.has(actorId)), characters);
      if (pendingActorIds.length) {
        return {
          intent: guidanceIntentToDirectorIntent(guidance, pendingActorIds),
          timestamp: message.timestamp,
        };
      }
      return { intent: null, timestamp: message.timestamp };
    }

    if (countAiResponsesAfter(messages, message.timestamp) >= guidance.maxTurns) {
      return { intent: null, timestamp: message.timestamp };
    }
    return {
      intent: guidanceIntentToDirectorIntent(guidance, uniqueKnownActorIds(getGuidanceTargetActorIds(guidance), characters)),
      timestamp: message.timestamp,
    };
  }

  return { intent: null, timestamp: null };
}

function isDirectorInterventionActive(event: NonNullable<GroupChat['runtimeEventsV2']>[number], messages: Message[], now: number) {
  const payload = event.payload as Record<string, unknown>;
  const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : event.createdAt + 10 * 60_000;
  if (now > expiresAt) return false;
  const maxTurns = typeof payload.maxTurns === 'number' ? Math.max(1, Math.round(payload.maxTurns)) : 1;
  return countAiResponsesAfter(messages, event.createdAt) < maxTurns;
}

function isDirectorInterventionExpired(event: NonNullable<GroupChat['runtimeEventsV2']>[number], now: number) {
  const payload = event.payload as Record<string, unknown>;
  const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : event.createdAt + 10 * 60_000;
  return now > expiresAt;
}

function getLatestDirectorInterventionIntent(chat: GroupChat, characters: AICharacter[], messages: Message[], now: number, ignoreBefore?: number | null): DirectorIntent | null {
  const events = (chat.runtimeEventsV2 || []).slice().reverse().filter((item) => item.kind === 'director_intervention' && !isDirectorInterventionExpired(item, now));
  for (const event of events) {
    if (typeof ignoreBefore === 'number' && event.createdAt < ignoreBefore) continue;
    const payload = event.payload as Record<string, unknown>;
    const text = typeof payload.text === 'string' ? payload.text : event.summary;
    const storedGuidance = typeof payload.userGuidance === 'object' && payload.userGuidance
      ? payload.userGuidance as UserGuidanceIntent
      : null;
    const guidance = storedGuidance || parseUserGuidanceIntent(text || '', characters);
    const respondedActorIds = getAiRespondersAfter(messages, event.createdAt);
    const pendingGuidanceActorIds = storedGuidance?.actorIds.length
      ? storedGuidance.actorIds.filter((actorId) => !respondedActorIds.has(actorId))
      : [];
    const hasTargetedGuidance = Boolean(storedGuidance?.actorIds.length);
    if (!hasTargetedGuidance && !isDirectorInterventionActive(event, messages, now)) continue;
    if (hasTargetedGuidance && !pendingGuidanceActorIds.length) continue;

    const targetActorIds = uniqueKnownActorIds(payload.targetActorIds, characters);
    const guidanceTargetActorIds = uniqueKnownActorIds(getGuidanceTargetActorIds(guidance), characters);
    const activeTargetActorIds = pendingGuidanceActorIds.length
      ? uniqueKnownActorIds(pendingGuidanceActorIds, characters)
      : targetActorIds.length
        ? targetActorIds
        : guidanceTargetActorIds;
    if (hasTargetedGuidance && !activeTargetActorIds.length) continue;
    return {
      source: 'user_message',
      targetLineId: typeof payload.targetLineId === 'string' ? payload.targetLineId : undefined,
      beatType: resolveDirectorBeatType(payload.intent),
      targetActorIds: activeTargetActorIds,
      pressure: clamp01(typeof payload.pressure === 'number' ? payload.pressure : 0.86),
      reason: text || 'A director intervention is steering the next room beat.',
      userGuidance: guidance,
    };
  }
  return null;
}

export function projectRuntimePressure(params: {
  chat: GroupChat;
  characters: AICharacter[];
  messages: Message[];
  pendingReplyContext?: PendingReplyLike | null;
  now?: number;
}): RuntimePressureProjection {
  if (!shouldUseFreeSpeechRuntimeDecision(params.chat)) {
    return { narrativeLines: [], primaryLine: null, directorIntent: null };
  }
  const now = params.now || Date.now();
  const activeMessages = params.messages.filter((message) => !message.isDeleted);
  const narrativeLines = projectNarrativeLines({
    chat: params.chat,
    characters: params.characters,
    messages: activeMessages,
    now,
  });
  const latestHumanGuidance = getLatestHumanGuidanceResolution(params.characters, activeMessages, now);
  const directorIntervention = getLatestDirectorInterventionIntent(params.chat, params.characters, activeMessages, now, latestHumanGuidance.timestamp);
  if (directorIntervention) {
    return {
      narrativeLines,
      primaryLine: selectPrimaryNarrativeLine(narrativeLines),
      directorIntent: directorIntervention,
    };
  }
  if (latestHumanGuidance.intent) {
    return {
      narrativeLines,
      primaryLine: selectPrimaryNarrativeLine(narrativeLines),
      directorIntent: latestHumanGuidance.intent,
    };
  }
  const directorIntent = resolveDirectorIntent({
    chat: params.chat,
    characters: params.characters,
    messages: activeMessages,
    pendingReplyContext: params.pendingReplyContext,
    narrativeLines,
  });
  return {
    narrativeLines,
    primaryLine: selectPrimaryNarrativeLine(narrativeLines),
    directorIntent,
  };
}
