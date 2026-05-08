import { lazy, Suspense } from 'react';
import { Box, Tabs, Tab, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import MemberList from '../controls/MemberList';

const RelationshipPanel = lazy(() => import('../controls/RelationshipPanel'));
const ChatRuntimePanel = lazy(() => import('./ChatRuntimePanel'));

interface ChatSidebarPanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  thinkingId: string | null;
  rightPanelTab: string;
  setRightPanelTab: (value: 'members' | 'world' | 'actions') => void;
  showMemberTab: boolean;
  showRuntimeTab: boolean;
  showActionTab?: boolean;
  actionPanel?: React.ReactNode;
  memberPanelTitle?: string;
  runtimePanelTitle?: string;
  privatePayloads: Array<{ key: string; title: string; text: string }>;
  onSpeakAs: (charId: string) => void;
  onRemoveMember?: (charId: string) => void;
  onUpdateSeats?: (memberIds: string[]) => void;
}

function ChatScenarioCard({ chat }: { chat: GroupChat }) {
  const rows = [] as string[];
  if (chat.scenarioState?.roleAssignments?.length) rows.push(`角色位 ${chat.scenarioState.roleAssignments.slice(0, 4).map((item) => item.roleId).join(' / ')}`);
  if (chat.scenarioState?.factions?.length) rows.push(`阵营 ${chat.scenarioState.factions.slice(0, 4).map((item) => item.label).join(' / ')}`);
  if (chat.scenarioState?.currentTurnActorId) rows.push(`当前轮次 ${chat.scenarioState.currentTurnActorId}`);
  if (!rows.length) return null;
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>场景结构</Typography>
      <Stack spacing={0.5}>
        {rows.map((row) => <Typography key={row} variant="body2">{row}</Typography>)}
      </Stack>
    </Box>
  );
}

function PanelFallback() {
  return null;
}

export default function ChatSidebarPanel({
  chat,
  members,
  thinkingId,
  rightPanelTab,
  setRightPanelTab,
  showMemberTab,
  showRuntimeTab,
  showActionTab,
  actionPanel,
  memberPanelTitle,
  runtimePanelTitle,
  privatePayloads,
  onSpeakAs,
  onRemoveMember,
  onUpdateSeats,
}: ChatSidebarPanelProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showMemberTab || showRuntimeTab || showActionTab ? (
        <Tabs value={rightPanelTab} onChange={(_, value) => setRightPanelTab(value)}>
          {showMemberTab ? <Tab value="members" label={memberPanelTitle || (chat.type === 'group' ? '成员' : '角色')} /> : null}
          {showRuntimeTab ? <Tab value="world" label={runtimePanelTitle || '状态'} /> : null}
          {showActionTab ? <Tab value="actions" label="动作" /> : null}
        </Tabs>
      ) : null}

      {rightPanelTab === 'members' && showMemberTab ? (
        <Stack spacing={2}>
          <MemberList
            members={members}
            thinkingId={thinkingId}
            chat={chat}
            onSpeakAs={onSpeakAs}
            onRemove={onRemoveMember}
            onUpdateSeats={onUpdateSeats}
          />
          <Suspense fallback={<PanelFallback />}>
            <RelationshipPanel chat={chat} members={members} />
          </Suspense>
        </Stack>
      ) : null}

      {rightPanelTab === 'world' && showRuntimeTab ? (
        <Stack spacing={2}>
          <ChatScenarioCard chat={chat} />
          <Suspense fallback={<PanelFallback />}>
            <ChatRuntimePanel chat={chat} members={members} privatePayloads={privatePayloads} />
          </Suspense>
        </Stack>
      ) : null}

      {rightPanelTab === 'actions' && showActionTab ? actionPanel || null : null}
    </Box>
  );
}
