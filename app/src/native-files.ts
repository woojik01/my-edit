export interface LocalFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(value: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
export interface LocalDirectoryHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
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
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
