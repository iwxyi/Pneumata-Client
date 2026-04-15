import { Box, Typography, Avatar, IconButton, Menu, MenuItem, List, ListItem, ListItemAvatar, ListItemText, Divider, Slider } from '@mui/material';
import { MoreVert as MoreIcon } from '@mui/icons-material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AICharacter } from '../../types/character';

interface MemberListProps {
  members: AICharacter[];
  thinkingId: string | null;
  onRemove?: (id: string) => void;
  onSpeakAs?: (id: string) => void;
}

export default function MemberList({ members, thinkingId, onRemove, onSpeakAs }: MemberListProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuCharId, setMenuCharId] = useState<string | null>(null);

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {t('controls.memberList')} ({members.length})
      </Typography>
      <List dense disablePadding>
        {members.map((member) => (
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
              <Avatar sx={{ width: 32, height: 32, fontSize: '1rem', bgcolor: 'primary.light' }}>
                {member.avatar}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={<Typography variant="body2" sx={{ fontWeight: 500 }}>{member.name}</Typography>}
              secondary={
                <Typography variant="caption" color={thinkingId === member.id ? 'primary.main' : 'text.secondary'}>
                  {thinkingId === member.id ? t('controls.thinking') : member.expertise.slice(0, 2).join(', ')}
                </Typography>
              }
            />
          </ListItem>
        ))}
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
