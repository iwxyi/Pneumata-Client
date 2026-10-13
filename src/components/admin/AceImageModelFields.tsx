import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from '@mui/material';
import type { AceImageModelForm } from './aceImageModelForm';

export default function AceImageModelFields({ models, onChange, disabled }: { models: AceImageModelForm[]; onChange: (models: AceImageModelForm[]) => void; disabled: boolean }) {
  const update = (index: number, patch: Partial<AceImageModelForm>) => onChange(models.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  return (
      <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 640 }}>
          <TableHead><TableRow>
            <TableCell>模型</TableCell><TableCell>1K（积分/张）</TableCell><TableCell>2K（积分/张）</TableCell><TableCell>4K（积分/张）</TableCell>
          </TableRow></TableHead>
          <TableBody>{models.map((model, index) => {
            return <TableRow key={model.code}>
              <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{model.displayName}<br /><span style={{ fontWeight: 400, fontSize: 12 }}>{model.code}</span></TableCell>
              {['1K', '2K', '4K'].map((size) => <TableCell key={size}><TextField variant="standard" type="number" aria-label={`${model.displayName} ${size} 积分价格`} value={model.prices[size]} disabled={disabled} placeholder={size === '1K' ? undefined : '同 1K'} slotProps={{ htmlInput: { min: 0, step: 'any' } }} onChange={(event) => update(index, { prices: { ...model.prices, [size]: event.target.value } })} /></TableCell>)}
            </TableRow>;
          })}</TableBody>
        </Table>
      </TableContainer>
  );
}
