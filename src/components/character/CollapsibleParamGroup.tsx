import { Box, Collapse, IconButton, Typography } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface CollapsibleParamGroupProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export default function CollapsibleParamGroup({ title, open, onToggle, children }: CollapsibleParamGroupProps) {
  return (
    <Box>
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          mb: open ? 0.25 : 0,
          py: 0,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <IconButton size="small">
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ pl: { xs: 1, md: 1.75 }, ml: { xs: 0.125, md: 0.25 }, borderLeft: 1, borderColor: 'divider' }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}
