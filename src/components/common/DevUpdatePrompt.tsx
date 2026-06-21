import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import AppSnackbar from './AppSnackbar';

const DEV_UPDATE_POLL_INTERVAL_MS = 2500;

async function fetchDevUpdateVersion(signal: AbortSignal) {
  const response = await fetch('/__pneumata_dev_updates', {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json() as { version?: unknown };
  return typeof payload.version === 'number' ? payload.version : null;
}

export default function DevUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let disposed = false;
    let baselineVersion: number | null = null;
    let pollTimer: number | null = null;
    let controller: AbortController | null = null;

    const schedulePoll = () => {
      if (disposed) return;
      pollTimer = window.setTimeout(() => void poll(), DEV_UPDATE_POLL_INTERVAL_MS);
    };

    const poll = async () => {
      controller = new AbortController();
      const activeController = controller;
      try {
        const version = await fetchDevUpdateVersion(activeController.signal);
        if (disposed || version === null) return;
        if (baselineVersion === null) {
          baselineVersion = version;
        } else if (version !== baselineVersion) {
          setNeedRefresh(true);
          baselineVersion = version;
        }
      } catch (error) {
        if (!activeController.signal.aborted && import.meta.env.DEV) {
          // Dev server restarts are expected while coding; retry quietly.
        }
      } finally {
        if (controller === activeController) controller = null;
        schedulePoll();
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      controller?.abort();
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
