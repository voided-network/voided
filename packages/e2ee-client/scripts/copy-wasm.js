/**
 * Script to copy the compiled WASM module to the correct location for packaging.
 * 
 * Usage:
 *   node scripts/copy-wasm.js
 * 
 * This should be run after `wasm-pack build` in crates/voided-wasm
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const workspaceRoot = join(packageRoot, '..', '..');

// Source location (where wasm-pack puts the output)
const wasmPkgDir = join(workspaceRoot, 'crates', 'voided-wasm', 'pkg');

// Destination location
const destDir = join(packageRoot, 'wasm');

// Files to copy
const filesToCopy = [
  'voided_wasm.js',
  'voided_wasm.d.ts',
  'voided_wasm_bg.wasm',
  'voided_wasm_bg.wasm.d.ts',
];

console.log('Looking for WASM module...');
console.log(`Source: ${wasmPkgDir}`);

if (!existsSync(wasmPkgDir)) {
  console.error('ERROR: WASM package directory not found.');
  console.error(`Expected at: ${wasmPkgDir}`);
  console.error('\nPlease run:');
  console.error('  cd crates/voided-wasm && wasm-pack build --target web --out-dir pkg');
  process.exit(1);
}

// Create destination directory
mkdirSync(destDir, { recursive: true });

// Copy each file
let copied = 0;
for (const file of filesToCopy) {
  const src = join(wasmPkgDir, file);
  const dest = join(destDir, file);
  
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
    copied++;
  } else {
    console.warn(`Warning: ${file} not found`);
  }
}

if (copied === 0) {
  console.error('ERROR: No WASM files found to copy.');
  process.exit(1);
}

console.log(`\n✓ Copied ${copied} WASM files to ${destDir}`);
console.log('\nTo publish, run:');
console.log('  npm publish');

