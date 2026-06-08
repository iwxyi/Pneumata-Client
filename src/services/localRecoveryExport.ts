import { useAuthStore } from '../stores/useAuthStore';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { PersistenceFailureSnapshot } from './persistenceHealth';

type SizedStorageEntry = {
  key: string;
  sizeBytes: number;
};

function textSizeBytes(value: string) {
  if (typeof Blob !== 'undefined') return new Blob([value]).size;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length;
}

function listLocalStorageSizes(limit = 20): { largest: SizedStorageEntry[]; totalBytes: number } {
  if (typeof localStorage === 'undefined') return { largest: [], totalBytes: 0 };
  const entries: SizedStorageEntry[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    entries.push({ key, sizeBytes: textSizeBytes(localStorage.getItem(key) || '') });
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  return { largest: entries.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, limit), totalBytes };
}

function redactSettings(settings: ReturnType<typeof useSettingsStore.getState>) {
  return {
    api: { ...settings.api, apiKey: '' },
    aiProfiles: (settings.aiProfiles || []).map((profile) => ({ ...profile, apiKey: '' })),
    theme: settings.theme,
    themeColor: settings.themeColor,
    language: settings.language,
    defaultSpeed: settings.defaultSpeed,
    aiGeneration: settings.aiGeneration,
    chatDraftDefaults: settings.chatDraftDefaults,
    customBubbleStyles: settings.customBubbleStyles,
    userBubbleStyleId: settings.userBubbleStyleId,
    userBubbleStyle: settings.userBubbleStyle,
    artifactAppearance: settings.artifactAppearance,
    companionship: settings.companionship,
    developerMode: settings.developerMode,
    developerUI: settings.developerUI,
    memoryUI: settings.memoryUI,
  };
}

function summarizeMessageWindows(messageWindowsByChatId: ReturnType<typeof useMessageStore.getState>['messageWindowsByChatId']) {
  return Object.fromEntries(Object.entries(messageWindowsByChatId || {}).map(([chatId, window]) => [
    chatId,
    {
      remoteExhausted: window.remoteExhausted,
      lastSyncedAt: window.lastSyncedAt,
      updatedAt: window.updatedAt,
      messageCount: window.messages?.length || 0,
    },
  ]));
}

export function buildLocalRecoverySnapshot(params?: {
  persistenceFailures?: PersistenceFailureSnapshot[];
}) {
  const authStore = useAuthStore.getState();
  const characterStore = useCharacterStore.getState();
  const chatStore = useChatStore.getState();
  const messageStore = useMessageStore.getState();
  const artifactStore = useCharacterArtifactStore.getState();
  const settingsStore = useSettingsStore.getState();
  const messageWindowsByChatId = messageStore.messageWindowsByChatId || {};
  const localStorageSizes = listLocalStorageSizes();
  const snapshot = {
    version: 1,
    exportedAt: Date.now(),
    auth: {
      authMode: authStore.authMode,
      userId: authStore.user?.id || null,
      nickname: authStore.user?.nickname || null,
    },
    persistence: {
      failures: params?.persistenceFailures || [],
      localStorageLargest: localStorageSizes.largest,
      localStorageTotalBytes: localStorageSizes.totalBytes,
    },
    summary: {
      characters: characterStore.characters.length,
      chats: chatStore.chats.length,
      activeMessages: messageStore.messages.length,
      messageWindows: Object.keys(messageWindowsByChatId).length,
      windowedMessages: Object.values(messageWindowsByChatId).reduce((sum, window) => sum + (window.messages?.length || 0), 0),
      artifacts: artifactStore.items.length,
      artifactJobs: artifactStore.jobs.length,
      pending: {
        characters: characterStore.pendingOperations?.length || 0,
        chats: chatStore.pendingOperations?.length || 0,
        messages: messageStore.pendingOperations?.length || 0,
        artifactJobs: artifactStore.jobs.filter((job) => job.status === 'pending' || job.status === 'running' || job.status === 'failed').length,
      },
    },
    data: {
      characters: characterStore.characters,
      chats: chatStore.chats,
      activeMessages: messageStore.messages,
      messageWindowsByChatId,
      messageWindowIndex: summarizeMessageWindows(messageWindowsByChatId),
      characterArtifacts: {
        items: artifactStore.items,
        jobs: artifactStore.jobs,
      },
      pendingOperations: {
        characters: characterStore.pendingOperations || [],
        chats: chatStore.pendingOperations || [],
        messages: messageStore.pendingOperations || [],
      },
      settings: redactSettings(settingsStore),
    },
  };
  return snapshot;
}
