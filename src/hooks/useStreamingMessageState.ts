import { useCallback, useRef } from 'react';
import type { Message } from '../types/message';
import { useMessageStore } from '../stores/useMessageStore';
import { shouldDiscardStreamingDraft } from '../services/streamingMessageLifecycle';

export function useStreamingMessageState(upsertMessage: (message: Message) => void) {
  const streamingMessageRef = useRef<Message | null>(null);
  const streamingFlushFrameRef = useRef<number | null>(null);
  const pendingStreamingMessageRef = useRef<Message | null>(null);

  const updateStreamingMessage = useCallback((updater: (current: Message | null) => Message | null, options?: { immediate?: boolean }) => {
    const next = updater(streamingMessageRef.current);
    streamingMessageRef.current = next;
    if (!next) return;
    pendingStreamingMessageRef.current = next;
    if (options?.immediate) {
      if (streamingFlushFrameRef.current != null) {
        cancelAnimationFrame(streamingFlushFrameRef.current);
        streamingFlushFrameRef.current = null;
      }
      pendingStreamingMessageRef.current = null;
      upsertMessage(next);
      return;
    }
    if (streamingFlushFrameRef.current != null) return;
    streamingFlushFrameRef.current = requestAnimationFrame(() => {
      streamingFlushFrameRef.current = null;
      const pending = pendingStreamingMessageRef.current;
      pendingStreamingMessageRef.current = null;
      if (pending) upsertMessage(pending);
    });
  }, [upsertMessage]);

  const discardStreamingMessage = useCallback(() => {
    if (streamingFlushFrameRef.current != null) {
      cancelAnimationFrame(streamingFlushFrameRef.current);
      streamingFlushFrameRef.current = null;
    }
    pendingStreamingMessageRef.current = null;
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
  }, [upsertMessage]);

  const clearStreamingMessageRef = useCallback(() => {
    if (streamingFlushFrameRef.current != null) {
      cancelAnimationFrame(streamingFlushFrameRef.current);
      streamingFlushFrameRef.current = null;
    }
    pendingStreamingMessageRef.current = null;
    streamingMessageRef.current = null;
  }, []);

  return {
    streamingMessageRef,
    updateStreamingMessage,
    discardStreamingMessage,
    clearStreamingMessageRef,
  };
}

