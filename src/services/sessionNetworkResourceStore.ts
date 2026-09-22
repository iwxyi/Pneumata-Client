import type { AssistantAgentLocalFileContext } from '../types/assistantArtifact';

const DB_NAME = 'pneumata-network-resources';
const DB_VERSION = 2;
const STORE = 'resources';
const METADATA_STORE = 'resourceMetadata';
const MAX_CONTEXT_FILES = 32;
const DEFAULT_MAX_CONTEXT_CHARS = 200_000;

export interface SessionNetworkResource {
  id: string;
  chatId: string;
  sourceUrl: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  createdAt: number;
}

type SessionNetworkResourceMetadata = Omit<SessionNetworkResource, 'blob'>;

function resourceMetadata(resource: SessionNetworkResource): SessionNetworkResourceMetadata {
  return {
    id: resource.id,
    chatId: resource.chatId,
    sourceUrl: resource.sourceUrl,
    path: resource.path,
    name: resource.name,
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes,
    createdAt: resource.createdAt,
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('chatId', 'chatId');
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metadataStore = db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        metadataStore.createIndex('chatId', 'chatId');
        if (request.transaction && db.objectStoreNames.contains(STORE)) {
          const cursorRequest = request.transaction.objectStore(STORE).openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            metadataStore.put(resourceMetadata(cursor.value as SessionNetworkResource));
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开会话资源存储失败'));
  });
  return dbPromise;
}

function requestResult<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE) {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('会话资源存储失败'));
    tx.onerror = () => reject(tx.error || new Error('会话资源事务失败'));
  }));
}

export async function saveSessionNetworkResource(resource: Omit<SessionNetworkResource, 'id' | 'createdAt'>) {
  const record: SessionNetworkResource = {
    ...resource,
    id: `network-resource-${Date.now()}-${crypto.randomUUID()}`,
    createdAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, METADATA_STORE], 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.objectStore(METADATA_STORE).put(resourceMetadata(record));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('保存会话资源失败'));
    tx.onabort = () => reject(tx.error || new Error('保存会话资源失败'));
  });
  return record;
}

export async function listSessionNetworkResources(chatId: string) {
  const records = await requestResult<SessionNetworkResource[]>('readonly', (store) => store.index('chatId').getAll(chatId));
  return records.sort((left, right) => right.createdAt - left.createdAt);
}

export async function listSessionNetworkResourceRegistry(chatId: string, query = '') {
  const records = await requestResult<SessionNetworkResourceMetadata[]>('readonly', (store) => store.index('chatId').getAll(chatId), METADATA_STORE);
  const normalizedQuery = query.toLowerCase();
  return records
    .map((resource) => ({
      resource,
      score: normalizedQuery.includes(resource.name.toLowerCase()) || normalizedQuery.includes(resource.path.toLowerCase()) ? 1 : 0,
    }))
    .sort((left, right) => right.score - left.score || right.resource.createdAt - left.resource.createdAt)
    .slice(0, 160)
    .map(({ resource }) => resource);
}

function isTextResource(resource: SessionNetworkResource) {
  return resource.mimeType.startsWith('text/') || /\.(?:md|txt|csv|json|xml|html?|css|js|ts|py|java|go|rs|yaml|yml|toml|ini|log)$/i.test(resource.name);
}

export async function getSessionNetworkResourceContexts(
  chatId: string,
  resourceIds: string[],
  query: string,
  maxChars = DEFAULT_MAX_CONTEXT_CHARS,
): Promise<AssistantAgentLocalFileContext[]> {
  if (!resourceIds.length) return [];
  const selectedIds = new Set(resourceIds.slice(0, MAX_CONTEXT_FILES));
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2);
  const resources = (await Promise.all([...selectedIds].map((id) => requestResult<SessionNetworkResource | undefined>('readonly', (store) => store.get(id)))))
    .filter((resource): resource is SessionNetworkResource => Boolean(resource && resource.chatId === chatId))
    .map((resource) => ({ resource, score: terms.reduce((score, term) => score + (`${resource.name} ${resource.path} ${resource.sourceUrl}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .sort((left, right) => right.score - left.score || right.resource.createdAt - left.resource.createdAt)
    .slice(0, MAX_CONTEXT_FILES);
  const contexts: AssistantAgentLocalFileContext[] = [];
  let remaining = Math.max(1, Math.min(maxChars, DEFAULT_MAX_CONTEXT_CHARS));
  for (const { resource } of resources) {
    if (remaining <= 0) break;
    const metadata = `会话资源：${resource.name}\n来源：${resource.sourceUrl}\n大小：${resource.sizeBytes} bytes`;
    const raw = isTextResource(resource) ? await resource.blob.text() : metadata;
    const content = raw.slice(0, remaining);
    contexts.push({ directoryId: 'session-network', path: resource.path, name: resource.name, mimeType: resource.mimeType, sizeBytes: resource.sizeBytes, content, truncated: raw.length > content.length, originalLength: raw.length });
    remaining -= content.length;
  }
  return contexts;
}
