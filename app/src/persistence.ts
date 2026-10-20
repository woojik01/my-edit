export interface Project {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  cursor: number;
}

export interface RecoveryPoint {
  id: string;
  projectId: string;
  content: string;
  createdAt: number;
}

const DB_NAME = 'my-edit-local';
const DB_VERSION = 1;
const MAX_RECOVERY_POINTS = 20;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('recovery')) {
        const recovery = db.createObjectStore('recovery', { keyPath: 'id' });
        recovery.createIndex('projectId', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('저장소를 열 수 없습니다.'));
    request.onblocked = () => reject(new Error('다른 탭에서 저장소를 업데이트하고 있습니다.'));
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('저장에 실패했습니다.'));
  });
}

export async function listProjects(includeDeleted = false): Promise<Project[]> {
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readonly');
  const rows = await requestResult(tx.objectStore('projects').getAll()) as Project[];
  return rows
    .filter((project) => includeDeleted || project.deletedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await openDatabase();
  return requestResult(db.transaction('projects', 'readonly').objectStore('projects').get(id));
}

export async function createProject(name = '새 HTML', content = starterHtml()): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(), name, content, createdAt: now, updatedAt: now, deletedAt: null, cursor: 0
  };
  const db = await openDatabase();
  await requestResult(db.transaction('projects', 'readwrite').objectStore('projects').add(project));
  return project;
}

export async function saveProject(project: Project, recoveryContent?: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(recoveryContent !== undefined ? ['projects', 'recovery'] : ['projects'], 'readwrite');
  tx.objectStore('projects').put({ ...project, updatedAt: Date.now() });
  if (recoveryContent !== undefined) {
    const store = tx.objectStore('recovery');
    const point: RecoveryPoint = {
      id: crypto.randomUUID(), projectId: project.id, content: recoveryContent, createdAt: Date.now()
    };
    store.add(point);
    const request = store.index('projectId').getAll(project.id);
    request.onsuccess = () => {
      const points = (request.result as RecoveryPoint[]).sort((a, b) => b.createdAt - a.createdAt);
      points.slice(MAX_RECOVERY_POINTS).forEach((oldPoint) => store.delete(oldPoint.id));
    };
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('저장에 실패했습니다.'));
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소되었습니다.'));
  });
}

export async function listRecoveryPoints(projectId: string): Promise<RecoveryPoint[]> {
  const db = await openDatabase();
  const rows = await requestResult(db.transaction('recovery', 'readonly').objectStore('recovery').index('projectId').getAll(projectId)) as RecoveryPoint[];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const project = await getProject(id);
  if (!project) throw new Error('문서를 찾을 수 없습니다.');
  project.name = name.trim() || '제목 없음';
  await saveProject(project);
}

export async function softDeleteProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) return;
  project.deletedAt = Date.now();
  await saveProject(project);
}

export async function restoreProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) return;
  project.deletedAt = null;
  await saveProject(project);
}

export async function replaceAllProjects(projects: Project[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readwrite');
  const store = tx.objectStore('projects');
  for (const project of projects) store.put(project);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('백업을 가져오지 못했습니다.'));
    tx.onabort = () => reject(tx.error ?? new Error('백업 가져오기가 취소되었습니다.'));
  });
}

export function starterHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>나의 첫 페이지</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { min-height: 100vh; display: grid; place-content: center; margin: 0; background: #f5f6ef; color: #20231a; }
    main { max-width: 36rem; padding: 2rem; }
    h1 { font-size: clamp(2rem, 8vw, 4rem); letter-spacing: -.06em; }
    button { border: 0; border-radius: 999px; padding: .8rem 1.1rem; background: #d7f36b; font: inherit; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <p>My Edit에서 만든 첫 페이지</p>
    <h1>여기서 시작해요.</h1>
    <button id="hello">눌러 보기</button>
    <p id="message"></p>
  </main>
  <script>
    document.querySelector('#hello').addEventListener('click', () => {
      document.querySelector('#message').textContent = 'HTML, CSS, JavaScript가 잘 실행돼요!';
    });
  </script>
</body>
</html>`;
}
