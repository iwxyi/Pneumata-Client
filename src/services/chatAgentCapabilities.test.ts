import { describe, expect, it } from 'vitest';
import { resolveChatAgentCapabilities } from './chatAgentCapabilities';

describe('resolveChatAgentCapabilities', () => {
  it('keeps agent disabled without either capability shape', () => {
    expect(resolveChatAgentCapabilities({ modeState: {} } as never).enabled).toBe(false);
  });

  it('prefers generic chat capability flags', () => {
    const result = resolveChatAgentCapabilities({ modeState: {
      agentCapabilities: { enabled: true, workspaceRead: true, chatArtifactWrite: false },
      assistantCapabilities: { agent: true, artifacts: true },
    } } as never);
    expect(result.workspaceRead).toBe(true);
    expect(result.chatArtifactWrite).toBe(false);
  });

  it('maps legacy assistant flags for compatibility', () => {
    const result = resolveChatAgentCapabilities({ modeState: { assistantCapabilities: { agent: true, artifacts: true, webSearch: true } } } as never);
    expect(result.enabled).toBe(true);
    expect(result.chatArtifactRead).toBe(true);
    expect(result.webSearch).toBe(true);
  });
});
