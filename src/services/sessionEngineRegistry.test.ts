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

  it('resolves new scenario families before legacy family fallback', () => {
    expect(resolveSessionFamilyKey(chat({
      mode: 'open_chat',
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'opinion-review', surfaceProfile: 'text' },
    }))).toBe('analysis');
    expect(resolveSessionEngineKey(chat({
      mode: 'open_chat',
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'ielts-coach', surfaceProfile: 'form' },
    }))).toBe('classroom');
  });

  it('keeps legacy family fallback and mode-derived engine mapping', () => {
    expect(resolveSessionEngineKey(chat({ mode: 'werewolf' }))).toBe('werewolf');
    expect(resolveSessionFamilyKey(chat({ mode: 'murder_mystery' }))).toBe('mystery');
  });

  it('falls back to open chat engine when neither scenario nor family resolves', () => {
    expect(resolveSessionEngineKey(chat({ mode: 'scripted_play' }))).toBe('open_chat');
  });

  it('prefers sessionKind family when scenario is absent', () => {
    expect(resolveSessionFamilyKey(chat({
      mode: 'open_chat',
      sessionKind: { topology: 'group', family: 'board_game', scenarioId: '', surfaceProfile: 'board' },
    }))).toBe('board_game');
  });
});
