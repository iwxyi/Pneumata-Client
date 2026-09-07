import type { GroupChat } from '../types/chat';
import type { AssistantArtifactItem, AssistantArtifactKind } from '../types/assistantArtifact';
import type { LocalWorkspaceDirectoryMeta } from '../types/localWorkspace';

const DB_NAME = 'pneumata-local-workspace';
const DB_VERSION = 1;
const DIRECTORY_STORE = 'directoryHandles';
const CHAT_ROOT = 'chat';
const ARTIFACT_METADATA_FILE = 'artifact.json';

type DirectoryHandle = FileSystemDirectoryHandle;
type BrowserWellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';

interface DirectoryHandleRecord {
  id: string;
  handle: DirectoryHandle;
}

interface WriteContext {
  chat: Pick<GroupChat, 'id' | 'name' | 'type'>;
  artifact: AssistantArtifactItem;
  directory: LocalWorkspaceDirectoryMeta;
}

export interface LocalWorkspaceFileEntry {
  directoryId: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  depth: number;
  sizeBytes?: number;
  mimeType?: string;
  updatedAt?: number;
}

export interface LocalWorkspaceScanOptions {
  pathPrefix?: string;
  nameContains?: string;
  extension?: string;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  maxEntries?: number;
  maxDepth?: number;
}

export interface LocalWorkspaceFileContext {
  directoryId: string;
  path: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
  originalLength: number;
}

export interface CrossWorkspaceFileOperation {
  kind: 'copy' | 'move';
  sourceDirectory: LocalWorkspaceDirectoryMeta;
  sourcePath: string;
  destinationDirectory: LocalWorkspaceDirectoryMeta;
  destinationPath: string;
  overwrite?: boolean;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: BrowserWellKnownDirectory }) => Promise<DirectoryHandle>;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openWorkspaceDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DIRECTORY_STORE)) {
        db.createObjectStore(DIRECTORY_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开本地工作区数据库失败'));
  });
  return dbPromise;
}

function withDirectoryStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openWorkspaceDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(DIRECTORY_STORE, mode);
    const store = tx.objectStore(DIRECTORY_STORE);
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地工作区数据库操作失败'));
    tx.onerror = () => reject(tx.error || new Error('本地工作区事务失败'));
  }));
}

export function isWebDirectoryPickerSupported() {
  return getWebDirectoryPickerSupport().supported;
}

export function getWebDirectoryPickerSupport() {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      reason: 'unavailable' as const,
      message: '当前运行环境没有浏览器窗口，无法授权本地文件夹。',
    };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure_context' as const,
      message: '本地文件夹授权需要安全上下文。请使用 https://、http://localhost 或 http://127.0.0.1 打开应用，不要用局域网 IP 或普通 http 域名。',
    };
  }
  if (typeof indexedDB === 'undefined') {
    return {
      supported: false,
      reason: 'indexeddb_unavailable' as const,
      message: '当前环境不可用 IndexedDB，无法保存文件夹授权。请检查隐私模式、浏览器策略或站点存储权限。',
    };
  }
  if (typeof window.showDirectoryPicker !== 'function') {
    return {
      supported: false,
      reason: 'api_missing' as const,
      message: '当前浏览器没有开放 File System Access API。桌面版 Chrome/Edge 通常支持；Safari、Firefox、iOS 和多数内置浏览器通常不支持。',
    };
  }
  return {
    supported: true,
    reason: 'supported' as const,
    message: '当前浏览器支持本地文件夹授权。',
  };
}

export async function pickLocalWorkspaceDirectory(): Promise<LocalWorkspaceDirectoryMeta> {
  const support = getWebDirectoryPickerSupport();
  if (!support.supported) {
    throw new Error(support.message);
  }
  const handle = await window.showDirectoryPicker!({ id: 'pneumata-artifacts', mode: 'readwrite' });
  const id = `web-dir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await withDirectoryStore('readwrite', (store) => store.put({ id, handle } satisfies DirectoryHandleRecord));
  const now = Date.now();
  return {
    id,
    name: handle.name || '本地文件夹',
    provider: 'web-file-system-access',
    addedAt: now,
    updatedAt: now,
    lastPermissionState: await queryDirectoryPermission(handle),
    lastError: null,
  };
}

export async function removeLocalWorkspaceDirectoryHandle(id: string) {
  await withDirectoryStore('readwrite', (store) => store.delete(id));
}

async function getDirectoryHandle(id: string) {
  const record = await withDirectoryStore<DirectoryHandleRecord | undefined>('readonly', (store) => store.get(id));
  return record?.handle || null;
}

export async function getLocalWorkspaceDirectoryPermission(id: string) {
  const handle = await getDirectoryHandle(id);
  if (!handle) return 'missing' as const;
  const permission = await queryDirectoryPermission(handle);
  return permission;
}

async function queryDirectoryPermission(handle: DirectoryHandle): Promise<PermissionState | 'unsupported'> {
  const maybeHandle = handle as DirectoryHandle & {
    queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof maybeHandle.queryPermission !== 'function') return 'unsupported';
  return maybeHandle.queryPermission({ mode: 'readwrite' });
}

async function ensureDirectoryPermission(handle: DirectoryHandle, requestIfNeeded = true) {
  const maybeHandle = handle as DirectoryHandle & {
    queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  const queried = typeof maybeHandle.queryPermission === 'function'
    ? await maybeHandle.queryPermission({ mode: 'readwrite' })
    : 'granted';
  if (queried === 'granted') return queried;
  if (!requestIfNeeded) return queried;
  if (typeof maybeHandle.requestPermission !== 'function') return queried;
  return maybeHandle.requestPermission({ mode: 'readwrite' });
}

function sanitizePathSegment(value: string, fallback: string) {
  const normalized = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return normalized || fallback;
}

function getArtifactExtension(kind: AssistantArtifactKind, language?: string | null) {
  const lang = (language || '').toLowerCase();
  if (kind === 'diagram') return lang.includes('mermaid') ? 'mmd' : 'md';
  if (kind === 'html') return 'html';
  if (kind === 'json') return 'json';
  if (kind === 'table') return 'csv';
  if (kind === 'code') {
    if (lang.includes('typescript') || lang === 'ts') return 'ts';
    if (lang.includes('javascript') || lang === 'js') return 'js';
    if (lang.includes('python') || lang === 'py') return 'py';
    if (lang.includes('css')) return 'css';
    if (lang.includes('html')) return 'html';
    return 'txt';
  }
  if (kind === 'document') return 'md';
  if (kind === 'image') return 'json';
  return 'txt';
}

async function ensureChildDirectory(parent: DirectoryHandle, name: string) {
  return parent.getDirectoryHandle(name, { create: true });
}

async function writeTextFile(directory: DirectoryHandle, fileName: string, content: string) {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function removeChildDirectory(parent: DirectoryHandle, name: string) {
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (error) {
    const domError = error as DOMException;
    if (domError?.name !== 'NotFoundError') throw error;
  }
}

async function readJsonFile(directory: DirectoryHandle, fileName: string) {
  try {
    const fileHandle = await directory.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function cleanupArtifactDirectoriesById(chatDir: DirectoryHandle, artifactId: string, keepFolderName?: string | null) {
  const iterator = getDirectoryEntries(chatDir);
  if (!iterator) return;
  for await (const [name, handle] of iterator) {
    if (handle.kind !== 'directory') continue;
    if (keepFolderName && name === keepFolderName) continue;
    const artifactMetadata = await readJsonFile(handle as DirectoryHandle, ARTIFACT_METADATA_FILE);
    if (artifactMetadata?.id !== artifactId) continue;
    await removeChildDirectory(chatDir, name);
  }
}

function getDirectoryEntries(handle: DirectoryHandle) {
  const iterable = handle as DirectoryHandle & {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  if (typeof iterable.entries !== 'function') return null;
  return iterable.entries();
}

function isTextLikeFile(file: File, path: string) {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith('text/')) return true;
  if ([
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/x-javascript',
    'application/x-typescript',
  ].includes(mimeType)) return true;
  return /\.(md|markdown|txt|json|jsonl|csv|tsv|xml|html|css|js|jsx|ts|tsx|mjs|cjs|py|java|go|rs|php|rb|sh|bash|zsh|sql|yaml|yml|toml|ini|env|mmd|mermaid)$/i.test(path);
}

function joinWorkspacePath(parent: string, child: string) {
  return parent ? `${parent}/${child}` : child;
}

async function getChildHandle(root: DirectoryHandle, path: string) {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) return null;
  let current: DirectoryHandle = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const isLast = index === parts.length - 1;
    if (isLast) {
      try {
        return await current.getFileHandle(part, { create: false });
      } catch {
        return null;
      }
    }
    try {
      current = await current.getDirectoryHandle(part, { create: false });
    } catch {
      return null;
    }
  }
  return null;
}

async function getParentDirectoryHandle(root: DirectoryHandle, path: string, create = false) {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 1 || parts.some((part) => part === '.' || part === '..')) return null;
  let current: DirectoryHandle = root;
  for (const part of parts.slice(0, -1)) {
    try {
      current = await current.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return { directory: current, name: parts[parts.length - 1]! };
}

async function readFileBytes(handle: FileSystemFileHandle) {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export interface LocalWorkspaceMutation {
  kind: 'write' | 'delete' | 'move';
  path: string;
  destinationPath?: string;
  content?: string;
}

export interface LocalWorkspaceMutationPlan {
  id: string;
  directoryId: string;
  mutations: LocalWorkspaceMutation[];
  createdAt: number;
  expiresAt: number;
}

export function createLocalWorkspaceMutationPlan(directoryId: string, mutations: LocalWorkspaceMutation[], ttlMs = 120_000): LocalWorkspaceMutationPlan {
  const now = Date.now();
  return { id: `workspace-plan-${now}-${Math.random().toString(36).slice(2, 8)}`, directoryId, mutations: mutations.slice(0, 100), createdAt: now, expiresAt: now + Math.max(10_000, Math.min(ttlMs, 600_000)) };
}

export function isLocalWorkspaceMutationPlanValid(plan: LocalWorkspaceMutationPlan) {
  return plan.mutations.length > 0 && Date.now() < plan.expiresAt;
}

export async function confirmAndApplyLocalWorkspaceMutationPlan(params: {
  plan: LocalWorkspaceMutationPlan;
  directory: LocalWorkspaceDirectoryMeta;
}) {
  if (params.plan.directoryId !== params.directory.id) throw new Error('工作区计划与目标目录不匹配');
  if (!isLocalWorkspaceMutationPlanValid(params.plan)) throw new Error('工作区变更计划已过期');
  return applyLocalWorkspaceMutations({ directory: params.directory, mutations: params.plan.mutations, dryRun: false });
}

export async function applyLocalWorkspaceMutations(params: {
  directory: LocalWorkspaceDirectoryMeta;
  mutations: LocalWorkspaceMutation[];
  dryRun?: boolean;
}) {
  const rootHandle = await getDirectoryHandle(params.directory.id);
  if (!rootHandle) throw new Error('本地文件夹授权已失效，请重新授权');
  const permission = await ensureDirectoryPermission(rootHandle);
  if (permission !== 'granted') throw new Error('未获得本地文件夹读写权限');
  const mutations = params.mutations.slice(0, 100);
  if (params.dryRun) return { applied: 0, planned: mutations.length };
  let applied = 0;
  for (const mutation of mutations) {
    const target = await getParentDirectoryHandle(rootHandle, mutation.path, mutation.kind === 'write');
    if (!target) continue;
    if (mutation.kind === 'write') {
      const handle = await target.directory.getFileHandle(target.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(mutation.content || '');
      await writable.close();
      applied += 1;
      continue;
    }
    if (mutation.kind === 'delete') {
      await target.directory.removeEntry(target.name).catch((error) => {
        if ((error as DOMException)?.name !== 'NotFoundError') throw error;
      });
      applied += 1;
      continue;
    }
    if (!mutation.destinationPath) continue;
    const source = await getParentDirectoryHandle(rootHandle, mutation.path);
    const destination = await getParentDirectoryHandle(rootHandle, mutation.destinationPath, true);
    if (!source || !destination) continue;
    const sourceHandle = await source.directory.getFileHandle(source.name, { create: false });
    const bytes = await readFileBytes(sourceHandle);
    const targetHandle = await destination.directory.getFileHandle(destination.name, { create: true });
    const writable = await targetHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
    await source.directory.removeEntry(source.name);
    applied += 1;
  }
  return { applied, planned: mutations.length };
}

/** Copy/move files between authorized workspaces. Move deletes the source only after a successful copy. */
export async function applyCrossWorkspaceFileOperations(operations: CrossWorkspaceFileOperation[]) {
  let applied = 0;
  for (const operation of operations.slice(0, 100)) {
    if (operation.sourceDirectory.id === operation.destinationDirectory.id
      && operation.sourcePath === operation.destinationPath) continue;
    const sourceRoot = await getDirectoryHandle(operation.sourceDirectory.id);
    const destinationRoot = await getDirectoryHandle(operation.destinationDirectory.id);
    if (!sourceRoot || !destinationRoot) throw new Error('本地文件夹授权已失效，请重新授权');
    if (await ensureDirectoryPermission(sourceRoot, false) !== 'granted' || await ensureDirectoryPermission(destinationRoot) !== 'granted') {
      throw new Error('未获得本地文件夹读写权限');
    }
    const source = await getChildHandle(sourceRoot, operation.sourcePath);
    const destination = await getParentDirectoryHandle(destinationRoot, operation.destinationPath, true);
    if (!source || !destination) continue;
    let targetHandle: FileSystemFileHandle;
    try {
      targetHandle = await destination.directory.getFileHandle(destination.name, { create: false });
      if (!operation.overwrite) continue;
    } catch {
      targetHandle = await destination.directory.getFileHandle(destination.name, { create: true });
    }
    const bytes = await readFileBytes(source);
    const writable = await targetHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
    if (operation.kind === 'move' && operation.sourcePath !== operation.destinationPath) {
      const sourceParent = await getParentDirectoryHandle(sourceRoot, operation.sourcePath);
      if (sourceParent) await sourceParent.directory.removeEntry(sourceParent.name);
    }
    applied += 1;
  }
  return { applied, planned: Math.min(operations.length, 100) };
}

export async function listLocalWorkspaceFiles(params: {
  directory: LocalWorkspaceDirectoryMeta;
  maxEntries?: number;
  maxDepth?: number;
  options?: LocalWorkspaceScanOptions;
}): Promise<LocalWorkspaceFileEntry[]> {
  const rootHandle = await getDirectoryHandle(params.directory.id);
  if (!rootHandle) throw new Error('本地文件夹授权已失效，请重新授权');
  const permission = await ensureDirectoryPermission(rootHandle, false);
  if (permission !== 'granted') throw new Error('未获得本地文件夹读写权限');
  const options = params.options || {};
  const maxEntries = Math.max(1, Math.min(options.maxEntries || params.maxEntries || 160, 500));
  const maxDepth = Math.max(1, Math.min(options.maxDepth || params.maxDepth || 4, 8));
  const entries: LocalWorkspaceFileEntry[] = [];

  async function walk(directory: DirectoryHandle, parentPath: string, depth: number) {
    if (entries.length >= maxEntries || depth > maxDepth) return;
    const iterator = getDirectoryEntries(directory);
    if (!iterator) return;
    for await (const [name, handle] of iterator) {
      if (entries.length >= maxEntries) return;
      if (!name || name.startsWith('.')) continue;
      const path = joinWorkspacePath(parentPath, name);
      if (handle.kind === 'directory') {
        if (!options.pathPrefix || path.startsWith(options.pathPrefix.replace(/^\/+|\/+$/g, ''))) entries.push({ directoryId: params.directory.id, path, name, kind: 'directory', depth });
        await walk(handle as DirectoryHandle, path, depth + 1);
        continue;
      }
      if (handle.kind !== 'file') continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const normalizedExtension = options.extension?.replace(/^\./, '').toLowerCase();
        if (options.pathPrefix && !path.startsWith(options.pathPrefix.replace(/^\/+|\/+$/g, ''))) continue;
        if (options.nameContains && !name.toLowerCase().includes(options.nameContains.toLowerCase())) continue;
        if (normalizedExtension && !name.toLowerCase().endsWith(`.${normalizedExtension}`)) continue;
        if (options.minSizeBytes != null && file.size < options.minSizeBytes) continue;
        if (options.maxSizeBytes != null && file.size > options.maxSizeBytes) continue;
        entries.push({
          directoryId: params.directory.id,
          path,
          name,
          kind: 'file',
          depth,
          sizeBytes: file.size,
          mimeType: file.type || undefined,
          updatedAt: file.lastModified || undefined,
        });
      } catch {
        entries.push({ directoryId: params.directory.id, path, name, kind: 'file', depth });
      }
    }
  }

  await walk(rootHandle, '', 1);
  return entries;
}

export async function readLocalWorkspaceTextFiles(params: {
  directory: LocalWorkspaceDirectoryMeta;
  paths: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalChars?: number;
}): Promise<LocalWorkspaceFileContext[]> {
  const rootHandle = await getDirectoryHandle(params.directory.id);
  if (!rootHandle) throw new Error('本地文件夹授权已失效，请重新授权');
  const permission = await ensureDirectoryPermission(rootHandle);
  if (permission !== 'granted') throw new Error('未获得本地文件夹读写权限');
  const maxFiles = Math.max(1, Math.min(params.maxFiles || 8, 20));
  const maxFileBytes = Math.max(1024, Math.min(params.maxFileBytes || 256_000, 1_000_000));
  const maxTotalChars = Math.max(2000, Math.min(params.maxTotalChars || 120_000, 400_000));
  const contexts: LocalWorkspaceFileContext[] = [];
  let remainingChars = maxTotalChars;

  for (const path of params.paths.slice(0, maxFiles)) {
    if (remainingChars <= 0) break;
    const fileHandle = await getChildHandle(rootHandle, path);
    if (!fileHandle) continue;
    const file = await fileHandle.getFile();
    if (!isTextLikeFile(file, path)) continue;
    if (file.size > maxFileBytes) continue;
    const raw = await file.text();
    const content = raw.slice(0, remainingChars);
    contexts.push({
      directoryId: params.directory.id,
      path,
      name: file.name || path.split('/').pop() || path,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
      content,
      truncated: raw.length > content.length,
      originalLength: raw.length,
    });
    remainingChars -= content.length;
  }
  return contexts;
}

function buildArtifactMetadata(ctx: WriteContext) {
  const currentVersion = ctx.artifact.versions.find((item) => item.id === ctx.artifact.currentVersionId)
    || ctx.artifact.versions[ctx.artifact.versions.length - 1]
    || null;
  return {
    id: ctx.artifact.id,
    chatId: ctx.chat.id,
    chatName: ctx.chat.name,
    kind: ctx.artifact.kind,
    title: ctx.artifact.title,
    summary: ctx.artifact.summary || '',
    language: ctx.artifact.language || currentVersion?.language || null,
    currentVersionId: ctx.artifact.currentVersionId,
    versions: ctx.artifact.versions.map((version) => ({
      id: version.id,
      sourceMessageId: version.sourceMessageId,
      baseVersionId: version.baseVersionId || null,
      changeSummary: version.changeSummary || '',
      createdAt: version.createdAt,
      files: version.files?.map((file) => ({ id: file.id, path: file.path, language: file.language || null })) || [],
      media: version.media || [],
    })),
    updatedAt: ctx.artifact.updatedAt,
  };
}

function getArtifactCurrentContent(item: AssistantArtifactItem) {
  const fallbackVersion = item.versions.length ? item.versions[item.versions.length - 1] : null;
  const version = item.versions.find((entry) => entry.id === item.currentVersionId) || fallbackVersion;
  if (!version) return '';
  if (version.files?.length) {
    return version.files.map((file) => `// ${file.path}\n${file.content}`).join('\n\n');
  }
  return version.content || '';
}

export function getAssistantChatWorkspaceFolderName(chat: Pick<GroupChat, 'id' | 'name'>) {
  return sanitizePathSegment(chat.name || '未命名助手', `assistant-${chat.id.slice(-8)}`);
}

export async function writeAssistantArtifactToLocalWorkspace(ctx: WriteContext) {
  if (ctx.chat.type !== 'assistant') return;
  const rootHandle = await getDirectoryHandle(ctx.directory.id);
  if (!rootHandle) throw new Error('本地文件夹授权已失效，请重新授权');
  const permission = await ensureDirectoryPermission(rootHandle);
  if (permission !== 'granted') throw new Error('未获得本地文件夹读写权限');

  const chatRoot = await ensureChildDirectory(rootHandle, CHAT_ROOT);
  const chatDir = await ensureChildDirectory(chatRoot, getAssistantChatWorkspaceFolderName(ctx.chat));
  const artifactDirName = sanitizePathSegment(ctx.artifact.title, `artifact-${ctx.artifact.id.slice(-8)}`);
  const artifactDir = await ensureChildDirectory(chatDir, artifactDirName);
  const currentVersion = ctx.artifact.versions.find((item) => item.id === ctx.artifact.currentVersionId)
    || ctx.artifact.versions[ctx.artifact.versions.length - 1]
    || null;

  await writeTextFile(artifactDir, ARTIFACT_METADATA_FILE, JSON.stringify(buildArtifactMetadata(ctx), null, 2));
  if (currentVersion?.files?.length) {
    const filesDir = await ensureChildDirectory(artifactDir, 'files');
    for (const file of currentVersion.files) {
      const parts = file.path.split(/[\\/]/).map((part) => sanitizePathSegment(part, 'untitled')).filter(Boolean);
      const fileName = parts.pop() || `${sanitizePathSegment(file.id, 'file')}.txt`;
      let targetDir = filesDir;
      for (const part of parts) {
        targetDir = await ensureChildDirectory(targetDir, part);
      }
      await writeTextFile(targetDir, fileName, file.content || '');
    }
    await cleanupArtifactDirectoriesById(chatDir, ctx.artifact.id, artifactDirName);
    return;
  }
  const ext = getArtifactExtension(ctx.artifact.kind, ctx.artifact.language || currentVersion?.language);
  await writeTextFile(artifactDir, `content.${ext}`, getArtifactCurrentContent(ctx.artifact));
  await cleanupArtifactDirectoriesById(chatDir, ctx.artifact.id, artifactDirName);
}

export async function rewriteAssistantChatWorkspace(params: {
  directory: LocalWorkspaceDirectoryMeta;
  chat: Pick<GroupChat, 'id' | 'name' | 'type'>;
  previousChatName?: string | null;
  artifacts: AssistantArtifactItem[];
}) {
  if (params.chat.type !== 'assistant') return;
  const rootHandle = await getDirectoryHandle(params.directory.id);
  if (!rootHandle) throw new Error('本地文件夹授权已失效，请重新授权');
  const permission = await ensureDirectoryPermission(rootHandle);
  if (permission !== 'granted') throw new Error('未获得本地文件夹读写权限');

  const chatRoot = await ensureChildDirectory(rootHandle, CHAT_ROOT);
  const previousFolder = params.previousChatName
    ? sanitizePathSegment(params.previousChatName, `assistant-${params.chat.id.slice(-8)}`)
    : null;
  const nextFolder = getAssistantChatWorkspaceFolderName(params.chat);
  for (const artifact of params.artifacts) {
    await writeAssistantArtifactToLocalWorkspace({ chat: params.chat, artifact, directory: params.directory });
  }
  if (previousFolder && previousFolder !== nextFolder) {
    await removeChildDirectory(chatRoot, previousFolder);
  }
}

export async function removeAssistantArtifactFromLocalWorkspace(params: {
  directory: LocalWorkspaceDirectoryMeta;
  chatId: string;
  artifactId: string;
}) {
  const rootHandle = await getDirectoryHandle(params.directory.id);
  if (!rootHandle) throw new Error('本地文件夹授权已失效，请重新授权');
  const permission = await ensureDirectoryPermission(rootHandle);
  if (permission !== 'granted') throw new Error('未获得本地文件夹读写权限');

  const chatRoot = await ensureChildDirectory(rootHandle, CHAT_ROOT);
  const iterator = getDirectoryEntries(chatRoot);
  if (!iterator) return;
  for await (const [name, handle] of iterator) {
    if (handle.kind !== 'directory') continue;
    const chatDir = handle as DirectoryHandle;
    const chatMetadata = await readJsonFile(chatDir, ARTIFACT_METADATA_FILE);
    if (chatMetadata?.chatId && chatMetadata.chatId !== params.chatId) {
      // artifact.json never exists at chat level; kept for forward compatibility if the layout changes.
    }
    await cleanupArtifactDirectoriesById(chatDir, params.artifactId);
  }
}
