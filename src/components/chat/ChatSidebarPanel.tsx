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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: { xs: '100%', md: 'auto' }, minHeight: 0 }}>
      {showMemberTab || showRuntimeTab || showActionTab ? (
        <Tabs
          value={rightPanelTab}
          onChange={(_, value) => setRightPanelTab(value)}
          variant="fullWidth"
          sx={{
            minHeight: 42,
            p: 0.4,
            borderRadius: 1,
            border: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.075)' : 'rgba(226,232,240,0.10)',
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.055)',
            backdropFilter: 'blur(18px) saturate(1.15)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.15)',
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 1px 0 rgba(255,255,255,0.78) inset, 0 10px 24px rgba(15,23,42,0.045)'
              : '0 1px 0 rgba(255,255,255,0.08) inset, 0 12px 28px rgba(0,0,0,0.20)',
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTabs-flexContainer': { gap: 0.35 },
            '& .MuiTab-root': {
              minWidth: 0,
              minHeight: 34,
              px: { xs: 0.55, sm: 1.25 },
              fontWeight: 720,
              fontSize: { xs: '0.78rem', sm: '0.875rem' },
              borderRadius: 0.75,
              color: 'text.secondary',
              whiteSpace: 'nowrap',
              transition: 'background-color 180ms ease, color 180ms ease, box-shadow 180ms ease',
            },
            '& .MuiTab-root.Mui-selected': {
              color: 'text.primary',
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.12)',
              boxShadow: (theme) => theme.palette.mode === 'light'
                ? '0 1px 0 rgba(255,255,255,0.90) inset, 0 6px 16px rgba(15,23,42,0.08)'
                : '0 1px 0 rgba(255,255,255,0.10) inset, 0 8px 18px rgba(0,0,0,0.24)',
            },
          }}
        >
          {showMemberTab ? <Tab value="members" label={memberPanelTitle || (chat.type === 'group' ? '成员' : '角色')} /> : null}
          {showRuntimeTab ? <Tab value="narrative" label="叙事线" /> : null}
          {showRuntimeTab ? <Tab value="world" label={runtimePanelTitle || '状态'} /> : null}
          {showActionTab ? <Tab value="actions" label="动作" /> : null}
        </Tabs>
      ) : null}

      <Box sx={{ flex: { xs: 1, md: '0 1 auto' }, minHeight: 0, overflowY: { xs: 'auto', md: 'visible' }, pr: { xs: 0.25, md: 0 } }}>
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
    </Box>
  );
}
