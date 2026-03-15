#!/usr/bin/env node
/**
 * Build script for voided-wasm module.
 * 
 * This script builds the Rust WASM module and copies artifacts.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname, delimiter } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');
const cratesDir = join(rootDir, 'crates');
const wasmDir = join(cratesDir, 'voided-wasm');
const outputDir = join(__dirname, '..', 'wasm');
const rustupBinDir = '/opt/homebrew/opt/rustup/bin';

function getPreferredBinDirs() {
  const dirs = [join(homedir(), '.cargo', 'bin'), rustupBinDir];
  return dirs.filter((dir, index) => existsSync(dir) && dirs.indexOf(dir) === index);
}

function getToolEnv() {
  const preferredBinDirs = getPreferredBinDirs();
  return {
    ...process.env,
    PATH: [...preferredBinDirs, process.env.PATH ?? ''].join(delimiter),
  };
}

function quote(cmd) {
  if (cmd.includes(' ')) return `"${cmd}"`;
  return cmd;
}

function resolveBinary(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const binDir of getPreferredBinDirs()) {
    const candidate = join(binDir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function build() {
  console.log('[build-wasm] Building voided-wasm module...');
  const cargoCmd = resolveBinary('cargo');
  let wasmPackCmd = resolveBinary('wasm-pack');
  const toolEnv = getToolEnv();
  
  // Check for Rust toolchain
  try {
    execSync(`${quote(cargoCmd)} --version`, { stdio: 'pipe', env: toolEnv });
  } catch {
    console.error('[build-wasm] ERROR: Rust toolchain not found.');
    console.error('[build-wasm] Please install Rust from https://rustup.rs/');
    process.exit(1);
  }
  
  // Check for wasm-pack
  try {
    execSync(`${quote(wasmPackCmd)} --version`, { stdio: 'pipe', env: toolEnv });
  } catch {
    console.log('[build-wasm] Installing wasm-pack...');
    try {
      // `--locked` keeps dependency versions from wasm-pack's lockfile,
      // avoiding newer crates that may require a newer local rustc.
      execSync(`${quote(cargoCmd)} install wasm-pack --locked`, { stdio: 'inherit', env: toolEnv });
      wasmPackCmd = resolveBinary('wasm-pack');
    } catch (err) {
      console.error('[build-wasm] Failed to install wasm-pack:', err.message);
      process.exit(1);
    }
  }
  
  // Build with wasm-pack
  console.log('[build-wasm] Running wasm-pack build...');
  try {
    execSync(`${quote(wasmPackCmd)} build --target web --release`, {
      cwd: wasmDir,
      env: toolEnv,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[build-wasm] wasm-pack build failed:', err.message);
    process.exit(1);
  }
  
  // Copy artifacts to output directory
  const pkgDir = join(wasmDir, 'pkg');
  
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  const filesToCopy = [
    'voided_wasm.js',
    'voided_wasm_bg.wasm',
    'voided_wasm.d.ts',
  ];
  
  for (const file of filesToCopy) {
    const src = join(pkgDir, file);
    const dest = join(outputDir, file);
    
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`[build-wasm] Copied: ${file}`);
    } else {
      console.warn(`[build-wasm] Warning: ${file} not found`);
    }
  }
  
  // Create a wrapper that handles initialization
  const wrapperContent = `
// Auto-generated WASM initialization wrapper
import init, * as wasm from './voided_wasm.js';

let initialized = false;
let initPromise = null;

export async function initVoidedWasm() {
  if (initialized) return wasm;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    await init();
    initialized = true;
    return wasm;
  })();
  
  return initPromise;
}

export { wasm };
export default initVoidedWasm;
`;

  writeFileSync(join(outputDir, 'init.js'), wrapperContent.trim());
  console.log('[build-wasm] Created init.js wrapper');
  
  console.log('[build-wasm] Build complete!');
}

build();

