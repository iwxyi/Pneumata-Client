import { Box, Drawer, SwipeableDrawer, IconButton, Typography, Divider } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';

interface RightPanelProps {
  children: React.ReactNode;
  title?: string;
}

const PANEL_WIDTH = 320;

export default function RightPanel({ children, title }: RightPanelProps) {
  const { isMobile, isDesktop } = useResponsive();
  const { rightPanelOpen, setRightPanelOpen } = useUIStore();

  // Desktop: permanent panel
  if (isDesktop) {
    return rightPanelOpen ? (
      <Box
        sx={{
          width: PANEL_WIDTH,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {title && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {title}
              </Typography>
              <IconButton size="small" onClick={() => setRightPanelOpen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Divider />
          </>
        )}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>{children}</Box>
      </Box>
    ) : null;
  }

  // Mobile: bottom sheet (SwipeableDrawer)
  if (isMobile) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={rightPanelOpen}
        onClose={() => setRightPanelOpen(false)}
        onOpen={() => setRightPanelOpen(true)}
        swipeAreaWidth={20}
        sx={{
          '& .MuiDrawer-paper': {
            maxHeight: '80vh',
            borderRadius: '16px 16px 0 0',
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ width: 40, height: 4, bgcolor: 'grey.300', borderRadius: 2, mx: 'auto', mb: 2 }} />
          {title && (
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              {title}
            </Typography>
          )}
          {children}
        </Box>
      </SwipeableDrawer>
    );
  }

  // Tablet: right drawer
  return (
    <Drawer
      anchor="right"
      variant="temporary"
      open={rightPanelOpen}
      onClose={() => setRightPanelOpen(false)}
      sx={{
        '& .MuiDrawer-paper': {
          width: PANEL_WIDTH,
          borderRadius: 0,
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        {title && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {title}
              </Typography>
              <IconButton size="small" onClick={() => setRightPanelOpen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
          </>
        )}
        {children}
      </Box>
    </Drawer>
  );
}
