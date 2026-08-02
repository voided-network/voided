#!/usr/bin/env node
/**
 * Master build script for the voided encryption library.
 * 
 * This script builds both the Rust core and the npm packages.
 * 
 * Usage:
 *   node scripts/build-all.js           # Build everything
 *   node scripts/build-all.js --rust    # Build only Rust crates
 *   node scripts/build-all.js --npm     # Build only npm packages
 *   node scripts/build-all.js --wasm    # Build only WASM
 *   node scripts/build-all.js --node    # Build only Node native addon
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..');
const encServerDir = join(workspaceRoot, 'packages', 'enc-server');
const e2eeClientDir = join(workspaceRoot, 'packages', 'e2ee-client');

const args = process.argv.slice(2);
const buildAll = args.length === 0;
const buildNode = buildAll || args.includes('--node') || args.includes('--rust');
const buildWasm = buildAll || args.includes('--wasm') || args.includes('--rust');
const buildNpm = buildAll || args.includes('--npm');

function run(cmd, cwd = workspaceRoot) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

try {
  if (buildNode) {
    section('Building Rust Native Addon (voided-node)');
    run('npm run build:native', encServerDir);
  }

  if (buildWasm) {
    section('Building Rust WASM (voided-wasm)');
    run('npm run build:wasm', e2eeClientDir);
  }

  if (buildNpm) {
    section('Building npm package: @voideddev/enc-server');
    run('npm run build', encServerDir);
    
    section('Building npm package: @voideddev/e2ee-client');
    run('npm run build', e2eeClientDir);
  }

  section('BUILD COMPLETE');
  console.log(`
Build outputs are ready for release verification:

  @voideddev/enc-server
    - Location: packages/enc-server/
    - Release assets: verified prebuilds for every manifest target
    - Verify: cd packages/enc-server && npm run verify:release && npm run smoke:package

  @voideddev/e2ee-client  
    - Location: packages/e2ee-client/
    - Release assets: reproducible WASM plus TypeScript declarations
    - Verify: cd packages/e2ee-client && npm run prepare:wasm && npm run smoke:package

Publishing remains fail-closed behind each package's prepublishOnly source,
artifact, typecheck, and package-smoke gates.
`);

} catch (err) {
  console.error('\n✗ Build failed:', err.message);
  process.exit(1);
}

