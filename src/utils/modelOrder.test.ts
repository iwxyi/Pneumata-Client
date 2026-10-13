import { describe, expect, it } from 'vitest';
import { compareModelVersionsDescending } from './modelOrder';

describe('model version ordering', () => {
  it('puts larger version components first', () => {
    expect(['gpt-4.9', 'gpt-5.4', 'gpt-4.10', 'gpt-5.5'].sort(compareModelVersionsDescending))
      .toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-4.10', 'gpt-4.9']);
  });

  it('compares versions after variant names and ACE prefixes', () => {
    expect(['ace:chat:claude-opus-4.5', 'ace:chat:claude-sonnet-4.6', 'ace:chat:claude-3-7-sonnet'].sort(compareModelVersionsDescending))
      .toEqual(['ace:chat:claude-sonnet-4.6', 'ace:chat:claude-opus-4.5', 'ace:chat:claude-3-7-sonnet']);
  });

  it('puts named aliases after numbered versions', () => {
    expect(['nano-banana-pro', 'nano-banana-2', 'nano-banana-2.1'].sort(compareModelVersionsDescending))
      .toEqual(['nano-banana-2.1', 'nano-banana-2', 'nano-banana-pro']);
  });
});
