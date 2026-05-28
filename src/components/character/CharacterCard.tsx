import { Card, CardContent, CardActionArea, Box, Typography, Avatar, Chip, IconButton, Menu, MenuItem } from '@mui/material';
import { isImageAvatar } from '../../utils/avatar';
import MoreIcon from '@mui/icons-material/MoreVert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useRef, useState } from 'react';
import type { AICharacter } from '../../types/character';
import { useTranslation } from 'react-i18next';
import { formatExpertiseList } from '../../utils/expertise';
import { motion, transition } from '../../styles/motion';
import { buildInteractiveSurfaceSx, buildSelectionRailSx } from '../../styles/interaction';

interface CharacterCardProps {
  character: AICharacter;
  onEdit?: () => void;
  onDelete?: () => void;
  onStartDirectChat?: () => void;
  onClick?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  selectable?: boolean;
  selectionMode?: boolean;
}

export default function CharacterCard({ character, onEdit, onDelete, onStartDirectChat, onClick, onLongPress, selected, selectable, selectionMode }: CharacterCardProps) {
  const pressTimerRef = useRef<number | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { t, i18n } = useTranslation();

  const topTraits = Object.entries(character.personality)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => t(`character.${key}`));

  const longPressTriggeredRef = useRef(false);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    if (!onLongPress) return;
    longPressTriggeredRef.current = false;
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      onLongPress();
      clearPressTimer();
    }, 450);
  };

  const handleClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    onClick?.();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onLongPress) return;
    e.preventDefault();
    longPressTriggeredRef.current = true;
    onLongPress();
  };

  const handlePointerEnd = () => {
    clearPressTimer();
  };

  const handlePointerLeave = () => {
    clearPressTimer();
    longPressTriggeredRef.current = false;
  };

  const handlePointerCancel = () => {
    clearPressTimer();
    longPressTriggeredRef.current = false;
  };

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    longPressTriggeredRef.current = false;
    setAnchorEl(e.currentTarget);
  };

  const handleMenuClose = () => {
    longPressTriggeredRef.current = false;
    setAnchorEl(null);
  };

  const handleMenuAction = (action?: () => void) => {
    longPressTriggeredRef.current = false;
    setAnchorEl(null);
    action?.();
  };

  return (
    <Card
      variant="outlined"
      sx={{
        ...buildInteractiveSurfaceSx({ selected: Boolean(selected) }),
        height: '100%',
        overflow: 'hidden',
        '&::before': {
          ...buildSelectionRailSx(Boolean(selected)),
        },
      }}
    >
      <Box sx={{ position: 'relative', height: '100%' }}>
        {selectionMode && selectable ? (
          <Box sx={{ position: 'absolute', top: 10, left: 10, zIndex: 1, color: selected ? 'primary.main' : 'action.disabled' }}>
            <CheckCircleIcon fontSize="small" />
          </Box>
        ) : null}
        {(onEdit || onDelete) && (
          <IconButton
            size="small"
            onClick={handleMenuOpen}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 1,
              borderRadius: 1,
              bgcolor: 'transparent',
              transition: transition(['background-color', 'transform'], motion.durations.fast, motion.softOut),
              '&:hover': {
                bgcolor: 'action.hover',
                transform: 'scale(1.04)',
              },
              '&:active': {
                transform: 'scale(0.94)',
              },
            }}
          >
            <MoreIcon fontSize="small" />
          </IconButton>
        )}
        <CardActionArea
          onClick={handleClick}
          onPointerDown={startLongPress}
          onPointerUp={handlePointerEnd}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerCancel}
          onContextMenu={handleContextMenu}
          disabled={!onClick && !selectable}
          sx={{
            height: '100%',
          }}
        >
          <CardContent sx={{ p: 2, pr: (onEdit || onDelete) ? 6 : 2, height: '100%', '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Avatar src={isImageAvatar(character.avatar) ? character.avatar : undefined} sx={{ width: 48, height: 48, fontSize: '1.5rem', bgcolor: 'primary.light' }}>
                {isImageAvatar(character.avatar) ? undefined : character.avatar}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {character.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                  {topTraits.map((trait) => (
                    <Chip key={trait} label={trait} size="small" variant="outlined" />
                  ))}
                  {character.group ? (
                    <Chip label={character.group} size="small" color="primary" variant="outlined" />
                  ) : null}
                  {character.isPreset && (
                    <Chip label="Preset" size="small" color="secondary" variant="filled" />
                  )}
                </Box>
                {character.expertise.length > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }} noWrap>
                    {formatExpertiseList(character.expertise, i18n.language).join(' / ')}
                  </Typography>
                )}
              </Box>
            </Box>
          </CardContent>
        </CardActionArea>
      </Box>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        {onStartDirectChat && !selectionMode ? (
          <MenuItem onClick={() => handleMenuAction(onStartDirectChat)}>
            {i18n.language.startsWith('zh') ? '发起单聊' : 'Start direct chat'}
          </MenuItem>
        ) : null}
        {onEdit && (
          <MenuItem
            onClick={() => handleMenuAction(onEdit)}
          >
            {t('common.edit')}
          </MenuItem>
        )}
        {onDelete && (
          <MenuItem
            onClick={() => handleMenuAction(onDelete)}
            sx={{ color: 'error.main' }}
          >
            {t('common.delete')}
          </MenuItem>
        )}
      </Menu>
    </Card>
  );
}
