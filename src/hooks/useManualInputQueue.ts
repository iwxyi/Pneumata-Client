import { useCallback, useRef } from 'react';

export interface ManualInputQueueController {
  enqueueManualInput: (task: () => Promise<void>) => Promise<void>;
  isManualInputPending: () => boolean;
}

export function useManualInputQueue(params: {
  isRunningRef: React.MutableRefObject<boolean>;
  isPausedRef: React.MutableRefObject<boolean>;
  hasPendingTurnWork: () => boolean;
  pause: () => void;
  waitTimeoutMs?: number;
}): ManualInputQueueController {
  const { isRunningRef, isPausedRef, hasPendingTurnWork, pause, waitTimeoutMs = 45_000 } = params;
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(false);

  const waitForCurrentTurnToSettle = useCallback(async () => {
    const startedAt = Date.now();
    while (hasPendingTurnWork() && Date.now() - startedAt < waitTimeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    if (hasPendingTurnWork()) {
      throw new Error('当前发言一直没有结束，请稍后重试');
    }
  }, [hasPendingTurnWork, waitTimeoutMs]);

  const enqueueManualInput = useCallback((task: () => Promise<void>) => {
    const queued = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        pendingRef.current = true;
        try {
          await waitForCurrentTurnToSettle();
          if (isRunningRef.current && !isPausedRef.current) {
            isPausedRef.current = true;
            pause();
          }
          await task();
        } finally {
          pendingRef.current = false;
        }
      });
    queueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [isPausedRef, isRunningRef, pause, waitForCurrentTurnToSettle]);

  const isManualInputPending = useCallback(() => pendingRef.current, []);

  return { enqueueManualInput, isManualInputPending };
}
