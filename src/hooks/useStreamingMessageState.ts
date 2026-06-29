import { useCallback, useRef } from 'react';
import type { Message } from '../types/message';
import { useMessageStore } from '../stores/useMessageStore';
import { getNextStreamingDisplayContent, STREAMING_DISPLAY_TICK_MS } from '../services/streamingDisplayBuffer';
import { shouldDiscardStreamingDraft } from '../services/streamingMessageLifecycle';

export function useStreamingMessageState(upsertMessage: (message: Message) => void) {
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
    if (options?.immediate) {
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
  }, [flushStreamingDisplay, stopStreamingFlushTimer, upsertMessage]);

  const discardStreamingMessage = useCallback(() => {
    stopStreamingFlushTimer();
    const current = streamingMessageRef.current;
    if (current) {
      const state = useMessageStore.getState();
      const persisted = state.messageWindowsByChatId[current.chatId]?.messages.find((message) => message.id === current.id)
        || state.messages.find((message) => message.id === current.id)
        || null;
      if (shouldDiscardStreamingDraft(current, persisted)) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[streaming-message:discard-draft]', {
            current,
            persisted,
            chatId: current.chatId,
          });
        }
        upsertMessage({ ...current, isDeleted: true, isStreaming: false });
      }
    }
    streamingMessageRef.current = null;
    displayedStreamingMessageRef.current = null;
  }, [stopStreamingFlushTimer, upsertMessage]);

  const clearStreamingMessageRef = useCallback(() => {
    stopStreamingFlushTimer();
    const current = streamingMessageRef.current;
    if (current) {
      const state = useMessageStore.getState();
      const persisted = state.messageWindowsByChatId[current.chatId]?.messages.find((message) => message.id === current.id)
        || state.messages.find((message) => message.id === current.id)
        || null;
      upsertMessage({
        ...current,
        ...(persisted || {}),
        content: persisted?.content || current.content,
        metadata: {
          ...(current.metadata || {}),
          ...(persisted?.metadata || {}),
        },
        isStreaming: false,
      });
    }
    streamingMessageRef.current = null;
    displayedStreamingMessageRef.current = null;
  }, [stopStreamingFlushTimer, upsertMessage]);

  return {
    streamingMessageRef,
    updateStreamingMessage,
    discardStreamingMessage,
    clearStreamingMessageRef,
  };
}
