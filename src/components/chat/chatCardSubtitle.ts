import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import { isUserFacingMemoryItem } from '../../services/memoryPresentation';

function cleanRelationshipPreview(text: string) {
  return text
    .replace(/^[^\s]+→/, '')
    .replace(/^[^↔]+↔[^：:]+[：:]/, '')
    .trim();
}

function buildRelationshipPreview(members: AICharacter[]) {
  return members
    .flatMap((member) => member.relationships
      .filter((relation) => Boolean(relation.note?.trim()))
      .slice(0, 1)
      .map((relation) => {
        const preview = cleanRelationshipPreview(relation.note || '');
        return preview ? `${member.name}：${preview}` : '';
      }))
    .find(Boolean) || '';
}

function clipPreview(text: string, max = 72) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildLatestMessagePreview(message: Message | null, members: AICharacter[]) {
  if (!message || message.isDeleted || message.type === 'system' || message.type === 'event') return '';
  const senderName = message.type === 'user'
    ? '你'
    : message.type === 'god'
      ? 'God Mode'
      : members.find((member) => member.id === message.senderId)?.name || message.senderName || '未知';
  return clipPreview(sanitizeUserFacingText(`${senderName}：${message.content}`, members));
}

export function buildChatSubtitle(
  chat: GroupChat,
  members: AICharacter[],
  latestMessage: Message | null,
  companionshipPreview = '',
) {
  const latestMessagePreview = buildLatestMessagePreview(latestMessage, members);
  if (chat.type === 'direct' && companionshipPreview && (!latestMessage || latestMessage.type === 'user' || latestMessage.type === 'god')) {
    return clipPreview(sanitizeUserFacingText(companionshipPreview, members));
  }
  const relationshipPreview = buildRelationshipPreview(members);
  const memorySummary = sanitizeUserFacingText((chat.layeredMemories || []).filter(isUserFacingMemoryItem).slice(-2).map((item) => item.text).join(' / '), members);
  const recentEvent = sanitizeUserFacingText(chat.worldState?.recentEvent || '', members);
  return latestMessagePreview || clipPreview(sanitizeUserFacingText(relationshipPreview || memorySummary || recentEvent || chat.topic || '', members));
}
