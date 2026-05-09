import { lazy, Suspense } from 'react';
import { Box, Tabs, Tab, Stack, Typography, Chip } from '@mui/material';
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
  directMemoryContext?: {
    targetName: string | null;
    targetSummary: string;
    memoryVisibility: string;
    recentMemories: Array<{ id: string; text: string; layer: string; scope: string }>;
    recentRelationshipChanges: Array<{ type: string; text: string; createdAt: number }>;
  } | null;
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

function DirectMemoryHint({ chat, members, directMemoryContext }: { chat: GroupChat; members: AICharacter[]; directMemoryContext?: ChatSidebarPanelProps['directMemoryContext'] }) {
  if (chat.type !== 'direct' || !members[0]) return null;
  const character = members[0];
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>单聊记忆主轴</Typography>
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">该角色会优先读取自己的长期记忆、关系记忆与最近变化，而不是优先回溯来源群聊。</Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Chip size="small" label={`角色记忆 ${(character.layeredMemories || []).length}`} />
          <Chip size="small" label={`关系 ${(character.relationships || []).length}`} />
          <Chip size="small" label={`时间线 ${(character.runtimeTimeline || []).length}`} />
        </Box>
        {directMemoryContext?.memoryVisibility ? <Typography variant="caption" color="text.secondary">{directMemoryContext.memoryVisibility}</Typography> : null}
        {directMemoryContext?.targetSummary ? <Typography variant="caption" color="text.secondary">{directMemoryContext.targetSummary}</Typography> : null}
        {directMemoryContext?.recentRelationshipChanges?.length ? (
          <Typography variant="caption" color="text.secondary">最近关系变化：{directMemoryContext.recentRelationshipChanges.slice(-2).map((item) => item.text).join(' / ')}</Typography>
        ) : null}
      </Stack>
    </Box>
  );
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
  directMemoryContext,
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
          <DirectMemoryHint chat={chat} members={members} directMemoryContext={directMemoryContext} />
          <Suspense fallback={<PanelFallback />}>
            <ChatRuntimePanel chat={chat} members={members} privatePayloads={privatePayloads} />
          </Suspense>
        </Stack>
      ) : null}

      {rightPanelTab === 'actions' && showActionTab ? actionPanel || null : null}
    </Box>
  );
}
