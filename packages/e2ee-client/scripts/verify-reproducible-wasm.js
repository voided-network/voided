#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './release-provenance.js';

const wasmDir = join(packageRoot, 'wasm');
const reproducibleFiles = [
  'manifest.json',
  'package.json',
  'voided_wasm.js',
  'voided_wasm.d.ts',
  'voided_wasm_bg.wasm',
  'voided_wasm_bg.wasm.d.ts',
];

function run(script, args = []) {
  const result = spawnSync(
    process.execPath,
    [join(packageRoot, 'scripts', script), ...args],
    {
      cwd: packageRoot,
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `[verify-wasm-reproducibility] ${script} exited with status ` +
        `${result.status ?? 'unknown'}`,
    );
  }
}

function readArtifacts() {
  return new Map(
    reproducibleFiles.map((file) => [
      file,
      readFileSync(join(wasmDir, file)),
    ]),
  );
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// The caller creates the baseline with build-wasm-release.js. Verify that it
// is current and executable before retaining its exact bytes for comparison.
run('verify-release.js');
const baseline = readArtifacts();

// Build from a fresh copied source tree and fresh Cargo target directory. The
// slot deliberately changes the physical build root; path remapping must make
// that irrelevant to every published byte.
run('build-wasm-release.js', ['--repro-slot=verification']);
run('verify-release.js');
const reproduction = readArtifacts();

const changed = reproducibleFiles.filter(
  (file) => !baseline.get(file).equals(reproduction.get(file)),
);
if (changed.length > 0) {
  const details = changed
    .map(
      (file) =>
        `  ${file}: ${digest(baseline.get(file))} -> ` +
        `${digest(reproduction.get(file))}`,
    )
    .join('\n');
  throw new Error(
    '[verify-wasm-reproducibility] isolated builds were not byte-identical\n' +
      details,
  );
}

console.log(
  '[verify-wasm-reproducibility] two isolated builds are byte-identical: ' +
    digest(reproduction.get('voided_wasm_bg.wasm')),
);
