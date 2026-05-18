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
  enableBrowserRuntimeCounters: () => boolean;
  areBrowserRuntimeCountersEnabled: () => boolean;
  clear: () => void;
  cleanup: () => void;
  export: () => RuntimeMemoryMonitorRecord[];
  latest: (count?: number) => RuntimeMemoryMonitorRecord[];
  summary: () => RuntimeMemoryMonitorRecord | null;
  snapshot: () => Promise<RuntimeMemoryForensicsSnapshot>;
  gcSnapshot: () => Promise<RuntimeMemoryForensicsSnapshot>;
  mark: () => Promise<RuntimeMemoryForensicsSnapshot>;
  diff: () => Promise<Record<string, number> | null>;
  watch: (options?: { intervalMs?: number; limit?: number }) => () => void;
};

type BrowserRuntimeCounters = {
  activeTimeouts: number;
  activeIntervals: number;
  activeAnimationFrames: number;
  activeFetches: number;
  totalFetches: number;
  fetchErrors: number;
  activeEventListeners: number;
  objectUrls: number;
  createdObjectUrls: number;
  revokedObjectUrls: number;
};

type BrowserTimeoutId = ReturnType<Window['setTimeout']>;
type BrowserIntervalId = ReturnType<Window['setInterval']>;

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
    activeMessages: SizedEntry[];
    messageWindows: SizedEntry[];
    chatPendingOperations: SizedEntry[];
    characterPendingOperations: SizedEntry[];
    messagePendingOperations: SizedEntry[];
    resources: SizedEntry[];
    localStorage: SizedEntry[];
    eventListeners: SizedEntry[];
  };
};

const STORAGE_KEY = 'mirageTea-runtime-memory-monitor';
const VERBOSE_STORAGE_KEY = 'mirageTea-runtime-memory-monitor-verbose';
const MAX_RECORDS = 200;
const records: RuntimeMemoryMonitorRecord[] = [];
const jsonSizeCache = new WeakMap<object, number>();
let nextRecordId = 1;
let markedForensicsSnapshot: RuntimeMemoryForensicsSnapshot | null = null;

const browserRuntimeCounters: BrowserRuntimeCounters = {
  activeTimeouts: 0,
  activeIntervals: 0,
  activeAnimationFrames: 0,
  activeFetches: 0,
  totalFetches: 0,
  fetchErrors: 0,
  activeEventListeners: 0,
  objectUrls: 0,
  createdObjectUrls: 0,
  revokedObjectUrls: 0,
};
const activeTimeoutIds = new Set<BrowserTimeoutId>();
const activeIntervalIds = new Set<BrowserIntervalId>();
const activeAnimationFrameIds = new Set<number>();
const eventListenerCounts = new Map<string, number>();
const eventListenerKeys = new WeakMap<EventListenerOrEventListenerObject, string[]>();
const objectUrls = new Set<string>();

function incrementMapCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function decrementMapCount(map: Map<string, number>, key: string) {
  const next = (map.get(key) || 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

function trackListenerKey(listener: EventListenerOrEventListenerObject | null, key: string) {
  if (!listener) return;
  const keys = eventListenerKeys.get(listener) || [];
  keys.push(key);
  eventListenerKeys.set(listener, keys);
}

function untrackListenerKey(listener: EventListenerOrEventListenerObject | null, eventType: string) {
  if (!listener) return null;
  const keys = eventListenerKeys.get(listener);
  if (!keys?.length) return null;
  const index = keys.findIndex((key) => key.endsWith(`:${eventType}`));
  if (index < 0) return null;
  const [key] = keys.splice(index, 1);
  if (keys.length) eventListenerKeys.set(listener, keys);
  else eventListenerKeys.delete(listener);
  return key;
}

function describeEventTarget(target: EventTarget) {
  if (typeof window !== 'undefined' && target === window) return 'window';
  if (typeof document !== 'undefined' && target === document) return 'document';
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
    return target.tagName.toLowerCase();
  }
  return target.constructor?.name || 'EventTarget';
}

function topMapEntries(map: Map<string, number>, limit = 10): SizedEntry[] {
  return topEntries(Array.from(map.entries()).map(([id, size]) => ({ id, size })), limit);
}

function getBrowserRuntimeCounters() {
  browserRuntimeCounters.activeTimeouts = activeTimeoutIds.size;
  browserRuntimeCounters.activeIntervals = activeIntervalIds.size;
  browserRuntimeCounters.activeAnimationFrames = activeAnimationFrameIds.size;
  browserRuntimeCounters.activeEventListeners = Array.from(eventListenerCounts.values()).reduce((sum, count) => sum + count, 0);
  browserRuntimeCounters.objectUrls = objectUrls.size;
  return { ...browserRuntimeCounters };
}

function installBrowserRuntimeInstrumentation() {
  if (typeof window === 'undefined') return;
  const win = window as Window & { __MIRAGETEA_BROWSER_RUNTIME_INSTRUMENTED__?: boolean };
  if (win.__MIRAGETEA_BROWSER_RUNTIME_INSTRUMENTED__) return;
  win.__MIRAGETEA_BROWSER_RUNTIME_INSTRUMENTED__ = true;

  const originalSetTimeout = win.setTimeout.bind(win) as Window['setTimeout'];
  const originalClearTimeout = win.clearTimeout.bind(win) as Window['clearTimeout'];
  win.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = originalSetTimeout(() => {
      activeTimeoutIds.delete(id);
      if (typeof handler === 'function') {
        handler(...args);
      } else {
        // Keep the browser-compatible string handler path for completeness.
        originalSetTimeout(handler, 0);
      }
    }, timeout);
    activeTimeoutIds.add(id);
    return id;
  }) as typeof window.setTimeout;
  win.clearTimeout = ((id?: number) => {
    activeTimeoutIds.delete(id as BrowserTimeoutId);
    return originalClearTimeout(id);
  }) as typeof window.clearTimeout;

  const originalSetInterval = win.setInterval.bind(win) as Window['setInterval'];
  const originalClearInterval = win.clearInterval.bind(win) as Window['clearInterval'];
  win.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = originalSetInterval(handler, timeout, ...args);
    activeIntervalIds.add(id);
    return id;
  }) as typeof window.setInterval;
  win.clearInterval = ((id?: number) => {
    activeIntervalIds.delete(id as BrowserIntervalId);
    return originalClearInterval(id);
  }) as typeof window.clearInterval;

  const originalRequestAnimationFrame = win.requestAnimationFrame?.bind(win);
  const originalCancelAnimationFrame = win.cancelAnimationFrame?.bind(win);
  if (originalRequestAnimationFrame && originalCancelAnimationFrame) {
    win.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = originalRequestAnimationFrame((time) => {
        activeAnimationFrameIds.delete(id);
        callback(time);
      });
      activeAnimationFrameIds.add(id);
      return id;
    }) as typeof window.requestAnimationFrame;
    win.cancelAnimationFrame = ((id: number) => {
      activeAnimationFrameIds.delete(id);
      return originalCancelAnimationFrame(id);
    }) as typeof window.cancelAnimationFrame;
  }

  const originalFetch = win.fetch?.bind(win);
  if (originalFetch) {
    win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      browserRuntimeCounters.totalFetches += 1;
      browserRuntimeCounters.activeFetches += 1;
      return originalFetch(input, init).catch((error) => {
        browserRuntimeCounters.fetchErrors += 1;
        throw error;
      }).finally(() => {
        browserRuntimeCounters.activeFetches = Math.max(0, browserRuntimeCounters.activeFetches - 1);
      });
    }) as typeof window.fetch;
  }

  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
    if (listener) {
      const key = `${describeEventTarget(this)}:${String(type)}`;
      incrementMapCount(eventListenerCounts, key);
      trackListenerKey(listener, key);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
    const key = untrackListenerKey(listener, String(type));
    if (key) decrementMapCount(eventListenerCounts, key);
    return originalRemoveEventListener.call(this, type, listener, options);
  };

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = ((object: Blob | MediaSource) => {
    const url = originalCreateObjectURL(object);
    objectUrls.add(url);
    browserRuntimeCounters.createdObjectUrls += 1;
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    if (objectUrls.delete(url)) browserRuntimeCounters.revokedObjectUrls += 1;
    return originalRevokeObjectURL(url);
  }) as typeof URL.revokeObjectURL;
}

function isBrowserRuntimeInstrumentationInstalled() {
  return Boolean((window as Window & { __MIRAGETEA_BROWSER_RUNTIME_INSTRUMENTED__?: boolean }).__MIRAGETEA_BROWSER_RUNTIME_INSTRUMENTED__);
}

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

async function readUserAgentSpecificMemory() {
  const perf = globalThis.performance as MemoryPerformance | undefined;
  if (typeof perf?.measureUserAgentSpecificMemory !== 'function') return null;
  try {
    const result = await perf.measureUserAgentSpecificMemory();
    return typeof result.bytes === 'number' ? result.bytes : null;
  } catch {
    // Chromium may reject this API without cross-origin isolation.
    return null;
  }
}

async function readSnapshotMemory(): Promise<MemoryMeasure> {
  const memory = readMemory();
  const userAgentSpecificBytes = await readUserAgentSpecificMemory();
  return {
    ...memory,
    userAgentSpecificBytes,
  };
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

function sizePerformanceResourceEntries() {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return [];
  return performance.getEntriesByType('resource').map((entry, index) => {
    const resource = entry as PerformanceResourceTiming;
    return {
      id: resource.name || `resource-${index}`,
      label: resource.initiatorType || entry.entryType,
      size: Math.max(0, resource.decodedBodySize || resource.encodedBodySize || resource.transferSize || 0),
      counts: {
        durationMs: Math.round(resource.duration || 0),
        transferSize: resource.transferSize || 0,
        encodedBodySize: resource.encodedBodySize || 0,
        decodedBodySize: resource.decodedBodySize || 0,
      },
    };
  });
}

async function readForensicsStores() {
  const [{ useChatStore }, { useCharacterStore }, { useMessageStore }, sessionCommitPipeline, sessionRunner] = await Promise.all([
    import('../stores/useChatStore'),
    import('../stores/useCharacterStore'),
    import('../stores/useMessageStore'),
    import('./sessionCommitPipeline'),
    import('./sessionRunner'),
  ]);
  return {
    chatState: useChatStore.getState(),
    characterState: useCharacterStore.getState(),
    messageState: useMessageStore.getState(),
    deferredLlmDistillation: sessionCommitPipeline.getDeferredLlmDistillationDebugState(),
    sessionLoops: sessionRunner.getSessionLoopDebugState(),
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

function sizeMessageEntry(message: Message): SizedEntry {
  return {
    id: message.id,
    label: `${message.type}:${message.senderName || message.senderId || 'unknown'}`,
    size: directJsonSize(message),
    counts: {
      contentChars: message.content?.length || 0,
      isStreaming: message.isStreaming ? 1 : 0,
      isDeleted: message.isDeleted ? 1 : 0,
      hasServerId: message.serverId ? 1 : 0,
    },
    fields: {
      content: message.content?.length || 0,
      metadata: Math.max(0, directJsonSize(message) - (message.content?.length || 0)),
    },
  };
}

export function summarizeMessages(messages: Message[]) {
  return {
    count: messages.length,
    ai: messages.filter((message) => message.type === 'ai').length,
    user: messages.filter((message) => message.type === 'user' || message.type === 'god').length,
    event: messages.filter((message) => message.type === 'event').length,
    system: messages.filter((message) => message.type === 'system').length,
    streaming: messages.filter((message) => message.isStreaming).length,
    deleted: messages.filter((message) => message.isDeleted).length,
    totalContentChars: messages.reduce((sum, message) => sum + (message.content?.length || 0), 0),
    uniqueIds: new Set(messages.map((message) => message.id)).size,
    uniqueServerIds: new Set(messages.map((message) => message.serverId).filter(Boolean)).size,
    uniqueClientKeys: new Set(messages.map((message) => message.clientKey).filter(Boolean)).size,
  };
}

export function sizePendingOperationEntry(operation: unknown, index: number): SizedEntry {
  const record = typeof operation === 'object' && operation !== null ? operation as Record<string, unknown> : {};
  const patch = typeof record.patch === 'object' && record.patch !== null ? record.patch as Record<string, unknown> : null;
  const payload = typeof record.payload === 'object' && record.payload !== null ? record.payload as Record<string, unknown> : null;
  return {
    id: String(record.id || record.entityId || record.messageId || `operation-${index}`),
    label: String(record.kind || record.status || 'operation'),
    size: directJsonSize(operation),
    counts: {
      patchKeys: patch ? Object.keys(patch).length : 0,
      payloadKeys: payload ? Object.keys(payload).length : 0,
      attemptCount: typeof record.attemptCount === 'number' ? record.attemptCount : 0,
    },
    fields: {
      patch: directJsonSize(patch),
      payload: directJsonSize(payload),
      lastError: typeof record.lastError === 'string' ? record.lastError.length : 0,
    },
  };
}

export async function buildRuntimeMemoryForensicsSnapshot(limit = 10): Promise<RuntimeMemoryForensicsSnapshot> {
  const { chatState, characterState, messageState, deferredLlmDistillation, sessionLoops } = await readForensicsStores();
  const chatEntries = chatState.chats.map(sizeChatEntry);
  const characterEntries = characterState.characters.map(sizeCharacterEntry);
  const activeMessageEntries = messageState.messages.map(sizeMessageEntry);
  const messageWindowEntries = Object.entries(messageState.messageWindowsByChatId)
    .map(([chatId, window]) => sizeMessageWindowEntry(chatId, window));
  const chatPendingOperationEntries = chatState.pendingOperations.map(sizePendingOperationEntry);
  const characterPendingOperationEntries = characterState.pendingOperations.map(sizePendingOperationEntry);
  const messagePendingOperationEntries = messageState.pendingOperations.map(sizePendingOperationEntry);
  const localStorageEntries = sizeLocalStorageEntries();
  const resourceEntries = sizePerformanceResourceEntries();
  const activeMessageSummary = summarizeMessages(messageState.messages);
  const browserRuntime = getBrowserRuntimeCounters();
  const domCounts = countDomNodes();
  const snapshot = {
    at: Date.now(),
    memory: await readSnapshotMemory(),
    totals: {
      chats: directJsonSize(chatState.chats),
      characters: directJsonSize(characterState.characters),
      activeMessages: directJsonSize(messageState.messages),
      activeMessageCount: activeMessageSummary.count,
      activeMessageEventCount: activeMessageSummary.event,
      activeMessageStreamingCount: activeMessageSummary.streaming,
      activeMessageContentChars: activeMessageSummary.totalContentChars,
      activeMessageUniqueIds: activeMessageSummary.uniqueIds,
      activeMessageUniqueServerIds: activeMessageSummary.uniqueServerIds,
      activeMessageUniqueClientKeys: activeMessageSummary.uniqueClientKeys,
      messageWindows: directJsonSize(messageState.messageWindowsByChatId),
      chatPendingOperations: directJsonSize(chatState.pendingOperations),
      chatPendingOperationCount: chatState.pendingOperations.length,
      characterPendingOperations: directJsonSize(characterState.pendingOperations),
      characterPendingOperationCount: characterState.pendingOperations.length,
      messagePendingOperations: directJsonSize(messageState.pendingOperations),
      messagePendingOperationCount: messageState.pendingOperations.length,
      monitorRecordCount: records.length,
      monitorRecords: directJsonSize(records),
      monitorMarkedSnapshot: directJsonSize(markedForensicsSnapshot),
      deferredLlmDistillationStates: deferredLlmDistillation.stateCount,
      deferredLlmDistillationTasks: deferredLlmDistillation.taskCount,
      deferredLlmDistillationRunning: deferredLlmDistillation.running,
      deferredLlmDistillationRerunRequested: deferredLlmDistillation.rerunRequested,
      deferredLlmDistillationCancelled: deferredLlmDistillation.cancelled,
      sessionLoopCount: sessionLoops.count,
      sessionLoopIterations: sessionLoops.loops.reduce((sum, loop) => sum + loop.iterationCount, 0),
      resourceEntries: resourceEntries.length,
      resourceTransferSize: resourceEntries.reduce((sum, entry) => sum + (entry.counts?.transferSize || 0), 0),
      resourceDecodedBodySize: resourceEntries.reduce((sum, entry) => sum + (entry.counts?.decodedBodySize || 0), 0),
      localStorage: localStorageEntries.reduce((sum, entry) => sum + Math.max(0, entry.size), 0),
      ...domCounts,
      browserRuntimeActiveTimeouts: browserRuntime.activeTimeouts,
      browserRuntimeActiveIntervals: browserRuntime.activeIntervals,
      browserRuntimeActiveAnimationFrames: browserRuntime.activeAnimationFrames,
      browserRuntimeActiveFetches: browserRuntime.activeFetches,
      browserRuntimeTotalFetches: browserRuntime.totalFetches,
      browserRuntimeFetchErrors: browserRuntime.fetchErrors,
      browserRuntimeActiveEventListeners: browserRuntime.activeEventListeners,
      browserRuntimeObjectUrls: browserRuntime.objectUrls,
      browserRuntimeCreatedObjectUrls: browserRuntime.createdObjectUrls,
      browserRuntimeRevokedObjectUrls: browserRuntime.revokedObjectUrls,
    },
    largest: {
      chats: topEntries(chatEntries, limit),
      characters: topEntries(characterEntries, limit),
      activeMessages: topEntries(activeMessageEntries, limit),
      messageWindows: topEntries(messageWindowEntries, limit),
      chatPendingOperations: topEntries(chatPendingOperationEntries, limit),
      characterPendingOperations: topEntries(characterPendingOperationEntries, limit),
      messagePendingOperations: topEntries(messagePendingOperationEntries, limit),
      resources: topEntries(resourceEntries, limit),
      localStorage: topEntries(localStorageEntries, limit),
      eventListeners: topMapEntries(eventListenerCounts, limit),
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
      imageNodes: 0,
      loadedImageNodes: 0,
      styleNodes: 0,
      styleSheetCount: 0,
      cssRuleCount: 0,
      emotionStyleNodes: 0,
      muiStyleNodes: 0,
    };
  }
  const styleSheets = Array.from(document.styleSheets);
  const cssRuleCount = styleSheets.reduce((sum, sheet) => {
    try {
      return sum + (sheet.cssRules?.length || 0);
    } catch {
      return sum;
    }
  }, 0);
  const images = Array.from(document.images);
  return {
    domNodes: document.querySelectorAll('*').length,
    messageDomNodes: document.querySelectorAll('[data-message-id]').length,
    eventMessageDomNodes: document.querySelectorAll('[data-message-type="event"]').length,
    dialogDomNodes: document.querySelectorAll('[role="dialog"], .MuiModal-root').length,
    imageNodes: images.length,
    loadedImageNodes: images.filter((image) => image.complete && image.naturalWidth > 0).length,
    styleNodes: document.querySelectorAll('style, link[rel="stylesheet"]').length,
    styleSheetCount: styleSheets.length,
    cssRuleCount,
    emotionStyleNodes: document.querySelectorAll('style[data-emotion]').length,
    muiStyleNodes: document.querySelectorAll('style[data-emotion*="mui"], style[data-emotion*="css"]').length,
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
    enableBrowserRuntimeCounters: () => {
      installBrowserRuntimeInstrumentation();
      console.info('[memory-monitor] browser runtime counters enabled');
      return isBrowserRuntimeInstrumentationInstalled();
    },
    areBrowserRuntimeCountersEnabled: isBrowserRuntimeInstrumentationInstalled,
    clear: () => {
      records.splice(0, records.length);
    },
    cleanup: () => {
      records.splice(0, records.length);
      markedForensicsSnapshot = null;
      if (typeof performance !== 'undefined' && typeof performance.clearResourceTimings === 'function') {
        performance.clearResourceTimings();
      }
      if (typeof console !== 'undefined' && typeof console.clear === 'function') {
        console.clear();
      }
    },
    export: () => records.slice(),
    latest: (count = 20) => records.slice(-count),
    summary: () => records.at(-1) || null,
    snapshot: () => buildRuntimeMemoryForensicsSnapshot(),
    gcSnapshot: async () => {
      if (typeof window !== 'undefined' && typeof window.gc === 'function') {
        window.gc();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        window.gc();
      } else {
        console.warn('[memory-forensics] window.gc is unavailable; start Chrome with --js-flags=--expose-gc or use DevTools Memory GC');
      }
      return buildRuntimeMemoryForensicsSnapshot();
    },
    mark: async () => {
      markedForensicsSnapshot = await buildRuntimeMemoryForensicsSnapshot();
      console.info('[memory-forensics] marked baseline', markedForensicsSnapshot);
      return markedForensicsSnapshot;
    },
    diff: async () => {
      if (!markedForensicsSnapshot) {
        console.warn('[memory-forensics] no baseline; call mark() first');
        return null;
      }
      const snapshot = await buildRuntimeMemoryForensicsSnapshot();
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
        void buildRuntimeMemoryForensicsSnapshot(limit).then((snapshot) => {
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
      void buildRuntimeMemoryForensicsSnapshot(limit).then((snapshot) => {
        previous = snapshot;
      });
      return () => window.clearInterval(timer);
    },
  };
}

declare global {
  interface Window {
    __MIRAGETEA_MEMORY_MONITOR__?: RuntimeMemoryMonitorApi;
    gc?: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.__MIRAGETEA_MEMORY_MONITOR__ = window.__MIRAGETEA_MEMORY_MONITOR__ || buildMonitorApi();
}
