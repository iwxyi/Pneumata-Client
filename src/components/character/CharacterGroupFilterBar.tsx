import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Box, Chip, IconButton, Tooltip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
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
  collapsible?: boolean;
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
  collapsible = false,
  sx,
  onGroupPointerDown,
  onGroupPointerUp,
  onGroupPointerLeave,
  onGroupPointerCancel,
}: CharacterGroupFilterBarProps) {
  const chipRowRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  useLayoutEffect(() => {
    if (!collapsible) return undefined;
    const chipRow = chipRowRef.current;
    if (!chipRow) return undefined;

    const updateOverflow = () => {
      if (!expanded) {
        setHasOverflow(chipRow.scrollWidth > chipRow.clientWidth + 1);
      }
    };
    updateOverflow();

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOverflow);
    observer?.observe(chipRow);
    window.addEventListener('resize', updateOverflow);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [allCount, collapsible, expanded, options]);

  const showToggle = collapsible && (hasOverflow || expanded);

  return (
    <Box
      sx={[
        {
          maxWidth: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          flexWrap: 'nowrap',
          gap: 0.75,
          pt: 0.25,
          pb: 0.35,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        ref={chipRowRef}
        sx={{
          minWidth: 0,
          flex: '1 1 auto',
          width: expanded ? '100%' : 'auto',
          display: 'flex',
          flexWrap: collapsible && !expanded ? 'nowrap' : 'wrap',
          gap: 0.75,
          overflowX: collapsible && !expanded ? 'auto' : 'visible',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x pan-y',
        }}
      >
        <Chip
          label={formatGroupLabel(allLabel, allCount)}
          variant="outlined"
          onClick={() => onSelect(allValue)}
          sx={{ ...buildCharacterGroupChipSx(selectedValue === allValue), flexShrink: 0 }}
        />
        {options.map((group) => (
          <Chip
            key={group.value}
            label={formatGroupLabel(group.label, group.count)}
            variant="outlined"
            sx={{ ...buildCharacterGroupChipSx(selectedValue === group.value), flexShrink: 0 }}
            onClick={() => onSelect(group.value)}
            onPointerDown={(event) => onGroupPointerDown?.(group.value, event)}
            onPointerUp={onGroupPointerUp}
            onPointerLeave={onGroupPointerLeave}
            onPointerCancel={onGroupPointerCancel}
          />
        ))}
        {showToggle && expanded ? (
          <Tooltip title="收起分组">
            <IconButton
              size="small"
              aria-label="收起分组"
              aria-expanded
              onClick={() => setExpanded(false)}
              sx={{
                width: 30,
                height: 30,
                flex: '0 0 auto',
                border: '1px solid',
                borderColor: 'divider',
                color: 'text.secondary',
                bgcolor: 'background.paper',
                transition: transition(['color', 'border-color', 'background-color', 'transform'], motion.durations.fast, motion.softOut),
                '&:hover': { color: 'text.primary', borderColor: 'primary.main', bgcolor: 'action.hover' },
                '&:active': { transform: 'scale(0.94)' },
              }}
            >
              <ExpandLessIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
      {showToggle && !expanded ? (
        <Tooltip title={expanded ? '收起分组' : '展开全部分组'}>
          <IconButton
            size="small"
            aria-label="展开全部分组"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            sx={{
              width: 30,
              height: 30,
              flex: expanded ? '0 0 auto' : '0 0 30px',
              marginLeft: expanded ? 'auto' : 0,
              border: '1px solid',
              borderColor: 'divider',
              color: 'text.secondary',
              bgcolor: 'background.paper',
              transition: transition(['color', 'border-color', 'background-color', 'transform'], motion.durations.fast, motion.softOut),
              '&:hover': { color: 'text.primary', borderColor: 'primary.main', bgcolor: 'action.hover' },
              '&:active': { transform: 'scale(0.94)' },
            }}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}
