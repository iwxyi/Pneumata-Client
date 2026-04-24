import type { Message } from '../types/message';
import { api } from './api';

export async function persistStreamingMessage(params: {
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  upsertMessage: (message: Message) => void;
}) {
  const savedMessage = await api.createMessage(params.message.chatId, {
    type: params.message.type,
    senderId: params.message.senderId,
    senderName: params.message.senderName,
    content: params.message.content,
    emotion: params.message.emotion,
  });

  const persistedMessage = savedMessage as unknown as Message;
  params.upsertMessage(persistedMessage);
  return persistedMessage;
}
