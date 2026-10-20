import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { searchKeymap, openSearchPanel } from '@codemirror/search';
import { registerSW } from 'virtual:pwa-register';
import {
  createProject, getProject, listProjects, listRecoveryPoints,
  renameProject, replaceAllProjects, restoreProject, saveProject, softDeleteProject, starterHtml
} from './persistence';
import type { Project } from './persistence';
import './styles.css';

type Status = 'saved' | 'saving' | 'error';

const root = document.querySelector<HTMLDivElement>('#app')!;
let projects: Project[] = [];
let currentProject: Project | null = null;
let editorView: EditorView | null = null;
let saveTimer = 0;
let lastPersistedContent = '';
let lastRecoveryAt = 0;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
let installPrompt: BeforeInstallPromptEvent | null = null;
let offlineCacheReady = false;
let toastTimer = 0;
let previewMessages: Array<{ type: string; message: string; time: string }> = [];

const icon = (name: string) => {
  const paths: Record<string, string> = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/><path d="M20 12H9"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 15V3m0 0 5 5m-5-5L7 8"/><path d="M5 20h14"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/>',
    file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>`;
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function dateLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function showToast(message: string, action?: { label: string; run: () => void }) {
  let toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.append(toast);
  }
  toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  toast.classList.add('is-visible');
  if (action) toast.querySelector('button')?.addEventListener('click', action.run);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove('is-visible'), 3600);
}

function statusMarkup(status: Status): string {
  if (status === 'saving') return '<span class="status-dot is-saving"></span><span>저장 중</span>';
  if (status === 'error') return '<span class="status-dot is-error"></span><span>저장 실패</span>';
  return `<span class="status-dot"></span><span>저장됨</span>`;
}

function renderHome() {
  editorView?.destroy();
  editorView = null;
  const visible = projects.filter((project) => project.deletedAt === null);
  const trashed = projects.filter((project) => project.deletedAt !== null);
  root.innerHTML = `
    <div class="app-shell home-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="My Edit 홈"><span class="brand-mark">${icon('code')}</span><span>My Edit</span></a>
        <div class="topbar-right"><span class="offline-pill"><i></i><span id="connection-label">오프라인 준비 중</span></span><button class="install-button" data-action="install" aria-label="My Edit 앱 설치" title="My Edit 앱 설치">${icon('download')}<span>앱 설치</span></button></div>
      </header>
      <main class="home-content">
        <section class="hero">
          <div class="hero-copy"><span class="eyebrow">YOUR POCKET CODE SPACE</span><h1>생각을 적고,<br><em>바로 만들어봐.</em></h1><p>HTML을 쓰고 실행해 보세요.<br>내 문서는 이 기기에 저장돼요.</p></div>
          <button class="create-card" data-action="new"><span class="create-icon">${icon('plus')}</span><span><b>새 문서</b><small>빈 HTML에서 시작</small></span><span class="create-arrow">↗</span></button>
          <div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><span class="hero-code">&lt; / &gt;</span>
        </section>
        <section class="documents-section">
          <div class="section-heading"><div><span class="eyebrow">ON THIS DEVICE</span><h2>내 문서 <span>${visible.length}</span></h2></div><button class="search-toggle" data-action="toggle-search" aria-label="문서 검색">${icon('search')}</button></div>
          <label class="search-field" id="doc-search-wrap" hidden>${icon('search')}<input id="doc-search" type="search" placeholder="문서 이름 검색" autocomplete="off"></label>
          ${visible.length ? `<div class="document-grid" id="document-grid">${visible.map((project, index) => `
            <article class="document-card" data-open="${esc(project.id)}" style="--card-index:${index}">
              <div class="document-preview"><span class="preview-tag">HTML</span><span class="preview-spark">✳</span><pre>${esc(project.content.replace(/\s+/g, ' ').slice(0, 120))}</pre><span class="preview-lines"></span></div>
              <div class="document-meta"><div><h3>${esc(project.name)}</h3><p>수정 ${dateLabel(project.updatedAt)}</p></div><button class="card-menu" data-action="project-menu" data-id="${esc(project.id)}" aria-label="${esc(project.name)} 메뉴">${icon('more')}</button></div>
            </article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-glyph">${icon('file')}</span><b>아직 문서가 없어요</b><p>새 문서를 만들어 코드를 적어보세요.</p><button class="text-button" data-action="new">첫 문서 만들기 ${icon('plus')}</button></div>`}
          ${trashed.length ? `<button class="trash-link" data-action="trash">${icon('trash')} 휴지통 <span>${trashed.length}</span></button>` : ''}
        </section>
        <footer class="home-footer"><span>기기에 저장 · 인터넷 없이 편집 가능</span><span>MY EDIT <i>v0.1</i></span></footer>
      </main>
    </div>`;
  updateConnectionLabel();
}

function renderEditor(project: Project) {
  editorView?.destroy();
  currentProject = project;
  lastPersistedContent = project.content;
  lastRecoveryAt = Date.now();
  previewMessages = [];
  root.innerHTML = `
    <div class="app-shell editor-shell">
      <header class="editor-topbar">
        <button class="back-button" data-action="back" aria-label="내 문서로">${icon('back')}<span>내 문서</span></button>
        <div class="editor-title"><button data-action="rename" title="문서 이름 변경">${esc(project.name)} <span class="rename-mark">${icon('more')}</span></button><div class="save-status" id="save-status">${statusMarkup('saved')}</div></div>
        <div class="editor-actions"><button class="tool-button find-button" data-action="find" aria-label="코드 찾기">${icon('search')}<span>찾기</span></button><button class="tool-button export-button" data-action="export" aria-label="HTML 내보내기">${icon('download')}<span>내보내기</span></button><button class="icon-button menu-button" data-action="more" aria-label="더 보기">${icon('more')}</button></div>
      </header>
      <main class="workspace">
        <section class="code-pane" id="code-pane"><div class="pane-heading"><div><span class="pane-index">01</span><b>편집기</b><span class="file-label">index.html</span></div><button class="pane-action" data-action="find" aria-label="찾기">⌕</button></div><div class="editor-container" id="editor-container"></div><div class="editor-footer"><span id="cursor-label">HTML · UTF-8</span><span id="char-count">0자</span></div></section>
        <section class="preview-pane" id="preview-pane"><div class="pane-heading preview-heading"><div><span class="pane-index">02</span><b>미리보기</b></div><div class="preview-tools"><select id="preview-width" aria-label="미리보기 너비"><option value="100%">화면에 맞춤</option><option value="390px">모바일</option><option value="768px">태블릿</option><option value="1280px">넓은 화면</option></select><button class="pane-action" data-action="run" aria-label="다시 실행">${icon('refresh')}</button></div></div><div class="preview-stage"><div class="preview-device" id="preview-device"><iframe id="preview-frame" title="HTML 미리보기" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe></div></div><div class="console-panel" id="console-panel"><div class="console-heading"><span><i class="console-dot"></i> 실행 로그 <b id="log-count">0</b></span><button data-action="clear-console">지우기</button></div><div class="console-output" id="console-output"><p class="console-empty">실행 결과와 오류가 여기에 표시돼요.</p></div></div></section>
      </main>
      <nav class="mobile-tabs" aria-label="작업 화면"><button class="is-active" data-action="tab-code">${icon('code')}<span>편집</span></button><button data-action="tab-preview">${icon('eye')}<span>미리보기</span></button></nav>
      <div class="action-sheet" id="action-sheet" hidden><button data-action="import">${icon('upload')}<span>HTML 파일 가져오기</span></button><button data-action="backup-export">${icon('folder')}<span>전체 백업 내보내기</span></button><button data-action="backup-import">${icon('restore')}<span>백업 복원</span></button><button data-action="recovery">${icon('restore')}<span>이전 버전 복구</span></button><button data-action="delete">${icon('trash')}<span>문서 삭제</span></button></div>
      <input type="file" id="html-input" accept=".html,.htm,text/html" hidden><input type="file" id="backup-input" accept=".json,application/json" hidden>
    </div>`;
  mountCodeEditor(project);
  runPreview(project.content);
  updateConnectionLabel();
}

function editorTheme() {
  return EditorView.theme({
    '&': { color: '#e6e8e3', backgroundColor: '#14161a', height: '100%', fontSize: '14px' },
    '.cm-content': { caretColor: '#d7f36b', fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', padding: '18px 0 28px' },
    '.cm-line': { padding: '0 18px' },
    '.cm-gutters': { backgroundColor: '#14161a', color: '#5d625e', border: 'none', paddingRight: '8px' },
    '.cm-activeLine': { backgroundColor: '#1d2024' },
    '.cm-activeLineGutter': { color: '#d7f36b', backgroundColor: '#1d2024' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#d7f36b' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#48543a !important' },
    '.cm-tooltip': { backgroundColor: '#24272d', border: '1px solid #34383f', color: '#f2f3ef' },
    '.cm-panels': { backgroundColor: '#202329', color: '#e6e8e3' },
    '.cm-searchMatch': { backgroundColor: '#596e2c' },
    '.cm-searchMatch-selected': { backgroundColor: '#7d963d' }
  }, { dark: true });
}

function mountCodeEditor(project: Project) {
  const host = document.querySelector<HTMLDivElement>('#editor-container');
  if (!host) return;
  editorView = new EditorView({
    state: EditorState.create({
      doc: project.content,
      selection: { anchor: Math.min(project.cursor ?? 0, project.content.length) },
      extensions: [
        lineNumbers(), foldGutter(), history(), indentOnInput(), bracketMatching(), closeBrackets(),
        highlightActiveLine(), highlightActiveLineGutter(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        html({ autoCloseTags: true }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        editorTheme(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          queueSave();
          const count = document.querySelector('#char-count');
          if (count) count.textContent = `${update.state.doc.length.toLocaleString()}자`;
          const cursor = document.querySelector('#cursor-label');
          if (cursor) {
            const line = update.state.doc.lineAt(update.state.selection.main.head);
            cursor.textContent = `줄 ${line.number} · 열 ${update.state.selection.main.head - line.from + 1}`;
          }
        }),
        EditorView.domEventHandlers({
          blur: () => { if (currentProject && editorView) currentProject.cursor = editorView.state.selection.main.head; return false; }
        })
      ]
    }),
    parent: host
  });
  const count = document.querySelector('#char-count');
  if (count) count.textContent = `${project.content.length.toLocaleString()}자`;
}

function queueSave() {
  if (!currentProject || !editorView) return;
  currentProject.content = editorView.state.doc.toString();
  currentProject.cursor = editorView.state.selection.main.head;
  updateSaveStatus('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void persistCurrent(); }, 500);
}

function updateSaveStatus(status: Status) {
  const statusElement = document.querySelector('#save-status');
  if (statusElement) statusElement.innerHTML = statusMarkup(status);
}

async function persistCurrent(forceRecovery = false) {
  if (!currentProject) return;
  window.clearTimeout(saveTimer);
  if (editorView) {
    currentProject.content = editorView.state.doc.toString();
    currentProject.cursor = editorView.state.selection.main.head;
  }
  const priorContent = lastPersistedContent;
  const changed = priorContent !== currentProject.content;
  const shouldSnapshot = changed && (forceRecovery || Date.now() - lastRecoveryAt > 120_000);
  try {
    await saveProject(currentProject, shouldSnapshot ? priorContent : undefined);
    lastPersistedContent = currentProject.content;
    if (shouldSnapshot) lastRecoveryAt = Date.now();
    updateSaveStatus('saved');
  } catch (error) {
    updateSaveStatus('error');
    showToast(error instanceof Error ? error.message : '저장하지 못했어요. 공간을 확인해 주세요.');
  }
}

function injectPreviewBridge(source: string, token: string): string {
  const bridge = `<script>(function(){const t=${JSON.stringify(token)};function send(type,args){try{parent.postMessage({myEdit:t,type:type,message:Array.from(args).map(function(v){try{return typeof v==='string'?v:JSON.stringify(v)}catch(_){return String(v)}}).join(' ')} , '*')}catch(_){}}['log','info','warn','error'].forEach(function(k){const o=console[k].bind(console);console[k]=function(){send(k,arguments);o.apply(console,arguments)}});addEventListener('error',function(e){send('error',[e.message+' ('+e.lineno+':'+e.colno+')'])});addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise: '+(e.reason&&e.reason.message||e.reason)])})})()</script>`;
  if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, (match) => `${match}${bridge}`);
  return `<head>${bridge}</head>${source}`;
}

function runPreview(source: string) {
  const frame = document.querySelector<HTMLIFrameElement>('#preview-frame');
  if (!frame) return;
  previewMessages = [];
  renderConsole();
  const token = crypto.randomUUID();
  frame.dataset.token = token;
  frame.srcdoc = injectPreviewBridge(source, token);
}

function renderConsole() {
  const output = document.querySelector<HTMLDivElement>('#console-output');
  const count = document.querySelector('#log-count');
  if (!output || !count) return;
  count.textContent = String(previewMessages.length);
  output.innerHTML = previewMessages.length
    ? previewMessages.map((entry) => `<div class="console-entry is-${esc(entry.type)}"><span>${esc(entry.type)}</span><code>${esc(entry.message)}</code><time>${esc(entry.time)}</time></div>`).join('')
    : '<p class="console-empty">실행 결과와 오류가 여기에 표시돼요.</p>';
  output.scrollTop = output.scrollHeight;
}

function setMobileTab(tab: 'code' | 'preview') {
  document.querySelector('#code-pane')?.classList.toggle('mobile-active', tab === 'code');
  document.querySelector('#preview-pane')?.classList.toggle('mobile-active', tab === 'preview');
  document.querySelector('[data-action="tab-code"]')?.classList.toggle('is-active', tab === 'code');
  document.querySelector('[data-action="tab-preview"]')?.classList.toggle('is-active', tab === 'preview');
}

function updateConnectionLabel() {
  const label = document.querySelector('#connection-label');
  if (!label) return;
  const ready = offlineCacheReady || Boolean(navigator.serviceWorker?.controller);
  label.textContent = ready ? (navigator.onLine ? '오프라인 준비 완료' : '오프라인으로 사용 중') : (navigator.onLine ? '오프라인 준비 중' : '연결 필요');
  label.parentElement?.classList.toggle('is-ready', ready);
}

function showRenameDialog() {
  if (!currentProject) return;
  document.querySelector('#rename-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'rename-dialog';
  dialog.className = 'my-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-content" id="rename-form"><span class="eyebrow">DOCUMENT NAME</span><h2>문서 이름 바꾸기</h2><label class="input-label">이름<input name="name" maxlength="60" value="${esc(currentProject.name)}" required></label><div class="dialog-actions"><button class="button-secondary" value="cancel">취소</button><button class="button-primary" value="save">저장</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = new FormData(form).get('name')?.toString() ?? '';
    try {
      await renameProject(currentProject!.id, name);
      currentProject!.name = name.trim() || '제목 없음';
      dialog.close();
      renderEditor(currentProject!);
      showToast('이름을 바꿨어요.');
    } catch { showToast('이름을 변경하지 못했어요.'); }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>('input')?.select();
}

async function showRecoveryDialog() {
  if (!currentProject) return;
  await persistCurrent();
  const points = await listRecoveryPoints(currentProject.id);
  const dialog = document.createElement('dialog');
  dialog.className = 'my-dialog';
  dialog.innerHTML = `<div class="dialog-content"><span class="eyebrow">RECOVERY</span><h2>이전 버전 복구</h2><p class="dialog-copy">최근 저장된 복구 지점이에요. 복원하면 현재 내용은 새 복구 지점으로 보관해요.</p>${points.length ? `<div class="recovery-list">${points.map((point, i) => `<button class="recovery-item" data-recovery="${i}"><span>${icon('restore')}<b>${dateLabel(point.createdAt)}</b></span><small>${esc(point.content.replace(/\s+/g, ' ').slice(0, 88) || '(빈 문서)')}</small></button>`).join('')}</div>` : '<div class="empty-mini">아직 복구 지점이 없어요.<br>문서를 2분 이상 수정하면 이전 내용이 보관돼요.</div>'}<div class="dialog-actions"><button class="button-secondary" data-action="close-dialog">닫기</button></div></div>`;
  document.body.append(dialog);
  dialog.querySelector('[data-action="close-dialog"]')?.addEventListener('click', () => dialog.close());
  dialog.querySelectorAll<HTMLButtonElement>('[data-recovery]').forEach((button) => button.addEventListener('click', async () => {
    const point = points[Number(button.dataset.recovery)];
    if (!currentProject || !point) return;
    await persistCurrent(true);
    currentProject.content = point.content;
    currentProject.cursor = 0;
    await saveProject(currentProject);
    dialog.close();
    renderEditor(currentProject);
    showToast('이전 버전으로 복구했어요.');
  }));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function showTrashDialog() {
  const trashed = await listProjects(true).then((items) => items.filter((item) => item.deletedAt !== null));
  const dialog = document.createElement('dialog');
  dialog.className = 'my-dialog';
  dialog.innerHTML = `<div class="dialog-content"><span class="eyebrow">TRASH</span><h2>휴지통</h2>${trashed.length ? `<div class="recovery-list">${trashed.map((item) => `<div class="recovery-item trash-item"><span><b>${esc(item.name)}</b><button class="text-button" data-restore="${esc(item.id)}">복원</button></span><small>삭제 ${dateLabel(item.deletedAt!)}</small></div>`).join('')}</div>` : '<div class="empty-mini">휴지통이 비어 있어요.</div>'}<div class="dialog-actions"><button class="button-secondary" data-action="close-dialog">닫기</button></div></div>`;
  document.body.append(dialog);
  dialog.querySelector('[data-action="close-dialog"]')?.addEventListener('click', () => dialog.close());
  dialog.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((button) => button.addEventListener('click', async () => {
    await restoreProject(button.dataset.restore!);
    projects = await listProjects(true);
    dialog.close();
    renderHome();
    showToast('문서를 복원했어요.');
  }));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function newDocument() {
  const project = await createProject();
  projects = await listProjects(true);
  renderEditor(project);
}

async function exportHtml() {
  if (!currentProject) return;
  const filename = `${currentProject.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'my-edit'}.html`;
  try {
    const showSaveFilePicker = (window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }> }>;
    }).showSaveFilePicker;
    // Open the native picker before awaiting IndexedDB so transient user activation is preserved.
    const handle = showSaveFilePicker
      ? await showSaveFilePicker.call(window, { suggestedName: filename, types: [{ description: 'HTML 문서', accept: { 'text/html': ['.html'] } }] })
      : undefined;
    await persistCurrent();
    const blob = new Blob([currentProject.content], { type: 'text/html;charset=utf-8' });
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    showToast('HTML 파일을 내보냈어요.');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    showToast('파일을 내보내지 못했어요.');
  }
}

async function importHtml(file: File) {
  try {
    const content = await file.text();
    const name = file.name.replace(/\.(html?|xhtml)$/i, '') || '가져온 문서';
    const project = await createProject(name, content);
    projects = await listProjects(true);
    renderEditor(project);
    showToast('HTML 파일을 가져왔어요.');
  } catch { showToast('HTML 파일을 읽지 못했어요.'); }
}

async function exportBackup() {
  try {
    await persistCurrent();
    const all = await listProjects(true);
    const payload = { format: 'my-edit-backup', version: 1, exportedAt: new Date().toISOString(), projects: all };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `my-edit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('전체 백업을 내보냈어요.');
  } catch { showToast('백업을 만들지 못했어요.'); }
}

async function importBackup(file: File) {
  try {
    const payload = JSON.parse(await file.text()) as { format?: string; version?: number; projects?: Project[] };
    if (payload.format !== 'my-edit-backup' || payload.version !== 1 || !Array.isArray(payload.projects)) throw new Error('백업 형식이 올바르지 않습니다.');
    const incoming = payload.projects.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.content === 'string');
    if (!incoming.length && payload.projects.length) throw new Error('가져올 수 있는 문서가 없습니다.');
    await replaceAllProjects(incoming);
    projects = await listProjects(true);
    showToast(`${incoming.length}개 문서를 가져왔어요.`);
    renderHome();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '백업 파일을 읽지 못했어요.');
  }
}

async function deleteCurrentProject() {
  if (!currentProject) return;
  await persistCurrent();
  const id = currentProject.id;
  await softDeleteProject(id);
  projects = await listProjects(true);
  currentProject = null;
  renderHome();
  showToast('휴지통으로 이동했어요.', { label: '되돌리기', run: () => { void restoreDeleted(id); } });
}

async function restoreDeleted(id: string) {
  await restoreProject(id);
  projects = await listProjects(true);
  renderHome();
  showToast('문서를 복원했어요.');
}

function filterDocuments(query: string) {
  document.querySelectorAll<HTMLElement>('.document-card').forEach((card) => {
    card.hidden = !card.textContent?.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
}

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const openCard = target.closest<HTMLElement>('[data-open]');
  if (openCard && !target.closest('[data-action="project-menu"]')) {
    const project = await getProject(openCard.dataset.open!);
    if (project && project.deletedAt === null) renderEditor(project);
    return;
  }
  const button = target.closest<HTMLElement>('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  switch (action) {
    case 'new': await newDocument(); break;
    case 'back': await persistCurrent(); projects = await listProjects(true); currentProject = null; renderHome(); break;
    case 'run': if (editorView) runPreview(editorView.state.doc.toString()); break;
    case 'export': await exportHtml(); break;
    case 'rename': showRenameDialog(); break;
    case 'find': if (editorView) { setMobileTab('code'); openSearchPanel(editorView); } break;
    case 'more': document.querySelector('#action-sheet')?.toggleAttribute('hidden'); break;
    case 'import': document.querySelector<HTMLInputElement>('#html-input')?.click(); document.querySelector('#action-sheet')?.setAttribute('hidden', ''); break;
    case 'backup-export': await exportBackup(); document.querySelector('#action-sheet')?.setAttribute('hidden', ''); break;
    case 'backup-import': document.querySelector<HTMLInputElement>('#backup-input')?.click(); document.querySelector('#action-sheet')?.setAttribute('hidden', ''); break;
    case 'recovery': await showRecoveryDialog(); document.querySelector('#action-sheet')?.setAttribute('hidden', ''); break;
    case 'delete': await deleteCurrentProject(); document.querySelector('#action-sheet')?.setAttribute('hidden', ''); break;
    case 'clear-console': previewMessages = []; renderConsole(); break;
    case 'tab-code': setMobileTab('code'); break;
    case 'tab-preview': setMobileTab('preview'); break;
    case 'trash': await showTrashDialog(); break;
    case 'toggle-search': {
      const wrap = document.querySelector<HTMLElement>('#doc-search-wrap');
      if (wrap) { wrap.hidden = !wrap.hidden; if (!wrap.hidden) document.querySelector<HTMLInputElement>('#doc-search')?.focus(); }
      break;
    }
    case 'install': if (installPrompt) { await installPrompt.prompt(); installPrompt = null; } else showToast('브라우저 메뉴에서 "앱 설치"를 선택해 주세요.'); break;
    case 'close-dialog': (button.closest('dialog') as HTMLDialogElement | null)?.close(); break;
    case 'project-menu': {
      const project = await getProject(button.dataset.id!);
      if (project) {
        const choice = window.prompt(`"${project.name}" 문서\n\n이름 변경: 새 이름 입력\n삭제: !delete 입력`);
        if (choice === null) break;
        if (choice.trim() === '!delete') {
          await softDeleteProject(project.id);
          projects = await listProjects(true);
          renderHome();
          showToast('휴지통으로 이동했어요.');
        } else if (choice.trim()) {
          await renameProject(project.id, choice);
          projects = await listProjects(true);
          renderHome();
          showToast('문서 이름을 바꿨어요.');
        }
      }
      break;
    }
  }
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'doc-search') filterDocuments(target.value);
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.id === 'html-input' && target instanceof HTMLInputElement && target.files?.[0]) {
    void importHtml(target.files[0]);
    target.value = '';
  }
  if (target.id === 'backup-input' && target instanceof HTMLInputElement && target.files?.[0]) {
    void importBackup(target.files[0]);
    target.value = '';
  }
  if (target.id === 'preview-width') {
    const device = document.querySelector<HTMLElement>('#preview-device');
    if (device && target instanceof HTMLSelectElement) device.style.setProperty('--device-width', target.value);
  }
});

window.addEventListener('message', (event: MessageEvent) => {
  const frame = document.querySelector<HTMLIFrameElement>('#preview-frame');
  if (!frame || event.source !== frame.contentWindow || event.data?.myEdit !== frame.dataset.token) return;
  const message = event.data as { type: string; message: string };
  previewMessages.push({ type: message.type, message: String(message.message).slice(0, 1200), time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  if (previewMessages.length > 100) previewMessages.shift();
  renderConsole();
});

window.addEventListener('online', updateConnectionLabel);
window.addEventListener('offline', updateConnectionLabel);
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event as BeforeInstallPromptEvent; });
window.addEventListener('pagehide', () => { if (currentProject) void persistCurrent(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && currentProject) void persistCurrent(); });

async function start() {
  try {
    projects = await listProjects(true);
    const active = projects.filter((project) => project.deletedAt === null);
    if (!projects.length) {
      await createProject('시작하기', starterHtml());
      projects = await listProjects(true);
    }
    renderHome();
    if ('storage' in navigator && 'persist' in navigator.storage) void navigator.storage.persist();
    updateServiceWorker = registerSW({
      onOfflineReady() { offlineCacheReady = true; updateConnectionLabel(); showToast('My Edit을 오프라인에서 사용할 수 있어요.'); },
      onNeedRefresh() { showToast('업데이트가 준비됐어요.', { label: '지금 적용', run: () => { void (async () => { await persistCurrent(); await updateServiceWorker?.(true); })(); } }); },
      onRegisteredSW(_url, registration) {
        updateConnectionLabel();
        if (registration) window.setInterval(() => { if (navigator.onLine) void registration.update(); }, 60 * 60 * 1000);
      },
      onRegisterError() { showToast('오프라인 기능을 준비하지 못했어요. 새로고침해 주세요.'); }
    });
    if (!active.length) showToast('시작하기 문서를 열어 편집을 시작해 보세요.');
  } catch (error) {
    root.innerHTML = `<main class="fatal-error"><b>저장 공간을 열 수 없어요.</b><p>${esc(error instanceof Error ? error.message : '브라우저 저장소를 확인해 주세요.')}</p><button class="button-primary" onclick="location.reload()">다시 시도</button></main>`;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

void start();
