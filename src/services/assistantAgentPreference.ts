import { scopedStorageKey } from '../constants/brand';
import { getLocalDataUserId } from './authStorageScope';

const ASSISTANT_AGENT_DEFAULT_KEY = 'assistant-agent-default-enabled';
const LEGACY_KEY = scopedStorageKey(ASSISTANT_AGENT_DEFAULT_KEY);

function preferenceKey() {
  return scopedStorageKey(`${ASSISTANT_AGENT_DEFAULT_KEY}:${getLocalDataUserId()}`);
}

function parseStoredBoolean(raw: string | null) {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

export function readAssistantAgentPreference(): boolean | null {
  if (typeof localStorage === 'undefined') return null;
  const accountValue = parseStoredBoolean(localStorage.getItem(preferenceKey()));
  if (accountValue != null) return accountValue;
  const legacyValue = parseStoredBoolean(localStorage.getItem(LEGACY_KEY));
  if (legacyValue != null) {
    localStorage.setItem(preferenceKey(), JSON.stringify(legacyValue));
    localStorage.removeItem(LEGACY_KEY);
    return legacyValue;
  }
  return null;
}

export function readAssistantAgentDefaultEnabled(agentAvailable = false) {
  return readAssistantAgentPreference() ?? agentAvailable;
}

export function writeAssistantAgentDefaultEnabled(enabled: boolean) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(preferenceKey(), JSON.stringify(enabled));
}
