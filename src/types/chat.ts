export type ChatStyle = 'free' | 'debate' | 'brainstorm' | 'roleplay';

export interface GroupChat {
  id: string;
  name: string;
  topic: string;
  style: ChatStyle;
  memberIds: string[];       // AI character ID list
  speed: number;             // 0.5 - 2.0
  isActive: boolean;         // auto-chatting or not
  allowIntervention: boolean;
  topicSeed: string;         // initial topic seed
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
}
