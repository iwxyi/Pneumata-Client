import { Box, Tabs, Tab, Stack } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import MemberList from '../controls/MemberList';
import RelationshipPanel from '../controls/RelationshipPanel';
import ChatRuntimePanel from './ChatRuntimePanel';

interface ChatSidebarPanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  thinkingId: string | null;
  rightPanelTab: string;
  setRightPanelTab: (value: 'members' | 'world') => void;
  showMemberTab: boolean;
  showRuntimeTab: boolean;
  memberPanelTitle?: string;
  runtimePanelTitle?: string;
  privatePayloads: Array<{ key: string; title: string; text: string }>;
  onSpeakAs: (charId: string) => void;
  onStartPrivateChat?: (charId: string) => void;
  onRemoveMember?: (charId: string) => void;
}

export default function ChatSidebarPanel({
  chat,
  members,
  thinkingId,
  rightPanelTab,
  setRightPanelTab,
  showMemberTab,
  showRuntimeTab,
  memberPanelTitle,
  runtimePanelTitle,
  privatePayloads,
  onSpeakAs,
  onStartPrivateChat,
  onRemoveMember,
}: ChatSidebarPanelProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showMemberTab && showRuntimeTab ? (
        <Tabs value={rightPanelTab} onChange={(_, value) => setRightPanelTab(value)}>
          <Tab value="members" label={memberPanelTitle || (chat.type === 'group' ? '成员' : '角色')} />
          <Tab value="world" label={runtimePanelTitle || '状态'} />
        </Tabs>
      ) : null}

      {rightPanelTab === 'members' && showMemberTab ? (
        <Stack spacing={2}>
          <MemberList
            members={members}
            thinkingId={thinkingId}
            chat={chat}
            onSpeakAs={onSpeakAs}
            onStartPrivateChat={onStartPrivateChat}
            onRemove={onRemoveMember}
          />
          <RelationshipPanel chat={chat} members={members} />
        </Stack>
      ) : null}

      {rightPanelTab === 'world' && showRuntimeTab ? <ChatRuntimePanel chat={chat} members={members} privatePayloads={privatePayloads} /> : null}

    </Box>
  );
}
