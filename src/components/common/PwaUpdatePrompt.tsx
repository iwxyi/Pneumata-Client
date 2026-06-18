import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import { registerSW } from 'virtual:pwa-register';
import AppSnackbar from './AppSnackbar';

export default function PwaUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSWRef = useRef<ReturnType<typeof registerSW> | null>(null);

  useEffect(() => {
    updateSWRef.current = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
    });
  }, []);

  const handleRefresh = () => {
    void updateSWRef.current?.(true);
  };

  return (
    <AppSnackbar
      open={needRefresh}
      message="页面已更新，刷新后生效"
      severity="info"
      autoHideDuration={null}
      onClose={() => setNeedRefresh(false)}
      offset="none"
      action={
        <Button color="inherit" size="small" onClick={handleRefresh}>
          刷新
        </Button>
      }
    />
  );
}
