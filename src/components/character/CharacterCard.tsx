import { Card, CardContent, CardActionArea, Box, Typography, Avatar, Chip, IconButton, Menu, MenuItem } from '@mui/material';
import { MoreVert as MoreIcon } from '@mui/icons-material';
import { useState } from 'react';
import type { AICharacter } from '../../types/character';
import { useTranslation } from 'react-i18next';
import { formatExpertiseList } from '../../utils/expertise';

interface CharacterCardProps {
  character: AICharacter;
  onEdit?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  selected?: boolean;
  selectable?: boolean;
}

export default function CharacterCard({ character, onEdit, onDelete, onClick, selected, selectable }: CharacterCardProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { t, i18n } = useTranslation();

  const topTraits = Object.entries(character.personality)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => t(`character.${key}`));

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderRadius: 6,
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
        bgcolor: 'background.paper',
        transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: 2,
          borderColor: 'primary.main',
        },
      }}
    >
      <CardActionArea onClick={onClick} disabled={!onClick && !selectable}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Avatar sx={{ width: 48, height: 48, fontSize: '1.5rem', bgcolor: 'primary.light' }}>
              {character.avatar}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {character.name}
                </Typography>
                {!character.isPreset && (onEdit || onDelete) && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAnchorEl(e.currentTarget);
                    }}
                  >
                    <MoreIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                {topTraits.map((trait) => (
                  <Chip key={trait} label={trait} size="small" variant="outlined" />
                ))}
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

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {onEdit && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              onEdit();
            }}
          >
            {t('common.edit')}
          </MenuItem>
        )}
        {onDelete && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              onDelete();
            }}
            sx={{ color: 'error.main' }}
          >
            {t('common.delete')}
          </MenuItem>
        )}
      </Menu>
    </Card>
  );
}
