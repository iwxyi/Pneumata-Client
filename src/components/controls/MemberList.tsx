import { Box, Typography, Avatar, IconButton, Menu, MenuItem, List, ListItem, ListItemAvatar, Chip, Stack, Dialog, DialogTitle, DialogContent, DialogActions, Button, Tooltip } from '@mui/material';
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

interface MemberListProps {
  members: AICharacter[];
  thinkingId: string | null;
  chat?: GroupChat;
  onRemove?: (id: string) => void;
  onSpeakAs?: (id: string) => void;
  onUpdateSeats?: (memberIds: string[]) => void;
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

export default function MemberList({ members, thinkingId, chat, onRemove, onSpeakAs, onUpdateSeats }: MemberListProps) {
  const { t, i18n } = useTranslation();
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

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t('controls.memberList')} ({members.length})
        </Typography>
        {chat?.type === 'group' && onUpdateSeats ? <Button size="small" variant="text" onClick={openSeatDialog}>调整座位</Button> : null}
      </Box>
      <List dense disablePadding sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 0.5 }}>
        {visibleMembers.map((member) => {
          const innerLifeChips = buildMemberInnerLifeChips(member, i18n.language);
          const expressionFeedbackChips = buildMemberExpressionFeedbackChips(member, i18n.language, showDebugDetails);
          const emotionChips = buildMemberEmotionChips(member, i18n.language, showDebugDetails);
          const subtitle = buildMemberSubtitle(member, thinkingId, t('controls.thinking'));
          return (
            <ListItem
              key={member.id}
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  onClick={(e) => {
                    setAnchorEl(e.currentTarget);
                    setMenuCharId(member.id);
                  }}
                >
                  <MoreIcon fontSize="small" />
                </IconButton>
              }
              sx={{
                borderRadius: 2,
                bgcolor: thinkingId === member.id ? 'action.selected' : 'transparent',
              }}
            >
              <ListItemAvatar>
                <Avatar src={isImageAvatar(member.avatar) ? member.avatar : undefined} sx={{ width: 32, height: 32, fontSize: '1rem', bgcolor: 'primary.light' }}>
                  {isImageAvatar(member.avatar) ? undefined : member.avatar}
                </Avatar>
              </ListItemAvatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{member.name}</Typography>
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
                            sx={{ height: 20, cursor: 'help', '& .MuiChip-label': { px: 0.8 } }}
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
                            sx={{ height: 20, cursor: 'help', '& .MuiChip-label': { px: 0.8 } }}
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
                              sx={{ height: 20, cursor: 'help', '& .MuiChip-label': { px: 0.8 } }}
                            />
                          </Tooltip>
                        ))}
                      </Box>
                    ) : null}
                  </Stack>
                </Box>
              </Box>
            </ListItem>
          );
        })}
      </List>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        {onSpeakAs && <MenuItem onClick={() => { closeMenu(); if (menuCharId) onSpeakAs(menuCharId); }}>{t('controls.speakAs')}</MenuItem>}
        {onRemove && <MenuItem onClick={() => { closeMenu(); if (menuCharId) onRemove(menuCharId); }} sx={{ color: 'error.main' }}>{t('controls.removeMember')}</MenuItem>}
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
