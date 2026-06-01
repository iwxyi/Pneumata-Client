import { useEffect, useRef } from 'react';
import type { GroupChat } from '../types/chat';

interface UseChatAutoSocialFlowParams {
  chat: GroupChat | undefined;
  runAutoSocialEventFlow: (chat: GroupChat) => Promise<unknown>;
}

export function useChatAutoSocialFlow(params: UseChatAutoSocialFlowParams) {
  const lastAutoThreadCandidateIdRef = useRef<string | null>(null);

  useEffect(() => {
    const chat = params.chat;
    if (!chat || chat.type !== 'group') return;
    const latestEventId = chat.runtimeEventsV2?.at(-1)?.id || null;
    const autoFlowKey = `${chat.id}:${chat.updatedAt}:${latestEventId}`;
    if (lastAutoThreadCandidateIdRef.current === autoFlowKey) return;
    lastAutoThreadCandidateIdRef.current = autoFlowKey;
    void params.runAutoSocialEventFlow(chat);
  }, [params.chat, params.runAutoSocialEventFlow]);
}

