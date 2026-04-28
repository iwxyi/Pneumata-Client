import { Box, Typography, Avatar, IconButton, Menu, MenuItem, List, ListItem, ListItemAvatar, ListItemText, Chip, Stack } from '@mui/material';
import { isImageAvatar } from '../../utils/avatar';
import { MoreVert as MoreIcon } from '@mui/icons-material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';

interface MemberListProps {
  members: AICharacter[];
  thinkingId: string | null;
  chat?: GroupChat;
  onRemove?: (id: string) => void;
  onSpeakAs?: (id: string) => void;
  onStartPrivateChat?: (id: string) => void;
}

function buildMemberStatus(member: AICharacter) {
  const chips = [] as string[];
  if (member.relationships.some((relation) => relation.affinity >= 60 || relation.respect >= 60)) chips.push('高好感');
  if (member.relationships.some((relation) => relation.hostility >= 35 || relation.contempt >= 35)) chips.push('有冲突');
  return chips;
}

function buildMemberSubtitle(member: AICharacter, thinkingId: string | null, thinkingLabel: string) {
  if (thinkingId === member.id) return thinkingLabel;
  if (member.group?.trim()) return member.group;
  return member.expertise.slice(0, 2).join(', ');
}

export default function MemberList({ members, thinkingId, chat, onRemove, onSpeakAs, onStartPrivateChat }: MemberListProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuCharId, setMenuCharId] = useState<string | null>(null);

  void chat;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {t('controls.memberList')} ({members.length})
      </Typography>
      <List dense disablePadding>
        {members.map((member) => {
          const memberStatus = buildMemberStatus(member);
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
                mb: 0.5,
                bgcolor: thinkingId === member.id ? 'action.selected' : 'transparent',
              }}
            >
              <ListItemAvatar>
                <Avatar src={isImageAvatar(member.avatar) ? member.avatar : undefined} sx={{ width: 32, height: 32, fontSize: '1rem', bgcolor: 'primary.light' }}>
                  {isImageAvatar(member.avatar) ? undefined : member.avatar}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={<Typography variant="body2" sx={{ fontWeight: 500 }}>{member.name}</Typography>}
                secondary={
                  <Stack spacing={0.5} sx={{ mt: 0.25 }}>
                    <Typography variant="caption" color={thinkingId === member.id ? 'primary.main' : 'text.secondary'}>
                      {buildMemberSubtitle(member, thinkingId, t('controls.thinking'))}
                    </Typography>
                    {memberStatus.length ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {memberStatus.map((label) => <Chip key={`${member.id}-${label}`} size="small" label={label} variant="outlined" />)}
                      </Box>
                    ) : null}
                  </Stack>
                }
              />
            </ListItem>
          );
        })}
      </List>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        {onSpeakAs && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              if (menuCharId) onSpeakAs(menuCharId);
            }}
          >
            {t('controls.speakAs')}
          </MenuItem>
        )}
        {onStartPrivateChat && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              if (menuCharId) onStartPrivateChat(menuCharId);
            }}
          >
            发起AI私聊
          </MenuItem>
        )}
        {onRemove && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              if (menuCharId) onRemove(menuCharId);
            }}
            sx={{ color: 'error.main' }}
          >
            {t('controls.removeMember')}
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
