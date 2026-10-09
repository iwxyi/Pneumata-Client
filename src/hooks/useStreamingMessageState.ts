import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Message } from '../types/message';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createStreamingMessageDisplay } from '../services/streamingMessageDisplay';

export function useStreamingMessageState(upsertMessage: (message: Message) => void) {
  const streamingMessageRef = useRef<Message | null>(null);
  const display = useMemo(() => createStreamingMessageDisplay({
    upsertMessage,
    isAnimationEnabled: () => useSettingsStore.getState().enableStreamingDisplayAnimation,
  }), [upsertMessage]);
  useEffect(() => () => display.clear(), [display]);

  const updateStreamingMessage = useCallback((updater: (current: Message | null) => Message | null, options?: { immediate?: boolean }) => {
    const next = updater(streamingMessageRef.current);
    streamingMessageRef.current = next;
    display.update(next, options);
  }, [display]);

  const discardStreamingMessage = useCallback(() => {
    display.clear();
    const current = streamingMessageRef.current;
    if (current) {
      upsertMessage({ ...current, isDeleted: true, isStreaming: true });
    }
    streamingMessageRef.current = null;
  }, [display, upsertMessage]);

  const clearStreamingMessageRef = useCallback(() => {
    display.clear();
    streamingMessageRef.current = null;
  }, [display]);

  const freezeStreamingDisplay = useCallback(() => {
    display.freeze();
    streamingMessageRef.current = null;
  }, [display]);

  const getDisplayedStreamingMessage = useCallback(() => display.getDisplayed(), [display]);

  return {
    streamingMessageRef,
    updateStreamingMessage,
    discardStreamingMessage,
    clearStreamingMessageRef,
    freezeStreamingDisplay,
    getDisplayedStreamingMessage,
  };
}
