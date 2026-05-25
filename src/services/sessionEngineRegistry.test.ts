import { describe, expect, it } from 'vitest';
import type { GroupChat } from '../types/chat';
import { resolveSessionEngineKey, resolveSessionFamilyKey } from './sessionEngineRegistry';

function chat(input: Pick<GroupChat, 'mode'> & Partial<Pick<GroupChat, 'sessionKind'>>) {
  return input as Pick<GroupChat, 'mode' | 'sessionKind'>;
}

describe('sessionEngineRegistry', () => {
  it('resolves engine by scenario before mode fallback', () => {
    expect(resolveSessionEngineKey(chat({
      mode: 'open_chat',
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'panel-interview', surfaceProfile: 'form' },
    }))).toBe('interview');
  });

  it('resolves engine by family when scenario is absent', () => {
    expect(resolveSessionEngineKey(chat({
      mode: 'open_chat',
      sessionKind: { topology: 'group', family: 'deduction', scenarioId: '', surfaceProfile: 'hybrid' },
    }))).toBe('werewolf');
  });

  it('keeps legacy mode fallback and family labels', () => {
    expect(resolveSessionEngineKey(chat({ mode: 'werewolf' }))).toBe('werewolf');
    expect(resolveSessionFamilyKey(chat({ mode: 'murder_mystery' }))).toBe('mystery');
  });
});
