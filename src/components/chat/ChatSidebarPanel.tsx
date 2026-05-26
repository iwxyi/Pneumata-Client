import { lazy, Suspense } from 'react';
import { Box, Tabs, Tab, Stack, Typography, Chip } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { Message } from '../../types/message';
import MemberList from '../controls/MemberList';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import { formatScenarioRoleLabel } from '../../services/scenarioPresentation';

const RelationshipPanel = lazy(() => import('../controls/RelationshipPanel'));
const ChatRuntimePanel = lazy(() => import('./ChatRuntimePanel'));
const ChatNarrativePanel = lazy(() => import('./ChatNarrativePanel'));

interface ChatSidebarPanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  messages?: Message[];
  thinkingId: string | null;
  rightPanelTab: string;
  setRightPanelTab: (value: 'members' | 'narrative' | 'world' | 'actions') => void;
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
  onStartDirectChat?: (charId: string) => void;
  onRemoveMember?: (charId: string) => void;
  onUpdateSeats?: (memberIds: string[]) => void;
}

function memberName(id: string | null | undefined, members: AICharacter[]) {
  if (!id) return '成员';
  return members.find((member) => member.id === id)?.name || '成员';
}

function ChatScenarioCard({ chat, members }: { chat: GroupChat; members: AICharacter[] }) {
  const rows = [] as string[];
  if (chat.scenarioState?.roleAssignments?.length) {
    rows.push(`角色位 ${chat.scenarioState.roleAssignments.slice(0, 4).map((item) => `${memberName(item.actorId, members)}${item.roleId ? `：${formatScenarioRoleLabel(item.roleId)}` : ''}`).join(' / ')}`);
  }
  if (chat.scenarioState?.factions?.length) rows.push(`阵营 ${chat.scenarioState.factions.slice(0, 4).map((item) => item.label).join(' / ')}`);
  if (chat.scenarioState?.currentTurnActorId) rows.push(`当前轮次 ${memberName(chat.scenarioState.currentTurnActorId, members)}`);
  if (!rows.length) return null;
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>场景规则</Typography>
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
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMemoryDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  if (chat.type !== 'direct' || !members[0]) return null;
  const character = members[0];
  const showDebugDetails = developerMode && showMemoryDebug;
  const memoryChips = showDebugDetails
    ? [
      `角色记忆 ${(character.layeredMemories || []).length}`,
      `关系 ${(character.relationships || []).length}`,
      `时间线 ${(character.runtimeTimeline || []).length}`,
    ]
    : [
      (character.layeredMemories || []).length ? '会参考长期记忆' : '',
      (character.relationships || []).length ? '会参考关系线索' : '',
      (character.runtimeTimeline || []).length ? '会参考最近变化' : '',
    ].filter(Boolean);
  const recentRelationshipText = directMemoryContext?.recentRelationshipChanges?.slice(-2).map((item) => sanitizeUserFacingText(item.text, members)).filter(Boolean).join(' / ');
  const recentMemoryText = directMemoryContext?.recentMemoryWrites?.slice(0, 2).map((item) => sanitizeUserFacingText(item.text, members)).filter(Boolean).join(' / ');
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>单聊记忆主轴</Typography>
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">该角色会优先读取自己的长期记忆、关系记忆与最近变化，而不是优先回溯来源群聊。</Typography>
        {memoryChips.length ? (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {memoryChips.map((chip) => <Chip key={chip} size="small" label={chip} />)}
          </Box>
        ) : null}
        {directMemoryContext?.targetSummary ? <Typography variant="caption" color="text.secondary">{sanitizeUserFacingText(directMemoryContext.targetSummary, members)}</Typography> : null}
        {recentRelationshipText ? (
          <Typography variant="caption" color="text.secondary">最近关系变化：{recentRelationshipText}</Typography>
        ) : null}
        {recentMemoryText ? <Typography variant="caption" color="text.secondary">最近记忆：{recentMemoryText}</Typography> : null}
        {showDebugDetails && directMemoryContext?.memoryVisibility ? <Typography variant="caption" color="text.secondary">{directMemoryContext.memoryVisibility}</Typography> : null}
        {showDebugDetails && directMemoryContext?.sourceTagSummary ? <Typography variant="caption" color="text.secondary">来源：{directMemoryContext.sourceTagSummary}</Typography> : null}
        {showDebugDetails && directMemoryContext?.targetResolutionLabel ? <Typography variant="caption" color="text.secondary">判断方式：{directMemoryContext.targetResolutionLabel}</Typography> : null}
        {showDebugDetails && directMemoryContext?.targetResolution ? <Typography variant="caption" color="text.secondary">目标识别：{sanitizeUserFacingText(directMemoryContext.targetResolution, members)}</Typography> : null}
      </Stack>
    </Box>
  );
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
  showActionTab,
  actionPanel,
  memberPanelTitle,
  runtimePanelTitle,
  privatePayloads,
  directMemoryContext,
  onSpeakAs,
  onStartDirectChat,
  onRemoveMember,
  onUpdateSeats,
}: ChatSidebarPanelProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showMemberTab || showRuntimeTab || showActionTab ? (
        <Tabs value={rightPanelTab} onChange={(_, value) => setRightPanelTab(value)}>
          {showMemberTab ? <Tab value="members" label={memberPanelTitle || (chat.type === 'group' ? '成员' : '角色')} /> : null}
          {showRuntimeTab ? <Tab value="narrative" label="叙事线" /> : null}
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
            onStartDirectChat={onStartDirectChat}
            onRemove={onRemoveMember}
            onUpdateSeats={onUpdateSeats}
          />
          <Suspense fallback={<PanelFallback />}>
            <RelationshipPanel chat={chat} members={members} />
          </Suspense>
        </Stack>
      ) : null}

      {rightPanelTab === 'narrative' && showRuntimeTab ? (
        <Suspense fallback={<PanelFallback />}>
          <ChatNarrativePanel chat={chat} members={members} messages={messages} />
        </Suspense>
      ) : null}

      {rightPanelTab === 'world' && showRuntimeTab ? (
        <Stack spacing={2}>
          <ChatScenarioCard chat={chat} members={members} />
          <DirectMemoryHint chat={chat} members={members} directMemoryContext={directMemoryContext} />
          <Suspense fallback={<PanelFallback />}>
            <ChatRuntimePanel chat={chat} members={members} messages={messages} privatePayloads={privatePayloads} />
          </Suspense>
        </Stack>
      ) : null}

      {rightPanelTab === 'actions' && showActionTab ? actionPanel || null : null}
    </Box>
  );
}
