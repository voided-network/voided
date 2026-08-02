#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  digestFile,
  digestFiles,
  digestText,
  getCoreVersion,
  getNativeBindingVersion,
  getNativeSourceFiles,
  getPlatformIdentifier,
  packageRoot,
  readJson,
} from './release-provenance.js';

const currentOnly = process.argv.includes('--current-platform');
const requiredTargets = [
  'darwin-arm64',
  'linux-x64-gnu',
  'win32-x64-msvc',
];
const manifestPath = join(packageRoot, 'prebuilds', 'manifest.json');

function fail(message) {
  throw new Error(`[verify-native-release] ${message}`);
}

function mutateBase64(value, label) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0) fail(`native encryption returned empty ${label}`);
  bytes[0] ^= 1;
  return bytes.toString('base64');
}

function requireDecryptRejection(binding, encrypted, key, label) {
  let rejected = false;
  try {
    binding.decrypt(encrypted, key);
  } catch {
    rejected = true;
  }
  if (!rejected) fail(`native artifact accepted mutated ${label}`);
}

function requireExactObject(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(value) !== JSON.stringify(expected)
  ) {
    fail(`${label} is invalid`);
  }
}

function requireToolManifest(tools, target) {
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
    fail(`${target} tool manifest is invalid`);
  }
  const expectedKeys = [
    'cargo',
    'cargoSha256',
    'rustc',
    'rustcSha256',
    'node',
    'nodeSha256',
    ...(target === 'win32-x64-msvc'
      ? ['cargoXwin', 'cargoXwinSha256']
      : []),
    ...(target === 'darwin-arm64' ? ['codesignSha256'] : []),
  ].sort();
  if (JSON.stringify(Object.keys(tools).sort()) !== JSON.stringify(expectedKeys)) {
    fail(`${target} tool manifest has unexpected fields`);
  }
  for (const [name, value] of Object.entries(tools)) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      fail(`${target} tool manifest field ${name} is invalid`);
    }
    if (name.endsWith('Sha256') && !/^sha256:[a-f0-9]{64}$/.test(value)) {
      fail(`${target} tool digest ${name} is invalid`);
    }
  }
}

if (!existsSync(manifestPath)) fail('prebuilds/manifest.json is missing');
const manifest = readJson(manifestPath);
const packageVersion = readJson(join(packageRoot, 'package.json')).version;
const sourceDigest = digestFiles(getNativeSourceFiles());
if (manifest.schemaVersion !== 1) fail('unsupported manifest schema');
if (manifest.package !== '@voideddev/enc-server') fail('manifest package mismatch');
if (manifest.packageVersion !== packageVersion) fail('manifest package version is stale');
for (const target of Object.keys(manifest.targets ?? {})) {
  if (!requiredTargets.includes(target)) {
    fail(`manifest contains unsupported release target ${target}`);
  }
}

const currentTarget = getPlatformIdentifier();
const targets = currentOnly ? [currentTarget] : requiredTargets;
for (const target of targets) {
  const entry = manifest.targets?.[target];
  if (!entry) fail(`${target} has no verified artifact; publication is blocked`);
  if (entry.sourceDigest !== sourceDigest) {
    fail(`${target} was not built from the current security-relevant source`);
  }
  if (entry.coreVersion !== getCoreVersion()) fail(`${target} core version is stale`);
  if (entry.bindingVersion !== getNativeBindingVersion()) {
    fail(`${target} binding version is stale`);
  }
  requireToolManifest(entry.tools, target);
  requireExactObject(
    entry.buildEnvironment,
    {
      cargoIncremental: '0',
      locale: 'C',
      offline: 'true',
      pathRemapBuild: '/voided-build',
      pathRemapCargoHome: '/cargo-home',
      pathRemapRustupHome: '/rustup-home',
      pathRemapSource: '/voided-source',
      machOInstallName:
        target === 'darwin-arm64' ? '@rpath/voided_node.node' : 'not-applicable',
      machOUuid: target === 'darwin-arm64' ? 'sha256-v5' : 'not-applicable',
      ...(target === 'win32-x64-msvc'
        ? { peCodeViewGuid: 'sha256-v5' }
        : {}),
      sourceDateEpoch: '0',
      timezone: 'UTC',
      zeroArDate: '1',
    },
    `${target} reproducible-build environment`,
  );
  requireExactObject(
    entry.verification,
    {
      mode:
        target === 'win32-x64-msvc'
          ? 'cross-compiled-static-pe'
          : 'native-runtime',
    },
    `${target} verification mode`,
  );
  if (entry.file !== `${target}/voided_node.node`) {
    fail(`${target} has an invalid artifact path`);
  }

  const path = join(packageRoot, 'prebuilds', entry.file);
  if (!existsSync(path)) fail(`${target} artifact is missing`);
  const sha256 = digestFile(path);
  const size = statSync(path).size;
  if (sha256 !== entry.sha256) fail(`${target} artifact hash mismatch`);
  if (size !== entry.size) fail(`${target} artifact size mismatch`);
  const expectedBuildId = digestText(
    [target, sourceDigest, sha256, String(size)].join('\n'),
  );
  if (entry.buildId !== expectedBuildId) fail(`${target} build ID is invalid`);
}

const packagedTargets = readdirSync(join(packageRoot, 'prebuilds'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
for (const target of packagedTargets) {
  if (currentOnly && target !== currentTarget) continue;
  if (!requiredTargets.includes(target)) {
    fail(`${target} is not a supported release target`);
  }
  if (!manifest.targets?.[target]) {
    fail(`${target} contains an unverified binary`);
  }
}

if (targets.includes(currentTarget)) {
  const entry = manifest.targets[currentTarget];
  const require = createRequire(import.meta.url);
  const binding = require(join(packageRoot, 'prebuilds', entry.file));
  if (binding.VERSION !== entry.coreVersion) fail('runtime core version mismatch');
  const key = binding.generateKey();
  const plaintext = Buffer.from('exact native release verifier');
  const encrypted = binding.encrypt(plaintext, key, 'aes-256-gcm');
  if (!encrypted.tag || !binding.decrypt(encrypted, key).equals(plaintext)) {
    fail('runtime AEAD round-trip failed');
  }
  requireDecryptRejection(
    binding,
    { ...encrypted, ciphertext: mutateBase64(encrypted.ciphertext, 'ciphertext') },
    key,
    'ciphertext',
  );
  requireDecryptRejection(
    binding,
    { ...encrypted, tag: mutateBase64(encrypted.tag, 'authentication tag') },
    key,
    'authentication tag',
  );
  let rejected = false;
  try {
    binding.x25519SharedSecret(Buffer.alloc(32, 7), Buffer.alloc(32));
  } catch {
    rejected = true;
  }
  if (!rejected) fail('runtime accepts low-order X25519 input');

  const alice = binding.generateX25519KeyPair(Buffer.alloc(32, 0x11));
  const bob = binding.generateX25519KeyPair(Buffer.alloc(32, 0x22));
  const aliceShared = binding.x25519SharedSecret(alice.privateKey, bob.publicKey);
  const bobShared = binding.x25519SharedSecret(bob.privateKey, alice.publicKey);
  if (
    aliceShared.length !== 32 ||
    bobShared.length !== 32 ||
    aliceShared.every((byte) => byte === 0) ||
    !aliceShared.equals(bobShared)
  ) {
    fail('native artifact failed valid X25519 agreement symmetry');
  }
}

console.log(`[verify-native-release] verified ${targets.join(', ')}`);
