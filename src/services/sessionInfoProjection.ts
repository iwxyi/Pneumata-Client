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

  if (params.chat.sessionKind?.scenarioId === 'werewolf-classic' && params.chat.scenarioState?.werewolfRoleConfig) {
    cards.push({
      key: 'werewolf-role-config',
      title: isZh ? '角色分配' : 'Role setup',
      description: clean(String(params.chat.scenarioState.werewolfRoleConfig)),
    });
  }
  if (params.chat.sessionKind?.scenarioId === 'murder-mystery' && params.chat.scenarioState?.mysteryScript) {
    cards.push({
      key: 'mystery-script',
      title: isZh ? '剧本设定' : 'Script setup',
      description: clean(String(params.chat.scenarioState.mysteryScript)),
    });
  }
  if ((params.chat.sessionKind?.family === 'study' || params.chat.sessionKind?.family === 'agent') && params.chat.scenarioState?.goals?.[0]?.label) {
    cards.push({
      key: 'room-goal',
      title: isZh ? '当前目标' : 'Current goal',
      description: clean(String(params.chat.scenarioState.goals[0].label)),
    });
  }
  const discussionTarget = params.chat.sessionKind?.family === 'analysis' ? params.chat.scenarioState?.progress?.[0]?.target : undefined;
  if (typeof discussionTarget === 'number' && discussionTarget > 0) {
    cards.push({
      key: 'discussion-progress',
      title: isZh ? '审议进展' : 'Deliberation progress',
      description: clean(`${params.chat.scenarioState?.progress?.[0]?.value || 0}/${discussionTarget}`),
    });
  }
  if (params.chat.sessionKind?.family === 'board_game' && params.chat.scenarioState?.board?.schema) {
    cards.push({
      key: 'board-size',
      title: isZh ? '棋盘尺寸' : 'Board size',
      description: clean(`${params.chat.scenarioState.board.schema.columns || 0} × ${params.chat.scenarioState.board.schema.rows || 0}`),
    });
  }
  return cards;
}
