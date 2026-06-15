import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getChannelSemantics } from './channelSemanticsRegistry';

export type ProjectedChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    url: string;
    mimeType?: string;
  }>;
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

function buildTranscriptHeader(message: Message, characters: Map<string, AICharacter>, currentSpeakerId?: string) {
  if (message.type === 'user' || message.type === 'god') return '用户';
  if (message.senderId === currentSpeakerId) return '自己';
  return getTranscriptSpeakerName(message, characters);
}

function buildTranscriptLine(message: Message, characters: Map<string, AICharacter>, currentSpeakerId?: string) {
  return `${buildTranscriptHeader(message, characters, currentSpeakerId)}: ${compactTranscriptContent(message.content)}`;
}

function buildTranscriptInstruction(chatType: GroupChat['type']) {
  const semantics = getChannelSemantics({ type: chatType });
  return [
    'Conversation transcript for context only:',
    'The complete recent transcript is provided separately as chat messages and is not repeated here.',
    semantics.transcriptInstruction,
  ].join('\n');
}

function buildUserContextPrompt(transcript: string, chatType: GroupChat['type'] = 'group') {
  return `${buildTranscriptInstruction(chatType)}\n${transcript}`;
}

function buildTranscriptContext(messages: Message[], characters: Map<string, AICharacter>, currentSpeakerId?: string) {
  return messages.map((message) => buildTranscriptLine(message, characters, currentSpeakerId)).join('\n');
}

function buildCurrentSpeakerHistory(messages: Message[]) {
  return messages.map((message) => compactTranscriptContent(message.content)).join('\n');
}

function buildAssistantHistoryPrompt(history: string) {
  return history;
}

function isVisibleMessage(message: Message) {
  if (message.isDeleted) return false;
  if (message.type === 'system' || message.type === 'event') return false;
  return true;
}

function buildProjectedImageAttachments(message: Message) {
  const attachments = (message.metadata?.attachments || [])
    .filter((attachment) => attachment.kind === 'image' && attachment.url && attachment.status !== 'deleted' && attachment.status !== 'failed')
    .map((attachment) => ({ url: attachment.url as string, mimeType: attachment.mimeType }))
    .slice(0, 8);
  return attachments.length ? attachments : undefined;
}

export function projectConversationForModel(input: ConversationProjectionInput): ProjectedChatMessage[] {
  const visible = input.messages
    .filter(isVisibleMessage)
    .slice(-(input.limit ?? 12));
  const options = input.options || {};
  const currentSpeakerId = options.currentSpeakerId;
  const roomTranscript = visible.filter((message) => !(message.type === 'ai' && currentSpeakerId && message.senderId === currentSpeakerId));
  const projected: ProjectedChatMessage[] = [];
  if (roomTranscript.length) {
    projected.push({
      role: 'user',
      content: buildTranscriptInstruction(options.chatType || 'group'),
    });
  }
  for (const message of visible) {
    const attachments = buildProjectedImageAttachments(message);
    if (message.type === 'ai' && currentSpeakerId && message.senderId === currentSpeakerId) {
      projected.push({
        role: 'assistant',
        content: buildAssistantHistoryPrompt(compactTranscriptContent(message.content)),
        attachments,
      });
      continue;
    }
    projected.push({
      role: 'user',
      content: buildTranscriptLine(message, input.characters, currentSpeakerId),
      attachments,
    });
  }
  return projected;
}
