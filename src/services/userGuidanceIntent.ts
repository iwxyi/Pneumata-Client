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
  hardConstraintActorIds?: string[];
  suppressedActorIds?: string[];
  deferredActorIds?: string[];
  hasHardConstraints?: boolean;
  mediaRequest?: UserGuidanceMediaRequest;
  voiceRequest?: boolean;
  focusText: string;
  beatType: DirectorBeatType;
  pressure: number;
  maxTurns: number;
  minTargetTurns?: number;
  reason: string;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(ids: string[]) {
  return ids.filter((id, index, array) => id && array.indexOf(id) === index);
}

function normalizeActorAlias(value: string) {
  return value.replace(/\s+/g, '').trim();
}

function buildActorAliasCandidates(character: AICharacter) {
  const name = normalizeActorAlias(character.name || '');
  if (!name) return [];
  const aliases = new Set<string>([name]);
  const latinTail = name.match(/[A-Za-z][A-Za-z0-9_-]{1,20}$/)?.[0];
  if (latinTail) aliases.add(latinTail);
  const rolePrefixMatch = name.match(/(?:博主|达人|编辑|改造师|买手|主播|记者|律师|医生|老师|教授|工程师|设计师|摄影师|画师|作家|编剧|导演|主持人|师傅|大哥|姐姐|哥哥|妹妹)([\u4e00-\u9fff]{2,4})$/);
  if (rolePrefixMatch?.[1]) aliases.add(rolePrefixMatch[1]);
  if (/^[\u4e00-\u9fff]{4,}$/.test(name)) {
    const suffix = name.slice(-2);
    if (!/^(老师|教授|医生|律师|编辑|记者|导演|博主|达人|买手|主播|画师|作家|师傅|大哥|姐姐|哥哥|妹妹)$/.test(suffix)) {
      aliases.add(suffix);
    }
  }
  return Array.from(aliases).filter((alias) => alias.length >= 2);
}

function buildUniqueActorAliases(characters: AICharacter[]) {
  const owners = new Map<string, AICharacter[]>();
  characters.forEach((character) => {
    buildActorAliasCandidates(character).forEach((alias) => {
      const list = owners.get(alias) || [];
      list.push(character);
      owners.set(alias, list);
    });
  });
  const result = new Map<string, AICharacter>();
  owners.forEach((list, alias) => {
    const uniqueIds = new Set(list.map((item) => item.id));
    if (uniqueIds.size === 1) result.set(alias, list[0]);
  });
  return result;
}

function sortByNamePosition(text: string, characters: AICharacter[]) {
  const normalizedText = normalizeActorAlias(text);
  const aliases = buildUniqueActorAliases(characters);
  const earliestByActor = new Map<string, { character: AICharacter; index: number; alias: string }>();
  aliases.forEach((character, alias) => {
    const index = normalizedText.indexOf(alias);
    if (index < 0) return;
    const existing = earliestByActor.get(character.id);
    if (!existing || index < existing.index || (index === existing.index && alias.length > existing.alias.length)) {
      earliestByActor.set(character.id, { character, index, alias });
    }
  });
  return Array.from(earliestByActor.values()).sort((a, b) => a.index - b.index || b.alias.length - a.alias.length);
}

function findMentionedActors(text: string, characters: AICharacter[]) {
  return sortByNamePosition(text, characters).map((item) => item.character.id);
}

function isImageRequest(text: string) {
  const nouns = /(图片|照片|相片|图像|配图|证件照|自拍|海报|插画|头像|表情包)/i;
  if (!nouns.test(text)) return false;
  if (/(怎么看|咋看|什么看法|你觉得|你认为|解释|分析|识别|读取|提取|总结|翻译|看清|图里|图片里|截图里|照片里|这张|这幅|这图)/i.test(text)) return false;
  return /(发|发送|发给|给我发|来张|来个|整张|整一张|晒|拍|生成|画|绘制|做|制作|设计|创建|出一张|出个|换成|改成|修图|P图|p图|扩图|重绘)/i.test(text);
}

function isDirectSpeakRequest(text: string) {
  return /(说说|说一下|直接说|先说|说吧|说完|讲讲|回答|回应|回复|解释|评价|吐槽|问问|来一句|你来说|你来|发言|出题|写|分析|总结|展开|怎么看|咋看|什么看法|你觉得|你认为|想听.{0,16}(说|讲|回答|回复|发言|意见|看法)|轮到你)/i.test(text);
}

function hasHardConstraintText(text: string) {
  return /(预算|不超过|不能超过|以内|别忽略|不要忽略|别漏|不要漏|不能|不许|必须|一定|优先|至少|最多|只能|不要|别|记得|限制|约束|底线|边界)/i.test(text);
}

function needsShortTermTargetProtection(text: string) {
  return /(不是.{0,12}(让|叫|替)|别.{0,8}(抢|替|代)|不要.{0,8}(抢|替|代)|让.{0,12}(说完|讲完|先说)|想听.{0,16}(说|讲|回答|发言))/i.test(text);
}

function shouldProtectTargetForMultipleTurns(text: string) {
  return needsShortTermTargetProtection(text)
    || isNegatedSpeakerCorrection(text)
    || /(直接说|直接讲|先说|说吧).{0,24}(不用|别|不要|不必).{0,16}(照顾|顾及|管|理会|口径)/i.test(text);
}

function resolveMinTargetTurns(text: string) {
  if (isNegatedSpeakerCorrection(text) && /(刚才|之前|前面|想听|听).{0,18}(说|讲|回答|发言)/i.test(text)) return 2;
  return shouldProtectTargetForMultipleTurns(text) ? 2 : undefined;
}

function resolveActorGuidanceMaxTurns(params: {
  actorCount: number;
  minTargetTurns?: number;
  suppressedActorIds: string[];
  deferredActorIds: string[];
}) {
  const base = Math.max(params.minTargetTurns || 1, params.actorCount);
  if (params.suppressedActorIds.length || params.deferredActorIds.length) {
    return Math.max(base, 3);
  }
  return base;
}

function isNegatedSpeakerCorrection(text: string) {
  return /(不是|并非|没想|不想).{0,12}(让|叫|替|代)/i.test(text);
}

function isCollectiveActorRequest(text: string) {
  return /(每个人|每位|每个成员|所有人|全员|大家都|你们都|各自|分别|一人一|每人)/i.test(text)
    && isDirectSpeakRequest(text);
}

function isGroupQuestionAboutSubject(text: string) {
  return /(你们|大家|各位).{0,16}(觉得|认为|怎么看|咋看|什么看法|聊聊|说说)/i.test(text);
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
  const beforePrefix = text.slice(Math.max(0, prefixMatch.index - 4), prefixMatch.index);
  if (/(不是|并非|别|不要|不用|不该|不能|不想|没想)$/.test(beforePrefix)) return [];
  const firstActionAfterPrefix = /(帮|替|给|发|画|拍|写|说|讲|回答|回应|回复|解释|评价|吐槽|问|出题|总结|分析|展开)/i.exec(text.slice(prefixMatch.index + prefixMatch[0].length));
  const actionIndex = firstActionAfterPrefix
    ? prefixMatch.index + prefixMatch[0].length + firstActionAfterPrefix.index
    : Math.min(text.length, prefixMatch.index + 36);
  return mentioned
    .filter((item) => item.index > prefixMatch.index && item.index < actionIndex)
    .map((item) => item.character.id);
}

function namesAfterNegatedDirectivePrefix(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const negatedDirectivePattern = /(不是|并非|别|不要|不用|不该|不能|不想|没想).{0,4}(让|请|叫|安排|指定|点名|想让|替|代|抢)/gi;
  const ids: string[] = [];
  for (const prefixMatch of text.matchAll(negatedDirectivePattern)) {
    const start = prefixMatch.index ?? 0;
    const end = Math.min(text.length, start + 36);
    mentioned
      .filter((item) => item.index >= start && item.index < end)
      .forEach((item) => ids.push(item.character.id));
  }
  return unique(ids);
}

function namesAfterSoftFloorDefer(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const softDeferPattern = /(不用|不必|别|不要).{0,6}(先)?(照顾|顾及|管|理会).{0,12}(口径|说法|汇报|解释|面子|意见|态度)?/gi;
  const ids: string[] = [];
  for (const match of text.matchAll(softDeferPattern)) {
    const start = match.index ?? 0;
    const end = Math.min(text.length, start + 42);
    mentioned
      .filter((item) => item.index >= start && item.index < end)
      .forEach((item) => ids.push(item.character.id));
  }
  return unique(ids);
}

function startsWithMentionedActor(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const trimmed = text.trimStart();
  return mentioned
    .filter((item) => item.index <= text.length - trimmed.length + 2)
    .map((item) => item.character.id);
}

function explicitlyAddressedActors(text: string, mentioned: Array<{ character: AICharacter; index: number; alias?: string }>) {
  const addressSeparators = new Set([',', '，', ':', '：', '!', '！', '?', '？']);
  const sentenceBoundaries = new Set(['.', '。', '!', '！', '?', '？', ';', '；', '\n']);
  return mentioned
    .filter((item) => {
      const alias = item.alias || item.character.name;
      const before = text.slice(0, item.index).trimEnd().at(-1);
      const after = text.slice(item.index + alias.length).trimStart().at(0);
      const startsAddressClause = item.index === 0 || (before ? sentenceBoundaries.has(before) : true);
      return startsAddressClause && Boolean(after && addressSeparators.has(after));
    })
    .map((item) => item.character.id);
}

function mentionedActorsBeforeFirstAction(text: string, mentioned: Array<{ character: AICharacter; index: number }>) {
  const actionMatch = /(帮|替|给|发|画|拍|写|说|讲|回答|回应|回复|解释|评价|吐槽|问|出题|总结|分析|展开)/i.exec(text);
  if (!actionMatch) return [];
  return mentioned
    .filter((item) => item.index < actionMatch.index)
    .map((item) => item.character.id);
}

function resolveActionActors(text: string, characters: AICharacter[], imageRequest = false) {
  const mentioned = sortByNamePosition(text, characters);
  if (!mentioned.length) return [];
  const prefixActors = namesAfterDirectivePrefix(text, mentioned);
  if (prefixActors.length) return unique(prefixActors);
  const actorsBeforeAction = mentionedActorsBeforeFirstAction(text, mentioned);
  if (actorsBeforeAction.length && (imageRequest || isDirectSpeakRequest(text))) return unique(actorsBeforeAction);
  const leadingActors = startsWithMentionedActor(text, mentioned);
  if (leadingActors.length && (imageRequest || isDirectSpeakRequest(text))) return unique(leadingActors);
  const beforeActionActors = firstMentionBeforeAction(text, mentioned);
  if (beforeActionActors.length && (imageRequest || isDirectSpeakRequest(text))) return unique(beforeActionActors);
  if (isDirectSpeakRequest(text) && mentioned.length === 1) return [mentioned[0].character.id];
  return [];
}

export function parseUserGuidanceIntent(text: string, characters: AICharacter[]): UserGuidanceIntent | null {
  const rawText = normalizeText(text);
  if (!rawText) return null;
  const mentionedActorIds = findMentionedActors(rawText, characters);
  const imageRequest = isImageRequest(rawText);
  const hasHardConstraints = hasHardConstraintText(rawText);
  const minTargetTurns = resolveMinTargetTurns(rawText);
  const hardConstraintActorIds = hasHardConstraints ? mentionedActorIds : [];
  const collectiveActorIds = !imageRequest && isCollectiveActorRequest(rawText) ? allActorIds(characters) : [];
  const groupSubjectQuestion = !collectiveActorIds.length && mentionedActorIds.length > 0 && isGroupQuestionAboutSubject(rawText);
  const explicitlyAddressedActorIds = explicitlyAddressedActors(rawText, sortByNamePosition(rawText, characters));
  const actorIds = collectiveActorIds.length
    ? collectiveActorIds
    : groupSubjectQuestion
      ? []
      : explicitlyAddressedActorIds.length
        ? unique(explicitlyAddressedActorIds)
        : resolveActionActors(rawText, characters, imageRequest);
  const mentionedByPosition = sortByNamePosition(rawText, characters);
  const suppressedActorIds = namesAfterNegatedDirectivePrefix(rawText, mentionedByPosition)
    .filter((id) => !actorIds.includes(id));
  const deferredActorIds = namesAfterSoftFloorDefer(rawText, mentionedByPosition)
    .filter((id) => !actorIds.includes(id) && !suppressedActorIds.includes(id));
  // Voice intent must come from the structured guidance/model decision layer;
  // do not infer it from local keyword matching.
  const voiceRequest = false;
  const directRequest = Boolean(actorIds.length) || isDirectSpeakRequest(rawText);
  const subjectActorIds = imageRequest ? unique(mentionedActorIds.filter((id) => !actorIds.includes(id))) : [];
  if (!imageRequest && !directRequest && !mentionedActorIds.length) {
    return {
      kind: 'topic_shift',
      rawText,
      actorIds: [],
      mentionedActorIds,
      hardConstraintActorIds,
      suppressedActorIds,
      deferredActorIds,
      hasHardConstraints,
      voiceRequest,
      focusText: rawText,
      beatType: rawText.length > 90 ? 'summarize' : 'invite',
      pressure: hasHardConstraints ? 0.78 : rawText.length > 90 ? 0.66 : 0.58,
      maxTurns: hasHardConstraints ? 5 : 3,
      minTargetTurns,
      reason: hasHardConstraints ? '用户给出了需要持续遵守的群聊约束。' : '用户正在明确改变群聊焦点。',
    };
  }

  if (imageRequest) {
    const subjectNames = subjectActorIds.map((id) => characters.find((character) => character.id === id)?.name).filter(Boolean) as string[];
    return {
      kind: 'media_request', rawText, actorIds, mentionedActorIds, hardConstraintActorIds, suppressedActorIds, deferredActorIds,
      hasHardConstraints, voiceRequest, focusText: rawText, beatType: 'answer', pressure: actorIds.length ? 0.98 : 0.86,
      maxTurns: actorIds.length ? Math.max(1, actorIds.length) : 2, minTargetTurns,
      mediaRequest: { kind: 'image', subjectActorIds, subjectText: subjectNames.join('、') || rawText, actionText: rawText },
      reason: actorIds.length ? '用户指定角色发送或创作图片。' : '用户请求群聊产生图片内容。',
    };
  }

  if (actorIds.length || mentionedActorIds.length || voiceRequest) {
    return {
      kind: actorIds.length || voiceRequest ? 'direct_reply' : 'topic_shift',
      rawText,
      actorIds,
      mentionedActorIds,
      hardConstraintActorIds,
      suppressedActorIds,
      deferredActorIds,
      hasHardConstraints,
      voiceRequest,
      focusText: rawText,
      beatType: actorIds.length || voiceRequest ? 'answer' : 'invite',
      pressure: collectiveActorIds.length ? 0.96 : actorIds.length ? 0.92 : hasHardConstraints ? 0.84 : 0.7,
      maxTurns: actorIds.length ? resolveActorGuidanceMaxTurns({
        actorCount: actorIds.length,
        minTargetTurns,
        suppressedActorIds,
        deferredActorIds,
      }) : hasHardConstraints ? 5 : 3,
      minTargetTurns,
      reason: collectiveActorIds.length
        ? '用户要求所有角色分别执行同一个任务。'
        : actorIds.length
          ? '用户点名角色回应。'
          : hasHardConstraints
            ? '用户提到角色并给出了需要持续遵守的群聊约束。'
            : '用户提到角色并改变当前讨论焦点。',
    };
  }

  return null;
}

export function getGuidanceTargetActorIds(guidance: UserGuidanceIntent | null | undefined) {
  if (!guidance) return [];
  if (guidance.actorIds.length) return guidance.actorIds;
  // A persistent constraint can be about a character without asking that
  // character to speak. Explicit addressees have already been resolved into
  // actorIds; keep ordinary mentions in the guidance context only.
  if (guidance.hasHardConstraints) return [];
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
  const suppressedActorIds = knownUniqueIds(guidance.suppressedActorIds || [], characters);
  const mentionedActorIds = knownUniqueIds(guidance.mentionedActorIds || [], characters)
    .filter((id) => !suppressedActorIds.includes(id));
  const withoutSpeaker = (ids: string[]) => speakerId ? ids.filter((id) => id !== speakerId) : ids;
  const candidateGroups = [
    withoutSpeaker(subjectActorIds),
    withoutSpeaker(mentionedActorIds.filter((id) => !actorIds.includes(id))),
    withoutSpeaker(mentionedActorIds),
    withoutSpeaker(actorIds),
  ];
  return candidateGroups.find((group) => group.length) || [];
}
