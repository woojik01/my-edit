export interface LocalFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(value: Blob): Promise<void>; close(): Promise<void> }>;
  isSameEntry?(other: LocalFileHandle): Promise<boolean>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
export interface LocalDirectoryHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  removeEntry?(name: string): Promise<void>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options: { multiple: boolean }) => Promise<LocalFileHandle[]>;
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<LocalFileHandle>;
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<LocalDirectoryHandle>;
}
export function canPickOpenFiles(): boolean { return typeof (window as FilePickerWindow).showOpenFilePicker === 'function'; }
export function canPickSaveFile(): boolean { return typeof (window as FilePickerWindow).showSaveFilePicker === 'function'; }
export function canPickDirectory(): boolean { return typeof (window as FilePickerWindow).showDirectoryPicker === 'function'; }
export function pickOpenFiles(): Promise<LocalFileHandle[]> { return (window as FilePickerWindow).showOpenFilePicker!({ multiple: true }); }
export function pickSaveFile(name: string): Promise<LocalFileHandle> { return (window as FilePickerWindow).showSaveFilePicker!({ suggestedName: name }); }
export function pickDirectory(): Promise<LocalDirectoryHandle> { return (window as FilePickerWindow).showDirectoryPicker!({ mode: 'readwrite' }); }
export async function sameFileEntry(first: LocalFileHandle, second: LocalFileHandle): Promise<boolean> {
  if (first.isSameEntry) return first.isSameEntry(second);
  const [firstFile, secondFile] = await Promise.all([first.getFile(), second.getFile()]);
  return firstFile.name === secondFile.name && firstFile.size === secondFile.size && firstFile.lastModified === secondFile.lastModified;
}
export async function removeDirectoryFile(directory: LocalDirectoryHandle, name: string, expected?: LocalFileHandle): Promise<boolean> {
  if (!directory.removeEntry) throw new Error('이 브라우저는 폴더 안의 파일 삭제를 지원하지 않아요.');
  let handle: LocalFileHandle;
  try { handle = await directory.getFileHandle(name); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
  if (expected && !(await sameFileEntry(expected, handle))) throw new Error('선택한 폴더에서 같은 이름의 다른 파일을 찾았어요. 원본 파일은 삭제하지 않았어요.');
  await directory.removeEntry(name);
  return true;
}
export async function writeFileHandle(handle: LocalFileHandle, bytes: Uint8Array): Promise<File> {
  const writable = await handle.createWritable();
  await writable.write(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
  await writable.close();
  return handle.getFile();
}
export async function getDirectoryFileHandle(directory: LocalDirectoryHandle, name: string): Promise<{ handle: LocalFileHandle; existed: boolean }> {
  let handle: LocalFileHandle;
  let existed = true;
  try { handle = await directory.getFileHandle(name); }
  catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
    handle = await directory.getFileHandle(name, { create: true });
    existed = false;
  }
  return { handle, existed };
}
export async function writeDirectoryFile(directory: LocalDirectoryHandle, name: string, bytes: Uint8Array): Promise<{ handle: LocalFileHandle; file: File; existed: boolean }> {
  const { handle, existed } = await getDirectoryFileHandle(directory, name);
  const file = await writeFileHandle(handle, bytes);
  return { handle, file, existed };
}
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
