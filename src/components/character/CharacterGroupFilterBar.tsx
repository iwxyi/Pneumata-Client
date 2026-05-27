import type { PointerEvent } from 'react';
import { Box, Chip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { motion, transition } from '../../styles/motion';

export interface CharacterGroupFilterOption {
  value: string;
  label: string;
  count?: number;
}

interface CharacterGroupFilterBarProps {
  allLabel: string;
  allValue?: string | null;
  allCount?: number;
  options: CharacterGroupFilterOption[];
  selectedValue: string | null;
  onSelect: (value: string | null) => void;
  sx?: SxProps<Theme>;
  onGroupPointerDown?: (group: string, event: PointerEvent<HTMLDivElement>) => void;
  onGroupPointerUp?: (event: PointerEvent<HTMLDivElement>) => void;
  onGroupPointerLeave?: (event: PointerEvent<HTMLDivElement>) => void;
  onGroupPointerCancel?: (event: PointerEvent<HTMLDivElement>) => void;
}

function buildCharacterGroupChipSx(active: boolean) {
  return {
    height: 30,
    borderRadius: 999,
    fontWeight: active ? 720 : 560,
    bgcolor: active ? 'primary.main' : 'transparent',
    borderColor: active ? 'primary.main' : 'divider',
    color: active ? 'primary.contrastText' : 'text.secondary',
    transition: transition(['background-color', 'border-color', 'color', 'transform'], motion.durations.fast, active ? motion.gentleSpring : motion.softOut),
    '&.MuiChip-root': {
      bgcolor: active ? 'primary.main' : 'transparent',
      borderColor: active ? 'primary.main' : 'divider',
      color: active ? 'primary.contrastText' : 'text.secondary',
    },
    '&.Mui-focusVisible, &:focus-visible, &:active': {
      bgcolor: active ? 'primary.main' : 'action.hover',
      borderColor: active ? 'primary.main' : 'primary.main',
      color: active ? 'primary.contrastText' : 'text.primary',
    },
    '&:hover, &.MuiChip-clickable:hover': {
      bgcolor: active ? 'primary.dark' : 'action.hover',
      borderColor: active ? 'primary.dark' : 'primary.main',
      color: active ? 'primary.contrastText' : 'text.primary',
      transform: 'translateY(-1px)',
    },
    '&:active': {
      transform: 'scale(0.97)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
    },
  };
}

function formatGroupLabel(label: string, count?: number) {
  return typeof count === 'number' ? `${label} (${count})` : label;
}

export default function CharacterGroupFilterBar({
  allLabel,
  allValue = null,
  allCount,
  options,
  selectedValue,
  onSelect,
  sx,
  onGroupPointerDown,
  onGroupPointerUp,
  onGroupPointerLeave,
  onGroupPointerCancel,
}: CharacterGroupFilterBarProps) {
  return (
    <Box
      sx={[
        {
          maxWidth: '100%',
          display: 'flex',
          gap: 0.75,
          overflowX: 'auto',
          pt: 0.25,
          pb: 0.35,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Chip
        label={formatGroupLabel(allLabel, allCount)}
        variant="outlined"
        onClick={() => onSelect(allValue)}
        sx={buildCharacterGroupChipSx(selectedValue === allValue)}
      />
      {options.map((group) => (
        <Chip
          key={group.value}
          label={formatGroupLabel(group.label, group.count)}
          variant="outlined"
          sx={buildCharacterGroupChipSx(selectedValue === group.value)}
          onClick={() => onSelect(group.value)}
          onPointerDown={(event) => onGroupPointerDown?.(group.value, event)}
          onPointerUp={onGroupPointerUp}
          onPointerLeave={onGroupPointerLeave}
          onPointerCancel={onGroupPointerCancel}
        />
      ))}
    </Box>
  );
}
