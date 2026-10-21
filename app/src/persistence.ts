import { normalizeDocument } from './documents.ts';
import type { TextDocument } from './documents.ts';
import type { LocalDirectoryHandle, LocalFileHandle } from './native-files.ts';
export interface RecoveryPoint { id: string; projectId: string; content: string; createdAt: number }
export interface SaveTarget {
  projectId: string;
  kind: 'directory' | 'file';
  directoryHandle?: LocalDirectoryHandle;
  fileHandle?: LocalFileHandle;
  directoryName: string;
  fileName: string;
  lastModified: number | null;
  /** True after My Edit removed the linked device file while moving it to trash. */
  deviceDeleted?: boolean;
}
const DB_NAME = 'my-edit-local';
const DB_VERSION = 3;
let dbPromise: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) {
        const store = db.createObjectStore('projects', { keyPath: 'id' }); store.createIndex('updatedAt', 'updatedAt');
      } else {
        const cursor = request.transaction!.objectStore('projects').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result; if (!row) return;
          row.update(normalizeDocument(row.value)); row.continue();
        };
      }
      if (!db.objectStoreNames.contains('recovery')) {
        const store = db.createObjectStore('recovery', { keyPath: 'id' }); store.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('saveTargets')) db.createObjectStore('saveTargets', { keyPath: 'projectId' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { dbPromise = undefined; reject(request.error ?? new Error('저장소를 열 수 없어요.')); };
    request.onblocked = () => { dbPromise = undefined; reject(new Error('다른 My Edit 탭을 닫고 다시 시도해 주세요.')); };
  });
  return dbPromise;
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('앱에 저장하지 못했어요. 파일을 내려받아 보관해 주세요.'));
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소됐어요.'));
  });
}
export async function listDocuments(): Promise<TextDocument[]> {
  const db = await openDatabase();
  const request = db.transaction('projects', 'readonly').objectStore('projects').getAll();
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return rows.map(normalizeDocument).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function listSaveTargets(): Promise<SaveTarget[]> {
  const db = await openDatabase();
  const request = db.transaction('saveTargets', 'readonly').objectStore('saveTargets').getAll();
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result as SaveTarget[]); request.onerror = () => reject(request.error); });
}
export async function saveSaveTarget(target: SaveTarget): Promise<void> {
  const db = await openDatabase(); const tx = db.transaction('saveTargets', 'readwrite'); const done = transactionDone(tx);
  tx.objectStore('saveTargets').put(structuredClone(target)); await done;
}
export async function deleteSaveTarget(projectId: string): Promise<void> {
  const db = await openDatabase(); const tx = db.transaction('saveTargets', 'readwrite'); const done = transactionDone(tx);
  tx.objectStore('saveTargets').delete(projectId); await done;
}
export async function deleteDocumentsPermanently(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'saveTargets', 'recovery'], 'readwrite'); const done = transactionDone(tx);
  const projects = tx.objectStore('projects'), targets = tx.objectStore('saveTargets'), recovery = tx.objectStore('recovery');
  for (const id of ids) {
    projects.delete(id); targets.delete(id);
    const request = recovery.index('projectId').openCursor(IDBKeyRange.only(id));
    request.onsuccess = () => { const cursor = request.result; if (!cursor) return; cursor.delete(); cursor.continue(); };
  }
  await done;
}
export async function saveDocument(document: TextDocument, previousContent?: string): Promise<void> {
  const snapshot = structuredClone(document);
  const db = await openDatabase();
  const tx = db.transaction(previousContent === undefined ? ['projects'] : ['projects', 'recovery'], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore('projects').put(snapshot);
  if (previousContent !== undefined) {
    const store = tx.objectStore('recovery');
    store.add({ id: crypto.randomUUID(), projectId: snapshot.id, content: previousContent, createdAt: Date.now() } satisfies RecoveryPoint);
    const request = store.index('projectId').getAll(snapshot.id);
    request.onsuccess = () => {
      const points = (request.result as RecoveryPoint[]).sort((a, b) => b.createdAt - a.createdAt);
      for (const point of points.slice(20)) store.delete(point.id);
    };
  }
  await done;
}
export async function listRecoveryPoints(id: string): Promise<RecoveryPoint[]> {
  const db = await openDatabase();
  const request = db.transaction('recovery', 'readonly').objectStore('recovery').index('projectId').getAll(id);
  const points = await new Promise<RecoveryPoint[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return points.sort((a, b) => b.createdAt - a.createdAt);
}
export async function addRestoredDocuments(incoming: TextDocument[], existingIds: Set<string>): Promise<TextDocument[]> {
  const documents = incoming.map((document) => {
    const copy = structuredClone(document);
    if (existingIds.has(copy.id)) copy.id = crypto.randomUUID();
    existingIds.add(copy.id); return copy;
  });
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readwrite');
  const done = transactionDone(tx);
  for (const document of documents) tx.objectStore('projects').add(document);
  await done; return documents;
}
