#!/usr/bin/env node

import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './release-provenance.js';

// The verifier executes the exact compiled module, including hostile X25519 and
// AEAD-tag vectors. Nothing becomes packable unless every check completes.
await import('./verify-release.js');

const wasmDir = join(packageRoot, 'wasm');
const allowedFiles = [
  'manifest.json',
  'package.json',
  'voided_wasm.js',
  'voided_wasm.d.ts',
  'voided_wasm_bg.wasm',
  'voided_wasm_bg.wasm.d.ts',
];
const temporary = join(wasmDir, '.npmignore.new');
writeFileSync(
  temporary,
  [
    '# Generated only after the exact WASM artifact passes release verification.',
    '*',
    ...allowedFiles.map((file) => `!${file}`),
    '',
  ].join('\n'),
);
renameSync(temporary, join(wasmDir, '.npmignore'));
console.log('[prepare-wasm-package] verified WASM allowlist is ready');
