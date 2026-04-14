export type MessageType = 'ai' | 'user' | 'system' | 'god';

export interface Message {
  id: string;
  chatId: string;
  type: MessageType;
  senderId: string;         // AI character ID, 'user', or 'system'
  senderName: string;
  content: string;
  emotion: number;           // -1 to 1
  timestamp: number;
  isDeleted: boolean;
}
