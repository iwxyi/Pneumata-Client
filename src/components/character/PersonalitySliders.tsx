import { Box, Slider, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';

import { useTranslation } from 'react-i18next';
import type { PersonalityParams } from '../../types/character';

interface PersonalitySlidersProps {
  values: PersonalityParams;
  onChange: (params: PersonalityParams) => void;
  disabled?: boolean;
}

const PARAM_KEYS: (keyof PersonalityParams)[] = [
  'openness',
  'extroversion',
  'agreeableness',
  'neuroticism',
  'humor',
  'creativity',
  'assertiveness',
  'empathy',
];

export default function PersonalitySliders({ values, onChange, disabled }: PersonalitySlidersProps) {
  const { t } = useTranslation();

  const handleChange = (key: keyof PersonalityParams, value: number) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <Grid container spacing={0.25}>
      {PARAM_KEYS.map((key) => (
        <Grid key={key} size={{ xs: 12, md: 6 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0, py: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 68, lineHeight: 1, fontSize: 13 }}>
              {t(`character.${key}`)}
            </Typography>
            <Slider
              value={values[key]}
              onChange={(_, v) => handleChange(key, v as number)}
              min={0}
              max={100}
              step={10}
              marks
              disabled={disabled}
              size="small"
              sx={{
                flex: 1,
                my: -0.5,
                '& .MuiSlider-track': {
                  background: `linear-gradient(90deg,
                    ${values[key] < 30 ? '#2196f3' : values[key] < 70 ? '#9c27b0' : '#f44336'} 0%,
                    ${values[key] < 30 ? '#2196f3' : values[key] < 70 ? '#9c27b0' : '#f44336'} 100%)`,
                },
                '& .MuiSlider-mark': {
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 18, textAlign: 'right', lineHeight: 1, fontSize: 11 }}>
              {Math.round(values[key] / 10) * 10}
            </Typography>
          </Box>
        </Grid>
      ))}
    </Grid>
  );
}
