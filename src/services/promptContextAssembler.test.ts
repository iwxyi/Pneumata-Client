import { describe, expect, it } from 'vitest';
import { getPromptAdapter } from './promptContextAssembler';

describe('promptContextAssembler', () => {
  it('registers adapters by scenarioId aliases', () => {
    expect(getPromptAdapter('open-chat')).toBeTruthy();
    expect(getPromptAdapter('direct-chat')).toBeTruthy();
    expect(getPromptAdapter('ai-private-thread')).toBeTruthy();
    expect(getPromptAdapter('panel-interview')).toBeTruthy();
    expect(getPromptAdapter('werewolf-classic')).toBeTruthy();
  });
});
