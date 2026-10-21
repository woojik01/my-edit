import assert from 'node:assert/strict';
import { test } from 'node:test';
import { removeDirectoryFile, writeDirectoryFile } from '../app/src/native-files.ts';
import type { LocalDirectoryHandle, LocalFileHandle } from '../app/src/native-files.ts';

function fakeFile(name: string, source: string) {
  let contents = new TextEncoder().encode(source);
  const identity = {};
  const handle: LocalFileHandle = {
    name,
    async getFile() { return new File([contents], name, { lastModified: 123 }); },
    async createWritable() {
      return {
        async write(value) { contents = new Uint8Array(await value.arrayBuffer()); },
        async close() {}
      };
    },
    async isSameEntry(other) { return other === handle && identity !== undefined; }
  };
  return { handle, read: () => new TextDecoder().decode(contents) };
}

function fakeDirectory(initial: LocalFileHandle[] = []) {
  const files = new Map(initial.map((handle) => [handle.name, handle]));
  const directory: LocalDirectoryHandle = {
    name: 'Project',
    async getFileHandle(name, options) {
      const existing = files.get(name);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
      const created = fakeFile(name, '').handle;
      files.set(name, created);
      return created;
    },
    async removeEntry(name) {
      if (!files.delete(name)) throw new DOMException('Missing file', 'NotFoundError');
    }
  };
  return { directory, files };
}

test('device trash removes the matching file entry from a selected directory', async () => {
  const original = fakeFile('notes.txt', 'keep this for restore');
  const { directory, files } = fakeDirectory([original.handle]);
  assert.equal(await removeDirectoryFile(directory, 'notes.txt', original.handle), true);
  assert.equal(files.has('notes.txt'), false);
});

test('device trash refuses a same-name file that is not the original entry', async () => {
  const original = fakeFile('notes.txt', 'original');
  const other = fakeFile('notes.txt', 'different');
  const { directory, files } = fakeDirectory([other.handle]);
  await assert.rejects(removeDirectoryFile(directory, 'notes.txt', original.handle), /다른 파일/);
  assert.equal(files.has('notes.txt'), true);
});

test('restoring a device file writes it back to the selected directory', async () => {
  const { directory, files } = fakeDirectory();
  const bytes = new TextEncoder().encode('restored contents');
  const restored = await writeDirectoryFile(directory, 'notes.txt', bytes);
  assert.equal(restored.existed, false);
  assert.equal(restored.file.name, 'notes.txt');
  assert.equal(new TextDecoder().decode(await restored.file.arrayBuffer()), 'restored contents');
  assert.equal(files.has('notes.txt'), true);
});
