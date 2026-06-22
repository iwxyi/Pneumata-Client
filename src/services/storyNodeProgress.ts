import type { Message } from '../types/message';

export interface StoryNodeProgressChip {
  label: string;
  tone: 'chapter' | 'speech' | 'choice' | 'recap' | 'tradeoff';
}

export interface StoryNodeProgress {
  chips: StoryNodeProgressChip[];
}

export function buildStoryNodeProgress(message: Message): StoryNodeProgress | null {
  const events = message.metadata?.storyEvents || [];
  if (!events.length) return null;

  const chips: StoryNodeProgressChip[] = [];
  const chapterUpdate = events.find((event) => event.type === 'chapter_update' && event.title?.trim());
  const speechCount = events.filter((event) => event.type === 'speech').length;
  const chapterSummary = events.find((event) => event.type === 'chapter_update' && event.summary?.trim())?.summary?.trim() || '';
  const tradeoffCount = events
    .filter((event) => event.type === 'choice_point')
    .reduce((sum, event) => sum + (event.choices || []).filter((choice) => choice.risk?.trim() || choice.reward?.trim()).length, 0);
  const choiceCount = events
    .filter((event) => event.type === 'choice_point')
    .reduce((sum, event) => sum + (event.choices?.length || 0), 0);

  if (chapterUpdate?.title) {
    const status = chapterUpdate.status === 'completed' ? '章节结算' : chapterUpdate.startNewChapter ? '新章节' : '章节';
    chips.push({ label: `${status}：${chapterUpdate.title.trim()}`, tone: 'chapter' });
  }
  if (speechCount > 0) {
    chips.push({ label: `${speechCount} 句角色对白`, tone: 'speech' });
  }
  if (chapterSummary) {
    const summary = chapterSummary.length > 18 ? `${chapterSummary.slice(0, 17).trimEnd()}…` : chapterSummary;
    chips.push({ label: `阶段摘要：${summary}`, tone: 'recap' });
  }
  if (choiceCount > 0) {
    chips.push({ label: `${choiceCount} 个走向`, tone: 'choice' });
  }
  if (tradeoffCount > 0) {
    chips.push({ label: `${tradeoffCount} 个取舍`, tone: 'tradeoff' });
  }

  return chips.length ? { chips } : null;
}
