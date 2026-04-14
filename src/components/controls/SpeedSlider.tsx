import { Box, Slider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../../constants/defaults';

interface SpeedSliderProps {
  value: number;
  onChange: (speed: number) => void;
}

export default function SpeedSlider({ value, onChange }: SpeedSliderProps) {
  const { t } = useTranslation();

  return (
    <Box sx={{ px: 1 }}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t('controls.speedControl')}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {t('chat.speedSlow')}
        </Typography>
        <Slider
          value={value}
          onChange={(_, v) => onChange(v as number)}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          size="small"
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v}x`}
          sx={{ flex: 1 }}
        />
        <Typography variant="caption" color="text.secondary">
          {t('chat.speedFast')}
        </Typography>
      </Box>
    </Box>
  );
}
