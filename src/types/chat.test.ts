import { describe, expect, it } from 'vitest';
import { normalizeConversation, resolveShowRoleActions } from './chat';

function baseChat() {
  return {
    id: 'chat-1',
    type: 'group' as const,
    mode: 'open_chat' as const,
    modeConfig: {
      freeSpeaking: true,
      allowInterruptions: true,
      allowPrivateThreads: true,
      allowDirectorInterventions: true,
      showRoleActions: true,
    },
    modeState: { phase: 'free' as const },
    name: '群聊',
    topic: '',
    style: 'free' as const,
    runtimeEvolutionIntensity: 'balanced' as const,
    memberIds: ['a'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  };
}

describe('normalizeConversation role action visibility', () => {
  it('uses modeConfig.showRoleActions for legacy records without the top-level flag', () => {
    const chat = normalizeConversation({
      ...baseChat(),
      showRoleActions: undefined,
      modeConfig: {
        ...baseChat().modeConfig,
        showRoleActions: false,
      },
    });

    expect(chat.showRoleActions).toBe(false);
    expect(chat.modeConfig.showRoleActions).toBe(false);
    expect(resolveShowRoleActions(chat)).toBe(false);
  });

  it('keeps top-level showRoleActions as the canonical value when fields disagree', () => {
    const chat = normalizeConversation({
      ...baseChat(),
      showRoleActions: false,
      modeConfig: {
        ...baseChat().modeConfig,
        showRoleActions: true,
      },
    });

    expect(chat.showRoleActions).toBe(false);
    expect(chat.modeConfig.showRoleActions).toBe(false);
    expect(resolveShowRoleActions(chat)).toBe(false);
  });
});
