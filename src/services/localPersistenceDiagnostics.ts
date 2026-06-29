import { readIndexedDbStorageDiagnostics, readIndexedDbStorageEntryValue } from '../stores/storePersistenceScope';

type PersistedStoreKind = 'messages' | 'chats' | 'characters' | 'characterArtifacts' | 'settings' | 'unknown';

export interface LocalPersistenceStoreDiagnostic {
  key: string;
  kind: PersistedStoreKind;
  sizeBytes: number;
  counts: Record<string, number>;
  largest?: Array<{ id: string; sizeBytes: number; counts?: Record<string, number> }>;
  parseError?: string;
}

export interface LocalPersistenceDiagnostics {
  totalBytes: number;
  entries: LocalPersistenceStoreDiagnostic[];
}

function byteSize(value: unknown) {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    try {
      return JSON.stringify(value).length;
    } catch {
      return -1;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function detectKind(key: string, state: Record<string, unknown>): PersistedStoreKind {
  if (state.messageWindowsByChatId) return 'messages';
  if (state.chats) return 'chats';
  if (state.characters) return 'characters';
  if (state.items || state.jobs) return 'characterArtifacts';
  if (key.includes('settings')) return 'settings';
  return 'unknown';
}

function topSizedEntries(entries: Array<{ id: string; value: unknown; counts?: Record<string, number> }>, limit = 8) {
  return entries
    .map((entry) => ({
      id: entry.id,
      sizeBytes: byteSize(entry.value),
      counts: entry.counts,
    }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, limit);
}

function summarizeMessageWindows(state: Record<string, unknown>) {
  const windows = asRecord(state.messageWindowsByChatId);
  const entries = Object.entries(windows).map(([chatId, rawWindow]) => {
    const window = asRecord(rawWindow);
    const messages = asArray(window.messages);
    return {
      id: chatId,
      value: rawWindow,
      counts: {
        messages: messages.length,
        contentChars: messages.reduce<number>((sum, rawMessage) => {
          const message = asRecord(rawMessage);
          return sum + (typeof message.content === 'string' ? message.content.length : 0);
        }, 0),
      },
    };
  });
  return {
    counts: {
      windows: entries.length,
      messages: entries.reduce((sum, entry) => sum + (entry.counts?.messages || 0), 0),
      pendingOperations: asArray(state.pendingOperations).length,
    },
    largest: topSizedEntries(entries),
  };
}

function summarizeChats(state: Record<string, unknown>) {
  const chats = asArray(state.chats);
  return {
    counts: {
      chats: chats.length,
      pendingOperations: asArray(state.pendingOperations).length,
    },
    largest: topSizedEntries(chats.map((rawChat) => {
      const chat = asRecord(rawChat);
      return {
        id: String(chat.id || 'chat'),
        value: rawChat,
        counts: {
          runtimeEventsV2: asArray(chat.runtimeEventsV2).length,
          relationshipLedger: asArray(chat.relationshipLedger).length,
          layeredMemories: asArray(chat.layeredMemories).length,
        },
      };
    })),
  };
}

function summarizeCharacters(state: Record<string, unknown>) {
  const characters = asArray(state.characters);
  return {
    counts: {
      characters: characters.length,
      pendingOperations: asArray(state.pendingOperations).length,
    },
    largest: topSizedEntries(characters.map((rawCharacter) => {
      const character = asRecord(rawCharacter);
      return {
        id: String(character.id || 'character'),
        value: rawCharacter,
        counts: {
          layeredMemories: asArray(character.layeredMemories).length,
          runtimeTimeline: asArray(character.runtimeTimeline).length,
          relationships: asArray(character.relationships).length,
        },
      };
    })),
  };
}

function summarizeArtifacts(state: Record<string, unknown>) {
  const items = asArray(state.items);
  const jobs = asArray(state.jobs);
  return {
    counts: {
      items: items.length,
      jobs: jobs.length,
      textChars: items.reduce<number>((sum, rawItem) => {
        const item = asRecord(rawItem);
        return sum + (typeof item.text === 'string' ? item.text.length : 0);
      }, 0),
    },
    largest: topSizedEntries(items.map((rawItem) => {
      const item = asRecord(rawItem);
      return {
        id: String(item.id || 'artifact'),
        value: rawItem,
        counts: {
          textChars: typeof item.text === 'string' ? item.text.length : 0,
        },
      };
    })),
  };
}

function summarizePersistedState(key: string, sizeBytes: number, raw: string | null): LocalPersistenceStoreDiagnostic {
  if (!raw) return { key, kind: 'unknown', sizeBytes, counts: {} };
  try {
    const parsed = JSON.parse(raw) as { state?: unknown };
    const state = asRecord(parsed.state);
    const kind = detectKind(key, state);
    const summary = kind === 'messages'
      ? summarizeMessageWindows(state)
      : kind === 'chats'
        ? summarizeChats(state)
        : kind === 'characters'
          ? summarizeCharacters(state)
          : kind === 'characterArtifacts'
            ? summarizeArtifacts(state)
            : { counts: {}, largest: undefined };
    return {
      key,
      kind,
      sizeBytes,
      counts: summary.counts,
      largest: summary.largest,
    };
  } catch (error) {
    return {
      key,
      kind: 'unknown',
      sizeBytes,
      counts: {},
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildLocalPersistenceDiagnostics(limit = 20): Promise<LocalPersistenceDiagnostics> {
  const diagnostics = await readIndexedDbStorageDiagnostics(limit);
  const entries = await Promise.all(diagnostics.largest.map(async (entry) => {
    const raw = await readIndexedDbStorageEntryValue(entry.key);
    return summarizePersistedState(entry.key, entry.sizeBytes, raw);
  }));
  return {
    totalBytes: diagnostics.totalBytes,
    entries,
  };
}

function installLocalPersistenceDiagnostics() {
  if (typeof window === 'undefined') return;
  const target = window as Window & {
    __PNEUMATA_PERSISTENCE_DIAGNOSTICS__?: {
      snapshot: (limit?: number) => Promise<LocalPersistenceDiagnostics>;
    };
  };
  target.__PNEUMATA_PERSISTENCE_DIAGNOSTICS__ = target.__PNEUMATA_PERSISTENCE_DIAGNOSTICS__ || {
    snapshot: async (limit = 20) => {
      const snapshot = await buildLocalPersistenceDiagnostics(limit);
      console.info('[persistence-diagnostics] snapshot', snapshot);
      return snapshot;
    },
  };
}

installLocalPersistenceDiagnostics();
