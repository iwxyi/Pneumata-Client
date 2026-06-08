import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LocalCloudBootstrapSnapshot } from './localToCloudBootstrap';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { DEFAULT_SETTINGS } from '../types/settings';

const localStore = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => { localStore.set(key, value); },
  removeItem: (key: string) => { localStore.delete(key); },
  clear: () => { localStore.clear(); },
  key: (index: number) => Array.from(localStore.keys())[index] ?? null,
  get length() { return localStore.size; },
});

let bootstrap: Awaited<typeof import('./localToCloudBootstrap')>;

beforeAll(async () => {
  bootstrap = await import('./localToCloudBootstrap');
});

function character(id: string, name: string, extra: Partial<AICharacter> = {}) {
  return {
    id,
    name,
    avatar: '🙂',
    personality: {},
    expertise: [],
    speakingStyle: '',
    background: '',
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as AICharacter;
}

function chat(id: string, name: string, extra: Partial<GroupChat> = {}) {
  return {
    id,
    type: 'group',
    mode: 'free',
    name,
    topic: '',
    style: '',
    memberIds: [],
    speed: 'normal',
    isActive: true,
    allowIntervention: true,
    showRoleActions: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as GroupChat;
}

function snapshot(overrides: Partial<LocalCloudBootstrapSnapshot> = {}): LocalCloudBootstrapSnapshot {
  return {
    characters: [],
    chats: [],
    messageWindowsByChatId: {},
    settingsShouldUpload: true,
    ...overrides,
  };
}

describe('localToCloudBootstrap', () => {
  it('does not upload default settings during local bootstrap', () => {
    expect(bootstrap.shouldUploadSettingsDuringBootstrap(DEFAULT_SETTINGS as ReturnType<typeof import('../stores/useSettingsStore').useSettingsStore.getState>)).toBe(false);
    expect(bootstrap.shouldUploadSettingsDuringBootstrap({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
    } as ReturnType<typeof import('../stores/useSettingsStore').useSettingsStore.getState>)).toBe(true);
  });

  it('uploads settings-only bootstrap without fetching remote entity summaries', async () => {
    localStore.clear();
    const originalApi = await import('./api');
    const getSyncChanges = vi.spyOn(originalApi.api, 'getSyncChanges');
    const createCharacter = vi.spyOn(originalApi.api, 'createCharacter');
    const createChat = vi.spyOn(originalApi.api, 'createChat');
    const syncSettings = vi.spyOn((await import('../stores/useSettingsStore')).useSettingsStore.getState(), 'syncCurrentSettingsToServer').mockResolvedValue(undefined);

    await bootstrap.bootstrapLocalDataToCloud(snapshot({
      settingsShouldUpload: true,
    }));

    expect(syncSettings).toHaveBeenCalledTimes(1);
    expect(getSyncChanges).not.toHaveBeenCalled();
    expect(createCharacter).not.toHaveBeenCalled();
    expect(createChat).not.toHaveBeenCalled();

    getSyncChanges.mockRestore();
    createCharacter.mockRestore();
    createChat.mockRestore();
    syncSettings.mockRestore();
  });

  it('builds a summary reconcile plan before uploading local data', () => {
    const plan = bootstrap.createBootstrapReconcilePlan(
      snapshot({
        characters: [
          character('local-a', '阿青'),
          character('cloud-existing', '已有角色'),
          character('preset-local', '预设', { isPreset: true }),
          character('deleted-local', '本地已删', { deletedAt: 10 }),
        ],
        chats: [
          chat('local-chat', '本地群聊'),
          chat('cloud-chat', '已有群聊'),
          chat('deleted-chat', '本地已删', { deletedAt: 10 }),
        ],
      }),
      {
        characters: [
          { id: 'cloud-existing', name: '已有角色', isPreset: false, deletedAt: null },
          { id: 'remote-same-name', name: '阿青', isPreset: false, deletedAt: null },
        ],
        chats: [
          { id: 'cloud-chat', name: '已有群聊', deletedAt: null },
        ],
      },
    );

    expect(plan.charactersToCreate.map((item) => item.id)).toEqual(['local-a']);
    expect(plan.charactersAlreadyRemote.map((item) => item.id)).toEqual(['cloud-existing']);
    expect(plan.characterNameConflicts).toEqual([{
      localId: 'local-a',
      localName: '阿青',
      remoteId: 'remote-same-name',
      remoteName: '阿青',
    }]);
    expect(plan.chatsToCreate.map((item) => item.id)).toEqual(['local-chat']);
    expect(plan.chatsAlreadyRemote.map((item) => item.id)).toEqual(['cloud-chat']);
  });

  it('carries pending creates into the bootstrap reconcile plan', () => {
    const plan = bootstrap.createBootstrapReconcilePlan(
      snapshot({
        pendingCharacterOperations: [{
          id: 'char-op',
          kind: 'create',
          entityId: 'local-character',
          targetIds: ['local-character'],
          status: 'pending',
        }],
        pendingChatOperations: [{
          id: 'chat-op',
          kind: 'create',
          entityId: 'local-chat',
          targetIds: ['local-chat'],
          status: 'pending',
        }],
        pendingMessageOperations: [{
          id: 'message-op',
          kind: 'create',
          chatId: 'local-chat',
          localMessageId: 'local-message',
          status: 'pending',
        }],
      }),
      { characters: [], chats: [] },
    );

    expect(plan.pendingCharacterCreates.map((item) => item.id)).toEqual(['char-op']);
    expect(plan.pendingChatCreates.map((item) => item.id)).toEqual(['chat-op']);
    expect(plan.pendingMessageCreates.map((item) => item.id)).toEqual(['message-op']);
  });

  it('limits persisted bootstrap conflict details while keeping the total count', async () => {
    localStore.clear();
    const conflicts = Array.from({ length: 25 }, (_, index) => character(`local-${index}`, `重复${index}`));
    const remoteCharacters = conflicts.map((item, index) => ({
      id: `remote-${index}`,
      name: item.name,
      isPreset: false,
      deletedAt: null,
    }));
    const originalApi = await import('./api');
    const getSyncChanges = vi.spyOn(originalApi.api, 'getSyncChanges').mockImplementation(async ({ scope }) => {
      if (scope === 'characters.summary') {
        return {
          status: 'modified',
          scope,
          cursor: 'characters',
          revision: 'characters',
          changes: remoteCharacters.map((character) => ({
            entity: 'character_summary',
            id: character.id,
            updatedAt: 1,
            deletedAt: null,
            patch: character,
          })),
        } as Awaited<ReturnType<typeof originalApi.api.getSyncChanges>>;
      }
      return {
        status: 'modified',
        scope,
        cursor: 'chats',
        revision: 'chats',
        changes: [],
      } as Awaited<ReturnType<typeof originalApi.api.getSyncChanges>>;
    });
    const syncSettings = vi.spyOn((await import('../stores/useSettingsStore')).useSettingsStore.getState(), 'syncCurrentSettingsToServer').mockResolvedValue(undefined);
    const createCharacter = vi.spyOn(originalApi.api, 'createCharacter').mockImplementation(async (payload) => ({
      id: `created-${String(payload.name)}`,
      ...payload,
    }) as Awaited<ReturnType<typeof originalApi.api.createCharacter>>);

    await bootstrap.bootstrapLocalDataToCloud(snapshot({
      characters: conflicts,
      settingsShouldUpload: false,
      pendingCharacterOperations: [{
        id: 'character-create-local-0',
        kind: 'create',
        entityId: 'local-0',
        targetIds: ['local-0'],
        status: 'pending',
      }],
    }));

    const statusModule = await import('./cloudSyncBootstrapStatus');
    const status = statusModule.readCloudSyncBootstrapStatus();
    expect(status?.characterNameConflicts).toBe(25);
    expect(status?.characterNameConflictDetails).toHaveLength(statusModule.BOOTSTRAP_STATUS_CONFLICT_DETAIL_LIMIT);
    expect(status?.characterNameConflictDetailOverflow).toBe(5);
    expect(createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      id: 'local-0',
      operationId: 'character-create-local-0',
    }));

    getSyncChanges.mockRestore();
    syncSettings.mockRestore();
    createCharacter.mockRestore();
  });
});
