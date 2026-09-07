export type LocalWorkspaceProvider = 'web-file-system-access' | 'native-desktop' | 'native-mobile';

export interface LocalWorkspaceDirectoryMeta {
  id: string;
  name: string;
  provider: LocalWorkspaceProvider;
  addedAt: number;
  updatedAt: number;
  lastPermissionState?: PermissionState | 'unsupported' | 'missing';
  lastError?: string | null;
}

export type ChatStorageTarget =
  | { kind: 'session' }
  | { kind: 'workspace'; workspaceId: string };

export interface LocalWorkspaceSettingsSnapshot {
  directories: LocalWorkspaceDirectoryMeta[];
  defaultDirectoryId: string | null;
  /** Explicit default target; legacy defaultDirectoryId is retained for migration. */
  defaultStorageTarget?: ChatStorageTarget;
  selectedFilePathsByChatId: Record<string, string[]>;
  chatWriteLocks: Record<string, number>;
}
