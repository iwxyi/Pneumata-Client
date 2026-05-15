import type { AICharacter } from '../types/character';
import type { DriverMessageCommitTransition, GroupChat } from '../types/chat';
import type { Message } from '../types/message';

type MemoryMeasure = {
  usedJSHeapSize?: number | null;
  totalJSHeapSize?: number | null;
  jsHeapSizeLimit?: number | null;
  userAgentSpecificBytes?: number | null;
};

type RuntimeMemoryMonitorRecord = {
  id: number;
  at: number;
  label: string;
  chatId?: string;
  speakerId?: string;
  elapsedMs?: number;
  memory: MemoryMeasure;
  counts?: Record<string, number>;
  sizes?: Record<string, number>;
  extra?: Record<string, unknown>;
};

type MemoryPerformance = Performance & {
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{ bytes?: number }>;
};

type RuntimeMemoryMonitorApi = {
  enable: () => void;
  disable: () => void;
  verbose: (enabled?: boolean) => boolean;
  isEnabled: () => boolean;
  clear: () => void;
  export: () => RuntimeMemoryMonitorRecord[];
  latest: (count?: number) => RuntimeMemoryMonitorRecord[];
  summary: () => RuntimeMemoryMonitorRecord | null;
  snapshot: () => Promise<RuntimeMemoryForensicsSnapshot>;
  mark: () => Promise<RuntimeMemoryForensicsSnapshot>;
  diff: () => Promise<Record<string, number> | null>;
  watch: (options?: { intervalMs?: number; limit?: number }) => () => void;
};

type SizedEntry = {
  id: string;
  label?: string;
  size: number;
  counts?: Record<string, number>;
  fields?: Record<string, number>;
};

type RuntimeMemoryForensicsSnapshot = {
  at: number;
  memory: MemoryMeasure;
  totals: Record<string, number>;
  largest: {
    chats: SizedEntry[];
    characters: SizedEntry[];
    messageWindows: SizedEntry[];
    localStorage: SizedEntry[];
  };
};

const STORAGE_KEY = 'mirageTea-runtime-memory-monitor';
const VERBOSE_STORAGE_KEY = 'mirageTea-runtime-memory-monitor-verbose';
const MAX_RECORDS = 200;
const records: RuntimeMemoryMonitorRecord[] = [];
const jsonSizeCache = new WeakMap<object, number>();
let nextRecordId = 1;
let markedForensicsSnapshot: RuntimeMemoryForensicsSnapshot | null = null;

function getGlobalFlag() {
  return Boolean((globalThis as { __MIRAGETEA_MEMORY_MONITOR_ENABLED__?: boolean }).__MIRAGETEA_MEMORY_MONITOR_ENABLED__);
}

export function isRuntimeMemoryMonitorEnabled() {
  if (getGlobalFlag()) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setRuntimeMemoryMonitorEnabled(enabled: boolean) {
  (globalThis as { __MIRAGETEA_MEMORY_MONITOR_ENABLED__?: boolean }).__MIRAGETEA_MEMORY_MONITOR_ENABLED__ = enabled;
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage availability
  }
}

function isRuntimeMemoryMonitorVerbose() {
  try {
    return localStorage.getItem(VERBOSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setRuntimeMemoryMonitorVerbose(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(VERBOSE_STORAGE_KEY, '1');
    else localStorage.removeItem(VERBOSE_STORAGE_KEY);
  } catch {
    // ignore storage availability
  }
  return enabled;
}

function readMemory(): MemoryMeasure {
  const perf = globalThis.performance as MemoryPerformance | undefined;
  const memory = perf?.memory;
  return {
    usedJSHeapSize: typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null,
    totalJSHeapSize: typeof memory?.totalJSHeapSize === 'number' ? memory.totalJSHeapSize : null,
    jsHeapSizeLimit: typeof memory?.jsHeapSizeLimit === 'number' ? memory.jsHeapSizeLimit : null,
  };
}

async function readUserAgentSpecificMemory(recordId: number) {
  const perf = globalThis.performance as MemoryPerformance | undefined;
  if (typeof perf?.measureUserAgentSpecificMemory !== 'function') return;
  try {
    const result = await perf.measureUserAgentSpecificMemory();
    const record = records.find((item) => item.id === recordId);
    if (record) record.memory.userAgentSpecificBytes = typeof result.bytes === 'number' ? result.bytes : null;
  } catch {
    // Chromium may reject this API without cross-origin isolation.
  }
}

function safeJsonSize(value: unknown) {
  if (!isRuntimeMemoryMonitorEnabled() || value == null) return 0;
  if (typeof value === 'object' || typeof value === 'function') {
    const cached = jsonSizeCache.get(value);
    if (typeof cached === 'number') return cached;
  }
  try {
    const size = JSON.stringify(value).length;
    if (typeof value === 'object' || typeof value === 'function') {
      jsonSizeCache.set(value, size);
    }
    return size;
  } catch {
    return -1;
  }
}

function directJsonSize(value: unknown) {
  if (value == null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return -1;
  }
}

function topEntries(entries: SizedEntry[], limit = 10) {
  return [...entries].sort((left, right) => right.size - left.size).slice(0, limit);
}

function sizeLocalStorageEntries() {
  if (typeof localStorage === 'undefined') return [];
  const entries: SizedEntry[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (!key.toLowerCase().includes('miragetea')) continue;
    const value = localStorage.getItem(key) || '';
    entries.push({ id: key, size: value.length });
  }
  return entries;
}

async function readForensicsStores() {
  const [{ useChatStore }, { useCharacterStore }, { useMessageStore }] = await Promise.all([
    import('../stores/useChatStore'),
    import('../stores/useCharacterStore'),
    import('../stores/useMessageStore'),
  ]);
  return {
    chatState: useChatStore.getState(),
    characterState: useCharacterStore.getState(),
    messageState: useMessageStore.getState(),
  };
}

function sizeChatEntry(chat: GroupChat): SizedEntry {
  const fields = {
    worldState: directJsonSize(chat.worldState),
    layeredMemories: directJsonSize(chat.layeredMemories),
    runtimeSeed: directJsonSize(chat.runtimeSeed),
    runtimeTimeline: directJsonSize(chat.runtimeTimeline),
    runtimeEventsV2: directJsonSize(chat.runtimeEventsV2),
    relationshipLedger: directJsonSize(chat.relationshipLedger),
    modeState: directJsonSize(chat.modeState),
    scenarioState: directJsonSize(chat.scenarioState),
  };
  return {
    id: chat.id,
    label: chat.name,
    size: directJsonSize(chat),
    counts: {
      layeredMemories: chat.layeredMemories?.length || 0,
      runtimeTimeline: chat.runtimeTimeline?.length || 0,
      runtimeEventsV2: chat.runtimeEventsV2?.length || 0,
      relationshipLedger: chat.relationshipLedger?.length || 0,
      relationshipLedgerRecentEvents: (chat.relationshipLedger || []).reduce((sum, item) => sum + (item.recentEvents?.length || 0), 0),
      conflictAxes: chat.worldState?.conflictAxes?.length || 0,
      activeConflicts: chat.worldState?.conflictState?.activeConflicts?.length || 0,
    },
    fields,
  };
}

function sizeCharacterEntry(character: AICharacter): SizedEntry {
  const fields = {
    relationships: directJsonSize(character.relationships),
    layeredMemories: directJsonSize(character.layeredMemories),
    runtimeTimeline: directJsonSize(character.runtimeTimeline),
    memory: directJsonSize(character.memory),
    emotionalState: directJsonSize(character.emotionalState),
    personalityDrift: directJsonSize(character.personalityDrift),
    behavior: directJsonSize(character.behavior),
  };
  return {
    id: character.id,
    label: character.name,
    size: directJsonSize(character),
    counts: {
      relationships: character.relationships?.length || 0,
      layeredMemories: character.layeredMemories?.length || 0,
      runtimeTimeline: character.runtimeTimeline?.length || 0,
      memoryLongTerm: character.memory?.longTerm?.length || 0,
      memoryUser: character.memory?.userMemories?.length || 0,
    },
    fields,
  };
}

function sizeMessageWindowEntry(chatId: string, window: { messages?: Message[]; updatedAt?: number }): SizedEntry {
  const messages = window.messages || [];
  return {
    id: chatId,
    size: directJsonSize(window),
    counts: {
      messages: messages.length,
      eventMessages: messages.filter((message) => message.type === 'event').length,
      streamingMessages: messages.filter((message) => message.isStreaming).length,
      deletedMessages: messages.filter((message) => message.isDeleted).length,
      totalContentChars: messages.reduce((sum, message) => sum + (message.content?.length || 0), 0),
    },
    fields: {
      messages: directJsonSize(messages),
    },
  };
}

async function createForensicsSnapshot(limit = 10): Promise<RuntimeMemoryForensicsSnapshot> {
  const { chatState, characterState, messageState } = await readForensicsStores();
  const chatEntries = chatState.chats.map(sizeChatEntry);
  const characterEntries = characterState.characters.map(sizeCharacterEntry);
  const messageWindowEntries = Object.entries(messageState.messageWindowsByChatId)
    .map(([chatId, window]) => sizeMessageWindowEntry(chatId, window));
  const localStorageEntries = sizeLocalStorageEntries();
  const snapshot = {
    at: Date.now(),
    memory: readMemory(),
    totals: {
      chats: directJsonSize(chatState.chats),
      characters: directJsonSize(characterState.characters),
      activeMessages: directJsonSize(messageState.messages),
      messageWindows: directJsonSize(messageState.messageWindowsByChatId),
      chatPendingOperations: directJsonSize(chatState.pendingOperations),
      characterPendingOperations: directJsonSize(characterState.pendingOperations),
      messagePendingOperations: directJsonSize(messageState.pendingOperations),
      localStorage: localStorageEntries.reduce((sum, entry) => sum + Math.max(0, entry.size), 0),
      domNodes: countDomNodes().domNodes,
    },
    largest: {
      chats: topEntries(chatEntries, limit),
      characters: topEntries(characterEntries, limit),
      messageWindows: topEntries(messageWindowEntries, limit),
      localStorage: topEntries(localStorageEntries, limit),
    },
  };
  console.info('[memory-forensics] snapshot', snapshot);
  return snapshot;
}

function countChatRuntime(chat: GroupChat | null | undefined) {
  const empty = {
    chatLayeredMemories: 0,
    chatRuntimeEventsV2: 0,
    chatRuntimeTimeline: 0,
    relationshipLedger: 0,
    relationshipLedgerRecentEvents: 0,
    conflictAxes: 0,
    activeConflicts: 0,
  };
  if (!chat) return empty;
  return {
    ...empty,
    chatLayeredMemories: chat.layeredMemories?.length || empty.chatLayeredMemories,
    chatRuntimeEventsV2: chat.runtimeEventsV2?.length || empty.chatRuntimeEventsV2,
    chatRuntimeTimeline: chat.runtimeTimeline?.length || empty.chatRuntimeTimeline,
    relationshipLedger: chat.relationshipLedger?.length || empty.relationshipLedger,
    relationshipLedgerRecentEvents: (chat.relationshipLedger || []).reduce((sum, item) => sum + (item.recentEvents?.length || 0), empty.relationshipLedgerRecentEvents),
    conflictAxes: chat.worldState?.conflictAxes?.length || empty.conflictAxes,
    activeConflicts: chat.worldState?.conflictState?.activeConflicts?.length || empty.activeConflicts,
  };
}

function countCharacters(characters: AICharacter[] | null | undefined) {
  const list = characters || [];
  return {
    characters: list.length,
    characterRelationships: list.reduce((sum, item) => sum + (item.relationships?.length || 0), 0),
    characterLayeredMemories: list.reduce((sum, item) => sum + (item.layeredMemories?.length || 0), 0),
    characterRuntimeTimeline: list.reduce((sum, item) => sum + (item.runtimeTimeline?.length || 0), 0),
  };
}

function countDomNodes() {
  if (typeof document === 'undefined') {
    return {
      domNodes: 0,
      messageDomNodes: 0,
      eventMessageDomNodes: 0,
      dialogDomNodes: 0,
    };
  }
  return {
    domNodes: document.querySelectorAll('*').length,
    messageDomNodes: document.querySelectorAll('[data-message-id]').length,
    eventMessageDomNodes: document.querySelectorAll('[data-message-type="event"]').length,
    dialogDomNodes: document.querySelectorAll('[role="dialog"], .MuiModal-root').length,
  };
}

function sizeChatRuntimeFields(chat: GroupChat | null | undefined) {
  if (!isRuntimeMemoryMonitorVerbose()) {
    return {
      chatWorldStateJson: 0,
      chatRuntimeSeedJson: 0,
      chatLayeredMemoriesJson: 0,
      chatRuntimeTimelineJson: 0,
      chatRuntimeEventsV2Json: 0,
      chatRelationshipLedgerJson: 0,
    };
  }
  return {
    chatWorldStateJson: safeJsonSize(chat?.worldState),
    chatRuntimeSeedJson: safeJsonSize(chat?.runtimeSeed),
    chatLayeredMemoriesJson: safeJsonSize(chat?.layeredMemories),
    chatRuntimeTimelineJson: safeJsonSize(chat?.runtimeTimeline),
    chatRuntimeEventsV2Json: safeJsonSize(chat?.runtimeEventsV2),
    chatRelationshipLedgerJson: safeJsonSize(chat?.relationshipLedger),
  };
}

function sizeChatPatchRuntimeFields(patch: Partial<GroupChat> | null | undefined) {
  return {
    patchWorldStateJson: safeJsonSize(patch?.worldState),
    patchRuntimeSeedJson: safeJsonSize(patch?.runtimeSeed),
    patchLayeredMemoriesJson: safeJsonSize(patch?.layeredMemories),
    patchRuntimeTimelineJson: safeJsonSize(patch?.runtimeTimeline),
    patchRuntimeEventsV2Json: safeJsonSize(patch?.runtimeEventsV2),
    patchRelationshipLedgerJson: safeJsonSize(patch?.relationshipLedger),
  };
}

function sizeRuntimeDelta(delta: DriverMessageCommitTransition['chatRuntimeDelta'] | null | undefined) {
  return {
    runtimeDeltaJson: safeJsonSize(delta),
    runtimeDeltaEventsJson: safeJsonSize(delta?.runtimeEventsV2),
    runtimeDeltaLedgerJson: safeJsonSize(delta?.relationshipLedger),
  };
}

export function summarizeRuntimeMemoryState(params: {
  chat?: GroupChat | null;
  characters?: AICharacter[] | null;
  messages?: Message[] | null;
  transition?: DriverMessageCommitTransition | null;
}) {
  const transition = params.transition;
  const verbose = isRuntimeMemoryMonitorVerbose();
  return {
    counts: {
      messages: params.messages?.length || 0,
      transitionRuntimeEvents: transition?.runtimeEvents?.length || 0,
      transitionCharacterPatches: transition?.characterPatches?.length || 0,
      ...countChatRuntime(params.chat),
      ...countCharacters(params.characters),
      ...countDomNodes(),
    },
    sizes: {
      chatJson: verbose ? safeJsonSize(params.chat) : 0,
      charactersJson: verbose ? safeJsonSize(params.characters) : 0,
      messagesJson: verbose ? safeJsonSize(params.messages) : 0,
      transitionJson: safeJsonSize(transition),
      chatPatchJson: safeJsonSize(transition?.chatPatch),
      characterPatchesJson: safeJsonSize(transition?.characterPatches),
      runtimeEventsJson: safeJsonSize(transition?.runtimeEvents),
      ...sizeChatRuntimeFields(params.chat),
      ...sizeChatPatchRuntimeFields(transition?.chatPatch),
      ...sizeRuntimeDelta(transition?.chatRuntimeDelta),
    },
  };
}

export function recordRuntimeMemory(label: string, params: {
  chatId?: string;
  speakerId?: string;
  startedAt?: number;
  chat?: GroupChat | null;
  characters?: AICharacter[] | null;
  messages?: Message[] | null;
  transition?: DriverMessageCommitTransition | null;
  extra?: Record<string, unknown>;
} = {}) {
  if (!isRuntimeMemoryMonitorEnabled()) return null;
  const snapshot = summarizeRuntimeMemoryState(params);
  const record: RuntimeMemoryMonitorRecord = {
    id: nextRecordId,
    at: Date.now(),
    label,
    chatId: params.chatId,
    speakerId: params.speakerId,
    elapsedMs: params.startedAt ? Math.round((performance.now() - params.startedAt) * 10) / 10 : undefined,
    memory: readMemory(),
    counts: snapshot.counts,
    sizes: snapshot.sizes,
    extra: params.extra,
  };
  nextRecordId += 1;
  records.push(record);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  void readUserAgentSpecificMemory(record.id);
  if (isRuntimeMemoryMonitorVerbose()) {
    console.info('[memory-monitor]', {
      id: record.id,
      label: record.label,
      usedJSHeapSize: record.memory.usedJSHeapSize,
      elapsedMs: record.elapsedMs,
      counts: record.counts,
      sizes: record.sizes,
      extra: record.extra,
    });
  }
  return record;
}

export function createRuntimeMemoryTimer(label: string, params: Parameters<typeof recordRuntimeMemory>[1] = {}) {
  if (!isRuntimeMemoryMonitorEnabled()) {
    return {
      mark: () => null,
      finish: () => null,
    };
  }
  const startedAt = performance.now();
  recordRuntimeMemory(`${label}:start`, { ...params, startedAt });
  return {
    mark: (step: string, nextParams: Parameters<typeof recordRuntimeMemory>[1] = {}) => recordRuntimeMemory(`${label}:${step}`, {
      ...params,
      ...nextParams,
      startedAt,
    }),
    finish: (nextParams: Parameters<typeof recordRuntimeMemory>[1] = {}) => recordRuntimeMemory(`${label}:finish`, {
      ...params,
      ...nextParams,
      startedAt,
    }),
  };
}

function buildMonitorApi(): RuntimeMemoryMonitorApi {
  return {
    enable: () => {
      setRuntimeMemoryMonitorEnabled(true);
      console.info('[memory-monitor] enabled');
    },
    disable: () => {
      setRuntimeMemoryMonitorEnabled(false);
      console.info('[memory-monitor] disabled');
    },
    verbose: (enabled) => {
      if (typeof enabled === 'boolean') return setRuntimeMemoryMonitorVerbose(enabled);
      return isRuntimeMemoryMonitorVerbose();
    },
    isEnabled: isRuntimeMemoryMonitorEnabled,
    clear: () => {
      records.splice(0, records.length);
    },
    export: () => records.slice(),
    latest: (count = 20) => records.slice(-count),
    summary: () => records.at(-1) || null,
    snapshot: () => createForensicsSnapshot(),
    mark: async () => {
      markedForensicsSnapshot = await createForensicsSnapshot();
      console.info('[memory-forensics] marked baseline', markedForensicsSnapshot);
      return markedForensicsSnapshot;
    },
    diff: async () => {
      if (!markedForensicsSnapshot) {
        console.warn('[memory-forensics] no baseline; call mark() first');
        return null;
      }
      const snapshot = await createForensicsSnapshot();
      const delta = {
        usedJSHeapSize: (snapshot.memory.usedJSHeapSize || 0) - (markedForensicsSnapshot.memory.usedJSHeapSize || 0),
        totalJSHeapSize: (snapshot.memory.totalJSHeapSize || 0) - (markedForensicsSnapshot.memory.totalJSHeapSize || 0),
        ...Object.fromEntries(Object.entries(snapshot.totals).map(([key, value]) => [key, value - (markedForensicsSnapshot?.totals[key] || 0)])),
      };
      console.info('[memory-forensics] diff from marked baseline', delta);
      return delta;
    },
    watch: (options = {}) => {
      const intervalMs = options.intervalMs ?? 5000;
      const limit = options.limit ?? 5;
      let previous: RuntimeMemoryForensicsSnapshot | null = null;
      const timer = window.setInterval(() => {
        void createForensicsSnapshot(limit).then((snapshot) => {
          if (previous) {
            console.info('[memory-forensics] delta', {
              at: snapshot.at,
              heapDelta: (snapshot.memory.usedJSHeapSize || 0) - (previous.memory.usedJSHeapSize || 0),
              totalsDelta: Object.fromEntries(Object.entries(snapshot.totals).map(([key, value]) => [key, value - (previous?.totals[key] || 0)])),
            });
          }
          previous = snapshot;
        });
      }, intervalMs);
      void createForensicsSnapshot(limit).then((snapshot) => {
        previous = snapshot;
      });
      return () => window.clearInterval(timer);
    },
  };
}

declare global {
  interface Window {
    __MIRAGETEA_MEMORY_MONITOR__?: RuntimeMemoryMonitorApi;
  }
}

if (typeof window !== 'undefined') {
  window.__MIRAGETEA_MEMORY_MONITOR__ = window.__MIRAGETEA_MEMORY_MONITOR__ || buildMonitorApi();
}
