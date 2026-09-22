import type { NavigateFunction } from 'react-router-dom';
import { buildAssistantChatDraft } from '../../services/chatDraftBuilder';
import { useChatStore } from '../../stores/useChatStore';
import { useAuthStore } from '../../stores/useAuthStore';

export interface HomeCommandAssistantState {
  homeCommandInitialMessage: string;
  homeCommandStartAgent?: boolean;
  homeCommandPreferredMode?: 'chat' | 'image' | 'research' | 'tool';
}

export async function openAssistantFromHomeCommand(
  navigate: NavigateFunction,
  input: string,
  preferredMode: HomeCommandAssistantState['homeCommandPreferredMode'] = 'chat',
) {
  const auth = useAuthStore.getState();
  const agentAvailable = auth.authMode === 'cloud' && auth.user?.agentEntitled === true;
  const searchAvailable = agentAvailable && auth.user?.aiSearchEntitled === true;
  const draft = buildAssistantChatDraft({ agentAvailable, aiSearchAvailable: searchAvailable });
  const chat = await useChatStore.getState().addChat(draft);
  navigate(`/chats/${encodeURIComponent(chat.id)}?fromTab=3`, {
    state: {
      homeCommandInitialMessage: input,
      homeCommandStartAgent: true,
      homeCommandPreferredMode: preferredMode,
    } satisfies HomeCommandAssistantState,
  });
  return chat;
}
