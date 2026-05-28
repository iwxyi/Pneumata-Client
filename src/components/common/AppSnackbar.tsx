import type { ReactNode, SyntheticEvent } from 'react';
import Alert from '@mui/material/Alert';
import type { AlertColor, AlertProps } from '@mui/material/Alert';
import Portal from '@mui/material/Portal';
import Snackbar from '@mui/material/Snackbar';

type SnackbarOffset = 'navigation' | 'composer' | 'none';

interface AppSnackbarProps {
  open: boolean;
  message: ReactNode;
  severity?: AlertColor;
  autoHideDuration?: number;
  onClose: () => void;
  offset?: SnackbarOffset;
  alertVariant?: AlertProps['variant'];
}

const bottomOffsets: Record<SnackbarOffset, { xs: string; sm: number }> = {
  none: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', sm: 28 },
  navigation: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 92px)', sm: 28 },
  composer: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 116px)', sm: 104 },
};

export default function AppSnackbar({
  open,
  message,
  severity = 'success',
  autoHideDuration = 3000,
  onClose,
  offset = 'navigation',
  alertVariant,
}: AppSnackbarProps) {
  const handleSnackbarClose = (_event: SyntheticEvent | Event, _reason?: string) => {
    onClose();
  };

  const handleAlertClose = (_event: SyntheticEvent) => {
    onClose();
  };

  return (
    <Portal>
      <Snackbar
        open={open}
        autoHideDuration={autoHideDuration}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{
          zIndex: (theme) => theme.zIndex.snackbar + 1000,
          pointerEvents: 'none',
          '&.MuiSnackbar-root': {
            bottom: bottomOffsets[offset],
            left: { xs: 16, sm: '50%' },
            right: { xs: 16, sm: 'auto' },
            transform: { xs: 'none', sm: 'translateX(-50%)' },
            maxWidth: { xs: 'calc(100vw - 32px)', sm: 'min(560px, calc(100vw - 48px))' },
          },
          '& .MuiAlert-root': {
            pointerEvents: 'auto',
            width: '100%',
            borderRadius: 2,
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 18px 42px rgba(15,23,42,0.16)'
              : '0 18px 42px rgba(0,0,0,0.42)',
          },
        }}
      >
        <Alert severity={severity} variant={alertVariant} onClose={handleAlertClose}>
          {message}
        </Alert>
      </Snackbar>
    </Portal>
  );
}
