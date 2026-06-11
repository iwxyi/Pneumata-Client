import { Box, Typography, Avatar, IconButton, Menu, MenuItem, List, ListItem, ListItemAvatar, Chip, Stack, Dialog, DialogTitle, DialogContent, DialogActions, Button, Tooltip } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { formatEmotionStateLabel, getAffectChipColor, getRuntimeAxisLabel } from '../../services/personalityDrift';
import { isImageAvatar } from '../../utils/avatar';
import MoreIcon from '@mui/icons-material/MoreVert';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { useMemo, useState } from 'react';
import SortableList from '../common/SortableList';
import { useTranslation } from 'react-i18next';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { buildMemberExpressionFeedbackChips, buildMemberInnerLifeChips } from '../../services/memberInnerLifePresentation';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { microPillChipSx } from '../../styles/interaction';
import { canRunAiMemberActions } from '../../services/memberActionPolicy';
import { inferSystemAgentSubtypeFromId } from '../../services/actorRefPresentation';

interface MemberListProps {
  members: AICharacter[];
  thinkingId: string | null;
  chat?: GroupChat;
  onRemove?: (id: string) => void;
  onSpeakAs?: (id: string) => void;
  onGuideMember?: (id: string) => void;
  onSetPerspectiveMember?: (id: string) => void;
  onStartDirectChat?: (id: string) => void;
  onUpdateSeats?: (memberIds: string[]) => void;
  perspectiveMemberId?: string | null;
}

function buildMemberSubtitle(member: AICharacter, thinkingId: string | null, thinkingLabel: string) {
  if (thinkingId === member.id) return thinkingLabel;
  return '';
}

function buildMemberEmotionChips(member: AICharacter, language: string, showDebugDetails: boolean) {
  const emotionalState = member.emotionalState;
  if (!emotionalState) return [];
  return Object.entries(emotionalState)
    .map(([key, value]) => ({ key, value: Number(value) || 0 }))
    .filter((item) => item.value >= 12)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((item) => {
      const label = getRuntimeAxisLabel(item.key, language);
      const semanticLabel = formatEmotionStateLabel(item.key, item.value, language);
      return {
        label: showDebugDetails ? `${semanticLabel} ${Math.round(item.value)}` : semanticLabel,
        hint: language.startsWith('zh')
          ? `${label}来自最近几轮互动造成的短时情绪，不代表永久人格。${showDebugDetails ? `当前 ${Math.round(item.value)}` : ''}`
          : `${label} is a short-term emotion from recent interactions, not a permanent trait.${showDebugDetails ? ` Current ${Math.round(item.value)}` : ''}`,
      };
    });
}

function buildMemberListSurfaceSx() {
  return {
    position: 'relative',
    borderRadius: 1,
    bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.050)',
    border: '1px solid',
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.075)' : 'rgba(226,232,240,0.105)',
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 1px 0 rgba(255,255,255,0.80) inset, 0 12px 28px rgba(15,23,42,0.045)'
      : '0 1px 0 rgba(255,255,255,0.08) inset, 0 14px 32px rgba(0,0,0,0.20)',
    backdropFilter: 'blur(18px) saturate(1.18)',
    WebkitBackdropFilter: 'blur(18px) saturate(1.18)',
    overflow: 'hidden',
  };
}

function buildMemberRowSx(isThinking: boolean) {
  return {
    position: 'relative',
    borderRadius: 0.75,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 1,
    minWidth: 0,
    px: 1,
    py: 0.75,
    overflow: 'hidden',
    bgcolor: (theme: Theme) => isThinking
      ? `${theme.palette.primary.main}${theme.palette.mode === 'light' ? '14' : '24'}`
      : 'transparent',
    transition: 'background-color 160ms ease, transform 160ms ease',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 8,
      bottom: 8,
      width: 3,
      borderRadius: 999,
      bgcolor: isThinking ? 'primary.main' : 'transparent',
      pointerEvents: 'none',
    },
    '&:hover': {
      transform: 'translateX(1px)',
      bgcolor: (theme: Theme) => isThinking
        ? `${theme.palette.primary.main}${theme.palette.mode === 'light' ? '18' : '2B'}`
        : theme.palette.mode === 'light' ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.055)',
    },
  };
}

function buildMemberAvatarFallback(member: AICharacter) {
  if (member.avatar?.trim()) return member.avatar.trim().slice(0, 2);
  const name = member.name?.trim();
  if (!name) return '成';
  return name.slice(0, 1);
}

export default function MemberList({ members, thinkingId, chat, onRemove, onSpeakAs, onGuideMember, onSetPerspectiveMember, onStartDirectChat, onUpdateSeats, perspectiveMemberId }: MemberListProps) {
  const { i18n } = useTranslation();
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuCharId, setMenuCharId] = useState<string | null>(null);
  const [seatDialogOpen, setSeatDialogOpen] = useState(false);
  const showDebugDetails = developerMode && showAdvancedRuntimePanels;

  const resolvedSeatOrder = useMemo(() => {
    const orderedSeatIds = chat?.scenarioState?.seats
      ?.slice()
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((item) => item.actorId || '')
      .filter(Boolean);

    if (orderedSeatIds?.length) {
      const memberIds = new Set(members.map((member) => member.id));
      const normalizedSeatIds = orderedSeatIds.filter((id) => memberIds.has(id));
      const missingMemberIds = members.map((member) => member.id).filter((id) => !normalizedSeatIds.includes(id));
      return [...normalizedSeatIds, ...missingMemberIds];
    }

    return members.map((member) => member.id);
  }, [chat?.scenarioState?.seats, members]);

  const [seatOrder, setSeatOrder] = useState<string[]>([]);

  const memberLookup = useMemo(() => {
    return new Map(members.map((member) => [member.id, member]));
  }, [members]);
  const aiMemberIdSet = useMemo(() => {
    return new Set(
      members
        .map((member) => member.id)
        .filter((id) => id !== 'user' && !inferSystemAgentSubtypeFromId(id)),
    );
  }, [members]);

  const visibleMembers = useMemo(() => {
    const orderedMembers = resolvedSeatOrder.map((id) => memberLookup.get(id)).filter(Boolean) as AICharacter[];
    if (orderedMembers.length === members.length) return orderedMembers;
    return members;
  }, [memberLookup, members, resolvedSeatOrder]);

  const seatDialogMembers = useMemo(() => {
    const orderedMembers = seatOrder.map((id) => memberLookup.get(id)).filter(Boolean) as AICharacter[];
    return orderedMembers.length ? orderedMembers : visibleMembers;
  }, [memberLookup, seatOrder, visibleMembers]);

  const openSeatDialog = () => {
    setSeatOrder(resolvedSeatOrder);
    setSeatDialogOpen(true);
  };

  const closeMenu = () => {
    setAnchorEl(null);
    setMenuCharId(null);
  };
  const buildMemberActions = (memberId: string | null) => {
    const canRun = canRunAiMemberActions(memberId, aiMemberIdSet);
    if (!canRun || !memberId) return [];
    if (chat?.type === 'ai_direct') {
      return onSetPerspectiveMember ? [{
        key: 'perspective',
        label: i18n.language.startsWith('zh') ? '以该角色视角' : 'Use this perspective',
        selected: perspectiveMemberId === memberId,
        run: () => onSetPerspectiveMember(memberId),
      }] : [];
    }
    return [
      chat?.type !== 'direct' && onSpeakAs ? {
        key: 'speak-as',
        label: i18n.language.startsWith('zh') ? '以此角色发言' : 'Speak as',
        run: () => onSpeakAs(memberId),
      } : null,
      chat?.type !== 'direct' && onGuideMember ? {
        key: 'guide-member',
        label: i18n.language.startsWith('zh') ? '话题引导' : 'Topic guide',
        run: () => onGuideMember(memberId),
      } : null,
      canRun && onStartDirectChat ? {
        key: 'start-direct',
        label: i18n.language.startsWith('zh') ? '发起单聊' : 'Start direct chat',
        run: () => onStartDirectChat(memberId),
      } : null,
      canRun && onRemove ? {
        key: 'remove',
        label: i18n.language.startsWith('zh') ? '移除成员' : 'Remove member',
        danger: true,
        run: () => onRemove(memberId),
      } : null,
    ].filter(Boolean) as Array<{ key: string; label: string; selected?: boolean; danger?: boolean; run: () => void }>;
  };

  return (
    <Box>
      <List
        dense
        disablePadding
        sx={{
          ...buildMemberListSurfaceSx(),
          display: 'grid',
          gap: 0.15,
          p: 0.35,
        }}
      >
        {visibleMembers.map((member) => {
          const memberActions = buildMemberActions(member.id);
          const hasMemberActions = memberActions.length > 0;
          const innerLifeChips = buildMemberInnerLifeChips(member, i18n.language);
          const expressionFeedbackChips = buildMemberExpressionFeedbackChips(member, i18n.language, showDebugDetails);
          const emotionChips = buildMemberEmotionChips(member, i18n.language, showDebugDetails);
          const subtitle = buildMemberSubtitle(member, thinkingId, i18n.language.startsWith('zh') ? '思考中' : 'Thinking');
          return (
            <ListItem
              key={member.id}
              sx={buildMemberRowSx(thinkingId === member.id)}
            >
              <ListItemAvatar sx={{ minWidth: 0, flex: '0 0 auto' }}>
                <Avatar src={isImageAvatar(member.avatar) ? member.avatar : undefined} sx={{ width: 32, height: 32, fontSize: '1rem', bgcolor: 'primary.light' }}>
                  {isImageAvatar(member.avatar) ? undefined : buildMemberAvatarFallback(member)}
                </Avatar>
              </ListItemAvatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  title={member.name}
                  sx={{
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}
                >
                  {chat?.scenarioState?.mysteryRoleMappingMode === 'role_only'
                    ? (chat.scenarioState?.roleAssignments?.find((item) => item.actorId === member.id)?.summary || member.name)
                    : chat?.scenarioState?.mysteryRoleMappingMode === 'alias'
                      ? `${member.name}（${chat.scenarioState?.roleAssignments?.find((item) => item.actorId === member.id)?.summary || '未分配身份'}）`
                      : member.name}
                </Typography>
                <Box sx={{ mt: 0.25 }}>
                  <Stack spacing={0.5}>
                    {subtitle ? (
                      <Typography variant="caption" color={thinkingId === member.id ? 'primary.main' : 'text.secondary'}>
                        {subtitle}
                      </Typography>
                    ) : null}
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {innerLifeChips.map((item) => (
                        <Tooltip key={`${member.id}-inner-${item.label}`} title={item.hint} arrow placement="top">
                          <Chip
                            size="small"
                            label={item.label}
                            color={item.color}
                            variant="outlined"
                            sx={{ ...microPillChipSx, cursor: 'help' }}
                          />
                        </Tooltip>
                      ))}
                      {expressionFeedbackChips.map((item) => (
                        <Tooltip key={`${member.id}-expression-${item.label}`} title={item.hint} arrow placement="top">
                          <Chip
                            size="small"
                            label={item.label}
                            color={item.color}
                            variant="outlined"
                            sx={{ ...microPillChipSx, cursor: 'help' }}
                          />
                        </Tooltip>
                      ))}
                    </Box>
                    {emotionChips.length ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {emotionChips.map((item) => (
                          <Tooltip key={`${member.id}-emotion-${item.label}`} title={item.hint} arrow placement="top">
                            <Chip
                              size="small"
                              label={item.label}
                              variant="filled"
                              color={getAffectChipColor(item.label)}
                              sx={{ ...microPillChipSx, cursor: 'help' }}
                            />
                          </Tooltip>
                        ))}
                      </Box>
                    ) : null}
                  </Stack>
                </Box>
              </Box>
              {hasMemberActions ? (
                <IconButton
                  size="small"
                  sx={{
                    flex: '0 0 auto',
                    mt: -0.25,
                    opacity: 0.72,
                    '&:hover': { opacity: 1, bgcolor: 'action.hover' },
                  }}
                  onClick={(e) => {
                    setAnchorEl(e.currentTarget);
                    setMenuCharId(member.id);
                  }}
                >
                  <MoreIcon fontSize="small" />
                </IconButton>
              ) : null}
            </ListItem>
          );
        })}
      </List>
      {chat?.type === 'group' && onUpdateSeats ? (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.75 }}>
          <Button size="small" variant="text" onClick={openSeatDialog}>调整座位</Button>
        </Box>
      ) : null}

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl) && buildMemberActions(menuCharId).length > 0} onClose={closeMenu}>
        {buildMemberActions(menuCharId).map((action) => (
          <MenuItem
            key={action.key}
            selected={action.selected}
            onClick={() => {
              closeMenu();
              action.run();
            }}
            sx={action.danger ? { color: 'error.main' } : undefined}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={seatDialogOpen} onClose={() => setSeatDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>调整成员位置</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <SortableList
              items={seatDialogMembers}
              onChange={(nextMembers) => setSeatOrder(nextMembers.map((member) => member.id))}
              getItemSx={({ isDragging }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                p: 1,
                borderRadius: 2,
                bgcolor: isDragging ? 'action.selected' : 'action.hover',
                border: '1px solid',
                borderColor: isDragging ? 'primary.main' : 'transparent',
                boxShadow: isDragging ? 3 : 0,
                opacity: isDragging ? 0.88 : 1,
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none',
              })}
              renderItem={({ item: member, index }) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <DragIndicatorIcon fontSize="small" color="action" />
                  <Typography variant="body2">{index + 1}. {member.name}</Typography>
                </Box>
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSeatDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => {
            onUpdateSeats?.(seatOrder.length ? seatOrder : resolvedSeatOrder);
            setSeatDialogOpen(false);
          }}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
