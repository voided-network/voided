#!/usr/bin/env node
/**
 * Build script for voided-node native module.
 * 
 * This script builds the Rust native addon for the current platform.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');
const cratesDir = join(rootDir, 'crates');
const packageDir = join(__dirname, '..');

function getNativeLibraryFileName() {
  if (process.platform === 'win32') return 'voided_node.dll';
  if (process.platform === 'darwin') return 'libvoided_node.dylib';
  return 'libvoided_node.so';
}

function getPlatformIdentifier() {
  const platform = process.platform;
  const arch = process.arch;
  
  const platformMap = {
    'win32-x64': 'win32-x64-msvc',
    'win32-arm64': 'win32-arm64-msvc',
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-x64-gnu',
    'linux-arm64': 'linux-arm64-gnu',
  };
  
  return platformMap[`${platform}-${arch}`] || `${platform}-${arch}`;
}

function build() {
  console.log('[build-native] Building voided-node native module...');
  console.log(`[build-native] Platform: ${getPlatformIdentifier()}`);
  
  // Check for Rust toolchain
  try {
    execSync('cargo --version', { stdio: 'pipe' });
  } catch {
    console.error('[build-native] ERROR: Rust toolchain not found.');
    console.error('[build-native] Please install Rust from https://rustup.rs/');
    process.exit(1);
  }
  
  // Build with napi-rs
  console.log('[build-native] Running cargo build...');
  try {
    execSync('cargo build --release -p voided-node', {
      cwd: cratesDir,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[build-native] Cargo build failed:', err.message);
    process.exit(1);
  }

  const nativeLibraryName = getNativeLibraryFileName();
  const sourceLocations = [
    join(cratesDir, 'target', 'release', nativeLibraryName),
    join(rootDir, 'target', 'release', nativeLibraryName),
  ];
  const sourceFile = sourceLocations.find((location) => existsSync(location));

  if (!sourceFile) {
    console.error('[build-native] ERROR: Compiled native library not found.');
    console.error('[build-native] Tried locations:');
    sourceLocations.forEach((location) => console.error(`  - ${location}`));
    process.exit(1);
  }

  const platformId = getPlatformIdentifier();
  const prebuildDir = join(packageDir, 'prebuilds', platformId);
  const prebuildFile = join(prebuildDir, 'voided_node.node');
  const devDir = join(packageDir, 'native');
  const devFile = join(devDir, 'voided_node.node');

  mkdirSync(prebuildDir, { recursive: true });
  mkdirSync(devDir, { recursive: true });

  copyFileSync(sourceFile, prebuildFile);
  copyFileSync(sourceFile, devFile);

  console.log(`[build-native] Copied native module to: ${prebuildFile}`);
  console.log(`[build-native] Copied native module to: ${devFile}`);
  
  console.log('[build-native] Build complete!');
}

build();

