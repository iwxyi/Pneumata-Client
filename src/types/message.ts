export type MessageType = 'ai' | 'user' | 'system' | 'god' | 'event';

export interface Message {
  id: string;
  clientKey?: string;
  serverId?: string;
  chatId: string;
  type: MessageType;
  senderId: string;         // AI character ID, 'user', or 'system'
  senderName: string;
  content: string;
  emotion: number;           // -1 to 1
  timestamp: number;
  isDeleted: boolean;
  isOptimistic?: boolean;
  isStreaming?: boolean;
}
