export function createGuestUploadFlag<T>(storageKey: string) {
  return {
    read(): T[] {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as T[]) : [];
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
