import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeText, encodeText, FileReadError, MAX_FILE_BYTES, validateFileName } from '../app/src/files.ts';
import type { TextEncoding, LineEnding } from '../app/src/files.ts';

const text = '안녕하세요 🌿\nconst value = "café";\n마지막 줄';
for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as TextEncoding[]) {
  for (const bom of [false, true]) {
    test(`${encoding}, BOM=${bom}: Unicode and original bytes survive an unedited round trip`, () => {
      const bytes = encodeText({ content: text, encoding, bom, lineEnding: 'CRLF' });
      const decoded = decodeText(bytes, bom ? 'auto' : encoding);
      assert.equal(decoded.content, text);
      assert.equal(decoded.encoding, encoding);
      assert.equal(decoded.bom, bom);
      assert.equal(decoded.lineEnding, 'CRLF');
      assert.deepEqual(encodeText(decoded), bytes);
    });
  }
}
for (const lineEnding of ['LF', 'CRLF', 'CR'] as LineEnding[]) {
  test(`${lineEnding}: editing retains the chosen line ending`, () => {
    const source = encodeText({ content: 'one\ntwo\n', encoding: 'utf-8', bom: false, lineEnding });
    const decoded = decodeText(source);
    decoded.content += 'three\n';
    const separator = lineEnding === 'LF' ? '\n' : lineEnding === 'CR' ? '\r' : '\r\n';
    assert.equal(new TextDecoder().decode(encodeText(decoded)), ['one', 'two', 'three', ''].join(separator));
  });
}
test('mixed newlines remain byte identical before editing and use the declared style after editing', () => {
  const source = new TextEncoder().encode('a\r\nb\nc\r\nd\r');
  const decoded = decodeText(source);
  assert.equal(decoded.lineEnding, 'CRLF');
  assert.deepEqual(encodeText(decoded), source);
  decoded.content += 'new';
  assert.equal(new TextDecoder().decode(encodeText(decoded)), 'a\r\nb\r\nc\r\nd\r\nnew');
});
test('BOM stripping preserves a U+FEFF that belongs to the content', () => {
  const source = encodeText({ content: '\ufeffcontent', encoding: 'utf-8', bom: true, lineEnding: 'LF' });
  assert.equal(decodeText(source).content, '\ufeffcontent');
  assert.deepEqual(encodeText(decodeText(source)), source);
});
test('Korean legacy input is decoded explicitly and has an explicit UTF-8 output format', () => {
  const decoded = decodeText(new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7]), 'euc-kr');
  assert.equal(decoded.content, '안녕');
  assert.equal(decoded.convertedFrom, 'euc-kr');
  assert.equal(decoded.encoding, 'utf-8');
  assert.equal(new TextDecoder().decode(encodeText(decoded)), '안녕');
});
test('invalid UTF-8 is never silently replaced', () => {
  assert.throws(() => decodeText(new Uint8Array([0xc3, 0x28])), (error: unknown) => error instanceof FileReadError && error.kind === 'encoding');
});
test('BOM-less ASCII UTF-16 can be detected; empty files are valid', () => {
  for (const encoding of ['utf-16le', 'utf-16be'] as TextEncoding[]) {
    const source = encodeText({ content: 'hello\nworld', encoding, bom: false, lineEnding: 'LF' });
    assert.equal(decodeText(source).content, 'hello\nworld');
    assert.equal(decodeText(source).encoding, encoding);
  }
  assert.equal(decodeText(new Uint8Array()).content, '');
});
test('binary and oversized inputs are rejected before destructive decoding', () => {
  assert.throws(() => decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), (error: unknown) => error instanceof FileReadError && error.kind === 'binary');
  assert.throws(() => decodeText(new Uint8Array(MAX_FILE_BYTES + 1)), (error: unknown) => error instanceof FileReadError && error.kind === 'size');
  assert.throws(() => decodeText(new Uint8Array([65, 0, 0, 0, 66, 0, 0, 0])), FileReadError);
});
test('names are not limited by extensions, dotfiles or a format whitelist', () => {
  for (const name of ['main.py', 'config.custom', 'LICENSE', '.env', '.gitignore', '한글 메모.txt']) assert.equal(validateFileName(name), name);
  for (const name of ['', '.', '..', 'folder/file', 'folder\\file', 'a\0b']) assert.throws(() => validateFileName(name));
  assert.equal(decodeText(new TextEncoder().encode('MZ is just text.')).content, 'MZ is just text.');
});
test('ANSI-colored logs remain editable text', () => {
  const source = '\u001b[31merror\u001b[0m\n';
  assert.equal(decodeText(new TextEncoder().encode(source)).content, source);
});
