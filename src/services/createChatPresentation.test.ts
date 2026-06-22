import { describe, expect, it } from 'vitest';
import { buildIncludeUserAsMemberCopy } from './createChatPresentation';

describe('buildIncludeUserAsMemberCopy', () => {
  it('keeps the normal group-chat participation copy for non-story rooms', () => {
    expect(buildIncludeUserAsMemberCopy({ isZh: true, isStoryRoom: false, includeUserAsMember: true })).toEqual({
      label: '把我作为群成员',
      hint: '开启后，用户普通发言按群成员语义进入关系、关注与世界事件链路。',
    });
  });

  it('explains participant story choices when the user is in the story room', () => {
    const copy = buildIncludeUserAsMemberCopy({ isZh: true, isStoryRoom: true, includeUserAsMember: true });

    expect(copy.label).toBe('把我作为故事中的我');
    expect(copy.hint).toContain('故事中的“我”');
    expect(copy.hint).toContain('我……');
    expect(copy.hint).toContain('读者/导演');
  });

  it('explains director story choices when the user is outside the story room', () => {
    const copy = buildIncludeUserAsMemberCopy({ isZh: true, isStoryRoom: true, includeUserAsMember: false });

    expect(copy.label).toBe('把我作为故事中的我');
    expect(copy.hint).toContain('场外读者/导演');
    expect(copy.hint).toContain('具体角色行动');
    expect(copy.hint).toContain('我……');
  });
});
