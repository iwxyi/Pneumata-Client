let bootstrapLockCount = 0;

function dispatchBootstrapLockEvent(locked: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pneumata-cloud-sync-bootstrap-lock-changed', {
    detail: { locked },
  }));
}

export function isCloudSyncBootstrapLocked() {
  return bootstrapLockCount > 0;
}

export function beginCloudSyncBootstrapLock() {
  const wasLocked = isCloudSyncBootstrapLocked();
  bootstrapLockCount += 1;
  if (!wasLocked) dispatchBootstrapLockEvent(true);
}

export function endCloudSyncBootstrapLock() {
  if (bootstrapLockCount <= 0) return;
  bootstrapLockCount -= 1;
  if (!isCloudSyncBootstrapLocked()) dispatchBootstrapLockEvent(false);
}

export async function runWithCloudSyncBootstrapLock<T>(task: () => Promise<T>) {
  beginCloudSyncBootstrapLock();
  try {
    return await task();
  } finally {
    endCloudSyncBootstrapLock();
  }
}
