import type { GroupChat, StoryBeatKind, StoryChoicePolicy, StoryCurrentSceneState } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { Message, NarrativeBlock, NarrativeTurnMetadata, StoryChoiceSuggestion, StoryEvent } from '../types/message';
import { normalizeStoryChoiceSuggestions } from './storyChoices';

const MAX_STORY_EVENTS = 12;
const MAX_CHOICES = 4;
const STORY_ASSET_LIMIT = 6;
const STORY_ASSET_TEXT_LIMIT = 56;
const CHAPTER_MEMORY_LIMIT = 260;

export interface StoryBeatPlan {
  beatKind: StoryBeatKind;
  choicePolicy: StoryChoicePolicy;
  reason: string;
}

export interface StoryAssetPatch {
  currentScene?: StoryCurrentSceneState | null;
  openQuestions: string[];
  clues: string[];
  stakes: string[];
  relationshipShifts: string[];
  chapterMemory: string;
  storyGoal?: string;
  storySituation?: string;
}

export interface NormalizeStoryEventsOptions {
  previousMessages?: Array<Pick<Message, 'content' | 'metadata' | 'senderId' | 'senderName' | 'type'>>;
}

function compactText(value: unknown, max = 1200) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function normalizeStoryChoices(value: unknown): StoryChoiceSuggestion[] {
  return normalizeStoryChoiceSuggestions(value).slice(0, MAX_CHOICES);
}

function normalizeRepeatText(text: string) {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：“”"'‘’（）()[\]{}《》<>…—\-.,!?;:]/g, '')
    .trim();
}

function buildNgrams(text: string, size = 3) {
  const grams = new Set<string>();
  if (text.length <= size) {
    if (text) grams.add(text);
    return grams;
  }
  for (let index = 0; index <= text.length - size; index += 1) {
    grams.add(text.slice(index, index + size));
  }
  return grams;
}

function textSimilarity(left: string, right: string) {
  const a = buildNgrams(normalizeRepeatText(left));
  const b = buildNgrams(normalizeRepeatText(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((gram) => {
    if (b.has(gram)) overlap += 1;
  });
  return overlap / Math.min(a.size, b.size);
}

function splitDistinctiveStoryFragments(text: string) {
  return (text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [text])
    .map((part) => normalizeRepeatText(part))
    .filter((part) => part.length >= 18);
}

function sharesDistinctiveStoryFragment(text: string, previous: string) {
  const fragments = splitDistinctiveStoryFragments(text);
  const previousFragments = splitDistinctiveStoryFragments(previous);
  if (!fragments.length || !previousFragments.length) return false;
  return fragments.some((fragment) => previousFragments.some((previousFragment) => (
    fragment.includes(previousFragment)
    || previousFragment.includes(fragment)
    || textSimilarity(fragment, previousFragment) >= 0.86
  )));
}

function isNearDuplicateStoryText(text: string, previousTexts: string[], minLength = 28) {
  const normalized = normalizeRepeatText(text);
  if (normalized.length < minLength) return false;
  return previousTexts.some((previous) => {
    const previousNormalized = normalizeRepeatText(previous);
    if (previousNormalized.length < minLength) return false;
    if (previousNormalized.includes(normalized) || normalized.includes(previousNormalized)) return true;
    if (previousNormalized.slice(0, 36) === normalized.slice(0, 36)) return true;
    if (sharesDistinctiveStoryFragment(normalized, previousNormalized)) return true;
    return textSimilarity(normalized, previousNormalized) >= 0.72;
  });
}

function isAuthorNoteStoryText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return [
    /^(接下来|下一步|后续|本轮|这一轮|这一段|本段)(?:的)?(?:剧情|故事|叙事|场景|内容|走向|分支|节拍)?(?:会|将|应该|需要|可以|要)/,
    /^(剧情|故事|叙事|场景|分支|节拍)(?:走向|安排|设计|说明|分析|总结|规划|目标|方向)/,
    /^(作者|编剧|导演|系统|旁白)(?:说明|提示|分析|安排|规划)/,
    /^(选择后|用户选择后)(?:剧情|故事|叙事|场景)?(?:会|将|应该|需要)/,
  ].some((pattern) => pattern.test(normalized));
}

function collectHistoricalStoryText(message: Pick<Message, 'content' | 'metadata'>) {
  const blocks = message.metadata?.narrativeTurn?.blocks || [];
  const blockTexts = blocks
    .filter((block) => block.displayMode !== 'hidden' && block.displayMode !== 'system_panel' && block.displayMode !== 'choice_card')
    .map((block) => compactText(block.text, 1200))
    .filter(Boolean);
  const content = compactText(message.content, 1200);
  return Array.from(new Set([...blockTexts, content])).filter(Boolean);
}

function collectHistoricalSpeechTextsByActor(messages: NormalizeStoryEventsOptions['previousMessages']) {
  const speechTextsByActor = new Map<string, string[]>();
  for (const message of messages || []) {
    const blocks = message.metadata?.narrativeTurn?.blocks || [];
    for (const block of blocks) {
      if (block.actorKind !== 'character' || block.displayMode !== 'bubble') continue;
      const speakerKey = block.characterId || block.actorId || block.actorName || 'unknown';
      const text = compactText(block.text, 600);
      if (!text) continue;
      speechTextsByActor.set(speakerKey, [...(speechTextsByActor.get(speakerKey) || []), text]);
    }
    if (message.type === 'ai' && !blocks.length) {
      const text = compactText(message.content, 600);
      if (!text) continue;
      const speakerKey = message.senderId || message.senderName || 'unknown';
      speechTextsByActor.set(speakerKey, [...(speechTextsByActor.get(speakerKey) || []), text]);
    }
  }
  return speechTextsByActor;
}

export function normalizeStoryEvents(value: unknown, options: NormalizeStoryEventsOptions = {}): StoryEvent[] {
  if (!Array.isArray(value)) return [];
  const events: StoryEvent[] = [];
  const narrationTexts: string[] = (options.previousMessages || [])
    .flatMap((message) => collectHistoricalStoryText(message));
  const speechTextsByActor = collectHistoricalSpeechTextsByActor(options.previousMessages);
  for (const raw of value.slice(0, MAX_STORY_EVENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = item.type;
    if (type === 'narration') {
      const text = compactText(item.text, 1600);
      if (text && !isAuthorNoteStoryText(text) && !isNearDuplicateStoryText(text, narrationTexts)) {
        events.push({ type, text });
        narrationTexts.push(text);
      }
      continue;
    }
    if (type === 'speech') {
      const text = compactText(item.text, 600);
      if (!text) continue;
      const characterId = compactText(item.characterId, 80) || compactText(item.actorId, 80);
      const speakerName = compactText(item.speakerName, 80) || compactText(item.actorName, 80);
      const speakerKey = characterId || speakerName || 'unknown';
      const previousSpeechTexts = speechTextsByActor.get(speakerKey) || [];
      if (isNearDuplicateStoryText(text, previousSpeechTexts, 14)) continue;
      speechTextsByActor.set(speakerKey, [...previousSpeechTexts, text]);
      events.push({
        type,
        text,
        characterId: characterId || undefined,
        speakerName: speakerName || undefined,
      });
      continue;
    }
    if (type === 'choice_point') {
      const choices = normalizeStoryChoices(item.choices);
      if (choices.length >= 2) events.push({ type, choices });
    }
  }
  return events;
}

export function hasVisibleStoryEvents(value: unknown) {
  return normalizeStoryEvents(value).some((event) => event.type === 'narration' || event.type === 'speech');
}

export function getStoryChoicesFromEvents(events: StoryEvent[]): StoryChoiceSuggestion[] {
  const seen = new Set<string>();
  const choices: StoryChoiceSuggestion[] = [];
  for (const event of events) {
    if (event.type !== 'choice_point') continue;
    for (const choice of normalizeStoryChoices(event.choices)) {
      if (seen.has(choice.label)) continue;
      seen.add(choice.label);
      choices.push(choice);
      if (choices.length >= MAX_CHOICES) return choices;
    }
  }
  return choices;
}

function findCharacterLabel(event: StoryEvent, characters: AICharacter[]) {
  if (event.characterId) {
    const character = characters.find((item) => item.id === event.characterId);
    if (character?.name) return character.name;
  }
  return event.speakerName || event.characterId || '角色';
}

export function buildStoryEventsVisibleText(events: StoryEvent[], characters: AICharacter[]) {
  return events
    .flatMap((event) => {
      if (event.type === 'narration') return event.text?.trim() ? [event.text.trim()] : [];
      if (event.type === 'speech') {
        const text = event.text?.trim();
        if (!text) return [];
        return [`${findCharacterLabel(event, characters)}：“${text.replace(/^["“]|["”]$/g, '')}”`];
      }
      return [];
    })
    .join('\n\n')
    .trim();
}

function countMatches(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern)).length;
}

export function evaluateStoryEventQuality(events: StoryEvent[]) {
  const normalized = normalizeStoryEvents(events);
  const visibleText = normalized
    .filter((event) => event.type === 'narration' || event.type === 'speech')
    .map((event) => event.text || '')
    .join(' ');
  const narrationCount = normalized.filter((event) => event.type === 'narration').length;
  const speechCount = normalized.filter((event) => event.type === 'speech').length;
  const choiceEvents = normalized.filter((event) => event.type === 'choice_point');
  const choices = choiceEvents.flatMap((event) => event.choices || []);
  const concreteSignals = countMatches(visibleText, /(门|窗|雨|血|灯|脚步|钥匙|名单|病历|档案|信|照片|袖口|走廊|房间|医院|妆台|院子|声音|气味|手指|眼神|伤口|锁)/g);
  const hookSignals = countMatches(visibleText, /(为什么|谁|哪里|真相|秘密|隐瞒|失踪|异常|危险|威胁|暴露|怀疑|背叛|来不及|脚步声|敲击声|血迹|停电|名单|钥匙|代价|风险)/g);
  const relationshipSignals = countMatches(visibleText, /(信任|怀疑|保护|试探|逼问|沉默|拒绝|靠近|远离|隐瞒|背叛|动摇|警觉|害怕|犹豫)/g);
  const labels = [
    narrationCount > 0 ? 'has_narration' : '',
    speechCount > 0 ? 'has_speech' : '',
    choices.length >= 2 ? 'has_choice_point' : '',
    concreteSignals >= 2 ? 'concrete_scene' : '',
    hookSignals > 0 ? 'has_story_hook' : '',
    relationshipSignals > 0 ? 'has_relationship_pressure' : '',
    choices.length >= 2 && choices.every((choice) => choice.risk && choice.reward) ? 'choices_have_tradeoffs' : '',
  ].filter(Boolean);
  const gaps = [
    narrationCount > 0 ? '' : 'missing_narration',
    !visibleText || concreteSignals >= 2 ? '' : 'weak_concrete_scene',
    hookSignals > 0 ? '' : 'missing_story_hook',
    speechCount > 0 ? '' : 'no_character_speech',
    choices.length && choices.length < 2 ? 'too_few_choices' : '',
    choices.length >= 2 && choices.some((choice) => !choice.risk || !choice.reward) ? 'choice_tradeoff_missing' : '',
  ].filter(Boolean);
  const score = Math.max(0, Math.min(100, Math.round(
    (narrationCount > 0 ? 20 : 0)
    + (speechCount > 0 ? 12 : 0)
    + (concreteSignals >= 2 ? 22 : concreteSignals > 0 ? 10 : 0)
    + (hookSignals > 0 ? 18 : 0)
    + (relationshipSignals > 0 ? 10 : 0)
    + (choices.length >= 2 ? 10 : 0)
    + (choices.length >= 2 && choices.every((choice) => choice.risk && choice.reward) ? 8 : 0)
  )));
  return { score, labels, gaps };
}

function storyEventToBlocks(event: StoryEvent, index: number, characters: AICharacter[]): NarrativeBlock[] {
  if (event.type === 'narration' && event.text?.trim()) {
    return [{
      id: `block-${index + 1}`,
      actorId: 'narrator',
      actorKind: 'narrator',
      kind: 'prose',
      displayMode: 'paragraph',
      text: event.text.trim(),
    }];
  }
  if (event.type === 'speech' && event.text?.trim()) {
    const characterId = event.characterId || '';
    const normalizedSpeaker = event.speakerName?.trim();
    const character = characterId
      ? characters.find((item) => item.id === characterId) || characters.find((item) => normalizedSpeaker && item.name === normalizedSpeaker)
      : characters.find((item) => normalizedSpeaker && item.name === normalizedSpeaker);
    const actorId = character?.id || characterId || event.speakerName || 'character';
    return [{
      id: `block-${index + 1}`,
      actorId,
      actorKind: 'character',
      kind: 'dialogue',
      displayMode: 'bubble',
      text: event.text.trim(),
      actorName: character?.name || event.speakerName || characterId || '角色',
      characterId: character?.id || characterId || undefined,
    }];
  }
  return [];
}

export function buildNarrativeTurnFromStoryEvents(params: {
  conversation: GroupChat;
  events: StoryEvent[];
  characters: AICharacter[];
  phase?: string;
  turnKind?: NarrativeTurnMetadata['turnKind'];
}): NarrativeTurnMetadata | null {
  const blocks = params.events.flatMap((event, index) => storyEventToBlocks(event, index, params.characters));
  if (!blocks.length) return null;
  const phase = params.phase || params.conversation.scenarioState?.phase || 'scene';
  return {
    turnId: `${params.conversation.id}:${Date.now().toString(36)}`,
    turnKind: params.turnKind || (phase === 'branch' ? 'choice_prompt' : 'narrative_beat'),
    sceneId: String(params.conversation.scenarioState?.sceneId || 'main'),
    phase,
    povActorId: 'narrator',
    blocks,
  };
}

export function buildStoryReadingPanelBlock(params: {
  conversation: GroupChat;
  choices: StoryChoiceSuggestion[];
  id?: string;
}): NarrativeBlock | null {
  const choices = normalizeStoryChoiceSuggestions(params.choices);
  if (choices.length < 2) return null;
  const state = params.conversation.scenarioState;
  const recap = state?.chapterRecap;
  const recapText = compactStoryAssetText(recap?.summary || state?.chapterMemory || '', 120);
  const stakes = [
    ...(state?.stakes || []).slice(-2),
    ...choices.flatMap((choice) => [choice.risk, choice.reward].filter(Boolean) as string[]),
  ].map((item) => compactStoryAssetText(item, 36)).filter(Boolean);
  const uniqueStakes = Array.from(new Set(stakes)).slice(0, 4);
  const lines = [
    '新的抉择点',
    recapText ? `前情：${recapText}` : '当前压力已经形成，下一步会改变这一章的走向。',
    uniqueStakes.length ? `取舍：${uniqueStakes.join(' / ')}` : '',
  ].filter(Boolean);
  return {
    id: params.id || 'story-reading-panel',
    actorId: 'narrator',
    actorKind: 'system',
    kind: 'system_note',
    displayMode: 'system_panel',
    text: lines.join('\n'),
  };
}

export function appendStoryReadingPanelBlock(params: {
  conversation: GroupChat;
  narrativeTurn: NarrativeTurnMetadata | null;
  choices: StoryChoiceSuggestion[];
}): NarrativeTurnMetadata | null {
  const turn = params.narrativeTurn;
  if (!turn) return null;
  if (turn.blocks.some((block) => block.displayMode === 'system_panel' && block.kind === 'system_note')) return turn;
  const block = buildStoryReadingPanelBlock({
    conversation: params.conversation,
    choices: params.choices,
    id: `${turn.turnId}:story-reading-panel`,
  });
  if (!block) return turn;
  return {
    ...turn,
    blocks: [...turn.blocks, block],
  };
}

export function getCurrentChoiceEpoch(conversation: GroupChat) {
  const explicit = Number(conversation.scenarioState?.choiceEpoch || 0);
  const branchEpochs = (conversation.scenarioState?.branches || []).map((branch) => Number(branch.choiceEpoch || 0));
  return Math.max(explicit, 1, ...branchEpochs);
}

function hasEnoughDecisionPressure(conversation: GroupChat) {
  const state = conversation.scenarioState;
  if (!state) return false;
  const pressureSignals = [
    state.currentScene?.visibleThreat,
    ...(state.openQuestions || []).slice(-2),
    ...(state.clues || []).slice(-2),
    ...(state.stakes || []).slice(-2),
    ...(state.relationshipShifts || []).slice(-2),
  ].map((item) => compactStoryAssetText(item || '', 36)).filter(Boolean);
  const hasScenePressure = Boolean(state.currentScene?.visibleThreat || state.stakes?.length);
  const hasActionAnchor = Boolean(state.clues?.length || state.openQuestions?.length || state.relationshipShifts?.length);
  return pressureSignals.length >= 3 && hasScenePressure && hasActionAnchor;
}

export function resolveStoryBeatPlan(conversation: GroupChat): StoryBeatPlan {
  const phase = conversation.scenarioState?.phase || 'scene';
  const sceneBeatCount = Number(conversation.scenarioState?.sceneBeatCount || 0);
  if (phase === 'choice') {
    return { beatKind: 'decision', choicePolicy: 'require', reason: 'runtime is waiting for user decision' };
  }
  if (phase === 'branch') {
    return { beatKind: 'consequence', choicePolicy: 'forbid', reason: 'resolve selected branch before opening another choice' };
  }
  if (sceneBeatCount <= 0) {
    return { beatKind: 'establish', choicePolicy: 'forbid', reason: 'establish scene before choices' };
  }
  if (sceneBeatCount === 1) {
    return { beatKind: 'pressure', choicePolicy: 'forbid', reason: 'build visible pressure before choices' };
  }
  if (sceneBeatCount >= 2 && hasEnoughDecisionPressure(conversation)) {
    return { beatKind: 'decision', choicePolicy: 'require', reason: 'visible story pressure is ready for a meaningful choice' };
  }
  if (sceneBeatCount >= 3) {
    return { beatKind: 'decision', choicePolicy: 'require', reason: 'enough setup beats have accumulated' };
  }
  return { beatKind: 'new_pressure', choicePolicy: 'allow', reason: 'new pressure may become a decision point' };
}

export function buildChoicePolicyPrompt(plan: StoryBeatPlan) {
  const common = [
    `Story beat plan: beatKind=${plan.beatKind}; choicePolicy=${plan.choicePolicy}; reason=${plan.reason}.`,
    'A choice_point is a chapter decision, not a routine chat button.',
    'Every choice_point choice should include label, prompt, intent, risk, and reward when possible.',
  ];
  if (plan.choicePolicy === 'forbid') {
    return [
      ...common,
      'Do not output storyEvents.choice_point in this beat.',
      'End with readable pressure, consequence, or an unresolved image instead of options.',
    ];
  }
  if (plan.choicePolicy === 'require') {
    return [
      ...common,
      'This beat must reach a real decision point and output exactly one storyEvents.choice_point with 2-4 concrete choices.',
      'Before the choice_point, make the pressure visible in narration or consequential speech.',
      'Each choice must involve a different cost, risk, or likely reward.',
    ];
  }
  return [
    ...common,
    'Output storyEvents.choice_point only if the current beat has visibly created incompatible actions or stakes.',
    'If the pressure is not concrete yet, continue the scene without choices.',
  ];
}

export function compactStoryAssetText(text: string, max = STORY_ASSET_TEXT_LIMIT) {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function mergeStoryAssetList(existing: string[] | undefined, additions: string[], limit = STORY_ASSET_LIMIT) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...(existing || []), ...additions]) {
    const compact = compactStoryAssetText(item);
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    merged.push(compact);
  }
  return merged.slice(-limit);
}

function splitStorySentences(text: string) {
  return (text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text])
    .map((part) => compactStoryAssetText(part, 96))
    .filter(Boolean);
}

function pickLastMatchingSentence(sentences: string[], pattern: RegExp) {
  return sentences.slice().reverse().find((sentence) => {
    pattern.lastIndex = 0;
    return pattern.test(sentence);
  }) || '';
}

function pickLastMatch(texts: string[], pattern: RegExp) {
  for (const text of texts.slice().reverse()) {
    pattern.lastIndex = 0;
    const matches = Array.from(text.matchAll(pattern));
    const match = matches.at(-1)?.[0];
    if (match) return match;
  }
  return '';
}

function pickFirstMatch(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern))[0]?.[0] || '';
}

function inferStorySceneTime(sentences: string[], fallback?: string) {
  const pattern = /雨夜|深夜|凌晨|清晨|黄昏|傍晚|夜里|白天|天亮|天黑|黎明|午后|此刻|现在|刚才|昨晚|今早|第二天|新的一天/g;
  const fallbackTime = fallback ? pickLastMatch([fallback], pattern) || fallback : '';
  return compactStoryAssetText(
    pickLastMatch(sentences, pattern) || fallbackTime,
    16,
  );
}

function inferStorySceneLocation(sentences: string[], fallback?: string) {
  const locationPattern = /(?:旧医院走廊|旧医院|地下档案室|封锁(?:的)?旧住院楼|旧住院楼|走廊尽头|门外|门内|主楼|后院|医院|旧楼|走廊|病房|档案室|地下室|住院楼|妆台|侯府|房间|门口|院子|街|巷|车站|教室|办公室|实验室|仓库|码头|森林|城堡|宫殿|学校)/g;
  const sentence = pickLastMatchingSentence(sentences, locationPattern);
  const fallbackLocation = fallback ? pickFirstMatch(fallback, locationPattern) : '';
  return compactStoryAssetText(
    (sentence ? pickFirstMatch(sentence, locationPattern) : '') || fallbackLocation,
    32,
  );
}

function inferStorySceneThreat(sentences: string[]) {
  const sentence = pickLastMatchingSentence(sentences, /(危险|威胁|血迹|异常|失踪|隐瞒|暴露|追上|封锁|锁住|停电|真相|秘密|脚步声|敲击声|盯着|怀疑|背叛|来不及)/);
  return compactStoryAssetText(
    sentence,
    56,
  );
}

function inferPresentActorIds(text: string, characters: AICharacter[]) {
  return characters
    .filter((character) => character.name && text.includes(character.name))
    .map((character) => character.id)
    .slice(0, 6);
}

function buildCurrentScenePatch(params: {
  conversation: GroupChat;
  text: string;
  summary: string;
  sentences: string[];
  characters?: AICharacter[];
}): StoryCurrentSceneState | null {
  const previous = params.conversation.scenarioState?.currentScene || null;
  const state = params.conversation.scenarioState;
  const summary = compactStoryAssetText(params.summary || params.text || previous?.summary || state?.storySituation || state?.storyBackground || '', 120);
  const location = inferStorySceneLocation(params.sentences, previous?.location || state?.storyBackground || params.conversation.topic);
  const time = inferStorySceneTime(params.sentences, previous?.time);
  const visibleThreat = inferStorySceneThreat(params.sentences) || previous?.visibleThreat;
  const presentActorIds = inferPresentActorIds(params.text, params.characters || []);
  const mergedActorIds = Array.from(new Set([
    ...(previous?.presentActorIds || []),
    ...presentActorIds,
  ].filter(Boolean))).slice(-6);
  if (!summary && !location && !time && !visibleThreat && !mergedActorIds.length) return null;
  return {
    ...(location ? { location } : {}),
    ...(time ? { time } : {}),
    ...(mergedActorIds.length ? { presentActorIds: mergedActorIds } : {}),
    ...(visibleThreat ? { visibleThreat } : {}),
    ...(summary ? { summary } : {}),
    updatedAt: Date.now(),
  };
}

function getVisibleStoryText(message: Pick<Message, 'content' | 'metadata'>) {
  const blockText = message.metadata?.narrativeTurn?.blocks
    .filter((block) => block.displayMode !== 'hidden')
    .map((block) => block.text)
    .filter(Boolean)
    .join(' ');
  return compactStoryAssetText(blockText || message.content || '', 360);
}

export function extractStoryAssets(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'metadata'>;
  choices: StoryChoiceSuggestion[];
  summary: string;
  characters?: AICharacter[];
}): StoryAssetPatch {
  const text = getVisibleStoryText(params.message);
  const sentences = splitStorySentences(text);
  const openQuestionCandidates = sentences.filter((sentence) => (
    /[?？]$/.test(sentence)
    || /(谁|为何|为什么|是否|哪里|怎么|怎样|什么|真相|秘密|失踪|隐藏|隐瞒)/.test(sentence)
  ));
  const clueCandidates = sentences.filter((sentence) => (
    /(线索|证据|发现|记录|名单|钥匙|档案|病历|血迹|痕迹|照片|录音|门缝|脚印|异常|真相)/.test(sentence)
  ));
  const relationshipCandidates = sentences.filter((sentence) => (
    /(信任|怀疑|保护|隐瞒|背叛|靠近|疏远|敌意|动摇|试探|质问|承认|否认)/.test(sentence)
  ));
  const stakeCandidates = [
    ...sentences.filter((sentence) => /(危险|代价|风险|威胁|暴露|失去|来不及|时间|牺牲|安全|封锁|追上|逃走)/.test(sentence)),
    ...params.choices.flatMap((choice) => [choice.risk, choice.reward].filter(Boolean) as string[]),
  ];
  const chapterMemoryParts = [
    params.conversation.scenarioState?.chapterMemory || '',
    params.summary,
  ].filter(Boolean);
  const chapterMemory = compactStoryAssetText(chapterMemoryParts.join(' / '), CHAPTER_MEMORY_LIMIT);
  const state = params.conversation.scenarioState;
  const selectedGoal = state?.selectedChoice?.prompt || state?.selectedChoice?.label || '';
  const storyGoal = compactStoryAssetText(
    state?.phase === 'branch'
      ? (state.storyGoal || state.storyDirection || params.conversation.topic || '')
      : (selectedGoal || state?.storyGoal || state?.storyDirection || params.conversation.topic || ''),
    120,
  );
  const storySituation = compactStoryAssetText(params.summary || text || state?.storySituation || state?.storyBackground || '', 180);
  const currentScene = buildCurrentScenePatch({
    conversation: params.conversation,
    text,
    summary: params.summary,
    sentences,
    characters: params.characters,
  });
  return {
    ...(currentScene ? { currentScene } : {}),
    openQuestions: mergeStoryAssetList(params.conversation.scenarioState?.openQuestions, openQuestionCandidates),
    clues: mergeStoryAssetList(params.conversation.scenarioState?.clues, clueCandidates),
    stakes: mergeStoryAssetList(params.conversation.scenarioState?.stakes, stakeCandidates),
    relationshipShifts: mergeStoryAssetList(params.conversation.scenarioState?.relationshipShifts, relationshipCandidates),
    chapterMemory,
    ...(storyGoal ? { storyGoal } : {}),
    ...(storySituation ? { storySituation } : {}),
  };
}

export function buildStoryAssetPrompt(conversation: GroupChat) {
  const state = conversation.scenarioState;
  if (!state) return [];
  const recap = state.chapterRecap;
  const recentChoices = state.choiceHistory?.slice(-3) || [];
  const unchosenPaths = recentChoices
    .map((choice) => {
      const epoch = Number(choice.choiceEpoch || 0);
      const alternatives = epoch
        ? (state.branches || [])
          .filter((branch) => Number(branch.choiceEpoch || 0) === epoch && branch.status === 'completed')
          .map((branch) => branch.label)
          .filter(Boolean)
          .slice(0, 2)
        : [];
      return alternatives.length ? `epoch ${epoch || '?'} unchosen=${alternatives.join(' | ')}` : '';
    })
    .filter(Boolean);
  const lines = [
    state.storyGoal ? `Current chapter goal: ${state.storyGoal}` : '',
    state.currentScene ? `Current scene: ${[
      state.currentScene.location ? `location=${state.currentScene.location}` : '',
      state.currentScene.time ? `time=${state.currentScene.time}` : '',
      state.currentScene.visibleThreat ? `visible pressure=${state.currentScene.visibleThreat}` : '',
      state.currentScene.summary ? `summary=${state.currentScene.summary}` : '',
    ].filter(Boolean).join('; ')}` : '',
    state.storySituation ? `Current situation: ${state.storySituation}` : '',
    recap?.summary ? `Latest chapter recap: ${recap.summary}` : '',
    state.chapterMemory ? `Chapter memory: ${state.chapterMemory}` : '',
    state.openQuestions?.length ? `Open questions to preserve or answer deliberately: ${state.openQuestions.slice(-4).join(' / ')}` : '',
    state.clues?.length ? `Known clues to reuse or reframe: ${state.clues.slice(-4).join(' / ')}` : '',
    state.stakes?.length ? `Current stakes: ${state.stakes.slice(-4).join(' / ')}` : '',
    state.relationshipShifts?.length ? `Relationship pressure: ${state.relationshipShifts.slice(-4).join(' / ')}` : '',
    recentChoices.length ? `Recent user choices: ${recentChoices.map((choice) => [choice.label, choice.risk ? `risk=${choice.risk}` : '', choice.reward ? `reward=${choice.reward}` : '', choice.outcome ? `outcome=${choice.outcome}` : '', choice.impact ? `impact=${choice.impact}` : ''].filter(Boolean).join(' · ')).join(' / ')}` : '',
    unchosenPaths.length ? `Unchosen branches for continuity only: ${unchosenPaths.join(' / ')}` : '',
  ].filter(Boolean);
  if (!lines.length) return [];
  return [
    'Use these story assets as continuity anchors. Do not list them back to the user; weave at most 1-2 into the scene naturally.',
    'Before inventing an unrelated new clue, try to answer, complicate, or reframe one existing open question or known clue when it fits the current beat.',
    'Respect the user-selected path as canon. Do not write an unchosen branch as if it happened; use unchosen branches only as contrast, regret, rumor, or replay context.',
    'Make the next beat visibly inherit at least one prior choice outcome, impact, clue, or relationship pressure so the story feels remembered.',
    ...lines,
  ];
}

export function buildSelectedChoiceConsequencePrompt(conversation: GroupChat) {
  const state = conversation.scenarioState;
  if (!state || state.phase !== 'branch') return [];
  const selected = state.selectedChoice || state.choiceHistory?.slice().reverse().find((choice) => {
    const selectedEpoch = Number(state.selectedChoiceEpoch || 0);
    const choiceEpoch = Number(choice.choiceEpoch || 0);
    return !choice.outcome && (!selectedEpoch || choiceEpoch === selectedEpoch);
  });
  if (!selected?.label) return [];
  const rows = [
    `Selected choice: ${selected.label}`,
    selected.prompt ? `Choice promise to resolve: ${selected.prompt}` : '',
    selected.intent ? `Dramatic intent: ${selected.intent}` : '',
    selected.risk ? `Risk that should become visible or start to cost something: ${selected.risk}` : '',
    selected.reward ? `Reward/opportunity that should become visible or be partially earned: ${selected.reward}` : '',
  ].filter(Boolean);
  return [
    'This turn is the immediate consequence of the user choice. Do not drift to a generic next scene.',
    ...rows,
    'Show at least one concrete consequence of the selected choice before any new pressure or future option.',
    'If the full risk/reward cannot resolve yet, show a visible first sign, complication, clue, relationship shift, or cost.',
  ];
}

export function buildChapterRecap(params: {
  conversation: GroupChat;
  storyAssets: StoryAssetPatch;
  summary: string;
  openedChoice: boolean;
  nextSceneBeatCount: number;
}) {
  const previous = params.conversation.scenarioState?.chapterRecap || null;
  const choiceHistory = params.conversation.scenarioState?.choiceHistory || [];
  const choiceImpacts = choiceHistory.slice(-3).map((choice) => choice.impact).filter(Boolean) as string[];
  const previousImpacts = new Set(previous?.choiceImpacts || []);
  const hasNewChoiceImpact = choiceImpacts.some((impact) => !previousImpacts.has(impact));
  const shouldRefresh = params.openedChoice || params.nextSceneBeatCount >= 4 || hasNewChoiceImpact || !previous;
  if (!shouldRefresh) return previous;
  const lastChoices = choiceHistory.slice(-3).map((choice) => choice.label).filter(Boolean);
  const summary = compactStoryAssetText(params.storyAssets.chapterMemory || params.summary, 140);
  return {
    title: params.openedChoice ? '新的抉择点' : '阶段回顾',
    summary,
    discoveredClues: (params.storyAssets.clues || []).slice(-4),
    unresolvedQuestions: (params.storyAssets.openQuestions || []).slice(-4),
    changedRelationships: (params.storyAssets.relationshipShifts || []).slice(-4),
    stakes: (params.storyAssets.stakes || []).slice(-4),
    lastChoiceLabels: lastChoices,
    ...(choiceImpacts.length ? { choiceImpacts } : {}),
    updatedAt: Date.now(),
    beatCount: params.nextSceneBeatCount,
  };
}

function buildChoiceImpactSummary(params: {
  choice: NonNullable<NonNullable<GroupChat['scenarioState']>['choiceHistory']>[number];
  storyAssets?: StoryAssetPatch;
}) {
  const rows = [
    params.storyAssets?.relationshipShifts?.slice(-1)[0] ? `关系变化：${params.storyAssets.relationshipShifts.slice(-1)[0]}` : '',
    params.storyAssets?.clues?.slice(-1)[0] ? `新线索：${params.storyAssets.clues.slice(-1)[0]}` : '',
    params.storyAssets?.stakes?.slice(-1)[0] ? `代价/风险：${params.storyAssets.stakes.slice(-1)[0]}` : '',
    params.storyAssets?.openQuestions?.slice(-1)[0] ? `遗留悬念：${params.storyAssets.openQuestions.slice(-1)[0]}` : '',
    params.choice.reward ? `兑现收益：${params.choice.reward}` : '',
    params.choice.risk ? `承接风险：${params.choice.risk}` : '',
  ].map((item) => compactStoryAssetText(item, 72)).filter(Boolean);
  return compactStoryAssetText(Array.from(new Set(rows)).slice(0, 2).join('；'), 120);
}

function choiceConsequenceHasEvidence(params: {
  choice: NonNullable<NonNullable<GroupChat['scenarioState']>['choiceHistory']>[number];
  outcome: string;
  storyAssets?: StoryAssetPatch;
}) {
  const outcomeText = [
    params.outcome,
    params.storyAssets?.clues?.slice(-1)[0] || '',
    params.storyAssets?.stakes?.slice(-1)[0] || '',
    params.storyAssets?.relationshipShifts?.slice(-1)[0] || '',
    params.storyAssets?.openQuestions?.slice(-1)[0] || '',
  ].filter(Boolean).join(' ');
  const evidenceFields = [
    params.choice.label,
    params.choice.prompt,
    params.choice.intent,
    params.choice.risk,
    params.choice.reward,
  ].map((item) => compactStoryAssetText(item || '', 80)).filter((item) => normalizeRepeatText(item).length >= 2);
  if (!evidenceFields.length) return true;
  return evidenceFields.some((field) => {
    const normalizedField = normalizeRepeatText(field);
    const normalizedOutcome = normalizeRepeatText(outcomeText);
    if (!normalizedField || !normalizedOutcome) return false;
    if (normalizedOutcome.includes(normalizedField) || normalizedField.includes(normalizedOutcome)) return true;
    const fieldBigrams = buildNgrams(normalizedField, 2);
    const outcomeBigrams = buildNgrams(normalizedOutcome, 2);
    let bigramOverlap = 0;
    fieldBigrams.forEach((gram) => {
      if (outcomeBigrams.has(gram)) bigramOverlap += 1;
    });
    if (fieldBigrams.size && bigramOverlap / fieldBigrams.size >= 0.24) return true;
    return textSimilarity(normalizedField, normalizedOutcome) >= 0.18;
  });
}

export function updateChoiceHistoryOutcome(conversation: GroupChat, outcome: string, storyAssets?: StoryAssetPatch) {
  const history = conversation.scenarioState?.choiceHistory || [];
  const compactOutcome = compactStoryAssetText(outcome, 96);
  if (!history.length || !compactOutcome || conversation.scenarioState?.phase !== 'branch') return history;
  const selectedEpoch = Number(conversation.scenarioState?.selectedChoiceEpoch || 0);
  let targetIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const choiceEpoch = Number(history[index].choiceEpoch || 0);
    if ((!selectedEpoch || choiceEpoch === selectedEpoch) && !history[index].outcome) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex === -1) return history;
  if (!choiceConsequenceHasEvidence({ choice: history[targetIndex], outcome: compactOutcome, storyAssets })) return history;
  return history.map((choice, index) => (index === targetIndex ? {
    ...choice,
    outcome: compactOutcome,
    impact: choice.impact || buildChoiceImpactSummary({ choice, storyAssets }) || undefined,
  } : choice));
}

export function normalizeStoryBranches(conversation: GroupChat, choices: StoryChoiceSuggestion[]) {
  const existing = conversation.scenarioState?.branches || [];
  const currentEpoch = getCurrentChoiceEpoch(conversation);
  const selectedEpoch = Number(conversation.scenarioState?.selectedChoiceEpoch || 0);
  const active = existing.filter((branch) => branch.status !== 'locked' && branch.status !== 'completed' && branch.status !== 'chosen' && Number(branch.choiceEpoch || currentEpoch) === currentEpoch);
  const normalizedChoices = normalizeStoryChoiceSuggestions(choices);
  if (normalizedChoices.length < 2) return { branches: existing, hasOpenChoice: false, openedChoice: false };
  if (active.length >= 2 && selectedEpoch !== currentEpoch) return { branches: existing, hasOpenChoice: true, openedChoice: false };
  const nextEpoch = currentEpoch + 1;
  const prefix = `${conversation.id}:choice:${nextEpoch}`;
  return {
    branches: [
      ...existing,
      ...normalizedChoices.map((choice, index) => ({
        branchId: `${prefix}:${index + 1}`,
        label: choice.label,
        description: [choice.intent ? `意图：${choice.intent}` : '', choice.risk ? `风险：${choice.risk}` : '', choice.reward ? `收益：${choice.reward}` : ''].filter(Boolean).join('；'),
        prompt: choice.prompt || choice.label,
        intent: choice.intent || undefined,
        risk: choice.risk || undefined,
        reward: choice.reward || undefined,
        status: 'available' as const,
        source: 'suggested' as const,
        choiceEpoch: nextEpoch,
      })),
    ],
    hasOpenChoice: true,
    openedChoice: true,
  };
}
