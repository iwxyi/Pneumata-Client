export async function prefetchChatDetail(chatId: string) {
  const { useMessageStore } = await import('../stores/useMessageStore');
  void useMessageStore.getState().prefetchMessages(chatId, { limit: 20 });
}
