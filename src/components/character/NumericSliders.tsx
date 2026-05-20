import { Box, Slider, Tooltip, Typography } from '@mui/material';

interface Item<T extends string> {
  key: T;
  label: string;
  description?: string;
}

interface NumericSlidersProps<T extends string> {
  values: Record<T, number>;
  items: Item<T>[];
  onChange: (next: Record<T, number>) => void;
  disabled?: boolean;
  drift?: Partial<Record<T, number>>;
}

export default function NumericSliders<T extends string>({ values, items, onChange, disabled, drift }: NumericSlidersProps<T>) {
  return (
    <Box sx={{ display: 'grid', gap: 0.375, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, alignItems: 'start', columnGap: 1.5 }}>
      {items.map((item) => {
        const driftValue = drift?.[item.key] || 0;
        const snappedValue = Math.round(values[item.key] / 10) * 10;
        return (
          <Box key={item.key} sx={{ py: 0.125 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.label}</Typography>
              <Tooltip title={driftValue ? (item.description || `基础值 ${snappedValue}，长期运行后偏移 ${driftValue > 0 ? '+' : ''}${driftValue}`) : ''} disableHoverListener={!driftValue}>
                <Typography variant="caption" color="text.secondary">
                  {snappedValue}{driftValue ? `(${driftValue > 0 ? '+' : ''}${driftValue})` : ''}
                </Typography>
              </Tooltip>
            </Box>
            <Slider
              value={values[item.key]}
              onChange={(_, value) => onChange({ ...values, [item.key]: value as number })}
              min={0}
              max={100}
              step={10}
              marks
              disabled={disabled}
              size="small"
              sx={{ my: -0.5, '& .MuiSlider-mark': { width: 3, height: 3 } }}
            />
          </Box>
        );
      })}
    </Box>
  );
}
