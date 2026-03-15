#!/usr/bin/env node
/**
 * Cross-platform build script for voided-node native module.
 * 
 * Uses cargo-zigbuild to cross-compile to multiple platforms from a single machine.
 * 
 * Prerequisites:
 *   1. Install Zig: https://ziglang.org/download/
 *      - Windows: scoop install zig  OR  winget install zig.zig
 *      - Or set VOIDED_ZIG_BIN to an explicit executable path
 *   
 *   2. Install cargo-zigbuild:
 *      cargo install cargo-zigbuild
 *   
 *   3. Add Rust targets:
 *      rustup target add x86_64-unknown-linux-gnu
 *      rustup target add x86_64-apple-darwin
 *      rustup target add aarch64-apple-darwin
 * 
 * Usage:
 *   node scripts/build-cross-platform.js           # Build all platforms
 *   node scripts/build-cross-platform.js --linux   # Build Linux only
 *   node scripts/build-cross-platform.js --mac     # Build macOS only
 *   node scripts/build-cross-platform.js --windows # Build Windows only
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, delimiter } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..');
const cratesDir = join(workspaceRoot, 'crates');
const encServerDir = join(workspaceRoot, 'packages', 'enc-server');

const args = process.argv.slice(2);
const buildAll = args.length === 0;
const buildLinux = buildAll || args.includes('--linux');
const buildMac = buildAll || args.includes('--mac');
const buildWindows = buildAll || args.includes('--windows');

// Target configurations
const targets = [
  { 
    id: 'win32-x64-msvc', 
    rustTarget: 'x86_64-pc-windows-msvc', 
    enabled: buildWindows,
    useZig: false, // Native build on Windows
  },
  { 
    id: 'linux-x64-gnu', 
    rustTarget: 'x86_64-unknown-linux-gnu', 
    enabled: buildLinux,
    useZig: true,
  },
  { 
    id: 'darwin-x64', 
    rustTarget: 'x86_64-apple-darwin', 
    enabled: buildMac,
    useZig: true,
  },
  { 
    id: 'darwin-arm64', 
    rustTarget: 'aarch64-apple-darwin', 
    enabled: buildMac,
    useZig: true,
  },
];

// Try to find Zig from an explicit env var, an optional local tool cache, or PATH.
function findZig() {
  const possiblePaths = [
    process.env.VOIDED_ZIG_BIN,
    process.env.ZIG_COMMAND,
    join(workspaceRoot, 'tools', 'zig', 'windows-x86_64', 'zig.exe'),
    join(workspaceRoot, 'tools', 'zig', 'zig.exe'),
    'zig', // In PATH
  ].filter(Boolean);
  
  for (const zigPath of possiblePaths) {
    const check = spawnSync(zigPath, ['version'], { encoding: 'utf-8', shell: true });
    if (check.status === 0) {
      return zigPath;
    }
  }
  return null;
}

function checkPrerequisites() {
  console.log('Checking prerequisites...\n');
  
  // Check Rust
  const rustCheck = spawnSync('cargo', ['--version'], { encoding: 'utf-8', shell: true });
  if (rustCheck.status !== 0) {
    console.error('❌ Rust not found. Install from https://rustup.rs');
    process.exit(1);
  }
  console.log(`✓ ${rustCheck.stdout.trim()}`);
  
  const needsZig = targets.some(target => target.enabled && target.useZig);
  if (needsZig) {
    const zigPath = findZig();
    if (!zigPath) {
      console.error(`
❌ Zig not found. Install it with your package manager, set VOIDED_ZIG_BIN,
   or place an untracked local copy under tools/zig/.
   Download: https://ziglang.org/download/
`);
      process.exit(1);
    }
    const zigCheck = spawnSync(zigPath, ['version'], { encoding: 'utf-8', shell: true });
    console.log(`✓ Zig ${zigCheck.stdout.trim()} (${zigPath})`);
    process.env.ZIG_COMMAND = zigPath;
  } else {
    console.log('✓ Zig not required for the selected targets');
  }
  
  if (needsZig) {
    const zigbuildCheck = spawnSync('cargo', ['zigbuild', '--version'], { encoding: 'utf-8', shell: true });
    if (zigbuildCheck.status !== 0) {
      console.log('\n⚠️  cargo-zigbuild not found. Installing...');
      execSync('cargo install cargo-zigbuild', { stdio: 'inherit', shell: true });
    } else {
      console.log(`✓ ${zigbuildCheck.stdout.trim()}`);
    }
  }
  
  console.log('');
}

// Find rustup path
const rustupPath = process.platform === 'win32' 
  ? join(process.env.USERPROFILE || '', '.cargo', 'bin', 'rustup.exe')
  : 'rustup';

function addRustTarget(target) {
  const check = spawnSync(rustupPath, ['target', 'list', '--installed'], { encoding: 'utf-8', shell: true });
  if (!check.stdout || !check.stdout.includes(target)) {
    console.log(`Adding Rust target: ${target}`);
    try {
      execSync(`"${rustupPath}" target add ${target}`, { stdio: 'inherit', shell: true });
    } catch (e) {
      console.log(`Note: Could not add target ${target}, it may already be installed`);
    }
  }
}

function buildTarget(target) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Building for ${target.id} (${target.rustTarget})`);
  console.log('='.repeat(60));
  
  // Add the rust target if needed
  addRustTarget(target.rustTarget);
  
  // Build command - use cargo-zigbuild with explicit zig path for cross-compilation
  const zigPath = target.useZig ? findZig() : null;
  const buildCmd = target.useZig
    ? `cargo zigbuild --release -p voided-node --target ${target.rustTarget}`
    : `cargo build --release -p voided-node --target ${target.rustTarget}`;
  
  // Set environment with ZIG path
  const zigDir = zigPath && /[\\/]/.test(zigPath) ? dirname(zigPath) : null;
  const buildEnv = { 
    ...process.env,
    ...(zigPath ? { ZIG_COMMAND: zigPath } : {}),
    PATH: [zigDir, process.env.PATH].filter(Boolean).join(delimiter),
  };
  
  try {
    execSync(buildCmd, { 
      cwd: cratesDir, 
      stdio: 'inherit', 
      shell: true,
      env: buildEnv
    });
  } catch (err) {
    console.error(`❌ Build failed for ${target.id}`);
    return false;
  }
  
  // Find and copy the output
  const outputDir = join(cratesDir, 'target', target.rustTarget, 'release');
  const outputFile = target.id.startsWith('win32') 
    ? 'voided_node.dll' 
    : target.id.startsWith('darwin') 
      ? 'libvoided_node.dylib' 
      : 'libvoided_node.so';
  
  const sourcePath = join(outputDir, outputFile);
  const destDir = join(encServerDir, 'prebuilds', target.id);
  const destPath = join(destDir, 'voided_node.node');
  
  if (existsSync(sourcePath)) {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(sourcePath, destPath);
    console.log(`✓ Copied to ${destPath}`);
    return true;
  } else {
    // Try finding .node directly
    const nodeFile = join(outputDir, 'voided_node.node');
    if (existsSync(nodeFile)) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(nodeFile, destPath);
      console.log(`✓ Copied to ${destPath}`);
      return true;
    }
    console.error(`❌ Output not found: ${sourcePath}`);
    return false;
  }
}

// Main
console.log('Cross-Platform Build for voided-node\n');

checkPrerequisites();

const results = [];

for (const target of targets) {
  if (target.enabled) {
    const success = buildTarget(target);
    results.push({ ...target, success });
  }
}

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log('BUILD SUMMARY');
console.log('='.repeat(60));

for (const r of results) {
  const status = r.success ? '✓' : '❌';
  console.log(`  ${status} ${r.id}`);
}

const successCount = results.filter(r => r.success).length;
console.log(`\n${successCount}/${results.length} platforms built successfully.`);

if (successCount > 0) {
  console.log(`\nPrebuilds are in: packages/enc-server/prebuilds/`);
  console.log(`\nTo publish: cd packages/enc-server && npm publish`);
}
