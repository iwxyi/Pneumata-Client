import type { GroupChat } from '../types/chat';
import type { AICharacter } from '../types/character';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';

export interface SessionInfoCard {
  key: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionChatId?: string;
}

interface ProjectSessionInfoCardsParams {
  chat: GroupChat;
  chats: GroupChat[];
  members?: AICharacter[];
  isZh?: boolean;
}

export function projectSessionInfoCards(params: ProjectSessionInfoCardsParams): SessionInfoCard[] {
  const isZh = Boolean(params.isZh);
  const displayMembers: DisplayTextMember[] = [
    { id: 'user', name: '我' },
    ...((params.members || []).map((member) => ({ id: member.id, name: member.name }))),
  ];
  const clean = (text: string) => sanitizeUserFacingText(text, displayMembers);
  const cards: SessionInfoCard[] = [];
  if (params.chat.type === 'ai_direct') {
    if (params.chat.sourceChatId) {
      const sourceChat = params.chats.find((item) => item.id === params.chat.sourceChatId);
      cards.push({
        key: 'ai-direct-source-chat',
        title: isZh ? '来源群聊' : 'Source group chat',
        description: sourceChat
          ? clean(isZh ? `${sourceChat.name} · ${sourceChat.memberIds.length} 位成员` : `${sourceChat.name} · ${sourceChat.memberIds.length} members`)
          : (isZh ? '来源群聊已不可用' : 'Source chat is unavailable'),
        actionLabel: isZh ? '返回来源群聊' : 'Open source chat',
        actionChatId: params.chat.sourceChatId,
      });
    }
  }
  return cards;
}
