export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';
export type LineEnding = 'LF' | 'CRLF' | 'CR';
export interface TextFormat {
  encoding: TextEncoding;
  bom: boolean;
  lineEnding: LineEnding;
  originalText?: string;
  convertedFrom?: string;
}
export interface DecodedText extends TextFormat { content: string }
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const HIGHLIGHT_LIMIT = 1024 * 1024;
export const READ_ENCODINGS = [
  ['auto', '자동 (UTF-8 / UTF-16)'], ['utf-8', 'UTF-8'],
  ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE'],
  ['euc-kr', '한국어 (EUC-KR / CP949)'], ['shift_jis', '일본어 (Shift JIS)'],
  ['gb18030', '중국어 (GB18030)'], ['big5', '중국어 (Big5)'],
  ['windows-1252', '서유럽 (Windows-1252)'], ['windows-1251', '키릴 문자 (Windows-1251)'],
  ['windows-1250', '중유럽 (Windows-1250)'], ['iso-8859-2', 'ISO-8859-2'], ['koi8-r', 'KOI8-R']
] as const;
export class FileReadError extends Error {
  kind: 'encoding' | 'binary' | 'size';
  constructor(kind: FileReadError['kind'], message: string) { super(message); this.kind = kind; }
}
export function normalizeNewlines(text: string): string { return text.replace(/\r\n|\r/g, '\n'); }
export function detectLineEnding(text: string): { lineEnding: LineEnding; mixed: boolean } {
  const counts = { LF: 0, CRLF: 0, CR: 0 };
  for (const match of text.matchAll(/\r\n|\r|\n/g)) counts[match[0] === '\r\n' ? 'CRLF' : match[0] === '\r' ? 'CR' : 'LF']++;
  const styles = (Object.keys(counts) as LineEnding[]).sort((a, b) => counts[b] - counts[a]);
  return { lineEnding: styles[0], mixed: styles.filter((style) => counts[style] > 0).length > 1 };
}
function hasBinarySignature(bytes: Uint8Array): boolean {
  const signatures = [
    [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38],
    [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x25, 0x50, 0x44, 0x46],
    [0x7f, 0x45, 0x4c, 0x46], [0x1f, 0x8b],
    [0x37, 0x7a, 0xbc, 0xaf], [0x52, 0x61, 0x72, 0x21], [0xd0, 0xcf, 0x11, 0xe0], [0x00, 0x61, 0x73, 0x6d]
  ];
  return signatures.some((signature) => signature.every((byte, i) => bytes[i] === byte));
}
function guessUtf16(bytes: Uint8Array): TextEncoding | undefined {
  if (bytes.length < 4 || bytes.length % 2) return undefined;
  const pairs = Math.min(bytes.length / 2, 512);
  let evenZeros = 0, oddZeros = 0;
  for (let i = 0; i < pairs; i++) { if (bytes[i * 2] === 0) evenZeros++; if (bytes[i * 2 + 1] === 0) oddZeros++; }
  if (oddZeros / pairs > .3 && evenZeros / pairs < .05) return 'utf-16le';
  if (evenZeros / pairs > .3 && oddZeros / pairs < .05) return 'utf-16be';
  return undefined;
}
export function decodeText(bytes: Uint8Array, requestedEncoding = 'auto'): DecodedText {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileReadError('size', '파일당 최대 20 MB까지 열 수 있어요.');
  if (hasBinarySignature(bytes)) throw new FileReadError('binary', '압축·이미지·문서 같은 바이너리 파일은 텍스트로 편집할 수 없어요.');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
      (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
    throw new FileReadError('encoding', 'UTF-32 파일은 먼저 UTF-8 또는 UTF-16으로 변환해 주세요.');
  }
  const signature: { encoding: TextEncoding; length: number } | undefined =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? { encoding: 'utf-8', length: 3 } :
    bytes[0] === 0xff && bytes[1] === 0xfe ? { encoding: 'utf-16le', length: 2 } :
    bytes[0] === 0xfe && bytes[1] === 0xff ? { encoding: 'utf-16be', length: 2 } : undefined;
  const readEncoding = requestedEncoding === 'auto' ? signature?.encoding ?? guessUtf16(bytes) ?? 'utf-8' : requestedEncoding;
  const bom = signature?.encoding === readEncoding;
  let text: string;
  try {
    // Remove exactly one actual BOM; preserve a leading U+FEFF that belongs to the content.
    text = new TextDecoder(readEncoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom ? signature!.length : 0));
  } catch { throw new FileReadError('encoding', `${readEncoding.toUpperCase()}로 읽을 수 없어요. 원본 인코딩을 선택해 주세요.`); }
  // ANSI escape sequences are valid in text logs; NUL and other binary controls are not.
  const controls = text.match(/[\x00-\x08\x0e-\x1a\x1c-\x1f]/g)?.length ?? 0;
  if (text.includes('\0') || controls > Math.max(2, text.length * .01)) throw new FileReadError('binary', '텍스트가 아닌 데이터가 포함돼 있어요. 인코딩 또는 파일 형식을 확인해 주세요.');
  const { lineEnding, mixed } = detectLineEnding(text);
  const unicode = ['utf-8', 'utf-16le', 'utf-16be'].includes(readEncoding);
  return {
    content: normalizeNewlines(text), encoding: unicode ? readEncoding as TextEncoding : 'utf-8', bom: unicode && bom, lineEnding,
    ...(mixed ? { originalText: text } : {}), ...(!unicode ? { convertedFrom: readEncoding } : {})
  };
}
export function encodeText(document: TextFormat & { content: string }): Uint8Array {
  const { content, encoding, bom, lineEnding, originalText } = document;
  const separator = lineEnding === 'CRLF' ? '\r\n' : lineEnding === 'CR' ? '\r' : '\n';
  const text = originalText !== undefined && normalizeNewlines(originalText) === content
    ? originalText : normalizeNewlines(content).replace(/\n/g, separator);
  if (encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    if (!bom) return body;
    const bytes = new Uint8Array(body.length + 3); bytes.set([0xef, 0xbb, 0xbf]); bytes.set(body, 3); return bytes;
  }
  const offset = bom ? 2 : 0;
  const bytes = new Uint8Array(text.length * 2 + offset);
  const view = new DataView(bytes.buffer);
  const littleEndian = encoding === 'utf-16le';
  if (bom) view.setUint16(0, 0xfeff, littleEndian);
  for (let i = 0; i < text.length; i++) view.setUint16(offset + i * 2, text.charCodeAt(i), littleEndian);
  return bytes;
}
export function validateFileName(value: string): string {
  const name = value.trim();
  if (!name || name === '.' || name === '..') throw new Error('파일 이름을 입력해 주세요.');
  if (/[\x00-\x1f/\\]/.test(name)) throw new Error('파일 이름에 경로나 제어 문자를 넣을 수 없어요.');
  if (name.length > 255) throw new Error('파일 이름은 255자 이내로 입력해 주세요.');
  return name;
}
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
