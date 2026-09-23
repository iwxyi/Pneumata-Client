import { useCallback, useRef } from 'react';
import type { Message } from '../types/message';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getNextStreamingDisplayContent, STREAMING_DISPLAY_TICK_MS } from '../services/streamingDisplayBuffer';

export function useStreamingMessageState(upsertMessage: (message: Message) => void) {
  const enableStreamingDisplayAnimation = useSettingsStore((state) => state.enableStreamingDisplayAnimation);
  const streamingMessageRef = useRef<Message | null>(null);
  const streamingFlushTimerRef = useRef<number | null>(null);
  const displayedStreamingMessageRef = useRef<Message | null>(null);

  const stopStreamingFlushTimer = useCallback(() => {
    if (streamingFlushTimerRef.current == null) return;
    window.clearTimeout(streamingFlushTimerRef.current);
    streamingFlushTimerRef.current = null;
  }, []);

  const flushStreamingDisplay = useCallback(() => {
    streamingFlushTimerRef.current = null;
    const target = streamingMessageRef.current;
    if (!target) return;
    const currentDisplayed = displayedStreamingMessageRef.current;
    const displayContent = currentDisplayed?.id === target.id ? currentDisplayed.content : '';
    const nextContent = getNextStreamingDisplayContent(displayContent, target.content);
    const nextDisplayed = { ...target, content: nextContent };
    displayedStreamingMessageRef.current = nextDisplayed;
    upsertMessage(nextDisplayed);
    if (nextContent !== target.content) {
      streamingFlushTimerRef.current = window.setTimeout(flushStreamingDisplay, STREAMING_DISPLAY_TICK_MS);
    }
  }, [upsertMessage]);

  const updateStreamingMessage = useCallback((updater: (current: Message | null) => Message | null, options?: { immediate?: boolean }) => {
    const next = updater(streamingMessageRef.current);
    streamingMessageRef.current = next;
    if (!next) return;
    if (options?.immediate || !enableStreamingDisplayAnimation) {
      stopStreamingFlushTimer();
      displayedStreamingMessageRef.current = next;
      upsertMessage(next);
      return;
    }
    if (!displayedStreamingMessageRef.current || displayedStreamingMessageRef.current.id !== next.id) {
      displayedStreamingMessageRef.current = { ...next, content: '' };
    }
    if (streamingFlushTimerRef.current != null) return;
    streamingFlushTimerRef.current = window.setTimeout(flushStreamingDisplay, STREAMING_DISPLAY_TICK_MS);
  }, [enableStreamingDisplayAnimation, flushStreamingDisplay, stopStreamingFlushTimer, upsertMessage]);

  const discardStreamingMessage = useCallback(() => {
    stopStreamingFlushTimer();
    const current = streamingMessageRef.current;
    if (current) {
      upsertMessage({ ...current, isDeleted: true, isStreaming: true });
    }
    streamingMessageRef.current = null;
    displayedStreamingMessageRef.current = null;
  }, [stopStreamingFlushTimer, upsertMessage]);

  const clearStreamingMessageRef = useCallback(() => {
    stopStreamingFlushTimer();
    streamingMessageRef.current = null;
    displayedStreamingMessageRef.current = null;
  }, [stopStreamingFlushTimer]);

  const freezeStreamingDisplay = useCallback(() => {
    stopStreamingFlushTimer();
  }, [stopStreamingFlushTimer]);

  const getDisplayedStreamingMessage = useCallback(() => displayedStreamingMessageRef.current, []);

  return {
    streamingMessageRef,
    updateStreamingMessage,
    discardStreamingMessage,
    clearStreamingMessageRef,
    freezeStreamingDisplay,
    getDisplayedStreamingMessage,
  };
}
