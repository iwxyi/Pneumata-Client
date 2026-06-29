import { useEffect, useRef } from 'react';
import type { GroupChat } from '../types/chat';

const AUTO_SOCIAL_EVENT_KINDS = new Set([
  'pair_private_thread',
  'post_moment',
  'status_update',
  'check_in',
  'react_to_moment',
  'social_outing',
  'gift_exchange',
  'conflict_expression',
]);

interface UseChatAutoSocialFlowParams {
  chat: GroupChat | undefined;
  runAutoSocialEventFlow: (chat: GroupChat) => Promise<unknown>;
}

function hasHandledSocialEventMarker(chat: GroupChat, eventId: string) {
  return (chat.runtimeEventsV2 || []).some((event) => (
    event.kind === 'artifact'
    && event.summary === `handled_social_event:${eventId}`
  ));
}

export function hasPendingAutoSocialEventCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).some((event) => {
    if (event.kind !== 'event_candidate' || !event.id || hasHandledSocialEventMarker(chat, event.id)) return false;
    const eventKind = (event.payload as { eventKind?: unknown } | null | undefined)?.eventKind;
    return typeof eventKind === 'string' && AUTO_SOCIAL_EVENT_KINDS.has(eventKind);
  });
}

export function useChatAutoSocialFlow(params: UseChatAutoSocialFlowParams) {
  const lastAutoThreadCandidateIdRef = useRef<string | null>(null);

  useEffect(() => {
    const chat = params.chat;
    if (!chat || chat.type !== 'group') return;
    if (!chat.isActive) return;
    if (!hasPendingAutoSocialEventCandidate(chat)) return;
    const latestEventId = chat.runtimeEventsV2?.at(-1)?.id || null;
    const autoFlowKey = `${chat.id}:${chat.updatedAt}:${latestEventId}`;
    if (lastAutoThreadCandidateIdRef.current === autoFlowKey) return;
    lastAutoThreadCandidateIdRef.current = autoFlowKey;
    let cancelled = false;
    let idleHandle: number | null = null;
    const run = () => {
      if (cancelled) return;
      void params.runAutoSocialEventFlow(chat);
    };
    const handle = window.setTimeout(() => {
      const scheduler = (window as typeof window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }).requestIdleCallback;
      if (typeof scheduler === 'function') {
        idleHandle = scheduler(run, { timeout: 4000 });
        return;
      }
      run();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      if (idleHandle != null) window.cancelIdleCallback?.(idleHandle);
    };
  }, [params.chat, params.runAutoSocialEventFlow]);
}
