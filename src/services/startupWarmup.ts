import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';

let startupDataWarmupStarted = false;
function runAfterFirstPaint(task: () => void, delay = 600) {
  window.setTimeout(task, delay);
}

export function warmupStartupData() {
  if (startupDataWarmupStarted) return;
  startupDataWarmupStarted = true;

  runAfterFirstPaint(() => {
    const store = useChatStore;
    void Promise.resolve(store.persist.rehydrate()).finally(() => {
      store.getState().markChatsWarm();
    });

    const characterStore = useCharacterStore;
    void Promise.resolve(characterStore.persist.rehydrate()).finally(() => {
      characterStore.getState().markCharactersWarm();
    });
  });
}
