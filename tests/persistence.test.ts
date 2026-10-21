import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDocument } from '../app/src/documents.ts';
import { deleteDocumentsPermanently, listDocuments, listSaveTargets, saveDocument, saveSaveTarget, addRestoredDocuments, listRecoveryPoints } from '../app/src/persistence.ts';

// Seed the exact v1 store layout before the new persistence module opens it.
await new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('my-edit-local', 1);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('projects', { keyPath: 'id' }); store.createIndex('updatedAt', 'updatedAt');
    const recovery = request.result.createObjectStore('recovery', { keyPath: 'id' }); recovery.createIndex('projectId', 'projectId');
    store.add({ id: 'legacy', name: 'old', content: '<b>keep</b>', createdAt: 1, updatedAt: 2, deletedAt: null, cursor: 3 });
    recovery.add({ id: 'recovery-old', projectId: 'legacy', content: 'earlier', createdAt: 1 });
  };
  request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
});

test('v1 database upgrades without losing documents or recovery history', async () => {
  const migrated = (await listDocuments()).find((doc) => doc.id === 'legacy')!;
  assert.equal(migrated.name, 'old.html'); assert.equal(migrated.content, '<b>keep</b>'); assert.equal(migrated.cursor, 3);
  assert.equal((await listRecoveryPoints('legacy'))[0].content, 'earlier');
});
test('saving takes an immutable snapshot and commits before resolving', async () => {
  const doc = newDocument('main.py', 'before');
  const saving = saveDocument(doc);
  doc.content = 'after';
  await saving;
  assert.equal((await listDocuments()).find((item) => item.id === doc.id)!.content, 'before');
  await saveDocument(doc, 'before');
  assert.equal((await listDocuments()).find((item) => item.id === doc.id)!.content, 'after');
  assert.equal((await listRecoveryPoints(doc.id))[0].content, 'before');
});
test('restoring duplicate IDs adds copies and does not overwrite current work', async () => {
  const original = newDocument('.env', 'VALUE=original'); await saveDocument(original);
  const restored = await addRestoredDocuments([{ ...original, content: 'VALUE=backup' }, { ...original, content: 'VALUE=second' }], new Set((await listDocuments()).map((doc) => doc.id)));
  assert.notEqual(restored[0].id, original.id); assert.notEqual(restored[0].id, restored[1].id);
  const all = await listDocuments(); assert.equal(all.find((doc) => doc.id === original.id)!.content, 'VALUE=original');
  assert.equal(all.find((doc) => doc.id === restored[0].id)!.content, 'VALUE=backup');
});
test('permanent deletion removes workspace data, save location, and recovery points together', async () => {
  const doc = newDocument('discard.txt', 'content');
  await saveDocument(doc, 'previous');
  await saveSaveTarget({ projectId: doc.id, kind: 'directory', directoryHandle: { name: 'Test folder' } as never, directoryName: 'Test folder', fileName: 'discard.txt', lastModified: 10 });
  assert.equal((await listSaveTargets()).some((target) => target.projectId === doc.id), true);
  await deleteDocumentsPermanently([doc.id]);
  assert.equal((await listDocuments()).some((item) => item.id === doc.id), false);
  assert.equal((await listSaveTargets()).some((target) => target.projectId === doc.id), false);
  assert.deepEqual(await listRecoveryPoints(doc.id), []);
});
