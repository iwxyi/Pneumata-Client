import type { ChatFileAttachment } from '../types/message';

export function downloadChatFile(file: Pick<ChatFileAttachment, 'name' | 'mimeType' | 'url' | 'textContent'>) {
  if (typeof document === 'undefined') return false;
  const href = file.textContent != null
    ? URL.createObjectURL(new Blob([file.textContent], { type: file.mimeType || 'text/plain;charset=utf-8' }))
    : file.url || null;
  if (!href) return false;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = file.name || 'download';
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(href);
  return true;
}

export async function readUploadedChatFiles(files: File[], limits: { maxFiles?: number; maxBytes?: number } = {}): Promise<ChatFileAttachment[]> {
  const maxFiles = Math.max(1, Math.min(limits.maxFiles || 12, 40));
  const maxBytes = Math.max(1024, Math.min(limits.maxBytes || 1_000_000, 5_000_000));
  const result: ChatFileAttachment[] = [];
  for (const file of files.slice(0, maxFiles)) {
    if (file.size > maxBytes) continue;
    const isText = file.type.startsWith('text/') || /\.(txt|md|json|csv|xml|html|css|js|ts|py|yaml|yml|toml)$/i.test(file.name);
    result.push({ id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, source: 'message_upload', name: file.name, mimeType: file.type || undefined, sizeBytes: file.size, url: URL.createObjectURL(file), textContent: isText ? await file.text() : undefined, createdAt: Date.now() });
  }
  return result;
}
