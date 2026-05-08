import type { AICharacter } from '../types/character';
import type { DriverMessageCommitTransition, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';

export interface CommitRuntimeServices {
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitTransition['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}

export interface CommitRuntimeRequest {
  api: APIConfig;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  currentMessages: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitTransition | Promise<DriverMessageCommitTransition>;
}

export async function applyCommitTransition(params: {
  chatId: string;
  speakerId: string;
  transition: DriverMessageCommitTransition;
  services: CommitRuntimeServices;
}) {
  for (const patch of params.transition.characterPatches) {
    await params.services.updateCharacter(patch.characterId, patch.patch);
  }
  for (const eventPayload of params.transition.runtimeEvents) {
    await params.services.appendEventMessage(params.chatId, eventPayload);
  }
  params.services.recordSpeak(params.speakerId);
  await params.services.updateChat(params.chatId, { lastMessageAt: Date.now(), ...params.transition.chatPatch });
}
