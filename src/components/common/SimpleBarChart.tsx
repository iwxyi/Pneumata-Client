import { Box, Typography } from '@mui/material';

interface SimpleBarChartItem {
  label: string;
  value: number;
  color?: string;
}

interface SimpleBarChartProps {
  title?: string;
  items: SimpleBarChartItem[];
  max?: number;
}

export default function SimpleBarChart({ title, items, max = 100 }: SimpleBarChartProps) {
  return (
    <Box>
      {title ? <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography> : null}
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        {items.map((item) => (
          <Box key={item.label}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
              <Typography variant="caption" color="text.secondary">{item.label}</Typography>
              <Typography variant="caption" color="text.secondary">{item.value}</Typography>
            </Box>
            <Box sx={{ height: 8, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
              <Box sx={{ width: `${Math.max(0, Math.min(100, (item.value / max) * 100))}%`, height: '100%', bgcolor: item.color || 'primary.main' }} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
