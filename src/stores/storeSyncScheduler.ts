export function createSyncScheduler() {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(flush: () => Promise<void>, delay = 0) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, delay);
    },
    registerLifecycle(flush: () => Promise<void>, delay = 300) {
      if (typeof window === 'undefined') return;
      window.addEventListener('online', () => this.schedule(flush, delay));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.schedule(flush, delay);
      });
    },
  };
}
