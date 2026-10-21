export interface LocalFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(value: Blob): Promise<void>; close(): Promise<void> }>;
}
interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options: { multiple: boolean }) => Promise<LocalFileHandle[]>;
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<LocalFileHandle>;
}
export function canPickOpenFiles(): boolean { return typeof (window as FilePickerWindow).showOpenFilePicker === 'function'; }
export function canPickSaveFile(): boolean { return typeof (window as FilePickerWindow).showSaveFilePicker === 'function'; }
export function pickOpenFiles(): Promise<LocalFileHandle[]> { return (window as FilePickerWindow).showOpenFilePicker!({ multiple: true }); }
export function pickSaveFile(name: string): Promise<LocalFileHandle> { return (window as FilePickerWindow).showSaveFilePicker!({ suggestedName: name }); }
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
