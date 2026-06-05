import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';

export type ProjectedChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface ConversationProjectionOptions {
  currentSpeakerId?: string;
  chatType?: GroupChat['type'];
}

export interface ConversationProjectionInput {
  messages: Message[];
  characters: Map<string, AICharacter>;
  limit?: number;
  options?: ConversationProjectionOptions;
}

function getTranscriptSpeakerName(message: Message, characters: Map<string, AICharacter>) {
  if (message.type === 'user' || message.type === 'god') return message.senderName || 'User';
  if (message.type === 'system') return 'System';
  if (message.type === 'event') return 'Event';
  return message.senderName || characters.get(message.senderId)?.name || 'Unknown';
}

function compactTranscriptContent(content: string, max = 1400) {
  const trimmed = (content || '').trim();
  if (Array.from(trimmed).length <= max) return trimmed;
  return `${Array.from(trimmed).slice(0, max).join('')}...`;
}

function buildUserSideTranscriptContent(message: Message, characters: Map<string, AICharacter>) {
  return `${getTranscriptSpeakerName(message, characters)}: ${compactTranscriptContent(message.content)}`;
}

export function projectConversationForModel(input: ConversationProjectionInput): ProjectedChatMessage[] {
  const visible = input.messages
    .filter((message) => {
      if (message.isDeleted) return false;
      if (message.type === 'system') return false;
      if (message.type !== 'event') return true;
      return false;
    })
    .slice(-(input.limit ?? 12));
  const options = input.options || {};
  return visible.map((message) => {
    if (message.type === 'ai' && options.currentSpeakerId && message.senderId === options.currentSpeakerId) {
      return {
        role: 'assistant' as const,
        content: compactTranscriptContent(message.content),
      };
    }
    return {
      role: 'user' as const,
      content: buildUserSideTranscriptContent(message, input.characters),
    };
  });
}
