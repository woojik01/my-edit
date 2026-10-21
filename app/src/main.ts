import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment } from '@codemirror/commands';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { registerSW } from 'virtual:pwa-register';
import { createBackup, newDocument, parseBackup } from './documents.ts';
import type { TextDocument } from './documents.ts';
import { decodeText, encodeText, FileReadError, formatBytes, HIGHLIGHT_LIMIT, MAX_FILE_BYTES, READ_ENCODINGS, validateFileName } from './files.ts';
import type { DecodedText, LineEnding, TextEncoding } from './files.ts';
import { detectLanguage, fileBadge, languageDescriptions, languageLabel } from './languages.ts';
import { addRestoredDocuments, listDocuments, listRecoveryPoints, saveDocument } from './persistence.ts';
import { canPickOpenFiles, canPickSaveFile, downloadBytes, pickOpenFiles, pickSaveFile } from './native-files.ts';
import type { LocalFileHandle } from './native-files.ts';
import './styles.css';

type SaveStatus = 'saved' | 'saving' | 'error';
interface Settings { wrap: boolean; indent: string; fontSize: number }
interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const root = document.querySelector<HTMLDivElement>('#app')!;
const docs = new Map<string, TextDocument>();
const states = new Map<string, EditorState>();
const statuses = new Map<string, SaveStatus>();
const timers = new Map<string, number>();
const writes = new Map<string, Promise<void>>();
const persistedContent = new Map<string, string>();
const recoveryTimes = new Map<string, number>();
const handles = new Map<string, { handle: LocalFileHandle; modified: number }>();
const languageLoads = new Map<string, number>();
const diskWrites = new Set<string>();
const modeCompartment = new Compartment();
const wrapCompartment = new Compartment();
const indentCompartment = new Compartment();
let settings: Settings = { wrap: false, indent: '  ', fontSize: 14 };
let openIds: string[] = [];
let activeId: string | null = null;
let view: EditorView | null = null;
let offlineReady = false;
let installPrompt: BeforeInstallPromptEvent | null = null;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
let toastTimer = 0;
let importBusy = false;
let explorerQuery = '';

const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const icon = (name: string): string => {
  const paths: Record<string, string> = {
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
    folder: '<path d="M3 7V5h6l3 3h9v12H3z"/><path d="m3 11 2-3"/>',
    save: '<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/>',
    redo: '<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>`;
};
function readPreference(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function saveSession() {
  try { localStorage.setItem('my-edit-session-v2', JSON.stringify({ openIds, activeId })); } catch { /* Editing works without localStorage. */ }
}
function current(): TextDocument | undefined { return activeId ? docs.get(activeId) : undefined; }
function dirty(doc: TextDocument): boolean { return doc.exportedRevision !== doc.revision; }
function toast(message: string, action?: { label: string; run: () => void }) {
  const host = document.querySelector<HTMLDivElement>('#toast')!;
  host.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  host.classList.add('visible');
  if (action) host.querySelector('button')!.onclick = action.run;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host.classList.remove('visible'), action ? 12_000 : 4500);
}
function task(operation: () => void | Promise<void>) {
  try { Promise.resolve(operation()).catch(reportError); } catch (error) { reportError(error); }
}
function reportError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  toast(error instanceof Error ? error.message : '작업을 완료하지 못했어요.');
}
function dialog(title: string, content: string, wide = false): HTMLDialogElement {
  const element = document.createElement('dialog');
  element.className = `dialog${wide ? ' wide-dialog' : ''}`;
  element.innerHTML = `<header><div><span class="eyebrow">MY EDIT</span><h2>${esc(title)}</h2></div><button class="icon-button" data-dismiss aria-label="닫기">${icon('close')}</button></header>${content}`;
  element.querySelector('[data-dismiss]')!.addEventListener('click', () => element.close());
  element.addEventListener('close', () => element.remove(), { once: true });
  document.body.append(element); element.showModal(); return element;
}
function renderShell() {
  root.innerHTML = `
  <div class="workbench">
    <header class="app-header">
      <button class="icon-button sidebar-toggle" data-action="sidebar" aria-label="파일 목록 열기">${icon('menu')}</button>
      <a class="brand" href="#" data-action="welcome"><span class="brand-icon">${icon('code')}</span>My Edit <span class="version">0.2</span></a>
      <span class="header-divider"></span><span class="app-description">CODE & TEXT EDITOR</span>
      <div class="header-end"><span class="offline-status" id="offline-status" role="status">오프라인 준비 중</span><button class="install-button" id="update-ready" data-action="apply-update" hidden>업데이트 적용</button><button class="install-button" data-action="install">${icon('download')}<span>앱 설치</span></button></div>
    </header>
    <button class="sidebar-scrim" data-action="sidebar" aria-label="파일 목록 닫기" tabindex="-1"></button>
    <aside class="sidebar" aria-label="작업공간 파일">
      <div class="sidebar-heading"><div><span class="eyebrow">ON THIS DEVICE</span><h1>작업공간 <span id="file-count">0</span></h1></div><button class="icon-button" data-action="new" aria-label="새 파일 만들기">${icon('plus')}</button></div>
      <div class="workspace-actions"><button data-action="open">${icon('folder')}파일 열기</button><button data-action="new">${icon('plus')}새 파일</button></div>
      <label class="file-search">${icon('search')}<input id="file-search" type="search" placeholder="파일 이름으로 찾기" aria-label="작업공간 파일 검색" autocomplete="off"></label>
      <div class="file-list" id="file-list"></div>
      <div class="sidebar-footer"><button data-action="backup-export">${icon('download')}작업공간 백업</button><button data-action="trash">${icon('trash')}휴지통 <span id="trash-count"></span></button><p>파일은 이 기기에 보관돼요.<br>원본 파일 저장은 저장 버튼을 눌러 주세요.</p></div>
    </aside>
    <main class="main-area">
      <div class="tabs-bar"><div class="file-tabs" id="file-tabs" role="tablist" aria-label="열린 파일"></div><button class="icon-button new-tab-button" data-action="new" aria-label="새 파일 탭">${icon('plus')}</button></div>
      <div class="editor-toolbar"><div class="breadcrumb" id="breadcrumb">작업공간 <span>/</span> 시작</div><div class="toolbar-actions">
        <button class="icon-button desktop-tool" data-action="undo" title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">${icon('undo')}</button><button class="icon-button desktop-tool" data-action="redo" title="다시 실행" aria-label="다시 실행">${icon('redo')}</button>
        <button class="icon-button" data-action="find" title="찾기 / 바꾸기 (Ctrl+F)" aria-label="찾기 및 바꾸기">${icon('search')}</button>
        <button class="save-button" data-action="save" id="save-button">${icon('save')}<span>파일 저장</span></button>
        <button class="icon-button" data-action="more" aria-label="파일 및 편집 메뉴" aria-expanded="false">${icon('more')}</button>
      </div></div>
      <section class="welcome" id="welcome"><div class="welcome-mark">${icon('code')}<i></i></div><span class="eyebrow">YOUR WORDS. YOUR CODE. YOUR FILES.</span><h2>어떤 텍스트든,<br><em>여기서 시작.</em></h2><p>코드, 메모, 설정 파일까지.<br>확장자에 구애받지 않고 열고, 만들고, 편집하세요.</p>
        <div class="welcome-actions"><button class="primary-button" data-action="new">${icon('plus')}새 파일 만들기</button><button class="secondary-button" data-action="open">${icon('folder')}파일 열기</button></div>
        <div class="format-chips"><span>.py</span><span>.js</span><span>.json</span><span>.txt</span><span>.md</span><span>.env</span><span>…</span></div>
        <div class="welcome-notes"><span><i></i>인터넷 없이 편집</span><span>${languageDescriptions.length}개 언어 모드</span><span>자동 보관 · 파일로 저장</span></div>
      </section>
      <section class="editor-stage" id="editor-stage" aria-label="파일 편집기" hidden><div id="editor"></div><div class="large-file-note" id="large-file-note" hidden>큰 파일은 문법 강조를 끄고 편집해요.</div></section>
      <footer class="statusbar"><span class="local-status" id="local-status" role="status">로컬 작업공간</span><div class="status-tools"><button data-action="goto" id="cursor-status">줄 1, 열 1</button><button data-action="settings" id="indent-status">공백: 2</button><button data-action="format" id="encoding-status">UTF-8</button><button data-action="format" id="ending-status">LF</button><button data-action="language" id="language-status">일반 텍스트</button><span id="length-status"></span></div></footer>
    </main>
    <div class="drop-overlay" id="drop-overlay"><span>${icon('folder')}</span><b>텍스트 파일을 여기에 놓으세요</b><p>여러 파일을 한 번에 열 수 있어요.</p></div>
    <div id="file-menu" class="file-menu" hidden></div>
    <input type="file" id="file-input" multiple hidden><input type="file" id="backup-input" accept=".json,application/json" hidden>
  </div><div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  document.documentElement.style.setProperty('--editor-font', `${settings.fontSize}px`);
  document.querySelector('#file-search')!.addEventListener('input', (event) => { explorerQuery = (event.target as HTMLInputElement).value; renderExplorer(); });
}
function renderExplorer() {
  const visible = [...docs.values()].filter((doc) => doc.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = visible.filter((doc) => doc.name.toLocaleLowerCase().includes(explorerQuery.toLocaleLowerCase()));
  document.querySelector('#file-count')!.textContent = String(visible.length);
  const deleted = [...docs.values()].filter((doc) => doc.deletedAt !== null).length;
  document.querySelector('#trash-count')!.textContent = deleted ? String(deleted) : '';
  document.querySelector('#file-list')!.innerHTML = filtered.length ? filtered.map((doc) => `
    <button class="file-row${doc.id === activeId ? ' active' : ''}" data-open="${esc(doc.id)}" title="${esc(doc.name)}"><span class="file-badge" data-ext="${esc(doc.name.split('.').pop()?.toLowerCase() ?? '')}">${esc(fileBadge(doc.name))}</span><span class="file-name">${esc(doc.name)}</span><i class="dirty-dot" data-dirty="${esc(doc.id)}"${dirty(doc) ? '' : ' hidden'} title="원본 파일에 저장하지 않은 변경"></i></button>`).join('')
    : `<div class="empty-files">${explorerQuery ? '일치하는 파일이 없어요.' : '새 파일을 만들거나<br>기기의 텍스트 파일을 열어 보세요.'}</div>`;
}
function renderTabs() {
  document.querySelector('#file-tabs')!.innerHTML = openIds.map((id) => {
    const doc = docs.get(id)!;
    return `<div class="file-tab${id === activeId ? ' active' : ''}"><button role="tab" aria-selected="${id === activeId}" class="tab-open" data-open="${esc(id)}" title="${esc(doc.name)}"><span class="file-badge">${esc(fileBadge(doc.name))}</span><span>${esc(doc.name)}</span><i class="dirty-dot" data-dirty="${esc(id)}"${dirty(doc) ? '' : ' hidden'}></i></button><button class="tab-close" data-close="${esc(id)}" aria-label="${esc(doc.name)} 탭 닫기">${icon('close')}</button></div>`;
  }).join('');
  document.querySelector('.file-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function refreshStatus() {
  const doc = current();
  document.querySelector('#breadcrumb')!.innerHTML = doc ? `<span>작업공간 /</span> ${esc(doc.name)}` : '작업공간 <span>/ 시작</span>';
  document.title = doc ? `${dirty(doc) ? '● ' : ''}${doc.name} — My Edit` : 'My Edit — Code & Text Editor';
  const status = doc ? statuses.get(doc.id) ?? 'saved' : 'saved';
  const label = document.querySelector('#local-status')!;
  label.className = `local-status ${status}`;
  label.textContent = doc ? status === 'saving' ? '앱에 보관 중…' : status === 'error' ? '앱 보관 실패 · 파일로 저장하세요' : dirty(doc) ? '앱에 보관됨 · 파일 저장 필요' : '앱에 보관됨' : '로컬 작업공간';
  const save = document.querySelector<HTMLButtonElement>('#save-button')!;
  save.disabled = !doc || diskWrites.has(doc.id);
  save.title = canPickSaveFile() ? '파일로 저장 (Ctrl+S)' : '현재 이름으로 파일 내려받기 (Ctrl+S)';
  document.querySelector('#encoding-status')!.textContent = doc ? `${doc.encoding.toUpperCase().replace('UTF-16', 'UTF-16 ')}${doc.bom ? ' BOM' : ''}` : 'UTF-8';
  document.querySelector('#encoding-status')!.setAttribute('title', doc?.convertedFrom ? `${doc.convertedFrom}에서 읽음 · ${doc.encoding.toUpperCase()}로 저장` : '저장 인코딩 변경');
  document.querySelector('#ending-status')!.textContent = doc?.originalText !== undefined ? `혼합 → ${doc.lineEnding}` : doc?.lineEnding ?? 'LF';
  document.querySelector('#ending-status')!.setAttribute('title', doc?.originalText !== undefined ? '수정 전에는 원본 줄바꿈을 유지하고, 편집 후 표시된 방식으로 저장해요.' : '줄바꿈 형식');
  document.querySelector('#language-status')!.textContent = doc ? languageLabel(doc) : '일반 텍스트';
  document.querySelector('#indent-status')!.textContent = settings.indent === '\t' ? '탭: 4' : `공백: ${settings.indent.length}`;
  const large = Boolean(doc && doc.content.length > HIGHLIGHT_LIMIT);
  (document.querySelector('#large-file-note') as HTMLElement).hidden = !large;
  document.querySelectorAll<HTMLElement>('[data-dirty]').forEach((el) => { const item = docs.get(el.dataset.dirty!); el.hidden = !item || !dirty(item); });
  updateCursor();
}
function updateCursor() {
  const doc = current();
  if (!doc || !view) { document.querySelector('#length-status')!.textContent = ''; return; }
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  document.querySelector('#cursor-status')!.textContent = `줄 ${line.number}, 열 ${selection.head - line.from + 1}`;
  document.querySelector('#length-status')!.textContent = selection.empty ? `${view.state.doc.length.toLocaleString()}자` : `${Math.abs(selection.to - selection.from).toLocaleString()}자 선택`;
}
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c2a8f5' }, { tag: [tags.string, tags.special(tags.string)], color: '#b7d99a' },
  { tag: [tags.number, tags.bool, tags.null], color: '#efba8d' }, { tag: tags.comment, color: '#7e8a83', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#a9d7f0' },
  { tag: [tags.tagName, tags.typeName, tags.className], color: '#d7d78b' }, { tag: tags.attributeName, color: '#b7c5ed' },
  { tag: tags.heading, color: '#d7f36b', fontWeight: 'bold' }, { tag: tags.link, color: '#9bd7cf' }, { tag: tags.invalid, color: '#ff9c93' }
]);
const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#dce1db', backgroundColor: '#171b1c', fontSize: 'var(--editor-font)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { caretColor: '#d7f36b', padding: '20px 0 50px' }, '.cm-line': { padding: '0 22px' },
  '.cm-gutters': { backgroundColor: '#171b1c', color: '#56605b', border: 'none', padding: '0 8px 0 5px' },
  '.cm-activeLine': { backgroundColor: '#1e2424' }, '.cm-activeLineGutter': { color: '#bdcd8d', backgroundColor: '#1e2424' },
  '.cm-cursor': { borderLeftColor: '#d7f36b' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#3c4c3a !important' },
  '.cm-selectionMatch': { backgroundColor: '#384534' }, '.cm-tooltip': { backgroundColor: '#242c29', border: '1px solid #414b42' },
  '.cm-panels': { backgroundColor: '#222a27', color: '#e1e6db' }, '.cm-panel.cm-search': { padding: '10px', fontSize: '13px' },
  '.cm-textfield': { backgroundColor: '#141a18', color: '#edf0e6', border: '1px solid #4e5b4c', borderRadius: '4px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: '#343e32', color: '#e4ebd7', border: '1px solid #54604d', borderRadius: '4px' },
  '.cm-searchMatch': { backgroundColor: '#5b6030' }, '.cm-searchMatch-selected': { backgroundColor: '#717d3b' }
}, { dark: true });
function createEditorState(doc: TextDocument): EditorState {
  return EditorState.create({
    doc: doc.content, selection: { anchor: Math.min(doc.cursor, doc.content.length) },
    extensions: [lineNumbers(), foldGutter(), history(), indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
      drawSelection(), dropCursor(), highlightActiveLine(), highlightActiveLineGutter(), highlightSelectionMatches(), syntaxHighlighting(highlightStyle),
      modeCompartment.of([]), wrapCompartment.of(settings.wrap ? EditorView.lineWrapping : []),
      indentCompartment.of([indentUnit.of(settings.indent), EditorState.tabSize.of(settings.indent === '\t' ? 4 : settings.indent.length)]),
      keymap.of([
        { key: 'Mod-s', run: () => { task(() => saveFile()); return true; } },
        { key: 'Mod-Shift-s', run: () => { task(() => saveFile(true)); return true; } },
        { key: 'Mod-o', run: () => { task(() => chooseFiles()); return true; } },
        { key: 'Mod-g', run: () => { showGoto(); return true; } },
        { key: 'Mod-/', run: toggleComment },
        ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab
      ]), editorTheme,
      EditorView.contentAttributes.of({ 'aria-label': '파일 내용', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      EditorView.updateListener.of((update) => {
        const item = current(); if (!item) return;
        item.cursor = update.state.selection.main.head;
        if (update.docChanged) {
          const mixed = item.originalText !== undefined;
          item.content = update.state.doc.toString(); delete item.originalText;
          touch(item);
          if (mixed) toast(`혼합 줄바꿈은 편집 후 ${item.lineEnding}로 저장해요.`);
          if ((update.startState.doc.length > HIGHLIGHT_LIMIT) !== (update.state.doc.length > HIGHLIGHT_LIMIT)) queueMicrotask(() => task(() => configureLanguage(item.id)));
        } else if (update.selectionSet) { queuePersist(item.id); updateCursor(); }
      })]
  });
}
async function configureLanguage(id: string) {
  const doc = docs.get(id); if (!doc) return;
  const load = (languageLoads.get(id) ?? 0) + 1; languageLoads.set(id, load);
  const language = doc.content.length > HIGHLIGHT_LIMIT ? null : detectLanguage(doc);
  try {
    const support = language ? await language.load() : [];
    if (languageLoads.get(id) !== load) return;
    if (activeId === id && view) view.dispatch({ effects: modeCompartment.reconfigure(support) });
    else { const state = states.get(id); if (state) states.set(id, state.update({ effects: modeCompartment.reconfigure(support) }).state); }
  } catch { toast('언어 모드를 불러오지 못했어요. 일반 텍스트로 계속 편집할 수 있어요.'); }
}
function activate(id: string | null) {
  if (activeId && view) { states.set(activeId, view.state); const previous = current(); if (previous) { previous.cursor = view.state.selection.main.head; queuePersist(previous.id); } }
  if (id && (!docs.has(id) || docs.get(id)!.deletedAt !== null)) return;
  activeId = id;
  if (id && !openIds.includes(id)) openIds.push(id);
  (document.querySelector('#welcome') as HTMLElement).hidden = Boolean(id);
  (document.querySelector('#editor-stage') as HTMLElement).hidden = !id;
  if (id) {
    const state = states.get(id) ?? createEditorState(docs.get(id)!);
    if (view) view.setState(state); else view = new EditorView({ state, parent: document.querySelector('#editor')! });
    task(() => configureLanguage(id));
  }
  renderExplorer(); renderTabs(); refreshStatus(); saveSession();
  document.querySelector('.workbench')!.classList.remove('sidebar-open');
  if (id && matchMedia('(min-width: 761px)').matches) view?.focus();
}
function closeTab(id: string) {
  const index = openIds.indexOf(id); if (index < 0) return;
  task(() => persist(id));
  openIds = openIds.filter((openId) => openId !== id);
  if (activeId === id) activate(openIds[Math.min(index, openIds.length - 1)] ?? null); else { renderTabs(); saveSession(); }
  states.delete(id);
}
function touch(doc: TextDocument, affectsFile = true) {
  if (affectsFile) doc.revision++;
  doc.updatedAt = Date.now(); queuePersist(doc.id); refreshStatus();
}
function queuePersist(id: string) {
  window.clearTimeout(timers.get(id)); statuses.set(id, 'saving');
  timers.set(id, window.setTimeout(() => { timers.delete(id); task(() => persist(id)); }, 350));
  if (id === activeId) refreshStatus();
}
async function persist(id: string, forceRecovery = false): Promise<void> {
  window.clearTimeout(timers.get(id)); timers.delete(id);
  const doc = docs.get(id); if (!doc) return;
  const snapshot = structuredClone(doc); statuses.set(id, 'saving');
  const previousWrite = writes.get(id) ?? Promise.resolve();
  const write = previousWrite.catch(() => {}).then(async () => {
    const old = persistedContent.get(id);
    const snapshotDue = forceRecovery || (old !== undefined && old !== snapshot.content && Date.now() - (recoveryTimes.get(id) ?? 0) > 120_000);
    await saveDocument(snapshot, snapshotDue ? forceRecovery ? snapshot.content : old : undefined);
    persistedContent.set(id, snapshot.content);
    if (snapshotDue) recoveryTimes.set(id, Date.now());
    if (writes.get(id) === write && !timers.has(id)) statuses.set(id, 'saved');
  }).catch((error: unknown) => { statuses.set(id, 'error'); throw error; }).finally(() => { if (activeId === id) refreshStatus(); });
  writes.set(id, write); return write;
}
async function flushAll() { await Promise.all([...docs.keys()].filter((id) => statuses.get(id) !== 'saved').map((id) => persist(id))); }

function showNewFile(rename = false) {
  const target = rename ? current() : undefined;
  if (rename && !target) return;
  const element = dialog(rename ? '파일 이름 바꾸기' : '새 파일 만들기', `<form id="name-form"><label>확장자를 포함한 파일 이름<input id="name-input" name="name" value="${esc(target?.name ?? 'untitled.txt')}" maxlength="255" placeholder="예: main.py, .env, LICENSE" required autocomplete="off" spellcheck="false"></label><p class="dialog-help">원하는 확장자를 입력하세요. 확장자 없이 만들어도 돼요.</p><div class="name-examples">${['main.py', 'script.js', 'data.json', 'notes.md', '.env', 'LICENSE'].map((name) => `<button type="button" data-name="${name}">${name}</button>`).join('')}</div><p class="form-error" id="name-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary-button" data-cancel>취소</button><button class="primary-button" type="submit">${rename ? '이름 변경' : '만들기'} ${icon('arrow')}</button></div></form>`);
  const input = element.querySelector<HTMLInputElement>('#name-input')!;
  element.querySelector('[data-cancel]')!.addEventListener('click', () => element.close());
  element.querySelectorAll<HTMLButtonElement>('[data-name]').forEach((button) => button.onclick = () => { input.value = button.dataset.name!; input.focus(); });
  element.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    let name: string;
    try { name = validateFileName(input.value); } catch (error) { element.querySelector('#name-error')!.textContent = (error as Error).message; return; }
    if (target) { target.name = name; handles.delete(target.id); touch(target); renderExplorer(); renderTabs(); task(() => configureLanguage(target.id)); }
    else {
      const doc = newDocument(name); docs.set(doc.id, doc); activate(doc.id); task(() => persist(doc.id));
    }
    element.close(); view?.focus();
  });
  input.focus(); input.select();
}
function showReadOptions() {
  const element = dialog('인코딩을 지정해서 열기', `<form><label>원본 파일의 인코딩<select name="encoding">${READ_ENCODINGS.map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label><p class="dialog-help">UTF-8·UTF-16은 읽은 인코딩을 유지해요. 다른 인코딩은 내용을 확인한 뒤 UTF-8로 저장해요.</p><div class="dialog-actions"><button class="primary-button" type="submit">파일 선택 ${icon('folder')}</button></div></form>`);
  element.querySelector('form')!.addEventListener('submit', (event) => { event.preventDefault(); const encoding = element.querySelector('select')!.value; element.close(); task(() => chooseFiles(encoding)); });
}
function chooseEncoding(bytes: Uint8Array, name: string, initialError: string, initialEncoding = 'euc-kr'): Promise<DecodedText | null> {
  return new Promise((resolve) => {
    const element = dialog('읽기 인코딩 확인', `<form><p class="dialog-help"><b>${esc(name)}</b> · ${formatBytes(bytes.byteLength)}<br>${esc(initialError)}</p><label>원본 인코딩<select name="encoding">${READ_ENCODINGS.filter(([value]) => value !== 'auto').map(([value, label]) => `<option value="${value}"${value === initialEncoding ? ' selected' : ''}>${label}</option>`).join('')}</select></label><pre class="encoding-preview" id="encoding-preview"></pre><p class="dialog-help" id="encoding-note"></p><p class="form-error" id="encoding-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary-button" data-skip>건너뛰기</button><button type="submit" class="primary-button">이 내용으로 열기</button></div></form>`, true);
    let decoded: DecodedText | null = null;
    const preview = () => {
      try {
        decoded = decodeText(bytes, element.querySelector('select')!.value);
        element.querySelector('#encoding-preview')!.textContent = decoded.content.slice(0, 6000) || '(빈 파일)';
        element.querySelector('#encoding-note')!.textContent = decoded.convertedFrom ? `${decoded.convertedFrom}에서 읽고 UTF-8로 저장해요. 글자가 올바르게 보이는지 확인해 주세요.` : `${decoded.encoding.toUpperCase()}로 읽고 저장해요.`;
        element.querySelector('#encoding-error')!.textContent = '';
      } catch (error) { decoded = null; element.querySelector('#encoding-preview')!.textContent = ''; element.querySelector('#encoding-error')!.textContent = (error as Error).message; }
      element.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = !decoded;
    };
    element.querySelector('select')!.addEventListener('change', preview);
    element.querySelector('[data-skip]')!.addEventListener('click', () => element.close());
    element.querySelector('form')!.addEventListener('submit', (event) => { event.preventDefault(); if (!decoded) return; resolve(decoded); element.close(); });
    element.addEventListener('close', () => resolve(null), { once: true }); preview();
  });
}
async function importFiles(files: Array<{ file: File; handle?: LocalFileHandle }>, encoding = 'auto') {
  if (importBusy) { toast('현재 파일을 모두 연 뒤 다시 시도해 주세요.'); return; }
  importBusy = true; let opened = 0;
  try {
    for (const { file, handle } of files) {
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: 파일당 최대 20 MB까지 열 수 있어요.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let decoded: DecodedText | null;
        try { decoded = decodeText(bytes, encoding); }
        catch (error) { if (!(error instanceof FileReadError) || error.kind !== 'encoding') throw error; decoded = await chooseEncoding(bytes, file.name, error.message); }
        if (!decoded) continue;
        if (decoded.convertedFrom && encoding !== 'auto') {
          // Explicit legacy decoding also gets a preview before UTF-8 conversion.
          decoded = await chooseEncoding(bytes, file.name, '저장할 때 UTF-8로 변환돼요. 내용을 확인해 주세요.', encoding);
          if (!decoded) continue;
        }
        const doc = newDocument(file.name, decoded.content, decoded); doc.exportedRevision = decoded.convertedFrom ? null : 0;
        docs.set(doc.id, doc); persistedContent.set(doc.id, doc.content);
        if (handle) handles.set(doc.id, { handle, modified: file.lastModified });
        activate(doc.id); await persist(doc.id); opened++;
      } catch (error) { toast(`${file.name}: ${error instanceof Error ? error.message : '파일을 열지 못했어요.'}`); }
    }
    if (opened) toast(`${opened}개 파일을 열었어요.`);
  } finally { importBusy = false; }
}
async function chooseFiles(encoding = 'auto') {
  if (canPickOpenFiles()) {
    const selected = await pickOpenFiles();
    const files = await Promise.all(selected.map(async (handle) => ({ file: await handle.getFile(), handle })));
    await importFiles(files, encoding);
  } else {
    const input = document.querySelector<HTMLInputElement>('#file-input')!; input.dataset.encoding = encoding; input.click();
  }
}
function confirmOverwrite(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const element = dialog('원본 파일이 변경됐어요', `<p class="dialog-help">${esc(name)} 파일이 열린 뒤 다른 앱에서 바뀌었어요. 현재 편집 내용으로 덮어쓸까요?</p><div class="dialog-actions"><button class="secondary-button" data-cancel>취소</button><button class="primary-button" data-confirm>덮어쓰기</button></div>`);
    element.querySelector('[data-cancel]')!.addEventListener('click', () => element.close());
    element.querySelector('[data-confirm]')!.addEventListener('click', () => { resolve(true); element.close(); });
    element.addEventListener('close', () => resolve(false), { once: true });
  });
}
async function saveFile(saveAs = false) {
  const doc = current(); if (!doc || diskWrites.has(doc.id)) return;
  const snapshot = structuredClone(doc);
  const existing = !saveAs ? handles.get(doc.id) : undefined;
  // Invoke the picker directly from the gesture, before waiting for IndexedDB.
  const picked = !existing && canPickSaveFile() ? pickSaveFile(snapshot.name) : undefined;
  diskWrites.add(doc.id); refreshStatus();
  try {
    const handle = existing?.handle ?? (picked ? await picked : undefined);
    if (existing) { const disk = await existing.handle.getFile(); if (disk.lastModified !== existing.modified && !(await confirmOverwrite(snapshot.name))) return; }
    const bytes = encodeText(snapshot);
    if (handle) {
      const stream = await handle.createWritable(); await stream.write(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })); await stream.close();
      const file = await handle.getFile(); handles.set(doc.id, { handle, modified: file.lastModified });
      if (doc.name === snapshot.name && doc.name !== handle.name) {
        doc.name = handle.name; const unchanged = doc.revision === snapshot.revision; doc.revision++;
        if (unchanged) snapshot.revision = doc.revision;
        renderTabs(); renderExplorer(); await configureLanguage(doc.id);
      }
    } else downloadBytes(bytes, snapshot.name);
    doc.exportedRevision = snapshot.revision;
    if (doc.revision === snapshot.revision) delete doc.convertedFrom;
    try { await persist(doc.id); toast(handle ? '파일을 저장했어요.' : '현재 파일 이름으로 내려받기를 요청했어요.'); }
    catch { toast('파일로 내보냈지만 앱 보관에 실패했어요.'); }
  } finally { diskWrites.delete(doc.id); refreshStatus(); }
}
function showLanguage() {
  const doc = current(); if (!doc) return;
  const options = [{ name: 'auto', label: `자동 감지 (${languageLabel({ ...doc, language: 'auto' })})` }, { name: 'plain', label: '일반 텍스트' }, ...languageDescriptions.map((item) => ({ name: item.name, label: item.name }))];
  const element = dialog('파일 언어 모드', `<label>언어 검색<input type="search" id="language-query" placeholder="Python, JavaScript, C++…" autocomplete="off"></label><div class="language-list">${options.map((item) => `<button class="language-option${doc.language === item.name ? ' selected' : ''}" data-language="${esc(item.name)}">${esc(item.label)}${doc.language === item.name ? '<span>✓</span>' : ''}</button>`).join('')}</div>`);
  element.querySelector('input')!.addEventListener('input', (event) => { const query = (event.target as HTMLInputElement).value.toLowerCase(); element.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => { button.hidden = !button.textContent!.toLowerCase().includes(query); }); });
  element.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => button.onclick = () => { doc.language = button.dataset.language!; touch(doc, false); task(() => configureLanguage(doc.id)); element.close(); });
  element.querySelector('input')!.focus();
}
function showFormat() {
  const doc = current(); if (!doc) return;
  const element = dialog('파일 저장 형식', `<form><label>저장 인코딩<select name="encoding">${(['utf-8', 'utf-16le', 'utf-16be'] as const).map((encoding) => `<option value="${encoding}"${doc.encoding === encoding ? ' selected' : ''}>${encoding.toUpperCase()}</option>`).join('')}</select></label><label class="checkbox-label"><input type="checkbox" name="bom"${doc.bom ? ' checked' : ''}>BOM 포함</label><label>줄바꿈<select name="ending">${['LF', 'CRLF', 'CR'].map((ending) => `<option${doc.lineEnding === ending ? ' selected' : ''}>${ending}</option>`).join('')}</select></label><p class="dialog-help">${doc.originalText !== undefined ? '이 파일에는 혼합 줄바꿈이 있어요. 형식을 적용하거나 편집하면 선택한 방식으로 통일해요.' : '원본의 인코딩·BOM·줄바꿈을 유지하며, 여기에서 바꿀 수 있어요.'}${doc.convertedFrom ? `<br>${esc(doc.convertedFrom)}에서 읽었어요. 저장 인코딩은 ${doc.encoding.toUpperCase()}예요.` : ''}</p><div class="dialog-actions"><button type="submit" class="primary-button">형식 적용</button></div></form>`);
  element.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault(); const data = new FormData(element.querySelector('form')!);
    const encoding = data.get('encoding') as TextEncoding, bom = data.has('bom'), ending = data.get('ending') as LineEnding;
    if (encoding !== doc.encoding || bom !== doc.bom || ending !== doc.lineEnding || doc.originalText !== undefined) {
      doc.encoding = encoding; doc.bom = bom; doc.lineEnding = ending; delete doc.originalText; touch(doc);
    }
    element.close();
  });
}
function showGoto() {
  if (!view || !current()) return;
  const element = dialog('줄로 이동', `<form><label>줄 번호 (1–${view.state.doc.lines.toLocaleString()})<input name="line" type="number" min="1" max="${view.state.doc.lines}" value="${view.state.doc.lineAt(view.state.selection.main.head).number}" required></label><div class="dialog-actions"><button class="primary-button" type="submit">이동 ${icon('arrow')}</button></div></form>`);
  element.querySelector('form')!.addEventListener('submit', (event) => { event.preventDefault(); const number = Number(element.querySelector('input')!.value); if (!view || !Number.isInteger(number) || number < 1 || number > view.state.doc.lines) return; view.dispatch({ selection: { anchor: view.state.doc.line(number).from }, scrollIntoView: true }); element.close(); view.focus(); });
  element.querySelector('input')!.select();
}
function applySettings() {
  document.documentElement.style.setProperty('--editor-font', `${settings.fontSize}px`);
  const effects = [wrapCompartment.reconfigure(settings.wrap ? EditorView.lineWrapping : []), indentCompartment.reconfigure([indentUnit.of(settings.indent), EditorState.tabSize.of(settings.indent === '\t' ? 4 : settings.indent.length)])];
  for (const [id, state] of states) if (id !== activeId) states.set(id, state.update({ effects }).state);
  view?.dispatch({ effects });
  try { localStorage.setItem('my-edit-settings-v2', JSON.stringify(settings)); } catch { /* Nonessential preference. */ }
  refreshStatus();
}
function showSettings() {
  const element = dialog('편집기 설정', `<form><label>글자 크기<select name="font">${[12, 13, 14, 15, 16, 18, 20, 24].map((size) => `<option value="${size}"${settings.fontSize === size ? ' selected' : ''}>${size}px</option>`).join('')}</select></label><label>들여쓰기<select name="indent"><option value="2"${settings.indent === '  ' ? ' selected' : ''}>공백 2칸</option><option value="4"${settings.indent === '    ' ? ' selected' : ''}>공백 4칸</option><option value="tab"${settings.indent === '\t' ? ' selected' : ''}>탭 (너비 4칸)</option></select></label><label class="checkbox-label"><input type="checkbox" name="wrap"${settings.wrap ? ' checked' : ''}>긴 줄 자동 줄바꿈</label><div class="shortcut-list"><span>파일 저장 <kbd>Ctrl / ⌘ S</kbd></span><span>찾기·바꾸기 <kbd>Ctrl / ⌘ F</kbd></span><span>줄 이동 <kbd>Ctrl / ⌘ G</kbd></span><span>주석 토글 <kbd>Ctrl / ⌘ /</kbd></span></div><div class="dialog-actions"><button class="primary-button" type="submit">설정 적용</button></div></form>`);
  element.querySelector('form')!.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(element.querySelector('form')!); settings = { wrap: data.has('wrap'), indent: data.get('indent') === 'tab' ? '\t' : ' '.repeat(Number(data.get('indent'))), fontSize: Number(data.get('font')) }; applySettings(); element.close(); });
}
async function showRecovery() {
  const doc = current(); if (!doc) return;
  await persist(doc.id); const points = await listRecoveryPoints(doc.id);
  const element = dialog('이전 내용 복구', `<p class="dialog-help">최근 복구 지점 20개를 보관해요. 복구 전 현재 내용도 남겨요.</p><div class="recovery-list">${points.length ? points.map((point, index) => `<button data-recovery="${index}"><b>${new Date(point.createdAt).toLocaleString('ko-KR')}</b><small>${esc(point.content.replace(/\s+/g, ' ').slice(0, 100) || '(빈 파일)')}</small></button>`).join('') : '<p class="dialog-help">아직 복구 지점이 없어요. 편집 중 이전 내용이 자동으로 보관돼요.</p>'}</div>`);
  element.querySelectorAll<HTMLButtonElement>('[data-recovery]').forEach((button) => button.onclick = () => task(async () => {
    const point = points[Number(button.dataset.recovery)]; await persist(doc.id, true);
    activate(doc.id); view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: point.content }, selection: { anchor: 0 } });
    await persist(doc.id); element.close(); toast('이전 내용을 복구했어요.');
  }));
}
async function trashCurrent() {
  const doc = current(); if (!doc) return;
  doc.deletedAt = Date.now(); await persist(doc.id); closeTab(doc.id); states.delete(doc.id); handles.delete(doc.id); renderExplorer();
  toast('작업공간 휴지통으로 이동했어요. 원본 파일은 그대로예요.', { label: '되돌리기', run: () => task(async () => { doc.deletedAt = null; await persist(doc.id); activate(doc.id); }) });
}
function showTrash() {
  const deleted = [...docs.values()].filter((doc) => doc.deletedAt !== null).sort((a, b) => b.deletedAt! - a.deletedAt!);
  const element = dialog('작업공간 휴지통', `<div class="recovery-list">${deleted.length ? deleted.map((doc) => `<div class="trash-row"><span>${esc(doc.name)}</span><button class="secondary-button" data-restore="${esc(doc.id)}">복원</button></div>`).join('') : '<p class="dialog-help">휴지통이 비어 있어요.</p>'}</div>`);
  element.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((button) => button.onclick = () => task(async () => { const doc = docs.get(button.dataset.restore!)!; doc.deletedAt = null; await persist(doc.id); element.close(); activate(doc.id); toast('파일을 복원했어요.'); }));
}
function exportBackup() {
  const text = createBackup([...docs.values()]); downloadBytes(new TextEncoder().encode(text), `my-edit-workspace-${new Date().toISOString().slice(0, 10)}.json`);
  toast('작업공간 백업을 내려받기 요청했어요.');
}
async function restoreBackup(file: File) {
  if (file.size > 80 * 1024 * 1024) throw new Error('80 MB 이하의 백업 파일을 선택해 주세요.');
  const incoming = parseBackup(await file.text());
  const added = await addRestoredDocuments(incoming, new Set(docs.keys()));
  for (const doc of added) { docs.set(doc.id, doc); persistedContent.set(doc.id, doc.content); statuses.set(doc.id, 'saved'); }
  renderExplorer(); const first = added.find((doc) => doc.deletedAt === null); if (first) activate(first.id);
  toast(`${added.length}개 파일을 복원했어요. 기존 작업은 그대로 보관돼요.`);
}
function showPreview() {
  const doc = current(); if (!doc) return;
  if (detectLanguage(doc)?.name !== 'HTML') { toast('HTML 파일에서 미리보기를 열 수 있어요.'); return; }
  const element = dialog('HTML 미리보기', '<p class="dialog-help">이 파일만 미리 봐요. 외부 리소스는 인터넷 연결이 필요할 수 있어요.</p><iframe class="preview-frame" title="HTML 미리보기" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe>', true);
  element.querySelector('iframe')!.srcdoc = doc.content;
}
function toggleMenu() {
  const host = document.querySelector<HTMLDivElement>('#file-menu')!;
  if (!host.hidden) { closeMenu(); return; }
  const doc = current();
  const items: Array<[string, string, string, string?]> = [
    ['new', 'plus', '새 파일', ''], ['open', 'folder', '파일 열기', 'Ctrl+O'], ['open-encoding', 'folder', '인코딩을 지정해서 열기'],
    ...(doc ? [['undo', 'undo', '실행 취소', 'Ctrl+Z'], ['redo', 'redo', '다시 실행', 'Ctrl+Shift+Z']] as Array<[string, string, string, string?]> : []),
    ...(doc ? [['save-as', 'save', '다른 이름으로 저장', 'Ctrl+Shift+S'], ['rename', 'code', '파일 이름 바꾸기'], ['language', 'code', '언어 모드 선택'], ['format', 'settings', '인코딩 · 줄바꿈'], ['goto', 'arrow', '줄로 이동', 'Ctrl+G'], ['comment', 'code', '주석 토글', 'Ctrl+/'], ['recovery', 'history', '이전 내용 복구'], ...(detectLanguage(doc)?.name === 'HTML' ? [['preview', 'eye', 'HTML 미리보기']] : []), ['delete', 'trash', '작업공간에서 휴지통으로']] as Array<[string, string, string, string?]> : []),
    ['settings', 'settings', '편집기 설정'], ['backup-export', 'download', '작업공간 백업'], ['backup-import', 'history', '백업 가져오기'], ['trash', 'trash', '휴지통'], ['update', 'download', '앱 업데이트 확인']
  ];
  host.innerHTML = items.map(([action, glyph, label, shortcut]) => `<button data-action="${action}">${icon(glyph)}<span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</button>`).join('');
  host.hidden = false; document.querySelector('[data-action="more"]')!.setAttribute('aria-expanded', 'true');
  host.querySelector('button')?.focus();
}
function closeMenu() { (document.querySelector('#file-menu') as HTMLElement).hidden = true; document.querySelector('[data-action="more"]')!.setAttribute('aria-expanded', 'false'); }
function updateOfflineStatus() {
  const element = document.querySelector('#offline-status'); if (!element) return;
  const ready = offlineReady || Boolean(navigator.serviceWorker?.controller);
  element.textContent = ready ? navigator.onLine ? '오프라인 준비 완료' : '오프라인 사용 중' : navigator.onLine ? '오프라인 준비 중' : '첫 연결 필요';
  element.classList.toggle('ready', ready);
}
async function installApp() {
  if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
  if (matchMedia('(display-mode: standalone)').matches) { toast('앱으로 실행 중이에요.'); return; }
  dialog('My Edit 설치', '<p class="dialog-help">브라우저 메뉴에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.<br><br>iPhone·iPad의 Safari에서는 공유 메뉴 → 홈 화면에 추가를 선택해 주세요.</p>');
}
async function checkUpdate() {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) { toast('오프라인 앱 등록을 기다린 뒤 다시 확인해 주세요.'); return; }
  await registration.update();
  if (registration.waiting) showUpdate(); else toast('업데이트를 확인했어요. 새 버전이 준비되면 알려드릴게요.');
}
function showUpdate() {
  const button = document.querySelector<HTMLElement>('#update-ready'); if (button) button.hidden = false;
  toast('새 My Edit가 준비됐어요.', { label: '업데이트 적용', run: () => task(async () => { await flushAll(); await applyUpdate?.(true); }) });
}

document.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (!target.closest('#file-menu, [data-action="more"]') && document.querySelector('#file-menu')) closeMenu();
  const open = target.closest<HTMLElement>('[data-open]'); if (open) { activate(open.dataset.open!); return; }
  const close = target.closest<HTMLElement>('[data-close]'); if (close) { closeTab(close.dataset.close!); return; }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action; if (!action) return;
  if (action !== 'more') closeMenu();
  if (action === 'welcome') { event.preventDefault(); activate(null); }
  else if (action === 'sidebar') document.querySelector('.workbench')!.classList.toggle('sidebar-open');
  else if (action === 'new') showNewFile();
  else if (action === 'open') task(() => chooseFiles());
  else if (action === 'open-encoding') showReadOptions();
  else if (action === 'save') task(() => saveFile());
  else if (action === 'save-as') task(() => saveFile(true));
  else if (action === 'rename') showNewFile(true);
  else if (action === 'more') toggleMenu();
  else if (action === 'find' && view && current()) openSearchPanel(view);
  else if (action === 'undo' && view && current()) undo(view);
  else if (action === 'redo' && view && current()) redo(view);
  else if (action === 'comment' && view && current()) toggleComment(view);
  else if (action === 'language') showLanguage();
  else if (action === 'format') showFormat();
  else if (action === 'goto') showGoto();
  else if (action === 'settings') showSettings();
  else if (action === 'recovery') task(showRecovery);
  else if (action === 'delete') task(trashCurrent);
  else if (action === 'trash') showTrash();
  else if (action === 'backup-export') exportBackup();
  else if (action === 'backup-import') document.querySelector<HTMLInputElement>('#backup-input')!.click();
  else if (action === 'preview') showPreview();
  else if (action === 'install') task(installApp);
  else if (action === 'update') task(checkUpdate);
  else if (action === 'apply-update') task(async () => { await flushAll(); await applyUpdate?.(true); });
});
document.addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
  if (input.id === 'file-input') { const files = Array.from(input.files, (file) => ({ file })); const encoding = input.dataset.encoding ?? 'auto'; input.value = ''; task(() => importFiles(files, encoding)); }
  if (input.id === 'backup-input') { const file = input.files[0]; input.value = ''; task(() => restoreBackup(file)); }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeMenu(); document.querySelector('.workbench')?.classList.remove('sidebar-open'); }
  if (event.target instanceof HTMLElement && event.target.closest('[role="tablist"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const index = openIds.indexOf(activeId ?? '');
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? openIds.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + openIds.length) % openIds.length;
    if (openIds[next]) { event.preventDefault(); activate(openIds[next]); document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus(); }
  }
  if (document.querySelector('dialog[open]') || (event.target instanceof Element && event.target.closest('.cm-editor'))) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); task(() => saveFile(event.shiftKey)); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); task(() => chooseFiles()); }
});
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; document.querySelector('#drop-overlay')?.classList.add('visible'); } });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.querySelector('#drop-overlay')?.classList.remove('visible'); });
document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', (event) => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); dragDepth = 0; document.querySelector('#drop-overlay')?.classList.remove('visible'); task(() => importFiles(Array.from(event.dataTransfer!.files, (file) => ({ file })))); });
window.addEventListener('online', updateOfflineStatus); window.addEventListener('offline', updateOfflineStatus);
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event as BeforeInstallPromptEvent; });
window.addEventListener('pagehide', () => { void flushAll().catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushAll().catch(() => {}); });

async function start() {
  const storedSettings = readPreference('my-edit-settings-v2') as Partial<Settings> | null;
  if (storedSettings) settings = { wrap: storedSettings.wrap === true, indent: ['  ', '    ', '\t'].includes(storedSettings.indent ?? '') ? storedSettings.indent! : '  ', fontSize: [12, 13, 14, 15, 16, 18, 20, 24].includes(storedSettings.fontSize ?? 0) ? storedSettings.fontSize! : 14 };
  renderShell();
  applyUpdate = registerSW({ onOfflineReady() { offlineReady = true; updateOfflineStatus(); }, onNeedRefresh: showUpdate,
    onRegisteredSW(_url, registration) { updateOfflineStatus(); if (registration) window.setInterval(() => { if (navigator.onLine) void registration.update().catch(() => {}); }, 60 * 60 * 1000); },
    onRegisterError() { toast('오프라인 준비에 실패했어요. 연결 상태를 확인하고 다시 열어 주세요.'); }
  });
  try {
    for (const doc of await listDocuments()) { docs.set(doc.id, doc); persistedContent.set(doc.id, doc.content); statuses.set(doc.id, 'saved'); }
    const session = readPreference('my-edit-session-v2') as { openIds?: unknown; activeId?: unknown } | null;
    if (Array.isArray(session?.openIds)) openIds = [...new Set(session.openIds.filter((id): id is string => typeof id === 'string' && docs.has(id) && docs.get(id)!.deletedAt === null))];
    activate(typeof session?.activeId === 'string' && openIds.includes(session.activeId) ? session.activeId : openIds[0] ?? null);
    updateOfflineStatus();
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
  } catch (error) {
    dialog('작업공간을 열 수 없어요', `<p class="dialog-help">${esc(error instanceof Error ? error.message : '브라우저 저장 공간을 확인해 주세요.')}<br><br>기존 파일을 보호하기 위해 새 작업을 시작하지 않았어요. 다른 My Edit 탭을 닫고 다시 열어 주세요.</p><div class="dialog-actions"><button class="primary-button" data-retry>다시 시도</button></div>`).querySelector('[data-retry]')!.addEventListener('click', () => location.reload());
  }
}
void start();
