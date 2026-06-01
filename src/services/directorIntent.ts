import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { NarrativeLineProjection } from './narrativeProjection';
import { selectPrimaryNarrativeLine } from './narrativeProjection';
import { getGuidanceTargetActorIds, parseUserGuidanceIntent, type UserGuidanceIntent } from './userGuidanceIntent';

export type DirectorIntentSource =
  | 'user_message'
  | 'narrative_line'
  | 'conflict'
  | 'relationship'
  | 'faction'
  | 'growth'
  | 'emotion'
  | 'topic'
  | 'room_state';

export type DirectorBeatType =
  | 'answer'
  | 'challenge'
  | 'defend'
  | 'escalate'
  | 'cool_down'
  | 'reveal'
  | 'deflect'
  | 'summarize'
  | 'invite';

export interface DirectorIntent {
  source: DirectorIntentSource;
  targetLineId?: string;
  beatType: DirectorBeatType;
  targetActorIds: string[];
  pressure: number;
  reason: string;
  userGuidance?: UserGuidanceIntent | null;
}

export interface PendingReplyLike {
  targetIds: string[];
  primaryTargetId: string | null;
  sourceSpeakerId: string | null;
  unmetTurns: number;
  strength: 'soft' | 'strong';
}

function clampPressure(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizePercent(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0;
}

function uniqueActorIds(ids: Array<string | null | undefined>, characters: AICharacter[]) {
  const knownIds = new Set(characters.map((character) => character.id));
  const resolved = ids.filter((id): id is string => typeof id === 'string' && knownIds.has(id));
  return resolved.filter((id, index, array) => array.indexOf(id) === index);
}

function getLatestVisibleMessage(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted).at(-1) || null;
}

function isHumanGuidanceMessage(message: Message | null | undefined): message is Message {
  if (!message) return false;
  if (message.type === 'god') return true;
  // "speak as" user messages are character participation, not topic guidance.
  if (message.type === 'user' && message.metadata?.manualSpeaker) return false;
  return message.type === 'user';
}

function getLatestAiMessage(messages: Message[]) {
  return messages.filter((message) => message.type === 'ai' && !message.isDeleted).at(-1) || null;
}

function findMentionedCharacters(text: string, characters: AICharacter[]) {
  return characters
    .filter((character) => character.name && text.includes(character.name))
    .map((character) => character.id);
}

function resolveUserMessageDirectorIntent(message: Message, characters: AICharacter[]): DirectorIntent {
  const guidance = parseUserGuidanceIntent(message.content, characters);
  if (guidance) {
    const targetActorIds = uniqueActorIds(getGuidanceTargetActorIds(guidance), characters);
    return {
      source: 'user_message',
      beatType: guidance.beatType,
      targetActorIds,
      pressure: guidance.pressure,
      reason: guidance.reason,
      userGuidance: guidance,
    };
  }
  const mentioned = findMentionedCharacters(message.content, characters);
  if (mentioned.length) {
    return {
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: uniqueActorIds(mentioned, characters),
      pressure: 0.9,
      reason: '用户明确提到了一个或多个角色。',
    };
  }
  return {
    source: 'user_message',
    beatType: message.content.length > 90 ? 'summarize' : 'invite',
    targetActorIds: [],
    pressure: message.content.length > 90 ? 0.62 : 0.5,
    reason: '用户消息正在改变下一轮回应方向。',
  };
}

function resolveConflictBeat(nextPressure?: string): DirectorBeatType {
  if (nextPressure === 'cool') return 'cool_down';
  if (nextPressure === 'divert') return 'deflect';
  if (nextPressure === 'stabilize') return 'defend';
  if (nextPressure === 'spread') return 'invite';
  return 'escalate';
}

function resolveLineIntent(line: NarrativeLineProjection): DirectorIntent {
  const beat = line.possibleNextBeats[0] || {
    beatType: line.type === 'conflict' ? 'escalate' : line.type === 'relationship' ? 'invite' : 'summarize',
    targetActorIds: line.participantIds,
    pressure: line.salience,
    reason: line.summary,
  };
  return {
    source: line.type === 'conflict'
      ? 'conflict'
      : line.type === 'relationship'
        ? 'relationship'
        : line.type === 'faction'
          ? 'faction'
          : line.type === 'growth'
            ? 'growth'
          : 'narrative_line',
    targetLineId: line.id,
    beatType: beat.beatType,
    targetActorIds: beat.targetActorIds,
    pressure: clampPressure(Math.max(beat.pressure, line.salience)),
    reason: beat.reason || line.summary,
  };
}

export function resolveDirectorIntent(params: {
  chat: GroupChat;
  characters: AICharacter[];
  messages: Message[];
  pendingReplyContext?: PendingReplyLike | null;
  narrativeLines?: NarrativeLineProjection[];
}): DirectorIntent {
  const latestMessage = getLatestVisibleMessage(params.messages);
  const latestAiMessage = getLatestAiMessage(params.messages);
  const pending = params.pendingReplyContext;
  if (isHumanGuidanceMessage(latestMessage)) {
    return resolveUserMessageDirectorIntent(latestMessage, params.characters);
  }

  if (pending?.targetIds.length) {
    return {
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: pending.targetIds,
      pressure: clampPressure((pending.strength === 'strong' ? 0.82 : 0.58) + Math.min(0.16, pending.unmetTurns * 0.04)),
      reason: pending.sourceSpeakerId
        ? '被点名角色还有未回应的期待。'
        : '有角色被点名，需要在房间漂移前接住回应。',
    };
  }

  const primaryLine = selectPrimaryNarrativeLine(params.narrativeLines || []);
  if (primaryLine) {
    return resolveLineIntent(primaryLine);
  }

  const primaryConflict = params.chat.worldState.conflictState?.primaryConflict || null;
  if (primaryConflict && primaryConflict.stage !== 'resolved') {
    const targetActorIds = uniqueActorIds([
      ...(primaryConflict.targetIds || []),
      ...(primaryConflict.participantIds || []),
    ], params.characters);
    return {
      source: 'conflict',
      targetLineId: primaryConflict.id,
      beatType: resolveConflictBeat(primaryConflict.nextPressure),
      targetActorIds,
      pressure: clampPressure(0.46 + primaryConflict.severity * 0.42),
      reason: primaryConflict.summary || '主要矛盾仍在生效。',
    };
  }

  const room = params.chat.worldState.structuredRoomState;
  if (room?.pileOnTarget) {
    const roomHeat = normalizePercent(room.heat);
    return {
      source: 'room_state',
      beatType: roomHeat > 0.68 ? 'cool_down' : 'defend',
      targetActorIds: uniqueActorIds([room.pileOnTarget], params.characters),
      pressure: clampPressure(0.48 + roomHeat * 0.34),
      reason: '房间里出现了持续指向同一角色的压力，需要回应或降温。',
    };
  }

  const topicDrift = normalizePercent(room?.topicDrift);
  if (room && topicDrift > 0.62) {
    return {
      source: 'room_state',
      beatType: 'summarize',
      targetActorIds: [],
      pressure: clampPressure(0.44 + topicDrift * 0.28),
      reason: '房间话题已经明显漂移，适合转向或收束。',
    };
  }

  return {
    source: latestAiMessage ? 'topic' : 'room_state',
    beatType: latestAiMessage ? 'invite' : 'summarize',
    targetActorIds: latestAiMessage ? uniqueActorIds([latestAiMessage.senderId], params.characters) : [],
    pressure: latestAiMessage ? 0.34 : 0.22,
    reason: latestAiMessage ? '延续当前正在进行的话题，不强行推进新剧情。' : '目前还没有明显的叙事压力。',
  };
}

export function describeDirectorIntent(intent: DirectorIntent) {
  const targets = intent.targetActorIds.length ? intent.targetActorIds.join(',') : 'group';
  const guidance = intent.userGuidance ? `; guidance=${intent.userGuidance.kind}; userText=${intent.userGuidance.rawText}` : '';
  return `source=${intent.source}; beat=${intent.beatType}; targets=${targets}; pressure=${intent.pressure.toFixed(2)}; reason=${intent.reason}${guidance}`;
}
