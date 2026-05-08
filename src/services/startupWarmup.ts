let startupDataWarmupStarted = false;
function runAfterFirstPaint(task: () => void, delay = 600) {
  window.setTimeout(task, delay);
}

export function warmupStartupData() {
  if (startupDataWarmupStarted) return;
  startupDataWarmupStarted = true;

  runAfterFirstPaint(() => {
    void import('../stores/useChatStore').then(({ useChatStore }) => {
      const store = useChatStore;
      void Promise.resolve(store.persist.rehydrate()).finally(() => {
        store.getState().markChatsWarm();
      });
    });

    void import('../stores/useCharacterStore').then(({ useCharacterStore }) => {
      const store = useCharacterStore;
      void Promise.resolve(store.persist.rehydrate()).finally(() => {
        store.getState().markCharactersWarm();
      });
    });
  });
}
