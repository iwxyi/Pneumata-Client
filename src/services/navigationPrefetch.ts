import { useMessageStore } from '../stores/useMessageStore';

export async function prefetchChatDetail(chatId: string) {
  void useMessageStore.getState().prefetchMessages(chatId, { limit: 20 });
}
