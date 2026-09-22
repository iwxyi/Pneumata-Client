import { unzipSync, zipSync } from 'fflate';
import type { AssistantAgentNetworkRequest, AssistantAgentLocalFileContext } from '../types/assistantArtifact';
import { api } from './api';
import { fetchNetworkResource, exportNetworkResource } from './networkResourceService';
import { saveSessionNetworkResource } from './sessionNetworkResourceStore';
import { useLocalWorkspaceStore } from '../stores/useLocalWorkspaceStore';
import { getLocalWorkspaceDirectoryPermission, writeBinaryFileToLocalWorkspace } from './localWorkspaceService';

const MAX_TASK_FILES = 10_000;
const MAX_TASK_BYTES = 500 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 10_000;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_DEVICE_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_READ_CONTEXT_FILES = 32;
const MAX_READ_CONTEXT_CHARS = 200_000;

interface TransferEntry { url: string; path: string; sizeBytes?: number; transferToken?: string }

function safePath(value: string) {
  const path = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`不安全的文件路径：${value}`);
  return path;
}

function bytesFromResult(content: string, encoding: 'utf8' | 'base64') {
  if (encoding === 'utf8') return new TextEncoder().encode(content);
  return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
}

function isTextLike(path: string, contentType: string) {
  return contentType.startsWith('text/') || /json|xml|javascript|svg/i.test(contentType)
    || /\.(?:md|txt|csv|json|xml|html?|css|js|ts|py|java|go|rs|yaml|yml|toml|ini|log)$/i.test(path);
}

async function listHttpDirectory(rootUrl: string): Promise<TransferEntry[]> {
  const root = new URL(rootUrl);
  const rootPath = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`;
  const seenPages = new Set<string>();
  const files = new Map<string, TransferEntry>();
  async function walk(url: string, depth: number) {
    if (depth > 8 || files.size >= MAX_TASK_FILES || seenPages.has(url)) return;
    seenPages.add(url);
    const page = await fetchNetworkResource(url, 'source');
    if (!/html|xhtml/i.test(page.contentType) || !page.text) {
      files.set(url, { url, path: decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'download'), sizeBytes: page.sizeBytes });
      return;
    }
    const documentNode = new DOMParser().parseFromString(page.text, 'text/html');
    const linkBase = new URL(page.finalUrl || url);
    if (depth === 0 && !linkBase.pathname.endsWith('/')) linkBase.pathname += '/';
    for (const anchor of Array.from(documentNode.querySelectorAll('a[href]'))) {
      if (files.size >= MAX_TASK_FILES) break;
      const child = new URL(anchor.getAttribute('href') || '', linkBase);
      if (child.origin !== root.origin || child.hash || child.href === url) continue;
      if (!child.pathname.startsWith(rootPath)) continue;
      const relative = decodeURIComponent(child.pathname.slice(rootPath.length));
      if (!relative || relative.startsWith('../')) continue;
      if (child.pathname.endsWith('/')) await walk(child.toString(), depth + 1);
      else files.set(child.toString(), { url: child.toString(), path: safePath(relative) });
    }
  }
  await walk(root.toString(), 0);
  return [...files.values()];
}

async function listEntries(request: AssistantAgentNetworkRequest): Promise<TransferEntry[]> {
  if (!request.recursive) return [{ url: request.url, path: safePath(request.fileName || decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).at(-1) || 'download')) }];
  if (/^ftps?:/i.test(request.url)) {
    const listing = await api.listNetworkDirectory(request.url);
    if (listing.truncated) throw new Error(`目录文件数量达到 ${MAX_TASK_FILES} 个上限，请缩小范围或拆分任务`);
    return listing.files.map((file) => ({ ...file, path: safePath(file.path), transferToken: listing.transferToken }));
  }
  return listHttpDirectory(request.url);
}

function extractedEntries(path: string, bytes: Uint8Array) {
  if (!/\.zip$/i.test(path)) return [];
  let count = 0;
  let total = 0;
  const extracted = unzipSync(bytes, { filter: (file) => {
    if (file.name.endsWith('/')) return false;
    safePath(file.name);
    count += 1;
    total += file.originalSize;
    if (count > MAX_EXTRACTED_FILES) throw new Error('压缩包文件数量超过限制');
    if (total > MAX_EXTRACTED_BYTES) throw new Error('压缩包解压体积超过 200 MB 限制');
    return true;
  } });
  return Object.entries(extracted).map(([name, value]) => {
    return { path: safePath(`${path.replace(/\.zip$/i, '')}/${name}`), bytes: value, mimeType: 'application/octet-stream' };
  });
}

async function persistFile(params: {
  chatId: string;
  request: AssistantAgentNetworkRequest;
  sourceUrl: string;
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  workspacePermissionCache: Map<string, Awaited<ReturnType<typeof getLocalWorkspaceDirectoryPermission>>>;
}) {
  const store = useLocalWorkspaceStore.getState();
  const defaultTarget = store.getDefaultStorageTarget();
  const destination = params.request.destination || (defaultTarget.kind === 'workspace' ? 'workspace' : 'session');
  const copy = new Uint8Array(params.bytes.byteLength);
  copy.set(params.bytes);
  const blob = new Blob([copy.buffer], { type: params.mimeType });
  const saveToSession = async (label = '会话资源') => {
    await saveSessionNetworkResource({ chatId: params.chatId, sourceUrl: params.sourceUrl, path: params.path, name: params.path.split('/').at(-1) || params.path, mimeType: params.mimeType, sizeBytes: params.bytes.byteLength, blob });
    return { target: label, written: true, outcome: 'created' as const };
  };
  if (destination === 'device') {
    exportNetworkResource(params.bytes, params.path.split('/').at(-1) || 'download', params.mimeType);
    return { target: '设备', written: true, outcome: 'created' as const };
  }
  if (destination === 'workspace') {
    const target = params.request.workspaceId || (defaultTarget.kind === 'workspace' ? defaultTarget.workspaceId : '');
    if (!target) throw new Error('没有可写入的默认工作区');
    const requestedPath = params.request.destinationPath?.replace(/^\/+|\/+$/g, '');
    const targetPath = params.request.recursive
      ? `${requestedPath || '下载'}/${params.path}`
      : requestedPath || `下载/${params.path}`;
    const directory = store.directories.find((item) => item.id === target);
    if (!directory) throw new Error('找不到目标工作区');
    const explicitWorkspace = params.request.destination === 'workspace';
    let currentPermission = params.workspacePermissionCache.get(directory.id);
    if (!explicitWorkspace && !currentPermission) {
      currentPermission = await getLocalWorkspaceDirectoryPermission(directory.id);
      params.workspacePermissionCache.set(directory.id, currentPermission);
    }
    if (!explicitWorkspace && currentPermission !== 'granted') {
      return saveToSession('会话资源（默认工作区当前未授权）');
    }
    const result = await writeBinaryFileToLocalWorkspace({
      directory,
      path: safePath(targetPath),
      content: blob,
      requestPermission: explicitWorkspace,
      conflictPolicy: params.request.conflictPolicy || 'rename',
    });
    return { target: '工作区', written: result.outcome !== 'skipped', outcome: result.outcome };
  }
  return saveToSession();
}

export async function executeNetworkTransferTask(chatId: string, request: AssistantAgentNetworkRequest): Promise<AssistantAgentLocalFileContext[]> {
  if (request.action === 'read' && !request.recursive) {
    const result = await fetchNetworkResource(request.url, request.mode === 'binary' ? 'download' : request.mode);
    return [{ directoryId: 'network', path: result.finalUrl, name: request.fileName || result.title || result.fileName, mimeType: result.contentType, sizeBytes: result.sizeBytes, content: result.text || `网络文件：${result.fileName}\n大小：${result.sizeBytes} bytes`, truncated: Boolean(result.truncated), originalLength: result.originalLength || result.sizeBytes }];
  }
  const entries = await listEntries(request);
  if (entries.length > MAX_TASK_FILES) throw new Error(`任务文件数量超过 ${MAX_TASK_FILES} 个限制`);
  const declaredTotal = entries.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
  if (declaredTotal > MAX_TASK_BYTES) throw new Error('任务预计大小超过 500 MB，请缩小范围或拆分任务');
  const contexts: AssistantAgentLocalFileContext[] = [];
  let received = 0;
  let saved = 0;
  let extracted = 0;
  let skipped = 0;
  let renamed = 0;
  let overwritten = 0;
  let readContextChars = 0;
  const persistedTargets = new Set<string>();
  const workspacePermissionCache = new Map<string, Awaited<ReturnType<typeof getLocalWorkspaceDirectoryPermission>>>();
  const deviceFiles: Record<string, Uint8Array> = {};
  try {
    for (const entry of entries) {
      const result = await fetchNetworkResource(entry.url, 'download', { transferToken: entry.transferToken });
      const bytes = bytesFromResult(result.content, result.encoding);
      received += bytes.byteLength;
      if (received > MAX_TASK_BYTES) throw new Error('任务实际下载大小超过 500 MB，已停止');
      const extractedFiles = request.extractArchives ? extractedEntries(entry.path, bytes) : [];
      if (request.action === 'read') {
        saved += 1;
        const readable = [{ path: entry.path, bytes, mimeType: result.contentType }, ...extractedFiles];
        for (const item of readable) {
          if (contexts.length >= MAX_READ_CONTEXT_FILES || readContextChars >= MAX_READ_CONTEXT_CHARS) break;
          const metadata = `网络文件：${item.path}\n大小：${item.bytes.byteLength} bytes`;
          const raw = isTextLike(item.path, item.mimeType) ? new TextDecoder().decode(item.bytes) : metadata;
          const content = raw.slice(0, MAX_READ_CONTEXT_CHARS - readContextChars);
          contexts.push({ directoryId: 'network', path: item.path, name: item.path.split('/').at(-1) || item.path, mimeType: item.mimeType, sizeBytes: item.bytes.byteLength, content, truncated: content.length < raw.length, originalLength: raw.length });
          readContextChars += content.length;
        }
        extracted += extractedFiles.length;
        continue;
      }
      if (request.destination === 'device' && (request.recursive || entries.length > 1 || extractedFiles.length)) {
        deviceFiles[entry.path] = bytes;
        for (const item of extractedFiles) deviceFiles[item.path] = item.bytes;
        const aggregateBytes = Object.values(deviceFiles).reduce((sum, value) => sum + value.byteLength, 0);
        if (aggregateBytes > MAX_DEVICE_ARCHIVE_BYTES) throw new Error('设备导出内容超过 100 MB，请保存到会话或工作区');
        saved += 1;
        extracted += extractedFiles.length;
        continue;
      }
      const persisted = await persistFile({ chatId, request, sourceUrl: result.finalUrl, path: entry.path, bytes, mimeType: result.contentType, workspacePermissionCache });
      persistedTargets.add(persisted.target);
      if (persisted.written) saved += 1;
      else skipped += 1;
      if (persisted.outcome === 'renamed') renamed += 1;
      if (persisted.outcome === 'overwritten') overwritten += 1;
      for (const item of extractedFiles) {
        const extractedResult = await persistFile({ chatId, request, sourceUrl: result.finalUrl, ...item, workspacePermissionCache });
        persistedTargets.add(extractedResult.target);
        if (extractedResult.written) extracted += 1;
        else skipped += 1;
        if (extractedResult.outcome === 'renamed') renamed += 1;
        if (extractedResult.outcome === 'overwritten') overwritten += 1;
      }
    }
    if (Object.keys(deviceFiles).length) {
      const archive = zipSync(deviceFiles, { level: 6 });
      const name = `${request.fileName?.replace(/\.zip$/i, '') || new URL(request.url).hostname || 'network-files'}.zip`;
      exportNetworkResource(archive, name, 'application/zip');
    }
  } catch (error) {
    if (saved > 0 && request.destination !== 'device') {
      throw new Error(`网络传输部分完成：已保存 ${saved} 个文件、解压 ${extracted} 个文件；随后失败：${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  const saveTarget = request.action === 'read'
    ? '当前上下文（未持久化）'
    : request.destination === 'device' ? '设备' : [...persistedTargets].join('、') || request.destination || '默认存储目标';
  const fileCountLabel = request.action === 'read' ? '读取文件' : '保存文件';
  const content = `网络传输任务完成。\n来源：${request.url}\n${fileCountLabel}：${saved}\n解压文件：${extracted}\n自动重命名：${renamed}\n覆盖文件：${overwritten}\n跳过文件：${skipped}\n总接收：${received} bytes\n保存目标：${saveTarget}`;
  contexts.push({ directoryId: 'network-task', path: request.url, name: request.fileName || '网络传输任务', mimeType: 'text/plain', sizeBytes: received, content, truncated: false, originalLength: content.length });
  return contexts;
}
