export function buildWarmState<T>(params: {
  items: T[];
  projectVisible: (items: T[]) => T[];
  pendingEditSyncCount: number;
  pendingEditSyncError: string | null;
  isLoading: boolean;
}) {
  return {
    isLoading: params.isLoading,
    items: params.projectVisible(params.items),
    pendingEditSyncCount: params.pendingEditSyncCount,
    pendingEditSyncError: params.pendingEditSyncError,
  };
}
