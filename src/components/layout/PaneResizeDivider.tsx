import { Box } from '@mui/material';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion, transition } from '../../styles/motion';

interface PaneResizeDividerProps {
  resizing: boolean;
  ariaLabel: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
}

export const PANE_RESIZE_DIVIDER_HIT_WIDTH = 12;
export const PANE_RESIZE_DIVIDER_LAYOUT_WIDTH = 1;

export default function PaneResizeDivider({ resizing, ariaLabel, onPointerDown, onDoubleClick }: PaneResizeDividerProps) {
  return (
    <Box
      onDoubleClick={onDoubleClick}
      aria-label={ariaLabel}
      sx={{
        width: PANE_RESIZE_DIVIDER_LAYOUT_WIDTH,
        flex: `0 0 ${PANE_RESIZE_DIVIDER_LAYOUT_WIDTH}px`,
        alignSelf: 'stretch',
        cursor: 'col-resize',
        zIndex: 2,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        position: 'relative',
        touchAction: 'none',
        bgcolor: 'transparent',
      }}
    >
      <Box
        onPointerDown={onPointerDown}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          height: 'auto',
          width: PANE_RESIZE_DIVIDER_HIT_WIDTH,
          transform: 'translateX(-50%)',
          bgcolor: 'transparent !important',
          backgroundColor: 'transparent !important',
          cursor: 'col-resize',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          outline: 'none',
          '&:active, &:focus': {
            bgcolor: 'transparent !important',
            backgroundColor: 'transparent !important',
            outline: 'none',
          },
          '&:hover + .pane-resize-divider-line': {
            bgcolor: 'primary.main',
            opacity: 1,
          },
        }}
      />
      <Box
        className="pane-resize-divider-line"
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          height: 'auto',
          width: 1,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          bgcolor: (theme) => resizing
            ? theme.palette.primary.main
            : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.13)' : 'rgba(226,232,240,0.16)',
          opacity: resizing ? 1 : 0.72,
          transition: transition(['background-color', 'opacity'], 220, motion.softOut),
        }}
      />
    </Box>
  );
}
