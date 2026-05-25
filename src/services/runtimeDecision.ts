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

function getLatestDirectorInterventionIntent(chat: GroupChat, characters: AICharacter[], messages: Message[], now: number): DirectorIntent | null {
  const event = (chat.runtimeEventsV2 || []).slice().reverse().find((item) => item.kind === 'director_intervention' && !isDirectorInterventionExpired(item, now) && isDirectorInterventionActive(item, messages, now));
  if (!event) return null;
  const payload = event.payload as Record<string, unknown>;
  const text = typeof payload.text === 'string' ? payload.text : event.summary;
  const guidance = typeof payload.userGuidance === 'object' && payload.userGuidance
    ? payload.userGuidance as UserGuidanceIntent
    : parseUserGuidanceIntent(text || '', characters);
  const respondedActorIds = getAiRespondersAfter(messages, event.createdAt);
  const pendingGuidanceActorIds = guidance?.actorIds.length
    ? guidance.actorIds.filter((actorId) => !respondedActorIds.has(actorId))
    : [];
  if (guidance?.actorIds.length && !pendingGuidanceActorIds.length) return null;
  const targetActorIds = uniqueKnownActorIds(payload.targetActorIds, characters);
  const guidanceTargetActorIds = uniqueKnownActorIds(getGuidanceTargetActorIds(guidance), characters);
  const activeTargetActorIds = pendingGuidanceActorIds.length
    ? uniqueKnownActorIds(pendingGuidanceActorIds, characters)
    : targetActorIds.length
      ? targetActorIds
      : guidanceTargetActorIds;
  if (guidance?.actorIds.length && !activeTargetActorIds.length) return null;
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
  const directorIntervention = getLatestDirectorInterventionIntent(params.chat, params.characters, activeMessages, now);
  if (directorIntervention) {
    return {
      narrativeLines,
      primaryLine: selectPrimaryNarrativeLine(narrativeLines),
      directorIntent: directorIntervention,
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
