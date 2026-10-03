import { expect } from '@playwright/test';
import ts from 'typescript';

/** Provenance URLs are data. Standalone programs must not import or call network/code loaders. */
export function expectStandaloneSource(code: string): void {
  const syntax = ts.createSourceFile('download.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const forbidden = new Set(['eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts', 'sendBeacon']);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) violations.push('external import');
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) && callee.argumentExpression && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text : '';
      if (callee.kind === ts.SyntaxKind.ImportKeyword || forbidden.has(name)) violations.push(name || 'dynamic import');
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  expect(violations).toEqual([]);
}
