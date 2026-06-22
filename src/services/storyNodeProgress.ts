import type { Message } from '../types/message';

export interface StoryNodeProgressChip {
  label: string;
  tone: 'chapter' | 'speech' | 'choice';
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
  if (choiceCount > 0) {
    chips.push({ label: `${choiceCount} 个走向`, tone: 'choice' });
  }

  return chips.length ? { chips } : null;
}
