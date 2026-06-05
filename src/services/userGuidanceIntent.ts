import type { AICharacter } from '../types/character';
import type { DirectorBeatType } from './directorIntent';

export type UserGuidanceIntentKind = 'topic_shift' | 'direct_reply' | 'media_request';

export interface UserGuidanceMediaRequest {
  kind: 'image';
  subjectActorIds: string[];
  subjectText: string;
  actionText: string;
}

export interface UserGuidanceIntent {
  kind: UserGuidanceIntentKind;
  rawText: string;
  actorIds: string[];
  mentionedActorIds: string[];
  mediaRequest?: UserGuidanceMediaRequest;
  focusText: string;
  beatType: DirectorBeatType;
  pressure: number;
  maxTurns: number;
  reason: string;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(ids: string[]) {
  return ids.filter((id, index, array) => id && array.indexOf(id) === index);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortByNamePosition(text: string, characters: AICharacter[]) {
  return characters
    .map((character) => ({ character, index: character.name ? text.indexOf(character.name) : -1 }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);
}

function findMentionedActors(text: string, characters: AICharacter[]) {
  return sortByNamePosition(text, characters).map((item) => item.character.id);
}

function isImageRequest(text: string) {
  return /(图片|照片|相片|图像|配图|发图|晒图|发张|发个图|画个|画张|画一张|拍个|拍张|证件照|自拍|截图|海报|插画|头像|表情包)/i.test(text);
}

function isDirectSpeakRequest(text: string) {
  return /(说说|说一下|讲讲|回答|回应|回复|解释|评价|吐槽|问问|来一句|你来说|你来|发言|出题|写|分析|总结|展开)/i.test(text);
}

function isCollectiveActorRequest(text: string) {
  return /(每个人|每位|每个成员|所有人|全员|大家都|你们都|各自|分别|一人一|每人)/i.test(text)
    && isDirectSpeakRequest(text);
}

function allActorIds(characters: AICharacter[]) {
  return characters.map((character) => character.id).filter(Boolean);
}

function firstMentionBeforeAction(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const actionMatch = /(帮|替|给|发|画|拍|写|说|讲|回答|回应|回复|解释|评价|吐槽|问|出题|总结|分析|展开)/i.exec(text);
  if (!actionMatch) return [];
  return mentioned
    .filter((item) => item.index < actionMatch.index)
    .map((item) => item.character.id);
}

function namesAfterDirectivePrefix(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const prefixMatch = /(让|请|叫|安排|指定|点名|让一下|麻烦|想让)/i.exec(text);
  if (!prefixMatch) return [];
  const firstActionAfterPrefix = /(帮|替|给|发|画|拍|写|说|讲|回答|回应|回复|解释|评价|吐槽|问|出题|总结|分析|展开)/i.exec(text.slice(prefixMatch.index + prefixMatch[0].length));
  const actionIndex = firstActionAfterPrefix
    ? prefixMatch.index + prefixMatch[0].length + firstActionAfterPrefix.index
    : Math.min(text.length, prefixMatch.index + 36);
  return mentioned
    .filter((item) => item.index > prefixMatch.index && item.index < actionIndex)
    .map((item) => item.character.id);
}

function startsWithMentionedActor(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const trimmed = text.trimStart();
  return mentioned
    .filter((item) => item.index <= text.length - trimmed.length + 2)
    .map((item) => item.character.id);
}

function mentionedActorsBeforeFirstAction(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const actionMatch = /(帮|替|给|发|画|拍|写|说|讲|回答|回应|回复|解释|评价|吐槽|问|出题|总结|分析|展开)/i.exec(text);
  if (!actionMatch) return [];
  return mentioned
    .filter((item) => item.index < actionMatch.index)
    .map((item) => item.character.id);
}

function resolveActionActors(text: string, characters: AICharacter[], imageRequest: boolean) {
  const mentioned = sortByNamePosition(text, characters);
  if (!mentioned.length) return [];
  const prefixActors = namesAfterDirectivePrefix(text, mentioned);
  if (prefixActors.length) return unique(prefixActors);
  const actorsBeforeAction = mentionedActorsBeforeFirstAction(text, mentioned);
  if (actorsBeforeAction.length > 1 && (imageRequest || isDirectSpeakRequest(text))) return unique(actorsBeforeAction);
  const leadingActors = startsWithMentionedActor(text, mentioned);
  if (leadingActors.length && (imageRequest || isDirectSpeakRequest(text))) return unique(leadingActors);
  const beforeActionActors = firstMentionBeforeAction(text, mentioned);
  if (beforeActionActors.length && (imageRequest || isDirectSpeakRequest(text))) return unique(beforeActionActors);
  if (isDirectSpeakRequest(text) && mentioned.length === 1) return [mentioned[0].character.id];
  return [];
}

function stripLeadingActorNames(text: string, characters: AICharacter[], actorIds: string[]) {
  let next = text;
  for (const actorId of actorIds) {
    const name = characters.find((character) => character.id === actorId)?.name;
    if (!name) continue;
    next = next.replace(new RegExp(`^\\s*${escapeRegExp(name)}\\s*[,，、和与跟]?\\s*`), '');
  }
  return normalizeText(next);
}

function resolveSubjectText(text: string, characters: AICharacter[], subjectActorIds: string[], actorIds: string[]) {
  const subjectNames = subjectActorIds
    .map((id) => characters.find((character) => character.id === id)?.name)
    .filter(Boolean) as string[];
  if (subjectNames.length) return subjectNames.join('、');
  const withoutActors = stripLeadingActorNames(text, characters, actorIds);
  return withoutActors || text;
}

export function parseUserGuidanceIntent(text: string, characters: AICharacter[]): UserGuidanceIntent | null {
  const rawText = normalizeText(text);
  if (!rawText) return null;
  const mentionedActorIds = findMentionedActors(rawText, characters);
  const imageRequest = isImageRequest(rawText);
  const collectiveActorIds = !imageRequest && isCollectiveActorRequest(rawText) ? allActorIds(characters) : [];
  const actorIds = collectiveActorIds.length ? collectiveActorIds : resolveActionActors(rawText, characters, imageRequest);
  const subjectActorIds = imageRequest ? unique(mentionedActorIds.filter((id) => !actorIds.includes(id))) : [];
  const directRequest = Boolean(actorIds.length) || isDirectSpeakRequest(rawText);
  if (!imageRequest && !directRequest && !mentionedActorIds.length) {
    return {
      kind: 'topic_shift',
      rawText,
      actorIds: [],
      mentionedActorIds,
      focusText: rawText,
      beatType: rawText.length > 90 ? 'summarize' : 'invite',
      pressure: rawText.length > 90 ? 0.66 : 0.58,
      maxTurns: 3,
      reason: '用户正在明确改变群聊焦点。',
    };
  }

  if (imageRequest) {
    const actionText = stripLeadingActorNames(rawText, characters, actorIds);
    const subjectText = resolveSubjectText(rawText, characters, subjectActorIds, actorIds);
    return {
      kind: 'media_request',
      rawText,
      actorIds,
      mentionedActorIds,
      mediaRequest: {
        kind: 'image',
        subjectActorIds,
        subjectText,
        actionText: actionText || rawText,
      },
      focusText: rawText,
      beatType: 'answer',
      pressure: actorIds.length ? 0.98 : 0.86,
      maxTurns: actorIds.length ? Math.max(1, actorIds.length) : 2,
      reason: actorIds.length ? '用户指定角色发送或创作图片。' : '用户请求群聊产生图片内容。',
    };
  }

  if (actorIds.length || mentionedActorIds.length) {
    return {
      kind: actorIds.length ? 'direct_reply' : 'topic_shift',
      rawText,
      actorIds,
      mentionedActorIds,
      focusText: rawText,
      beatType: actorIds.length ? 'answer' : 'invite',
      pressure: collectiveActorIds.length ? 0.96 : actorIds.length ? 0.92 : 0.7,
      maxTurns: actorIds.length ? Math.max(1, actorIds.length) : 3,
      reason: collectiveActorIds.length ? '用户要求所有角色分别执行同一个任务。' : actorIds.length ? '用户点名角色回应。' : '用户提到角色并改变当前讨论焦点。',
    };
  }

  return null;
}

export function getGuidanceTargetActorIds(guidance: UserGuidanceIntent | null | undefined) {
  if (!guidance) return [];
  if (guidance.actorIds.length) return guidance.actorIds;
  if (guidance.kind === 'media_request') return guidance.mentionedActorIds;
  return guidance.mentionedActorIds;
}

function knownUniqueIds(ids: Array<string | undefined>, characters: AICharacter[]) {
  const known = new Set(characters.map((character) => character.id));
  return ids.filter((id, index, array): id is string => Boolean(id && known.has(id) && array.indexOf(id) === index));
}

export function getGuidanceMemoryTargetActorIds(
  guidance: UserGuidanceIntent | null | undefined,
  characters: AICharacter[],
  speakerId?: string | null,
) {
  if (!guidance) return [];
  const actorIds = knownUniqueIds(guidance.actorIds || [], characters);
  const subjectActorIds = knownUniqueIds(guidance.mediaRequest?.subjectActorIds || [], characters);
  const mentionedActorIds = knownUniqueIds(guidance.mentionedActorIds || [], characters);
  const withoutSpeaker = (ids: string[]) => speakerId ? ids.filter((id) => id !== speakerId) : ids;
  const candidateGroups = [
    withoutSpeaker(subjectActorIds),
    withoutSpeaker(mentionedActorIds.filter((id) => !actorIds.includes(id))),
    withoutSpeaker(mentionedActorIds),
    withoutSpeaker(actorIds),
  ];
  return candidateGroups.find((group) => group.length) || [];
}
