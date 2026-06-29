type RuntimeMemoryMonitorModule = typeof import('./runtimeMemoryMonitor');
type RuntimeMemoryRecordParams = Parameters<RuntimeMemoryMonitorModule['recordRuntimeMemory']>[1];

interface RuntimeMemoryTimer {
  mark: (step: string, params?: RuntimeMemoryRecordParams) => void;
  finish: (params?: RuntimeMemoryRecordParams) => void;
}

const MEMORY_MONITOR_KEY = 'pneumata-runtime-memory-monitor';
let runtimeMemoryMonitorPromise: Promise<RuntimeMemoryMonitorModule> | null = null;

function getGlobalMonitorFlag() {
  return Boolean((globalThis as { __PNEUMATA_MEMORY_MONITOR_ENABLED__?: boolean }).__PNEUMATA_MEMORY_MONITOR_ENABLED__);
}

export function isRuntimeMemoryTimerEnabled() {
  if (getGlobalMonitorFlag()) return true;
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(MEMORY_MONITOR_KEY) === '1';
  } catch {
    return false;
  }
}

function loadRuntimeMemoryMonitor() {
  runtimeMemoryMonitorPromise ??= import('./runtimeMemoryMonitor');
  return runtimeMemoryMonitorPromise;
}

function recordRuntimeMemoryAsync(label: string, params: RuntimeMemoryRecordParams) {
  if (!isRuntimeMemoryTimerEnabled()) return;
  void loadRuntimeMemoryMonitor().then(({ recordRuntimeMemory }) => {
    recordRuntimeMemory(label, params);
  });
}

export function recordRuntimeMemoryIfEnabled(label: string, params: RuntimeMemoryRecordParams) {
  recordRuntimeMemoryAsync(label, params);
}

export function createRuntimeMemoryTimer(label: string, params: RuntimeMemoryRecordParams = {}): RuntimeMemoryTimer {
  if (!isRuntimeMemoryTimerEnabled()) {
    return {
      mark: () => undefined,
      finish: () => undefined,
    };
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  recordRuntimeMemoryAsync(`${label}:start`, { ...params, startedAt });
  return {
    mark: (step, nextParams = {}) => recordRuntimeMemoryAsync(`${label}:${step}`, {
      ...params,
      ...nextParams,
      startedAt,
    }),
    finish: (nextParams = {}) => recordRuntimeMemoryAsync(`${label}:finish`, {
      ...params,
      ...nextParams,
      startedAt,
    }),
  };
}
