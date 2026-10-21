import { detectLineEnding, normalizeNewlines, validateFileName } from './files.ts';
import type { TextFormat, TextEncoding, LineEnding } from './files.ts';
export interface TextDocument extends TextFormat {
  schemaVersion: 2;
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  cursor: number;
  language: string;
  revision: number;
  exportedRevision: number | null;
}
export function newDocument(name: string, content = '', format: Partial<TextFormat> = {}): TextDocument {
  const now = Date.now();
  return {
    schemaVersion: 2, id: crypto.randomUUID(), name: validateFileName(name), content: normalizeNewlines(content),
    createdAt: now, updatedAt: now, deletedAt: null, cursor: 0, language: 'auto', revision: 0, exportedRevision: null,
    encoding: format.encoding ?? 'utf-8', bom: format.bom ?? false, lineEnding: format.lineEnding ?? detectLineEnding(content).lineEnding,
    ...(format.originalText !== undefined ? { originalText: format.originalText } : {}),
    ...(format.convertedFrom ? { convertedFrom: format.convertedFrom } : {})
  };
}
function timestamp(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback; }
export function normalizeDocument(value: unknown): TextDocument {
  if (!value || typeof value !== 'object') throw new Error('파일 데이터가 올바르지 않아요.');
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || typeof raw.content !== 'string') throw new Error('파일의 이름 또는 내용이 올바르지 않아요.');
  const legacy = raw.schemaVersion !== 2;
  const name = legacy && !/\.(html?|xhtml)$/i.test(raw.name) ? `${raw.name}.html` : raw.name;
  const detected = detectLineEnding(raw.content);
  const now = Date.now();
  return {
    schemaVersion: 2, id: raw.id, name, content: normalizeNewlines(raw.content), createdAt: timestamp(raw.createdAt, now), updatedAt: timestamp(raw.updatedAt, now),
    deletedAt: typeof raw.deletedAt === 'number' ? timestamp(raw.deletedAt, now) : null,
    cursor: typeof raw.cursor === 'number' && Number.isFinite(raw.cursor) ? Math.max(0, Math.min(raw.content.length, Math.floor(raw.cursor))) : 0,
    language: typeof raw.language === 'string' ? raw.language : 'auto',
    encoding: ['utf-8', 'utf-16le', 'utf-16be'].includes(String(raw.encoding)) ? raw.encoding as TextEncoding : 'utf-8',
    bom: raw.bom === true, lineEnding: ['LF', 'CRLF', 'CR'].includes(String(raw.lineEnding)) ? raw.lineEnding as LineEnding : detected.lineEnding,
    revision: typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    exportedRevision: typeof raw.exportedRevision === 'number' && Number.isSafeInteger(raw.exportedRevision) && raw.exportedRevision >= 0 ? raw.exportedRevision : null,
    ...(typeof raw.originalText === 'string' && normalizeNewlines(raw.originalText) === normalizeNewlines(raw.content)
      ? { originalText: raw.originalText } : detected.mixed ? { originalText: raw.content } : {}),
    ...(typeof raw.convertedFrom === 'string' ? { convertedFrom: raw.convertedFrom } : {})
  };
}
export function parseBackup(text: string): TextDocument[] {
  const payload: unknown = JSON.parse(text);
  if (!payload || typeof payload !== 'object') throw new Error('My Edit 백업 파일이 아니에요.');
  const data = payload as Record<string, unknown>;
  if (data.format !== 'my-edit-backup' || ![1, 2].includes(Number(data.version)) || !Array.isArray(data.projects)) throw new Error('My Edit 백업 파일이 아니에요.');
  return data.projects.map(normalizeDocument);
}
export function createBackup(documents: TextDocument[]): string {
  return JSON.stringify({ format: 'my-edit-backup', version: 2, exportedAt: new Date().toISOString(), projects: documents }, null, 2);
}
export function expiredTrashIds(documents: TextDocument[], retentionDays: number, now = Date.now()): string[] {
  const age = Math.max(1, Math.min(365, Math.floor(retentionDays))) * 24 * 60 * 60 * 1000;
  return documents.filter((doc) => doc.deletedAt !== null && now - doc.deletedAt >= age).map((doc) => doc.id);
}
