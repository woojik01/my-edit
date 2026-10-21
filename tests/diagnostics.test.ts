import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { languageDescriptions } from '../app/src/languages.ts';
import { syntaxDiagnostics } from '../app/src/diagnostics.ts';

test('syntax diagnostics report parser errors for a supported language mode', async () => {
  const javascript = languageDescriptions.find((language) => language.name === 'JavaScript');
  assert.ok(javascript);
  const support = await javascript.load();
  const invalid = EditorState.create({ doc: 'const = 1;', extensions: support });
  const valid = EditorState.create({ doc: 'const value = 1;', extensions: support });
  assert.ok(syntaxDiagnostics(invalid).length > 0);
  assert.equal(syntaxDiagnostics(valid).length, 0);
});

test('syntax diagnostics stay quiet when no parser is active', () => {
  const state = EditorState.create({ doc: 'const = 1;' });
  assert.deepEqual(syntaxDiagnostics(state), []);
});
