#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import {
  digestFile,
  digestFiles,
  digestText,
  getCoreVersion,
  getWasmBindingVersion,
  getWasmSourceFiles,
  packageRoot,
  readJson,
} from './release-provenance.js';

function fail(message) {
  throw new Error(`[verify-wasm-release] ${message}`);
}

function mutateBase64(value, label) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0) fail(`WASM encryption returned empty ${label}`);
  bytes[0] ^= 1;
  return bytes.toString('base64');
}

function requireDecryptRejection(wasm, encrypted, key, label) {
  let rejected = false;
  try {
    wasm.decrypt(encrypted, key);
  } catch {
    rejected = true;
  }
  if (!rejected) fail(`WASM accepted mutated ${label}`);
}

const wasmDir = join(packageRoot, 'wasm');
const manifestPath = join(wasmDir, 'manifest.json');
const manifest = readJson(manifestPath);
const currentSourceDigest = digestFiles(getWasmSourceFiles());
const requiredArtifactFiles = [
  'voided_wasm.js',
  'voided_wasm_bg.wasm',
  'voided_wasm.d.ts',
  'voided_wasm_bg.wasm.d.ts',
  'package.json',
];
const requiredArtifactSet = new Set(requiredArtifactFiles);

if (manifest.schemaVersion !== 4) fail('unsupported provenance manifest schema');
if (manifest.package !== '@voideddev/e2ee-client') fail('manifest package name mismatch');
if (manifest.target !== 'wasm32-unknown-unknown') fail('manifest target mismatch');
if (manifest.packageVersion !== readJson(join(packageRoot, 'package.json')).version) {
  fail('manifest package version does not match package.json');
}
if (manifest.coreVersion !== getCoreVersion()) fail('manifest voided-core version is stale');
if (manifest.bindingVersion !== getWasmBindingVersion()) {
  fail('manifest voided-wasm version is stale');
}
if (manifest.sourceDigest !== currentSourceDigest) {
  fail(
    `WASM was not built from the current security-relevant source tree\n` +
      `  manifest: ${manifest.sourceDigest}\n` +
      `  current:  ${currentSourceDigest}`,
  );
}

const requiredToolKeys = [
  'cargo',
  'cargoSha256',
  'rustc',
  'rustcSha256',
  'wasmBindgen',
  'wasmBindgenSha256',
  'wasmPack',
  'wasmPackSha256',
];
if (!manifest.tools || typeof manifest.tools !== 'object') {
  fail('manifest tools are missing');
}
const actualToolKeys = Object.keys(manifest.tools).sort();
if (
  actualToolKeys.length !== requiredToolKeys.length ||
  actualToolKeys.some((key, index) => key !== requiredToolKeys[index])
) {
  fail('manifest must contain the exact release tool set');
}
for (const key of requiredToolKeys) {
  if (
    typeof manifest.tools[key] !== 'string' ||
    manifest.tools[key].length === 0 ||
    manifest.tools[key].length > 512
  ) {
    fail(`manifest tool ${key} is invalid`);
  }
}
for (const key of ['cargoSha256', 'rustcSha256', 'wasmBindgenSha256', 'wasmPackSha256']) {
  if (!/^sha256:[0-9a-f]{64}$/.test(manifest.tools[key])) {
    fail(`manifest ${key} is invalid`);
  }
}
const toolEntries = Object.entries(manifest.tools)
  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([name, value]) => `${name}:${value}`);

const expectedBuildEnvironment = {
  cargoIncremental: '0',
  locale: 'C',
  offline: 'true',
  pathRemapBuild: '/voided-build',
  pathRemapCargoHome: '/cargo-home',
  pathRemapSource: '/voided-source',
  pathRemapToolchain: '/rust-toolchain',
  sourceDateEpoch: '0',
  timezone: 'UTC',
};
if (
  !manifest.buildEnvironment ||
  typeof manifest.buildEnvironment !== 'object' ||
  JSON.stringify(manifest.buildEnvironment) !==
    JSON.stringify(expectedBuildEnvironment)
) {
  fail('manifest reproducible-build environment is invalid');
}
const buildEnvironmentEntries = Object.entries(manifest.buildEnvironment)
  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([name, value]) => `${name}:${value}`);

const artifactDigests = [];
if (
  !Array.isArray(manifest.artifacts) ||
  manifest.artifacts.length !== requiredArtifactFiles.length
) {
  fail('manifest must contain the exact required WASM artifact set');
}
const seenArtifactFiles = new Set();
for (const artifact of manifest.artifacts) {
  if (!artifact || typeof artifact !== 'object' || typeof artifact.file !== 'string') {
    fail('manifest contains an invalid artifact entry');
  }
  if (artifact.file.includes('/') || artifact.file.includes('\\')) {
    fail(`manifest artifact path must be a basename: ${artifact.file}`);
  }
  if (!requiredArtifactSet.has(artifact.file)) {
    fail(`manifest contains unexpected artifact ${artifact.file}`);
  }
  if (seenArtifactFiles.has(artifact.file)) {
    fail(`manifest contains duplicate artifact ${artifact.file}`);
  }
  seenArtifactFiles.add(artifact.file);
  const path = join(wasmDir, artifact.file);
  const actualDigest = digestFile(path);
  const actualSize = statSync(path).size;
  if (actualDigest !== artifact.sha256) {
    fail(`${artifact.file} hash mismatch (${actualDigest}, expected ${artifact.sha256})`);
  }
  if (actualSize !== artifact.size) {
    fail(`${artifact.file} size mismatch (${actualSize}, expected ${artifact.size})`);
  }
  artifactDigests.push(`${artifact.file}:${actualDigest}:${actualSize}`);
}
for (const file of requiredArtifactFiles) {
  if (!seenArtifactFiles.has(file)) fail(`manifest is missing required artifact ${file}`);
}

const expectedBuildId = digestText(
  [
    manifest.target,
    manifest.sourceDigest,
    ...toolEntries,
    ...buildEnvironmentEntries,
    ...artifactDigests.sort(),
  ].join('\n'),
);
if (manifest.buildId !== expectedBuildId) fail('manifest build ID is invalid');

const wasmPath = join(wasmDir, 'voided_wasm_bg.wasm');
const wasmBytes = readFileSync(wasmPath);
for (const marker of [
  '/Users/',
  '/home/',
  '/private/var/folders/',
  '/root/',
  '/var/folders/',
  '/.cargo/registry/',
  '/.rustup/',
  'C:/Users/',
  'C:\\Users\\',
  'voided-wasm-build-',
]) {
  if (wasmBytes.includes(Buffer.from(marker))) {
    fail(`WASM artifact leaked a host build path containing ${marker}`);
  }
}
const compiledWasm = await WebAssembly.compile(wasmBytes);
const castImports = WebAssembly.Module.imports(compiledWasm)
  .map((entry) => entry.name)
  .filter((name) => name.startsWith('__wbindgen_cast_'));
if (castImports.length === 0) {
  fail('WASM artifact contains no wasm-bindgen cast imports to validate');
}
for (const [index, name] of castImports.entries()) {
  const expected =
    `__wbindgen_cast_${(index + 1).toString(16).padStart(16, '0')}`;
  if (name !== expected) {
    fail(
      `WASM artifact has nondeterministic cast import ordering ` +
        `(${name}, expected ${expected})`,
    );
  }
}

const moduleUrl = pathToFileURL(join(wasmDir, 'voided_wasm.js')).href;
const wasm = await import(`${moduleUrl}?buildId=${encodeURIComponent(manifest.buildId)}`);
await wasm.default({ module_or_path: wasmBytes });

const key = wasm.generateKey();
const plaintext = new TextEncoder().encode('voided packaged WASM release smoke');
const encrypted = wasm.encrypt(plaintext, key, 'aes-256-gcm');
if (typeof encrypted.tag !== 'string' || encrypted.tag.length === 0) {
  fail('WASM encryption did not return its AEAD tag');
}
const opened = wasm.decrypt(encrypted, key);
if (new TextDecoder().decode(opened) !== new TextDecoder().decode(plaintext)) {
  fail('WASM encryption round-trip failed');
}
requireDecryptRejection(
  wasm,
  { ...encrypted, ciphertext: mutateBase64(encrypted.ciphertext, 'ciphertext') },
  key,
  'ciphertext',
);
requireDecryptRejection(
  wasm,
  { ...encrypted, tag: mutateBase64(encrypted.tag, 'authentication tag') },
  key,
  'authentication tag',
);

let rejectedLowOrderPoint = false;
try {
  wasm.x25519SharedSecret(new Uint8Array(32).fill(7), new Uint8Array(32));
} catch {
  rejectedLowOrderPoint = true;
}
if (!rejectedLowOrderPoint) {
  fail('WASM artifact accepts a non-contributory X25519 public key');
}

const boundedPlaintext = new TextEncoder().encode(
  '<article class="oathdoc-root"><section class="oathdoc-clause">' +
    'Auditable terms, transition metadata, and exact style state.</section></article>\n'.repeat(
      20_000,
    ),
);
const boundedCompressed = brotliCompressSync(boundedPlaintext);
if (boundedCompressed.length * 256 >= boundedPlaintext.length) {
  fail('bounded decompression smoke did not create a high-ratio Brotli stream');
}
const boundedOpened = wasm.decompressBounded(
  boundedCompressed,
  'brotli',
  boundedPlaintext.length,
);
if (
  boundedOpened.length !== boundedPlaintext.length ||
  boundedOpened.some((byte, index) => byte !== boundedPlaintext[index])
) {
  fail('bounded WASM decompression was not byte-exact');
}
for (const [limit, label] of [
  [boundedPlaintext.length - 1, 'one-byte-small output cap'],
  [1.5, 'fractional output cap'],
  [512 * 1024 * 1024 + 1, 'global-ceiling overflow'],
]) {
  let rejected = false;
  try {
    wasm.decompressBounded(boundedCompressed, 'brotli', limit);
  } catch {
    rejected = true;
  }
  if (!rejected) fail(`bounded WASM decompression accepted ${label}`);
}
let legacyRatioRejected = false;
try {
  wasm.decompress(boundedCompressed, 'brotli');
} catch {
  legacyRatioRejected = true;
}
if (!legacyRatioRejected) {
  fail('legacy WASM decompression expansion policy changed unexpectedly');
}

const alice = wasm.generateX25519KeyPair(new Uint8Array(32).fill(0x11));
const bob = wasm.generateX25519KeyPair(new Uint8Array(32).fill(0x22));
const aliceShared = new Uint8Array(
  wasm.x25519SharedSecret(
    new Uint8Array(alice.privateKey),
    new Uint8Array(bob.publicKey),
  ),
);
const bobShared = new Uint8Array(
  wasm.x25519SharedSecret(
    new Uint8Array(bob.privateKey),
    new Uint8Array(alice.publicKey),
  ),
);
if (
  aliceShared.length !== 32 ||
  bobShared.length !== 32 ||
  aliceShared.every((byte) => byte === 0) ||
  aliceShared.some((byte, index) => byte !== bobShared[index])
) {
  fail('WASM artifact failed valid X25519 agreement symmetry');
}

console.log(`[verify-wasm-release] verified ${manifest.buildId}`);
