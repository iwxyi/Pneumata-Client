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
    <Grid container spacing={1.5}>
      {PARAM_KEYS.map((key) => (
        <Grid key={key} size={{ xs: 12, sm: 6, lg: 4 }}>
          <Box sx={{ px: 0.5, py: 0.25 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.25 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t(`character.${key}`)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {values[key]}
              </Typography>
            </Box>
            <Slider
              value={values[key]}
              onChange={(_, v) => handleChange(key, v as number)}
              min={0}
              max={100}
              disabled={disabled}
              size="small"
              sx={{
                my: 0,
                '& .MuiSlider-track': {
                  background: `linear-gradient(90deg,
                    ${values[key] < 30 ? '#2196f3' : values[key] < 70 ? '#9c27b0' : '#f44336'} 0%,
                    ${values[key] < 30 ? '#2196f3' : values[key] < 70 ? '#9c27b0' : '#f44336'} 100%)`,
                },
              }}
            />
          </Box>
        </Grid>
      ))}
    </Grid>
  );
}
