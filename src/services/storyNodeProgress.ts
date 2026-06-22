import type { Message } from '../types/message';

export interface StoryNodeProgressChip {
  label: string;
  tone: 'chapter' | 'recap';
}

export interface StoryNodeProgress {
  chips: StoryNodeProgressChip[];
}

export function buildStoryNodeProgress(message: Message): StoryNodeProgress | null {
  const events = message.metadata?.storyEvents || [];
  if (!events.length) return null;

  const chips: StoryNodeProgressChip[] = [];
  const chapterUpdate = events.find((event) => event.type === 'chapter_update' && event.title?.trim());
  const chapterSummary = events.find((event) => event.type === 'chapter_update' && event.summary?.trim())?.summary?.trim() || '';

  if (chapterUpdate?.title) {
    const status = chapterUpdate.status === 'completed' ? '章节结算' : chapterUpdate.startNewChapter ? '新章节' : '章节';
    chips.push({ label: `${status}：${chapterUpdate.title.trim()}`, tone: 'chapter' });
  }
  if (chapterSummary) {
    const summary = chapterSummary.length > 18 ? `${chapterSummary.slice(0, 17).trimEnd()}…` : chapterSummary;
    chips.push({ label: `阶段摘要：${summary}`, tone: 'recap' });
  }

  return chips.length ? { chips } : null;
}
