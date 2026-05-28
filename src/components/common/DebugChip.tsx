import { Chip, type ChipProps } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { compactPillChipSx } from '../../styles/interaction';

export default function DebugChip(props: Omit<ChipProps, 'label' | 'color' | 'variant' | 'size'>) {
  const { i18n } = useTranslation();
  return (
    <Chip
      size="small"
      label={i18n.language.startsWith('zh') ? '调试' : 'Debug'}
      color="warning"
      variant="outlined"
      sx={compactPillChipSx}
      {...props}
    />
  );
}
