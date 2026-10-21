import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expiredTrashIds, newDocument, normalizeDocument, createBackup, parseBackup } from '../app/src/documents.ts';
import { detectLanguage, languageDescriptions } from '../app/src/languages.ts';
import { MAX_FILE_BYTES } from '../app/src/files.ts';

test('legacy HTML documents keep their data and gain their implicit extension once', () => {
  const old = { id: 'old-id', name: '시작하기', content: '<p>안녕</p>', createdAt: 12, updatedAt: 24, deletedAt: null, cursor: 4 };
  const migrated = normalizeDocument(old);
  assert.equal(migrated.name, '시작하기.html');
  assert.equal(migrated.content, old.content);
  assert.equal(migrated.cursor, 4);
  assert.equal(migrated.id, old.id);
  assert.equal(migrated.createdAt, 12);
  assert.deepEqual(normalizeDocument(migrated), migrated);
  assert.equal(normalizeDocument({ ...old, name: 'already.html' }).name, 'already.html');
});
test('v2 creates blank files with arbitrary names and never adds an HTML suffix', () => {
  for (const name of ['main.py', 'LICENSE', '.env', 'unknown.abcxyz']) {
    const doc = newDocument(name);
    assert.equal(doc.name, name); assert.equal(doc.content, '');
    assert.equal(normalizeDocument(doc).name, name);
  }
});
test('the external import size limit does not make previously stored large documents unreadable', () => {
  const content = 'x'.repeat(MAX_FILE_BYTES + 1);
  assert.equal(normalizeDocument({ id: 'large-existing', name: 'old', content }).content, content);
});
test('v2 backup round trip preserves UTF-16, line ending and filename metadata', () => {
  const doc = newDocument('.env', 'HELLO=안녕\n', { encoding: 'utf-16be', bom: true, lineEnding: 'CRLF' });
  doc.language = 'Properties files'; doc.revision = 3; doc.exportedRevision = 2;
  assert.deepEqual(parseBackup(createBackup([doc])), [doc]);
});
test('legacy backups migrate and invalid backups fail as a whole', () => {
  const old = { id: 'a', name: 'legacy', content: '<p>old</p>' };
  assert.equal(parseBackup(JSON.stringify({ format: 'my-edit-backup', version: 1, projects: [old] }))[0].name, 'legacy.html');
  assert.throws(() => parseBackup(JSON.stringify({ format: 'my-edit-backup', version: 2, projects: [old, { name: 'invalid' }] })));
  assert.throws(() => parseBackup('{"format":"other","projects":[]}'));
});
test('trash expiry uses the selected day count and keeps newer items', () => {
  const now = 1_800_000_000_000;
  const old = newDocument('old.txt'); old.deletedAt = now - 4 * 24 * 60 * 60 * 1000;
  const recent = newDocument('recent.txt'); recent.deletedAt = now - 2 * 24 * 60 * 60 * 1000;
  const live = newDocument('live.txt');
  assert.deepEqual(expiredTrashIds([old, recent, live], 3, now), [old.id]);
  assert.deepEqual(expiredTrashIds([old, recent, live], 5, now), []);
});
test('common formats, dotfiles, shebangs and unknown files select useful modes', () => {
  for (const [name, language] of [['main.py', 'Python'], ['main.ts', 'TypeScript'], ['data.json', 'JSON'], ['notes.md', 'Markdown'], ['config.yaml', 'YAML'], ['build.rs', 'Rust'], ['Main.kt', 'Kotlin'], ['.env.local', 'Properties files'], ['Dockerfile', 'Dockerfile']]) {
    assert.equal(detectLanguage({ name, content: '', language: 'auto' })?.name, language, name);
  }
  assert.equal(detectLanguage({ name: 'script', content: '#!/usr/bin/env python3\nprint(1)', language: 'auto' })?.name, 'Python');
  assert.equal(detectLanguage({ name: 'thing.unknown', content: 'text', language: 'auto' }), null);
  assert.equal(detectLanguage({ name: 'main.py', content: '', language: 'plain' }), null);
  assert.equal(detectLanguage({ name: 'thing.unknown', content: '', language: 'JavaScript' })?.name, 'JavaScript');
});
test('every bundled language mode actually loads', async () => {
  assert.ok(languageDescriptions.length >= 100);
  const loaded = await Promise.all(languageDescriptions.map((language) => language.load()));
  assert.ok(loaded.every((support) => support.language));
});
