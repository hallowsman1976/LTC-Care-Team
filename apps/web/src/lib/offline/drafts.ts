const databaseName = 'smart-ltc-demo-drafts';
const storeName = 'visit-drafts';
const maxDrafts = 10;
const ttlMs = 24 * 60 * 60_000;

export interface OfflineDraft {
  submissionId: string;
  userId: string;
  visitId: string;
  encryptedPayload: string;
  createdAt: number;
  expiresAt: number;
}

export const offlineDraftsEnabled = import.meta.env.VITE_OFFLINE_DRAFTS_ENABLED === 'true';

function openDatabase(): Promise<IDBDatabase> {
  if (!offlineDraftsEnabled) return Promise.reject(new Error('OFFLINE_DRAFTS_DISABLED'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'submissionId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(draft: Omit<OfflineDraft, 'createdAt' | 'expiresAt'>): Promise<void> {
  const database = await openDatabase();
  const existing = await listDrafts(draft.userId, database);
  if (existing.length >= maxDrafts) throw new Error('OFFLINE_DRAFT_LIMIT');
  const now = Date.now();
  await transaction(database, 'readwrite', (store) => store.put({ ...draft, createdAt: now, expiresAt: now + ttlMs }));
}

export async function listDrafts(userId: string, provided?: IDBDatabase): Promise<OfflineDraft[]> {
  const database = provided ?? await openDatabase();
  const all = await transaction<OfflineDraft[]>(database, 'readonly', (store) => store.getAll());
  return all.filter((draft) => draft.userId === userId && draft.expiresAt > Date.now());
}

export async function purgeDrafts(): Promise<void> {
  const database = await openDatabase();
  await transaction(database, 'readwrite', (store) => store.clear());
}

function transaction<T = void>(database: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = action(database.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}
