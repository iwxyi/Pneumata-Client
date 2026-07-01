import { describe, expect, it } from 'vitest';
import { resolveStorySidebarTab, splitSidebarActions } from './useChatSidebarProjection';

describe('resolveStorySidebarTab', () => {
  it('keeps explicit story asset tabs', () => {
    expect(resolveStorySidebarTab('narrative')).toBe('session');
    expect(resolveStorySidebarTab('chapters')).toBe('chapters');
    expect(resolveStorySidebarTab('clues')).toBe('clues');
    expect(resolveStorySidebarTab('roles')).toBe('roles');
    expect(resolveStorySidebarTab('developer')).toBe('developer');
  });

  it('maps ordinary chat tabs to the story overview instead of member management', () => {
    expect(resolveStorySidebarTab('members')).toBe('session');
    expect(resolveStorySidebarTab('world')).toBe('session');
    expect(resolveStorySidebarTab('actions')).toBe('session');
    expect(resolveStorySidebarTab('activities')).toBe('session');
  });
});

describe('splitSidebarActions', () => {
  it('keeps gameplay actions in the session tab and private thread actions in activities', () => {
    const groups = splitSidebarActions([
      { type: 'question_member', label: '质询成员' },
      { type: 'start_private_thread', label: '发起 AI 私聊' },
      { type: 'summarize_discussion', label: '总结审议' },
      { type: 'attention_followup_user', label: '跟进用户' },
    ]);

    expect(groups.sessionActions.map((action) => action.type)).toEqual(['question_member', 'summarize_discussion']);
    expect(groups.activityActions.map((action) => action.type)).toEqual(['start_private_thread', 'attention_followup_user']);
  });
});
