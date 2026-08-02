#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './release-provenance.js';

const outputs = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/crypto-backend.js',
  'dist/crypto-backend.cjs',
  'dist/wasm/loader.js',
  'dist/wasm/loader.cjs',
];
const literalWasmImport =
  /import\s*\(\s*['"][^'"]*voided_wasm\.js['"]\s*\)/;
const guardedRuntimeImport =
  /import\s*\(\s*\/\*\s*@vite-ignore\s*\*\/\s*[A-Za-z_$][\w$]*\s*\)/g;

for (const relativePath of outputs) {
  const path = join(packageRoot, relativePath);
  if (!existsSync(path)) {
    throw new Error(`[verify-wasm-loader-dist] build omitted ${relativePath}`);
  }
  const source = readFileSync(path, 'utf8');
  if (literalWasmImport.test(source)) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} contains a statically analyzable WASM glue import`,
    );
  }
  const guardedImportCount = source.match(guardedRuntimeImport)?.length ?? 0;
  if (guardedImportCount < 3) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} lost a guarded runtime WASM import`,
    );
  }
  if (
    source.includes('__wbindgen_start') ||
    source.includes('voided_wasm_bg.wasm')
  ) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} inlined wasm-bindgen glue`,
    );
  }
  if (source.includes('resetWasm')) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} exposed the loader lock reset`,
    );
  }
}

for (const relativePath of [
  'dist/index.js',
  'dist/index.cjs',
  'dist/crypto-backend.js',
  'dist/crypto-backend.cjs',
  'dist/wasm/loader.js',
  'dist/wasm/loader.cjs',
]) {
  const source = readFileSync(join(packageRoot, relativePath), 'utf8');
  if (
    !source.includes('configureWasmLoader') ||
    !(
      source.includes('decompressBounded') ||
      source.includes('decompress_bounded')
    )
  ) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} omitted a required WASM API`,
    );
  }
}

for (const relativePath of [
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/crypto-backend.d.ts',
  'dist/crypto-backend.d.cts',
  'dist/wasm/loader.d.ts',
  'dist/wasm/loader.d.cts',
]) {
  const source = readFileSync(join(packageRoot, relativePath), 'utf8');
  if (
    !source.includes('configureWasmLoader') ||
    !source.includes('WasmLoaderOptions') ||
    !(
      source.includes('decompressBounded') ||
      source.includes('decompress_bounded')
    )
  ) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} omitted required WASM API types`,
    );
  }
  if (source.includes('resetWasm')) {
    throw new Error(
      `[verify-wasm-loader-dist] ${relativePath} declared the loader lock reset`,
    );
  }
}

console.log('[verify-wasm-loader-dist] runtime WASM imports are preserved');
