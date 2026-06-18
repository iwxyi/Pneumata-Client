import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import AppSnackbar from './AppSnackbar';

export default function DevUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const source = new EventSource('/__pneumata_dev_updates');
    source.addEventListener('update', () => {
      setNeedRefresh(true);
    });

    return () => {
      source.close();
    };
  }, []);

  if (!import.meta.env.DEV) return null;

  return (
    <AppSnackbar
      open={needRefresh}
      message="开发代码已更新，刷新后生效"
      severity="info"
      autoHideDuration={null}
      onClose={() => setNeedRefresh(false)}
      offset="none"
      action={
        <Button color="inherit" size="small" onClick={() => window.location.reload()}>
          刷新
        </Button>
      }
    />
  );
}
