import { Fab, Tooltip } from '@mui/material';
import PlayIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { useTranslation } from 'react-i18next';

interface PlayPauseButtonProps {
  isRunning: boolean;
  isPaused: boolean;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
}

export default function PlayPauseButton({ isRunning, isPaused, onPlay, onPause, onResume }: PlayPauseButtonProps) {
  const { t } = useTranslation();

  const handleClick = () => {
    if (!isRunning) {
      onPlay();
    } else if (isPaused) {
      onResume();
    } else {
      onPause();
    }
  };

  const label = !isRunning
    ? t('controls.play')
    : isPaused
      ? t('controls.resume')
      : t('controls.pause');

  const isPlaying = isRunning && !isPaused;

  return (
    <Tooltip title={label}>
      <Fab
        color="primary"
        size="medium"
        onClick={handleClick}
        sx={{
          position: 'fixed',
          bottom: { xs: 72, sm: 24 },
          right: 24,
          zIndex: 1100,
        }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </Fab>
    </Tooltip>
  );
}
