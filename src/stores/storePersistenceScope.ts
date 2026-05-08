export function createScopedStorage(params: {
  getScopedKey: () => string;
  legacyKey: string;
}) {
  return {
    getItem: (name: string) => {
      const scopedName = params.getScopedKey();
      const legacyName = params.legacyKey;
      if (name !== legacyName) return localStorage.getItem(name);
      return localStorage.getItem(scopedName) ?? localStorage.getItem(legacyName);
    },
    setItem: (name: string, value: string) => {
      const scopedName = params.getScopedKey();
      const legacyName = params.legacyKey;
      if (name !== legacyName) {
        localStorage.setItem(name, value);
        return;
      }
      localStorage.setItem(scopedName, value);
      localStorage.removeItem(legacyName);
    },
    removeItem: (name: string) => {
      const scopedName = params.getScopedKey();
      const legacyName = params.legacyKey;
      if (name !== legacyName) {
        localStorage.removeItem(name);
        return;
      }
      localStorage.removeItem(scopedName);
      localStorage.removeItem(legacyName);
    },
  };
}
