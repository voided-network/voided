import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

assert(process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--package'),
  'Usage: node verify-declaration-types.js [--package BUILT_PACKAGE_DIR]');
const root = process.argv[3] ? resolve(process.argv[3]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = ['index', 'crypto-backend', 'transport-crypto', 'wasm/loader']
  .flatMap(name => ['.d.ts', '.d.cts'].map(extension => resolve(root, 'dist', name + extension)));
assert(entries.every(file => existsSync(file)), 'Build all ESM/CommonJS declaration entrypoints first');
const program = ts.createProgram(entries, { noEmit: true, strict: true, skipLibCheck: false,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
}));
console.log(JSON.stringify({ schema: 'voided.emitted-declaration-types.v1', packageRoot: root,
  entries: entries.length, compiler: ts.version, skipLibCheck: false, passed: diagnostics.length === 0,
  diagnostics: diagnostics.map(value => ({ code: value.code,
    message: ts.flattenDiagnosticMessageText(value.messageText, '\n') })) }));
process.exitCode = diagnostics.length ? 1 : 0;
