export type RuntimePlatform = 'web' | 'electron' | 'android' | 'ios' | 'unknown';

export interface PlatformCapabilities {
  platform: RuntimePlatform;
  workspacePicker: boolean;
  workspaceRead: boolean;
  workspaceWrite: boolean;
  fileUpload: boolean;
  fileDownload: boolean;
  officeTransform: boolean;
  commandExecution: boolean;
  systemActions: boolean;
}

export function detectRuntimePlatform(): RuntimePlatform {
  if (typeof window === 'undefined') return 'unknown';
  const w = window as Window & { electronAPI?: unknown; Capacitor?: { getPlatform?: () => string } };
  if (w.electronAPI) return 'electron';
  const platform = w.Capacitor?.getPlatform?.();
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  return 'web';
}

export function resolvePlatformCapabilities(platform = detectRuntimePlatform()): PlatformCapabilities {
  if (platform === 'electron') return { platform, workspacePicker:true, workspaceRead:true, workspaceWrite:true, fileUpload:true, fileDownload:true, officeTransform:true, commandExecution:true, systemActions:true };
  if (platform === 'web') return { platform, workspacePicker: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function', workspaceRead:true, workspaceWrite:true, fileUpload:true, fileDownload:true, officeTransform:false, commandExecution:false, systemActions:false };
  if (platform === 'android' || platform === 'ios') return { platform, workspacePicker:false, workspaceRead:false, workspaceWrite:false, fileUpload:true, fileDownload:true, officeTransform:false, commandExecution:false, systemActions:false };
  return { platform, workspacePicker:false, workspaceRead:false, workspaceWrite:false, fileUpload:false, fileDownload:false, officeTransform:false, commandExecution:false, systemActions:false };
}
