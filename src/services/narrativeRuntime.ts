import type { GroupChat } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { NarrativeBlock, NarrativeTurnMetadata, StoryChoiceSuggestion, StoryEvent } from '../types/message';
import { isConcreteStoryChoiceLabel } from './storyChoices';

const MAX_STORY_EVENTS = 12;
const MAX_CHOICES = 4;

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
  return { label, prompt: prompt || null };
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

export function normalizeStoryEvents(value: unknown): StoryEvent[] {
  if (!Array.isArray(value)) return [];
  const events: StoryEvent[] = [];
  for (const raw of value.slice(0, MAX_STORY_EVENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = item.type;
    if (type === 'narration') {
      const text = compactText(item.text, 1600);
      if (text) events.push({ type, text });
      continue;
    }
    if (type === 'speech') {
      const text = compactText(item.text, 600);
      if (!text) continue;
      const characterId = compactText(item.characterId, 80) || compactText(item.actorId, 80);
      const speakerName = compactText(item.speakerName, 80) || compactText(item.actorName, 80);
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
      actorName: character?.name || event.speakerName,
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
