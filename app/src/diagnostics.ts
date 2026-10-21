import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';
import { HIGHLIGHT_LIMIT } from './files.ts';

/** Convert parser error nodes from the active CodeMirror language into lint diagnostics. */
export function syntaxDiagnostics(state: EditorState): Diagnostic[] {
  if (state.doc.length > HIGHLIGHT_LIMIT) return [];
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  if (!state.doc.length || tree.length < state.doc.length) return [];

  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  tree.iterate({
    enter(node) {
      if (!node.type.isError) return;
      const key = `${node.from}:${node.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      diagnostics.push({
        from: node.from,
        to: node.to,
        severity: 'error',
        message: '현재 언어 모드의 문법 분석기가 이 구문을 오류로 표시했어요.'
      });
    }
  });
  return diagnostics;
}
