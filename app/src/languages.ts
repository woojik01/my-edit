import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { TextDocument } from './documents.ts';
export const languageDescriptions = [...languages].sort((a, b) => a.name.localeCompare(b.name));
export function detectLanguage(document: Pick<TextDocument, 'name' | 'content' | 'language'>): LanguageDescription | null {
  if (document.language === 'plain') return null;
  if (document.language !== 'auto') return LanguageDescription.matchLanguageName(languages, document.language, false);
  if (/^\.env(?:\.|$)/i.test(document.name) || /\.(ini|cfg)$/i.test(document.name)) return LanguageDescription.matchLanguageName(languages, 'Properties files', false);
  const byName = LanguageDescription.matchFilename(languages, document.name);
  if (byName) return byName;
  const firstLine = document.content.split('\n', 1)[0];
  if (firstLine.startsWith('#!')) {
    const name = /\bpython[\d.]*/.test(firstLine) ? 'Python' : /\bnode\b/.test(firstLine) ? 'JavaScript' : /\b(?:ba|z|fi|da|k)?sh\b/.test(firstLine) ? 'Shell' : /\bruby\b/.test(firstLine) ? 'Ruby' : /\bperl\b/.test(firstLine) ? 'Perl' : '';
    if (name) return LanguageDescription.matchLanguageName(languages, name, false);
  }
  return null;
}
export function languageLabel(document: Pick<TextDocument, 'name' | 'content' | 'language'>): string { return detectLanguage(document)?.name ?? '일반 텍스트'; }
export function fileBadge(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const badges: Record<string, string> = { js: 'JS', ts: 'TS', py: 'PY', json: '{}', md: 'M↓', html: '<>', css: '#', sql: 'SQL', sh: '$', rs: 'RS', cpp: 'C++', c: 'C', java: 'J', kt: 'KT', yaml: 'Y', yml: 'Y', txt: 'T' };
  return badges[ext.toLowerCase()] ?? (ext ? ext.toUpperCase().slice(0, 3) : '≡');
}
