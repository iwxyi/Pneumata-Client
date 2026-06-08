import { describe, expect, it } from 'vitest';
import {
  getCalendarSyncScopeContract,
  getChatDetailSyncScopeContract,
  getMomentsSyncScopeContract,
  getSyncableCharacterMemberIds,
} from './pageSyncScopeContract';

describe('pageSyncScopeContract', () => {
  it('keeps chat detail local-first and limited to the current chat, message window, and member details', () => {
    const contract = getChatDetailSyncScopeContract({
      chatId: 'chat-1',
      memberIds: ['character-a', 'user', 'director', 'character-b', 'character-a'],
    });

    expect(contract.localFirst).toBe(true);
    expect(contract.initialBackgroundScopes).toEqual([
      'chats.detail:chat-1',
      'messages.window:chat-1',
      'characters.detail:character-a',
      'characters.detail:character-b',
    ]);
    expect(contract.initialBackgroundScopes).not.toContain('chats.summary');
    expect(contract.initialBackgroundScopes).not.toContain('world-runtime.window');
    expect(contract.initialBackgroundScopes).not.toContain('characters.summary');
  });

  it('filters non-character chat members before declaring character detail scopes', () => {
    expect(getSyncableCharacterMemberIds([
      'character-a',
      'system',
      'user',
      'topic-guide',
      'narrator',
      'character-a',
      'character-b',
    ])).toEqual(['character-a', 'character-b']);
  });

  it('keeps moments on world runtime and character summaries without chat summaries', () => {
    const contract = getMomentsSyncScopeContract();

    expect(contract.localFirst).toBe(true);
    expect(contract.initialBackgroundScopes).toEqual(['world-runtime.window', 'characters.summary']);
    expect(contract.initialBackgroundScopes).not.toContain('chats.summary');
  });

  it('keeps calendar on world runtime and character summaries without chat summaries', () => {
    const contract = getCalendarSyncScopeContract();

    expect(contract.localFirst).toBe(true);
    expect(contract.initialBackgroundScopes).toEqual(['world-runtime.window', 'characters.summary']);
    expect(contract.initialBackgroundScopes).not.toContain('chats.summary');
  });
});

