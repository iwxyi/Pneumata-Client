import { Box, Button, Collapse, Typography } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';

interface CollapsibleParamGroupProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  contentSx?: Record<string, unknown>;
}

export default function CollapsibleParamGroup({ title, open, onToggle, children, contentSx }: CollapsibleParamGroupProps) {
  const { i18n } = useTranslation();
  const toggleLabel = open
    ? (i18n.language.startsWith('zh') ? '收起' : 'Collapse')
    : (i18n.language.startsWith('zh') ? '展开' : 'Expand');
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: open ? 0.25 : 0, py: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Button size="small" onClick={onToggle} endIcon={open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}>
          {toggleLabel}
        </Button>
      </Box>
      <Collapse in={open}>
        <Box sx={{ pl: { xs: 1, md: 1.75 }, ml: { xs: 0.125, md: 0.25 }, borderLeft: 1, borderColor: 'divider', ...(contentSx || {}) }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}
