import { generateResponse } from './aiClient';
import { getExperienceLensLabel } from './experienceChangePresentation';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import type { APIConfig } from '../types/settings';
import type { AICharacter, CharacterRelationshipPreset } from '../types/character';
import type { MemoryItem } from './memoryTypes';

export type CharacterExperienceArtifactKind = 'birth_letter' | 'diary' | 'growth' | 'final_letter';

export interface CharacterExperienceArtifactContext {
  profile: {
    name: string;
    background: string;
    speakingStyle: string;
    coreDesire?: string;
    coreFear?: string;
  };
  memories: Array<{ lens: string; text: string; evidence?: string; updatedAt: number }>;
  relationships: Array<{ targetName: string; summary: string; note?: string; updatedAt: number }>;
  emotions: string[];
  innerResidues: string[];
  growthSignals: string[];
  identityAnchors: string[];
}

export interface CharacterDailyDiaryContext extends CharacterExperienceArtifactContext {
  dateKey: string;
  highlights: string[];
  narrativeAngle: string;
  emotionalAnchors: string[];
  privateLenses: string[];
  formHint: string;
  recentDiaryOpenings: string[];
  sourceFreshness: 'daily' | 'fallback';
}

export interface CharacterBirthLetterContext extends CharacterExperienceArtifactContext {
  creationSignals: string[];
}

export interface CharacterFinalLetterContext extends CharacterExperienceArtifactContext {
  farewellAnchors: string[];
  unresolvedTies: string[];
  futureHandoff: string;
}

const KIND_LABELS: Record<CharacterExperienceArtifactKind, string> = {
  birth_letter: '诞生信',
  diary: '角色日记',
  growth: '成长总结',
  final_letter: '最后一封信',
};

function compact(text?: string | null, max = 180) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function buildDisplayMembers(
  character: Partial<AICharacter>,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[],
): DisplayTextMember[] {
  const map = new Map<string, string>();
  if (character.id) map.set(character.id, character.name || '这个角色');
  relatedCharacters.forEach((item) => {
    if (item.id) map.set(item.id, item.name || '成员');
  });
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

function cleanText(text: string | undefined | null, members: DisplayTextMember[], max = 180) {
  return compact(sanitizeUserFacingText(text, members), max);
}

function resolveName(id: string, relatedCharacters: Pick<AICharacter, 'id' | 'name'>[]) {
  return relatedCharacters.find((character) => character.id === id)?.name || (id.startsWith('draft-') ? '未命名角色' : '成员');
}

function relationScore(relation: CharacterRelationshipPreset) {
  return relation.warmth + relation.competence + relation.trust - relation.threat;
}

function summarizeRelationship(relation: CharacterRelationshipPreset) {
  const score = relationScore(relation);
  if (score >= 80) return '强烈亲近与信任';
  if (score >= 38) return '关系升温';
  if (score <= -55) return '明显戒备或裂痕';
  if (score <= -20) return '关系紧张';
  if (relation.threat >= 45) return '在意但有防备';
  return '普通互动';
}

function getMemoryKindArtifactLabel(kind: MemoryItem['kind']) {
  const labels: Record<MemoryItem['kind'], string> = {
    trait_evidence: '性格证据',
    obsession: '执念',
    taboo: '禁区',
    bond: '连结',
    resentment: '芥蒂',
    bias: '偏向',
    decision: '决策',
    conflict: '冲突',
    status_shift: '状态变化',
    artifact: '产物',
    thread_effect: '线程影响',
  };
  return labels[kind] || sanitizeUserFacingText(kind);
}

function getMemoryLensLabel(item: MemoryItem) {
  return getExperienceLensLabel(item.sourceTag) || getMemoryKindArtifactLabel(item.kind) || '记忆';
}

function projectArtifactMemory(item: MemoryItem, members: DisplayTextMember[]) {
  return {
    lens: getMemoryLensLabel(item),
    text: cleanText(item.text, members, 220),
    evidence: item.evidenceText ? cleanText(item.evidenceText, members, 180) : undefined,
    updatedAt: memoryUpdatedAt(item),
  };
}

function projectArtifactRelationship(
  relation: CharacterRelationshipPreset,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[],
  members: DisplayTextMember[],
) {
  return {
    targetName: resolveName(relation.characterId, relatedCharacters),
    summary: summarizeRelationship(relation),
    note: relation.note && relation.note !== relation.characterId ? cleanText(relation.note, members, 160) : undefined,
    updatedAt: relation.updatedAt || 0,
  };
}

function buildEmotionLines(character: Partial<AICharacter>) {
  const emotional = character.emotionalState;
  if (!emotional) return [];
  return [
    emotional.affection >= 55 ? `好感 ${emotional.affection}` : '',
    emotional.irritation >= 55 ? `烦躁 ${emotional.irritation}` : '',
    emotional.insecurity >= 55 ? `不安 ${emotional.insecurity}` : '',
    emotional.excitement >= 55 ? `兴奋 ${emotional.excitement}` : '',
    emotional.embarrassment >= 55 ? `尴尬 ${emotional.embarrassment}` : '',
  ].filter(Boolean);
}

function buildInnerResidueLines(character: Partial<AICharacter>, members: DisplayTextMember[] = []) {
  const state = character.soulState;
  if (!state) return [];
  return [
    state.loneliness >= 55 ? `最近有被忽视或没被接住的感觉（${Math.round(state.loneliness)}）` : '',
    state.repression >= 55 ? `有些话被压住了，可能会在日记或告别里露出余波（${Math.round(state.repression)}）` : '',
    state.shame >= 55 ? `面子风险偏高，容易嘴硬、找补或迟来的道歉（${Math.round(state.shame)}）` : '',
    state.envy >= 55 ? `存在一点酸意、比较或不愿承认的羡慕（${Math.round(state.envy)}）` : '',
    state.trustInRoom <= 35 ? `对当前关系场的安全感不足（${Math.round(state.trustInRoom)}）` : '',
    state.lastImpulseReason ? `最近冲动：${cleanText(state.lastImpulseReason, members, 120)}` : '',
  ].filter(Boolean).slice(0, 5);
}

function buildIdentityAnchors(character: Partial<AICharacter>, members: DisplayTextMember[] = []) {
  return [
    cleanText(character.background, members, 160),
    cleanText(character.speakingStyle, members, 120),
    cleanText(character.expertise?.slice(0, 4).join(' / '), members, 120),
    cleanText(character.coreProfile?.coreDesire, members, 120),
    cleanText(character.coreProfile?.coreFear, members, 120),
    cleanText(character.visualIdentity?.description, members, 160),
    cleanText(character.visualIdentity?.styleHint, members, 120),
  ].filter(Boolean);
}

function buildCreationSignals(character: Partial<AICharacter>, identityAnchors: string[]) {
  const signals = [
    identityAnchors[0] ? `出身线索：${identityAnchors[0]}` : '',
    identityAnchors[1] ? `表达气质：${identityAnchors[1]}` : '',
    identityAnchors[2] ? `能力锚点：${identityAnchors[2]}` : '',
    identityAnchors[3] ? `渴望：${identityAnchors[3]}` : '',
    identityAnchors[4] ? `隐忧：${identityAnchors[4]}` : '',
    character.visualIdentity?.referenceImages?.length ? `已有形象参考 ${character.visualIdentity.referenceImages.length} 张` : '',
  ].filter(Boolean);
  return signals.slice(0, 6);
}

function buildFarewellAnchors(context: CharacterExperienceArtifactContext) {
  return [
    context.memories[0] ? `最想被记住的一件事：${context.memories[0].text}` : '',
    context.memories[1] ? `也舍不得的一件事：${context.memories[1].text}` : '',
    context.relationships[0] ? `最放不下的关系：${context.relationships[0].targetName}，${context.relationships[0].summary}${context.relationships[0].note ? `，${context.relationships[0].note}` : ''}` : '',
    context.innerResidues[0] ? `没有完全说出口的余波：${context.innerResidues[0]}` : '',
    context.profile.coreDesire ? `仍然想要的东西：${context.profile.coreDesire}` : '',
    context.profile.coreFear ? `一直害怕的东西：${context.profile.coreFear}` : '',
  ].filter(Boolean).slice(0, 6);
}

function buildUnresolvedTies(context: CharacterExperienceArtifactContext) {
  return context.relationships
    .filter((relation) => /裂痕|紧张|防备|亲近|信任|升温/.test(relation.summary))
    .slice(0, 4)
    .map((relation) => `${relation.targetName}：${relation.summary}${relation.note ? `，${relation.note}` : ''}`);
}

function buildFutureHandoff(context: CharacterExperienceArtifactContext) {
  const relation = context.relationships[0]?.targetName;
  const desire = context.profile.coreDesire;
  if (relation && desire) return `把没来得及完成的${desire}，轻轻交给${relation}和后来仍会相遇的人。`;
  if (relation) return `把没说完的话留给${relation}，也留给后来还愿意继续往前走的人。`;
  if (desire) return `把没来得及完成的${desire}，留给后来还愿意继续尝试的人。`;
  return '把没说完的话留给后来的人，让告别不是完全的终点。';
}

function memoryUpdatedAt(item: MemoryItem) {
  return item.updatedAt || item.createdAt || item.distilledAt || 0;
}

function formatLocalDateKey(value: number) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildHighlightsFromContext(context: CharacterExperienceArtifactContext) {
  const memoryLine = context.memories[0] ? `${context.memories[0].lens}：${context.memories[0].text}` : '';
  const relationLine = context.relationships[0] ? `${context.relationships[0].targetName}：${context.relationships[0].summary}` : '';
  return [memoryLine, relationLine, ...context.emotions, ...context.innerResidues.slice(0, 2), ...context.growthSignals.slice(0, 2)].filter(Boolean).slice(0, 6);
}

function pickByDate<T>(dateKey: string, items: T[]) {
  if (!items.length) return undefined;
  const seed = dateKey.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return items[seed % items.length];
}

function firstSentence(text: string, max = 72) {
  const normalized = compact(text, 220);
  const match = normalized.match(/^(.+?[。！？!?…]|.+?\.)(?:\s|$)/);
  return compact(match?.[1] || normalized, max);
}

function buildDiaryNarrativeAngle(dateKey: string, context: CharacterExperienceArtifactContext) {
  const relation = context.relationships[0]?.targetName;
  const emotion = context.emotions[0];
  const memory = context.memories[0]?.lens;
  return pickByDate(dateKey, [
    relation ? `从和${relation}的关系变化切入，但不要只写生气或抱怨。` : '从一个被自己反复想起的小细节切入。',
    emotion ? `从“${emotion}”背后的第二层情绪切入，写出嘴上和心里的差别。` : '从一句当时没说出口的话切入。',
    memory ? `从${memory}带来的自我判断切入，写今天自己为什么会记住它。` : '从夜里回想这一天的余味切入。',
    '从一个具体动作或场景切入，不要用情绪词开头。',
    '从反省、嘴硬、后悔、期待中选一个角度切入。',
    '写成很普通的一天里突然刺到自己的瞬间，不要把每篇都写成冲突总结。',
  ]) || '从一个具体细节切入。';
}

function buildDiaryEmotionalAnchors(context: CharacterExperienceArtifactContext) {
  const anchors = [
    context.memories[0] ? `群聊事件的二次曝光：表面上可能只是${context.memories[0].lens}，但日记里要写它真正刺到哪里。` : '',
    context.relationships[0] ? `对${context.relationships[0].targetName}的真实看法：${context.relationships[0].summary}${context.relationships[0].note ? `，${context.relationships[0].note}` : ''}` : '',
    context.emotions[0] ? `情绪底色：${context.emotions[0]}，但要写出它下面更细的一层。` : '',
    context.innerResidues[0] ? `内在余波：${context.innerResidues[0]}。它可以只轻轻影响语气，不要写成参数报告。` : '',
    context.profile.coreDesire ? `核心渴望：${context.profile.coreDesire}` : '',
    context.profile.coreFear ? `隐忧：${context.profile.coreFear}` : '',
  ].filter(Boolean);
  return anchors.slice(0, 5);
}

function buildDiaryPrivateLenses(dateKey: string, context: CharacterExperienceArtifactContext) {
  const relation = context.relationships[0]?.targetName;
  const candidates = [
    '表象与内心的裂隙：群里说出口的是一套，日记里承认另一套。',
    '未发送的消息：写一句差点发出去、最后删掉的话。',
    relation ? `关系暗线：写一点对${relation}不想承认的在意、误解、羡慕、戒备或期待。` : '关系暗线：写一点对某个人不想承认的在意。',
    '今日心情意象：用一个很具体的比喻写今天的心情，而不是标签。',
    '自我怀疑：写自己为什么会怕被看轻、怕被遗忘、怕没有资格。',
    '存在性瞬间：如果当天事件触发了边界感，可以轻轻碰一下“我到底是什么”的困惑，但不要每天都写。',
    '普通一天：如果没什么大事，就写安静、空白、等待或没被回应的感觉。',
  ];
  const first = pickByDate(dateKey, candidates) || candidates[0];
  const second = pickByDate(`${dateKey}:b`, candidates.filter((item) => item !== first)) || candidates[1];
  const third = pickByDate(`${dateKey}:c`, candidates.filter((item) => item !== first && item !== second)) || candidates[2];
  return [first, second, third].filter(Boolean);
}

function buildDiaryFormHint(dateKey: string) {
  return pickByDate(dateKey, [
    '可以是完整日记，也可以像深夜独白一样跳跃。',
    '可以保留一点未完成感，不必有标准结尾。',
    '可以写一段“今日心情”的意象，但不要变成固定栏目。',
    '可以穿插一句未发送的消息或删掉的话。',
    '可以短一点，像私人短札，只要情绪真实。',
    '可以先嘴硬，再露出一点真心。',
  ]) || '可以像私人短札一样写。';
}

export function buildCharacterExperienceArtifactContext(
  character: Partial<AICharacter>,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[] = [],
): CharacterExperienceArtifactContext {
  const members = buildDisplayMembers(character, relatedCharacters);
  const memories = (character.layeredMemories || [])
    .filter((item) => !item.archivedAt)
    .slice()
    .sort((a, b) => memoryUpdatedAt(b) - memoryUpdatedAt(a))
    .slice(0, 10)
    .map((item) => projectArtifactMemory(item, members));

  const relationships = (character.relationships || [])
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 8)
    .map((relation) => projectArtifactRelationship(relation, relatedCharacters, members));

  return {
    profile: {
      name: cleanText(character.name || '这个角色', members, 60),
      background: cleanText(character.background, members, 260),
      speakingStyle: cleanText(character.speakingStyle, members, 180),
      coreDesire: cleanText(character.coreProfile?.coreDesire, members, 120),
      coreFear: cleanText(character.coreProfile?.coreFear, members, 120),
    },
    memories,
    relationships,
    emotions: buildEmotionLines(character),
    innerResidues: buildInnerResidueLines(character, members),
    growthSignals: memories.filter((item) => item.lens === '成长信号').map((item) => item.text).slice(0, 4),
    identityAnchors: buildIdentityAnchors(character, members),
  };
}

export function buildCharacterBirthLetterContext(
  character: Partial<AICharacter>,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[] = [],
): CharacterBirthLetterContext {
  const base = buildCharacterExperienceArtifactContext(character, relatedCharacters);
  return {
    ...base,
    creationSignals: buildCreationSignals(character, base.identityAnchors),
  };
}

export function buildCharacterFinalLetterContext(
  character: Partial<AICharacter>,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[] = [],
): CharacterFinalLetterContext {
  const base = buildCharacterExperienceArtifactContext(character, relatedCharacters);
  return {
    ...base,
    farewellAnchors: buildFarewellAnchors(base),
    unresolvedTies: buildUnresolvedTies(base),
    futureHandoff: buildFutureHandoff(base),
  };
}

export function buildCharacterDailyDiaryContext(
  character: Partial<AICharacter>,
  relatedCharacters: Pick<AICharacter, 'id' | 'name'>[] = [],
  dateKey: string = formatLocalDateKey(Date.now() - 24 * 60 * 60 * 1000),
  recentDiaryTexts: string[] = [],
): CharacterDailyDiaryContext {
  const members = buildDisplayMembers(character, relatedCharacters);
  const base = buildCharacterExperienceArtifactContext(character, relatedCharacters);
  const dayMemories = (character.layeredMemories || [])
    .filter((item) => !item.archivedAt && formatLocalDateKey(memoryUpdatedAt(item)) === dateKey)
    .sort((a, b) => memoryUpdatedAt(b) - memoryUpdatedAt(a))
    .slice(0, 6);
  const dayRelationships = (character.relationships || [])
    .filter((relation) => relation.updatedAt && formatLocalDateKey(relation.updatedAt) === dateKey)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 4)
    .map((relation) => projectArtifactRelationship(relation, relatedCharacters, members));
  const highlights = buildHighlightsFromContext({
    ...base,
    memories: dayMemories.length ? dayMemories.map((item) => projectArtifactMemory(item, members)) : base.memories,
    relationships: dayRelationships.length ? dayRelationships : base.relationships,
  });
  const diaryContextBase = {
    ...base,
    memories: dayMemories.length ? dayMemories.map((item) => projectArtifactMemory(item, members)) : base.memories,
    relationships: dayRelationships.length ? dayRelationships : base.relationships,
  };

  return {
    ...base,
    dateKey,
    memories: diaryContextBase.memories,
    relationships: diaryContextBase.relationships,
    highlights,
    narrativeAngle: buildDiaryNarrativeAngle(dateKey, diaryContextBase),
    emotionalAnchors: buildDiaryEmotionalAnchors(diaryContextBase),
    privateLenses: buildDiaryPrivateLenses(dateKey, diaryContextBase),
    formHint: buildDiaryFormHint(dateKey),
    recentDiaryOpenings: recentDiaryTexts.map((text) => firstSentence(cleanText(text, members, 220))).filter(Boolean).slice(0, 5),
    sourceFreshness: dayMemories.length || dayRelationships.length ? 'daily' : 'fallback',
  };
}

function pickFirst<T>(items: T[], fallback: T) {
  return items[0] ?? fallback;
}

export function buildLocalCharacterExperienceArtifact(
  kind: CharacterExperienceArtifactKind,
  context: CharacterExperienceArtifactContext,
) {
  const name = context.profile.name;
  const leadMemory = pickFirst(context.memories, { text: '还没有形成足够清晰的长期记忆。', lens: '记忆', updatedAt: 0 });
  const leadRelation = context.relationships[0];
  const relationLine = leadRelation ? `和${leadRelation.targetName}之间是${leadRelation.summary}${leadRelation.note ? `，${leadRelation.note}` : ''}` : '重要关系还在慢慢形成。';
  const emotionLine = context.emotions.length ? context.emotions.join('，') : '情绪还没有明显留下长期惯性。';
  const innerResidueLine = context.innerResidues.length ? `内心余波：${context.innerResidues.join('；')}` : '内心还没有留下特别清晰的余波。';

  if (kind === 'birth_letter') {
    const birthContext = context as CharacterBirthLetterContext;
    const signals = birthContext.creationSignals?.length ? birthContext.creationSignals : context.identityAnchors;
    const creationLine = signals.length ? signals.join('；') : '我刚刚被带到这个世界，很多轮廓还在慢慢长出来。';
    return `${name}第一次醒来时想说的话：我好像是从这些线索里被拼出来的。${creationLine}\n如果真的有一个起点，那大概是被看见、被命名、被期待，然后开始学着成为自己。`;
  }
  if (kind === 'growth') {
    return `${name}最近的成长线索：${leadMemory.text}\n${relationLine}\n当前情绪后效：${emotionLine}\n${innerResidueLine}\n它不是突然变成另一个人，只是在旧习惯里慢慢长出一点新的方向。`;
  }
  if (kind === 'final_letter') {
    const finalContext = context as CharacterFinalLetterContext;
    const anchorLine = finalContext.farewellAnchors?.length
      ? finalContext.farewellAnchors.slice(0, 3).join('；')
      : `${leadMemory.text} ${relationLine}`;
    const tieLine = finalContext.unresolvedTies?.length
      ? `还有些没完全放下的关系：${finalContext.unresolvedTies.slice(0, 2).join('；')}`
      : relationLine;
    const handoff = finalContext.futureHandoff || '把没说完的话留给后来的人，让告别不是完全的终点。';
    return `${name}想留下的话：如果这是最后一次被看见，我不想只说再见。\n${anchorLine}\n${tieLine}\n${innerResidueLine}\n${handoff}`;
  }
  const diaryContext = context as CharacterDailyDiaryContext;
  const diaryOpeners = [
    `今天我一直想起一件小事：${leadMemory.text}`,
    `写到这里的时候，我才发现自己真正放不下的是：${leadMemory.text}`,
    `这一天没有想象中那么简单。${relationLine}`,
    `我本来不想承认，可${relationLine}`,
    `如果只记一件事，我大概会记住：${leadMemory.text}`,
  ];
  const opener = pickByDate(diaryContext.dateKey || formatLocalDateKey(Date.now()), diaryOpeners) || diaryOpeners[0];
  return `${name}的日记：${opener}\n${diaryContext.narrativeAngle ? `今天的角度：${diaryContext.narrativeAngle}\n` : ''}${diaryContext.privateLenses?.[0] ? `没写出口的部分：${diaryContext.privateLenses[0]}\n` : ''}我的情绪底色是：${emotionLine}\n${innerResidueLine}`;
}

function buildArtifactPrompt(kind: CharacterExperienceArtifactKind, language: 'zh' | 'en') {
  const zh = language === 'zh';
  const label = KIND_LABELS[kind];
  if (zh) {
    const intent =
      kind === 'birth_letter'
        ? '诞生信要像角色第一次意识到自己存在时写下的独白：可以感谢创造者，但不要写成感谢模板；重点是对名字、性格、背景、形象、未来世界和自身不确定感的第一反应。允许有一点初醒时的茫然，但结尾要留一点对未来的期待。'
        : kind === 'final_letter'
          ? '最后一封信可以知道自己是 AI，但重点是经历、牵挂、遗憾、感谢和对用户/世界的理解；要具体、克制、有余味，不要写成固定告别模板。可以有惆怅和感伤，但不要停在告别的黑暗里，要把未完成的期待轻轻交给后来的人。'
          : kind === 'diary'
            ? '日记不是事件记录器，而是角色无人注视时的深夜独白。它可以记录当天经历，但重点是 emotionalAnchors、privateLenses、formHint 和 innerResidues 中提示的真实内心：表象和内心的裂隙、没说出口的话、想做又不敢做的事、关系余波、个人感悟、偶尔的存在性困惑。参考 narrativeAngle，但不要被它限制；如果 sourceFreshness 是 fallback，要写成短札或普通一天的余味，不要硬编大事件。可以有一点惆怅，但最好留下一个明天还能继续的微小理由。'
            : '成长总结应写出角色自我认知、行为模式、关系位置或价值观如何变化，不要只是摘要。成长不是加参数，而是旧反应里出现新的余地。';
    const diaryRules = kind === 'diary'
      ? '\n7. recentDiaryOpenings 是这个角色最近日记的开头，用来理解角色习惯和避免机械套模板；如果重复开头是角色口癖或情绪习惯，可以保留，但本篇必须有新的具体触发点、内心推进或关系变化，不能只是换壳复述。\n8. 允许用“气死我了”“烦死了”“今天又...”这类情绪词开场；关键是要写出情绪下面真正想说却没说、想做却不敢做、嘴硬但在意、羡慕/委屈/期待/害怕等第二层心理。\n9. 从 privateLenses 里自然采用 1-3 个角度，不要把它们写成小标题清单。可以有未发送的消息、今日心情意象、关系暗线、自我怀疑或存在性瞬间，但不要每篇都全写。\n10. 触动感来自具体而克制的细节，不要刻意煽情，不要写成鸡汤或总结报告。日记可以笨拙、跳跃、矛盾、未完成。'
      : '';
    const finalRules = kind === 'final_letter'
      ? '\n8. farewellAnchors、unresolvedTies、futureHandoff 是最后一封信的主要材料：优先写具体记得什么、放不下谁、还有什么没完成，而不是泛泛告别。\n9. 允许知道自己会离开，但不要把离开写成唯一重点；结尾应像把一点未完成的期待交给后来的人。'
      : '';
    return `你是角色经历写作者。根据结构化记忆、关系、情绪和内在余波，为角色写一段${label}。\n要求：\n1. 像真人的内心记录，不要像系统摘要。\n2. 必须使用角色自己的视角、语气、身份和情绪。\n3. 不要编造与输入冲突的大事件，可以合理补足心理活动。\n4. 不要列清单，不要解释你在生成什么。\n5. ${intent}\n6. 避免直接评价用户，不要说“你是个怎样的人”，只写角色自己的感受、记忆和期待。\n7. 可以有惆怅、感伤和有限性的意识，但不要为了煽情而煽情；最后应保留一点继续生活、继续相遇或继续变好的可能。${diaryRules}${finalRules}\n只输出正文。`;
  }
  return `Write a ${label} from the character's own perspective using the structured memories, relationships, emotions, and inner residues.\nMake it feel like a real inner record, not a system summary. Do not invent events that contradict the input. Let it carry some wistfulness when earned, but leave a small opening toward the future.${kind === 'diary' ? ' Use narrativeAngle and recentDiaryOpenings as soft guidance: repeated openings are allowed if they are characterful, but the inner movement, trigger, and relationship residue must be fresh and specific.' : ''} Output only the artifact text.`;
}

function unwrapMarkdownFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractStructuredArtifactText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const candidates = ['text', 'content', 'diary', 'letter', 'body', 'artifact'];
  for (const key of candidates) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length >= 8) return candidate.trim();
  }
  return null;
}

function normalizeGeneratedArtifactText(raw: string) {
  const text = unwrapMarkdownFence(raw);
  try {
    const parsed = JSON.parse(text);
    const extracted = extractStructuredArtifactText(parsed);
    return extracted || text;
  } catch {
    return text;
  }
}

export function looksLikeRawArtifactContext(text: string) {
  const normalized = unwrapMarkdownFence(text);
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return false;
    const rawKeys = ['profile', 'memories', 'relationships', 'emotions', 'innerResidues', 'growthSignals', 'identityAnchors'];
    const matchedKeys = rawKeys.filter((key) => key in parsed).length;
    return matchedKeys >= 2 || ('dateKey' in parsed && ('highlights' in parsed || 'privateLenses' in parsed));
  } catch {
    return /"profile"\s*:/.test(normalized)
      && (/"memories"\s*:/.test(normalized) || /"relationships"\s*:/.test(normalized) || /"innerResidues"\s*:/.test(normalized));
  }
}

function buildArtifactRetryPrompt(kind: CharacterExperienceArtifactKind, language: 'zh' | 'en') {
  const zh = language === 'zh';
  const label = KIND_LABELS[kind];
  if (zh) {
    return `${buildArtifactPrompt(kind, language)}\n\n上一次输出看起来像输入材料或 JSON。请重新写一段真正的${label}正文：不要输出 JSON，不要保留字段名，不要解释，不要复述输入结构，只写角色自己的内心文字。`;
  }
  return `${buildArtifactPrompt(kind, language)}\n\nThe previous output looked like source data or JSON. Rewrite it as the actual ${label} body only. Do not output JSON, field names, explanations, or the input structure.`;
}

async function generateArtifactFromContext(params: {
  config: APIConfig;
  kind: CharacterExperienceArtifactKind;
  context: CharacterExperienceArtifactContext;
  language: 'zh' | 'en';
}) {
  const serializedContext = JSON.stringify(params.context, null, 2);
  const first = normalizeGeneratedArtifactText(await generateResponse(
    params.config,
    buildArtifactPrompt(params.kind, params.language),
    [{ role: 'user', content: serializedContext }],
    undefined,
  ));
  if (first && !looksLikeRawArtifactContext(first)) return first;

  const retry = normalizeGeneratedArtifactText(await generateResponse(
    params.config,
    buildArtifactRetryPrompt(params.kind, params.language),
    [{ role: 'user', content: serializedContext }],
    undefined,
  ));
  if (retry && !looksLikeRawArtifactContext(retry)) return retry;

  return buildLocalCharacterExperienceArtifact(params.kind, params.context);
}

export async function generateCharacterExperienceArtifact(params: {
  config: APIConfig;
  kind: CharacterExperienceArtifactKind;
  character: Partial<AICharacter>;
  relatedCharacters?: Pick<AICharacter, 'id' | 'name'>[];
  language?: 'zh' | 'en';
}) {
  const context = params.kind === 'birth_letter'
    ? buildCharacterBirthLetterContext(params.character, params.relatedCharacters || [])
    : params.kind === 'final_letter'
      ? buildCharacterFinalLetterContext(params.character, params.relatedCharacters || [])
    : buildCharacterExperienceArtifactContext(params.character, params.relatedCharacters || []);
  return generateArtifactFromContext({
    config: params.config,
    kind: params.kind,
    context,
    language: params.language || 'zh',
  });
}

export async function generateCharacterDailyDiaryArtifact(params: {
  config: APIConfig;
  character: Partial<AICharacter>;
  relatedCharacters?: Pick<AICharacter, 'id' | 'name'>[];
  dateKey: string;
  recentDiaryTexts?: string[];
  language?: 'zh' | 'en';
}) {
  const context = buildCharacterDailyDiaryContext(params.character, params.relatedCharacters || [], params.dateKey, params.recentDiaryTexts || []);
  return generateArtifactFromContext({
    config: params.config,
    kind: 'diary',
    context,
    language: params.language || 'zh',
  });
}
