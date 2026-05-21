export function createGuestUploadFlag<T>(storageKey: string) {
  return {
    read(): T[] {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as T[];
        return [];
      } catch {
        return [];
      }
    },
    write(items: T[]) {
      localStorage.setItem(storageKey, JSON.stringify(items));
    },
    clear() {
      localStorage.removeItem(storageKey);
    },
  };
}
