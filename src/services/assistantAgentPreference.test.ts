import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey } from '../constants/brand';
import {
  readAssistantAgentDefaultEnabled,
  readAssistantAgentPreference,
  writeAssistantAgentDefaultEnabled,
} from './assistantAgentPreference';

describe('assistantAgentPreference', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    });
  });

  it('defaults to enabled only when Agent is available and no choice was saved', () => {
    expect(readAssistantAgentPreference()).toBeNull();
    expect(readAssistantAgentDefaultEnabled(true)).toBe(true);
    expect(readAssistantAgentDefaultEnabled(false)).toBe(false);
  });

  it('persists an explicit choice for the current account', () => {
    values.set(storageKey('user'), JSON.stringify({ id: 'user-a' }));

    writeAssistantAgentDefaultEnabled(false);

    expect(readAssistantAgentDefaultEnabled(true)).toBe(false);
    expect(values.get(storageKey('assistant-agent-default-enabled:user-a'))).toBe('false');
  });

  it('keeps preferences isolated between accounts', () => {
    values.set(storageKey('user'), JSON.stringify({ id: 'user-a' }));
    writeAssistantAgentDefaultEnabled(false);
    values.set(storageKey('user'), JSON.stringify({ id: 'user-b' }));

    expect(readAssistantAgentPreference()).toBeNull();
    expect(readAssistantAgentDefaultEnabled(true)).toBe(true);
  });

  it('migrates the old global preference once into the current account', () => {
    values.set(storageKey('user'), JSON.stringify({ id: 'user-a' }));
    values.set(storageKey('assistant-agent-default-enabled'), 'true');

    expect(readAssistantAgentPreference()).toBe(true);
    expect(values.get(storageKey('assistant-agent-default-enabled:user-a'))).toBe('true');
    expect(values.has(storageKey('assistant-agent-default-enabled'))).toBe(false);
  });
});
