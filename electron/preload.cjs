const { clipboard, contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('senseMurmurDesktop', {
  platform: process.platform,
  writeClipboardText(text) {
    const value = String(text || '');
    if (!value) return false;
    clipboard.writeText(value);
    return clipboard.readText() === value;
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  runCommand(request) {
    return ipcRenderer.invoke('pneumata:run-command', request);
  },
  transformOffice(request) {
    return ipcRenderer.invoke('pneumata:transform-office', request);
  },
  systemAction(request) {
    return ipcRenderer.invoke('pneumata:system-action', request);
  },
});
