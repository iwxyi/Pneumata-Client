import { lazy, Suspense } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { Message } from '../../types/message';
import MemberList from '../controls/MemberList';
import FloatingSegmentedTabs from '../common/FloatingSegmentedTabs';
import { formatScenarioRoleLabel } from '../../services/scenarioPresentation';
import { ChatPrivateInfoCard } from './ChatPrivateInfoCard';
import { projectSessionParticipantTopology } from '../../services/sessionParticipantProjection';

const RelationshipPanel = lazy(() => import('../controls/RelationshipPanel'));
const ChatRuntimePanel = lazy(() => import('./ChatRuntimePanel'));
const ChatNarrativePanel = lazy(() => import('./ChatNarrativePanel'));

type ChatSidebarTab = 'members' | 'narrative' | 'world' | 'activities';

interface ChatSidebarPanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  messages?: Message[];
  thinkingId: string | null;
  rightPanelTab: string;
  setRightPanelTab: (value: ChatSidebarTab) => void;
  showMemberTab: boolean;
  showRuntimeTab: boolean;
  showActivityTab?: boolean;
  activityPanel?: React.ReactNode;
  memberFooter?: React.ReactNode;
  memberPanelTitle?: string;
  runtimePanelTitle?: string;
  privatePayloads: Array<{ key: string; title: string; text: string }>;
  privatePayloadTitle?: string;
  directMemoryContext?: {
    targetName: string | null;
    targetSummary: string;
    targetResolutionLabel?: string;
    memoryVisibility: string;
    recentMemories: Array<{ id: string; text: string; layer: string; scope: string }>;
    recentRelationshipChanges: Array<{ type: string; text: string; createdAt: number }>;
    recentMemoryWrites?: Array<{ id: string; text: string; layer: string; scope: string }>;
    sourceTagSummary?: string;
    sourceTagRows?: Array<{ tag: string; count: number; label: string }>;
    targetResolution?: string;
  } | null;
  onSpeakAs: (charId: string) => void;
  onGuideMember?: (charId: string) => void;
  onSetPerspectiveMember?: (charId: string) => void;
  onStartDirectChat?: (charId: string) => void;
  onRemoveMember?: (charId: string) => void;
  onUpdateSeats?: (memberIds: string[]) => void;
  perspectiveMemberId?: string | null;
}

function memberName(id: string | null | undefined, members: AICharacter[]) {
  if (!id) return '成员';
  return members.find((member) => member.id === id)?.name || '成员';
}

function ChatScenarioCard({ chat, members }: { chat: GroupChat; members: AICharacter[] }) {
  const rows = [] as string[];
  const topology = projectSessionParticipantTopology(chat, members, true);
  const nonMemberOperators = (chat.operatorIds || []).filter((id) => !chat.memberIds.includes(id));
  if (chat.scenarioState?.roleAssignments?.length) {
    rows.push(`角色位 ${chat.scenarioState.roleAssignments.slice(0, 4).map((item) => `${memberName(item.actorId, members)}${item.roleId ? `：${formatScenarioRoleLabel(item.roleId)}` : ''}`).join(' / ')}`);
  }
  if (chat.scenarioState?.factions?.length) rows.push(`阵营 ${chat.scenarioState.factions.slice(0, 4).map((item) => item.label).join(' / ')}`);
  if (chat.scenarioState?.currentTurnActorId) rows.push(`当前轮次 ${memberName(chat.scenarioState.currentTurnActorId, members)}`);
  if (!rows.length) return null;
  return (
    <Box sx={{
      p: 1.25,
      borderRadius: 1,
      bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.060)',
      border: '1px solid',
      borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.075)' : 'rgba(226,232,240,0.105)',
      boxShadow: (theme) => theme.palette.mode === 'light'
        ? '0 1px 0 rgba(255,255,255,0.82) inset, 0 12px 28px rgba(15,23,42,0.055)'
        : '0 1px 0 rgba(255,255,255,0.08) inset, 0 14px 32px rgba(0,0,0,0.24)',
      backdropFilter: 'blur(18px) saturate(1.18)',
      WebkitBackdropFilter: 'blur(18px) saturate(1.18)',
    }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>场景规则</Typography>
      <Stack spacing={0.5}>
        {rows.map((row) => <Typography key={row} variant="body2">{row}</Typography>)}
        {topology.memberBadges.length ? (
          <Typography variant="caption" color="text.secondary">
            {`成员 ${topology.memberBadges.map((item) => `${item.label}${item.capabilityLabels.length ? `(${item.capabilityLabels.join('/')})` : ''}`).join(' / ')}`}
          </Typography>
        ) : null}
        {topology.operatorBadges.length ? (
          <Typography variant="caption" color="text.secondary">
            {`操作者 ${topology.operatorBadges.map((item) => `${item.label}${item.capabilityLabels.length ? `(${item.capabilityLabels.join('/')})` : ''}`).join(' / ')}`}
          </Typography>
        ) : null}
        {nonMemberOperators.length ? (
          <Typography variant="caption" color="text.secondary">
            {`非成员操作者 ${nonMemberOperators.length} 位`}
          </Typography>
        ) : null}
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
  messages,
  thinkingId,
  rightPanelTab,
  setRightPanelTab,
  showMemberTab,
  showRuntimeTab,
  showActivityTab,
  activityPanel,
  memberFooter,
  memberPanelTitle,
  runtimePanelTitle,
  privatePayloads,
  privatePayloadTitle,
  directMemoryContext,
  onSpeakAs,
  onGuideMember,
  onSetPerspectiveMember,
  onStartDirectChat,
  onRemoveMember,
  onUpdateSeats,
  perspectiveMemberId,
}: ChatSidebarPanelProps) {
  const panelTabs = [
    showMemberTab ? { value: 'members' as const, label: `${memberPanelTitle || (chat.type === 'group' ? '成员' : '角色')} ${members.length}` } : null,
    showRuntimeTab ? { value: 'narrative' as const, label: '叙事线' } : null,
    showRuntimeTab ? { value: 'world' as const, label: runtimePanelTitle || '运行态' } : null,
    showActivityTab ? { value: 'activities' as const, label: '活动' } : null,
  ].filter(Boolean) as Array<{ value: ChatSidebarTab; label: string }>;
  const activePanelTab = panelTabs.some((item) => item.value === rightPanelTab)
    ? rightPanelTab as ChatSidebarTab
    : panelTabs[0]?.value || 'members';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      {panelTabs.length ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
          <FloatingSegmentedTabs
            value={activePanelTab}
            items={panelTabs}
            onChange={setRightPanelTab}
            equalWidth={false}
            comfortable={false}
          />
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: { xs: 0.25, md: 0.5 }, overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
        {activePanelTab === 'members' && showMemberTab ? (
          <Stack spacing={2}>
            <MemberList
              members={members}
              thinkingId={thinkingId}
              chat={chat}
              onSpeakAs={onSpeakAs}
              onGuideMember={onGuideMember}
              onSetPerspectiveMember={onSetPerspectiveMember}
              onStartDirectChat={onStartDirectChat}
              onRemove={onRemoveMember}
              onUpdateSeats={onUpdateSeats}
              perspectiveMemberId={perspectiveMemberId}
            />
            <Suspense fallback={<PanelFallback />}>
              <RelationshipPanel chat={chat} members={members} />
            </Suspense>
            {memberFooter || null}
          </Stack>
        ) : null}

        {activePanelTab === 'narrative' && showRuntimeTab ? (
          <Suspense fallback={<PanelFallback />}>
            <ChatNarrativePanel chat={chat} members={members} messages={messages} hideTitle />
          </Suspense>
        ) : null}

        {activePanelTab === 'world' && showRuntimeTab ? (
          <Stack spacing={2}>
            <ChatScenarioCard chat={chat} members={members} />
            <ChatPrivateInfoCard chat={chat} members={members} directMemoryContext={directMemoryContext || null} />
            <Suspense fallback={<PanelFallback />}>
              <ChatRuntimePanel chat={chat} members={members} messages={messages} privatePayloads={privatePayloads} privatePayloadTitle={privatePayloadTitle} />
            </Suspense>
          </Stack>
        ) : null}

        {activePanelTab === 'activities' && showActivityTab ? activityPanel || null : null}
      </Box>
    </Box>
  );
}
