import type { GroupChat, StoryBeatKind, StoryChoicePolicy } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { Message, NarrativeBlock, NarrativeTurnMetadata, StoryChoiceSuggestion, StoryEvent } from '../types/message';
import { isConcreteStoryChoiceLabel, normalizeStoryChoiceSuggestions } from './storyChoices';

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
  openQuestions: string[];
  clues: string[];
  stakes: string[];
  relationshipShifts: string[];
  chapterMemory: string;
  storyGoal?: string;
  storySituation?: string;
}

function compactText(value: unknown, max = 1200) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function normalizeStoryChoice(value: unknown): StoryChoiceSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const label = compactText(item.label, 80);
  if (!label || !isConcreteStoryChoiceLabel(label)) return null;
  const prompt = compactText(item.prompt, 180);
  const intent = compactText(item.intent, 40);
  const risk = compactText(item.risk, 120);
  const reward = compactText(item.reward, 120);
  return {
    label,
    prompt: prompt || null,
    ...(intent ? { intent } : {}),
    ...(risk ? { risk } : {}),
    ...(reward ? { reward } : {}),
  };
}

function normalizeStoryChoices(value: unknown): StoryChoiceSuggestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const choices: StoryChoiceSuggestion[] = [];
  for (const raw of value) {
    const choice = normalizeStoryChoice(raw);
    if (!choice || seen.has(choice.label)) continue;
    seen.add(choice.label);
    choices.push(choice);
    if (choices.length >= MAX_CHOICES) break;
  }
  return choices;
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

function isNearDuplicateStoryText(text: string, previousTexts: string[], minLength = 28) {
  const normalized = normalizeRepeatText(text);
  if (normalized.length < minLength) return false;
  return previousTexts.some((previous) => {
    const previousNormalized = normalizeRepeatText(previous);
    if (previousNormalized.length < minLength) return false;
    if (previousNormalized.includes(normalized) || normalized.includes(previousNormalized)) return true;
    if (previousNormalized.slice(0, 36) === normalized.slice(0, 36)) return true;
    return textSimilarity(normalized, previousNormalized) >= 0.72;
  });
}

export function normalizeStoryEvents(value: unknown): StoryEvent[] {
  if (!Array.isArray(value)) return [];
  const events: StoryEvent[] = [];
  const narrationTexts: string[] = [];
  const speechTextsByActor = new Map<string, string[]>();
  for (const raw of value.slice(0, MAX_STORY_EVENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = item.type;
    if (type === 'narration') {
      const text = compactText(item.text, 1600);
      if (text && !isNearDuplicateStoryText(text, narrationTexts)) {
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
  const storyGoal = compactStoryAssetText(selectedGoal || state?.storyGoal || state?.storyDirection || params.conversation.topic || '', 120);
  const storySituation = compactStoryAssetText(params.summary || text || state?.storySituation || state?.storyBackground || '', 180);
  return {
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
  const lines = [
    state.storyGoal ? `Current chapter goal: ${state.storyGoal}` : '',
    state.storySituation ? `Current situation: ${state.storySituation}` : '',
    recap?.summary ? `Latest chapter recap: ${recap.summary}` : '',
    state.chapterMemory ? `Chapter memory: ${state.chapterMemory}` : '',
    state.openQuestions?.length ? `Open questions to preserve or answer deliberately: ${state.openQuestions.slice(-4).join(' / ')}` : '',
    state.clues?.length ? `Known clues to reuse or reframe: ${state.clues.slice(-4).join(' / ')}` : '',
    state.stakes?.length ? `Current stakes: ${state.stakes.slice(-4).join(' / ')}` : '',
    state.relationshipShifts?.length ? `Relationship pressure: ${state.relationshipShifts.slice(-4).join(' / ')}` : '',
    state.choiceHistory?.length ? `Recent user choices: ${state.choiceHistory.slice(-3).map((choice) => [choice.label, choice.risk ? `risk=${choice.risk}` : '', choice.reward ? `reward=${choice.reward}` : '', choice.outcome ? `outcome=${choice.outcome}` : ''].filter(Boolean).join(' · ')).join(' / ')}` : '',
  ].filter(Boolean);
  if (!lines.length) return [];
  return [
    'Use these story assets as continuity anchors. Do not list them back to the user; weave at most 1-2 into the scene naturally.',
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
  const shouldRefresh = params.openedChoice || params.nextSceneBeatCount >= 4 || !previous;
  if (!shouldRefresh) return previous;
  const choiceHistory = params.conversation.scenarioState?.choiceHistory || [];
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
    updatedAt: Date.now(),
    beatCount: params.nextSceneBeatCount,
  };
}

export function updateChoiceHistoryOutcome(conversation: GroupChat, outcome: string) {
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
  return history.map((choice, index) => (index === targetIndex ? { ...choice, outcome: compactOutcome } : choice));
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
