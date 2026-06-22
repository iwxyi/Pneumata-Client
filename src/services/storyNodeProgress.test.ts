import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { buildStoryNodeProgress } from './storyNodeProgress';

function message(metadata: Message['metadata'] = {}): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'narrator',
    senderName: '旁白',
    content: '',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    metadata,
  };
}

describe('buildStoryNodeProgress', () => {
  it('summarizes visible story node progress from authoritative story events', () => {
    const progress = buildStoryNodeProgress(message({
      storyEvents: [
        { type: 'chapter_update', title: '枕下长剑', summary: '沈清婉发现毒剑来自军器监。', status: 'active', startNewChapter: true },
        { type: 'narration', text: '沈清婉按住袖中烙印。' },
        { type: 'speech', characterId: 'maid', text: '小姐，粥已经热好了。' },
        { type: 'speech', characterId: 'bride', text: '先放着。' },
        { type: 'choice_point', choices: [
          { label: '追问月奴昨夜铺床的细节', risk: '惊动背后的人', reward: '确认月奴立场' },
          { label: '先检查军器监烙印', risk: '错过追问时机', reward: '掌握物证' },
          { label: '等顾凌霄回来再说' },
        ] },
      ],
    }));

    expect(progress?.chips).toEqual([
      { label: '新章节：枕下长剑', tone: 'chapter' },
      { label: '阶段摘要：沈清婉发现毒剑来自军器监。', tone: 'recap' },
    ]);
  });

  it('marks completed chapter updates as chapter settlement', () => {
    expect(buildStoryNodeProgress(message({
      storyEvents: [{ type: 'chapter_update', title: '月奴迟疑', status: 'completed' }],
    }))?.chips[0]).toEqual({ label: '章节结算：月奴迟疑', tone: 'chapter' });
  });

  it('does not create progress chips without protocol events', () => {
    expect(buildStoryNodeProgress(message())).toBeNull();
    expect(buildStoryNodeProgress(message({ storyEvents: [{ type: 'narration', text: '屋里安静下来。' }] }))).toBeNull();
    expect(buildStoryNodeProgress(message({ storyEvents: [
      { type: 'speech', characterId: 'maid', text: '小姐，粥已经热好了。' },
      { type: 'choice_point', choices: [
        { label: '追问月奴昨夜铺床的细节', risk: '惊动背后的人', reward: '确认月奴立场' },
        { label: '先检查军器监烙印', risk: '错过追问时机', reward: '掌握物证' },
      ] },
    ] }))).toBeNull();
  });
});
