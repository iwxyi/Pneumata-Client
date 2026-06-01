import type { GroupChat } from '../types/chat';
import { sanitizeUserFacingText } from './displayTextSanitizer';

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
  isZh?: boolean;
}

export function projectSessionInfoCards(params: ProjectSessionInfoCardsParams): SessionInfoCard[] {
  const isZh = Boolean(params.isZh);
  const cards: SessionInfoCard[] = [];
  if (params.chat.type === 'direct') {
    cards.push({
      key: 'direct-semantics',
      title: isZh ? '用户私聊语义' : 'Direct semantics',
      description: isZh
        ? '该会话是用户与角色的回应式私域线程，不参与自动群聊轮转。'
        : 'This thread is a user-to-character responsive private channel and is excluded from auto group turns.',
    });
  }
  if (params.chat.type === 'ai_direct') {
    cards.push({
      key: 'ai-direct-semantics',
      title: isZh ? '双 AI 私聊语义' : 'AI-direct semantics',
      description: isZh
        ? '该会话是角色之间的独立私聊线程，可作为群聊事件回流来源。'
        : 'This thread is a standalone character-to-character private channel and may feed back into group events.',
    });
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
  const clean = (text: string) => sanitizeUserFacingText(text);
