import type { Message } from '../types/message';
import { api } from './api';

export async function persistStreamingMessage(params: {
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  addOptimisticMessage: (message: Message) => void;
  replaceOptimisticMessage: (temporaryId: string, message: Message) => void;
}) {
  const temporaryId = `streaming-${params.message.senderId}-${Date.now()}`;
  const optimisticMessage: Message = {
    ...params.message,
    id: temporaryId,
    timestamp: Date.now(),
    isDeleted: false,
  };

  params.addOptimisticMessage(optimisticMessage);

  const savedMessage = await api.createMessage(params.message.chatId, {
    type: params.message.type,
    senderId: params.message.senderId,
    senderName: params.message.senderName,
    content: params.message.content,
    emotion: params.message.emotion,
  });

  const persistedMessage = savedMessage as unknown as Message;
  params.replaceOptimisticMessage(temporaryId, persistedMessage);
  return persistedMessage;
}
