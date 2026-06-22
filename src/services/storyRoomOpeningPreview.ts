import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { sanitizeUserFacingText } from './displayTextSanitizer';

export interface StoryRoomOpeningPreviewItem {
  label: string;
  text: string;
}

export interface StoryRoomOpeningPreview {
  title: string;
  goal: string;
  scene: string;
  firstChapterGoal: string;
  readerPromise: string;
  items: StoryRoomOpeningPreviewItem[];
}

function cleanText(value: string | undefined | null, members: AICharacter[], maxLength: number) {
  const text = sanitizeUserFacingText(value, members).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function pushItems(
  target: StoryRoomOpeningPreviewItem[],
  label: string,
  values: string[] | undefined,
  members: AICharacter[],
  limit: number,
) {
  for (const value of values || []) {
    if (target.length >= 6) return;
    const text = cleanText(value, members, 58);
    if (!text || target.some((item) => item.text === text)) continue;
    target.push({ label, text });
    if (target.filter((item) => item.label === label).length >= limit) return;
  }
}

export function buildStoryRoomOpeningPreview(chat: GroupChat | null | undefined, members: AICharacter[]): StoryRoomOpeningPreview | null {
  if (chat?.sessionKind?.scenarioId !== 'story-reader') return null;
  const state = chat.scenarioState;
  if (!state) return null;

  const sceneLabel = [
    cleanText(state.currentScene?.time, members, 12),
    cleanText(state.currentScene?.location, members, 18),
  ].filter(Boolean).join(' · ');
  const title = sceneLabel || cleanText(chat.name, members, 28) || '故事开场';
  const goal = cleanText(state.storyGoal || state.storyDirection, members, 92);
  const scene = cleanText(state.currentScene?.summary || state.storySituation || state.storyBackground, members, 116);
  const firstChapterGoal = cleanText(state.storyOutline?.split(/[；;]/)[0] || state.storyGoal || state.storyDirection, members, 86);
  const items: StoryRoomOpeningPreviewItem[] = [];
  pushItems(items, '悬念', state.openQuestions, members, 2);
  pushItems(items, '线索', state.clues, members, 2);
  pushItems(items, '风险', state.stakes, members, 1);
  pushItems(items, '关系', state.relationshipShifts, members, 1);
  const trackedLabels = Array.from(new Set(items.map((item) => item.label))).slice(0, 3);
  const readerPromise = trackedLabels.length
    ? `你的选择会影响${trackedLabels.join('、')}，并沉淀到章节回看。`
    : '';

  if (!goal || !scene || !firstChapterGoal || !readerPromise || items.length < 2) return null;
  return { title, goal, scene, firstChapterGoal, readerPromise, items };
}
