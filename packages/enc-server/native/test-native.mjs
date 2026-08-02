/**
 * Native binding integration test for voided-node
 *
 * Run with: node packages/enc-server/native/test-native.mjs
 */

import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
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
} from '../scripts/release-provenance.js';

const require = createRequire(import.meta.url);

function loadCurrentVerifiedNativeBinding() {
  const platform = getPlatformIdentifier();
  const manifest = readJson(join(packageRoot, 'prebuilds', 'manifest.json'));
  const packageMetadata = readJson(join(packageRoot, 'package.json'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.package !== '@voideddev/enc-server' ||
    manifest.packageVersion !== packageMetadata.version
  ) {
    throw new Error('Native provenance manifest is invalid or stale');
  }

  const entry = manifest.targets?.[platform];
  if (!entry) {
    throw new Error(`No verified native artifact exists for ${platform}`);
  }

  const expectedRelativePath = `${platform}/voided_node.node`;
  if (entry.file !== expectedRelativePath) {
    throw new Error(`Native artifact path is invalid for ${platform}`);
  }

  const sourceDigest = digestFiles(getNativeSourceFiles());
  if (entry.sourceDigest !== sourceDigest) {
    throw new Error(`Native artifact was not built from the current source for ${platform}`);
  }
  if (entry.coreVersion !== getCoreVersion()) {
    throw new Error(`Native artifact core version is stale for ${platform}`);
  }
  if (entry.bindingVersion !== getNativeBindingVersion()) {
    throw new Error(`Native artifact binding version is stale for ${platform}`);
  }

  const modulePath = join(packageRoot, 'prebuilds', entry.file);
  const artifactHash = digestFile(modulePath);
  const artifactSize = statSync(modulePath).size;
  if (artifactHash !== entry.sha256) {
    throw new Error(`Native artifact hash mismatch for ${platform}`);
  }
  if (!Number.isSafeInteger(entry.size) || artifactSize !== entry.size) {
    throw new Error(`Native artifact size mismatch for ${platform}`);
  }

  const expectedBuildId = digestText(
    [platform, sourceDigest, artifactHash, String(artifactSize)].join('\n'),
  );
  if (entry.buildId !== expectedBuildId) {
    throw new Error(`Native artifact build ID mismatch for ${platform}`);
  }

  // All provenance checks deliberately happen before native code is loaded.
  const binding = require(modulePath);
  if (binding.VERSION !== entry.coreVersion) {
    throw new Error(`Native runtime version mismatch for ${platform}`);
  }
  return { binding, buildId: entry.buildId, modulePath, platform };
}

// Test result tracking
let passed = 0;
let failed = 0;
const errors = [];

function log(msg) {
  console.log(`[TEST] ${msg}`);
}

function success(name, details = '') {
  passed++;
  console.log(`✓ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, error) {
  failed++;
  errors.push({ name, error });
  console.log(`✗ ${name}: ${error}`);
}

async function test(name, fn) {
  try {
    await fn();
    success(name);
  } catch (e) {
    fail(name, e.message);
  }
}

// Load only the current platform artifact after verifying its manifest provenance.
let native;
try {
  const verified = loadCurrentVerifiedNativeBinding();
  native = verified.binding;
  log(`Loaded verified native module from: ${verified.modulePath}`);
  log(`Verified native build: ${verified.platform} ${verified.buildId}`);
  log('Native module loaded successfully');
  log(`Version: ${native.VERSION}`);
} catch (e) {
  console.error(`Failed to load native module: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}

// ============================================================================
// ENCRYPTION TESTS
// ============================================================================

console.log('\n=== Encryption Tests ===\n');

await test('generateKey returns 32 bytes', () => {
  const key = native.generateKey();
  if (key.length !== 32) throw new Error(`Expected 32 bytes, got ${key.length}`);
});

await test('encrypt/decrypt roundtrip', () => {
  const key = native.generateKey();
  const plaintext = Buffer.from('Hello, World!');

  const encrypted = native.encrypt(plaintext, key);
  if (!encrypted.ciphertext) throw new Error('No ciphertext in result');
  if (!encrypted.nonce) throw new Error('No nonce in result');
  if (!encrypted.tag) throw new Error('No tag in result');

  const decrypted = native.decrypt(encrypted, key);
  if (decrypted.toString() !== plaintext.toString()) {
    throw new Error(`Decryption mismatch: ${decrypted.toString()}`);
  }
});

await test('encrypt with XChaCha20-Poly1305', () => {
  const key = native.generateKey();
  const plaintext = Buffer.from('XChaCha20 test');

  const encrypted = native.encrypt(plaintext, key, 'xchacha20-poly1305');
  if (encrypted.algorithm !== 'xchacha20-poly1305') {
    throw new Error(`Wrong algorithm: ${encrypted.algorithm}`);
  }

  const decrypted = native.decrypt(encrypted, key);
  if (decrypted.toString() !== plaintext.toString()) {
    throw new Error('Decryption failed');
  }
});

await test('encrypt empty data', () => {
  const key = native.generateKey();
  const plaintext = Buffer.from('');

  const encrypted = native.encrypt(plaintext, key);
  const decrypted = native.decrypt(encrypted, key);

  if (decrypted.length !== 0) throw new Error('Expected empty decryption');
});

await test('wrong key fails decryption', () => {
  const key1 = native.generateKey();
  const key2 = native.generateKey();
  const plaintext = Buffer.from('Secret');

  const encrypted = native.encrypt(plaintext, key1);

  try {
    native.decrypt(encrypted, key2);
    throw new Error('Should have thrown');
  } catch (e) {
    if (e.message === 'Should have thrown') throw e;
    // Expected to fail
  }
});

// ============================================================================
// KEY DERIVATION TESTS
// ============================================================================

console.log('\n=== Key Derivation Tests ===\n');

await test('deriveKeyHkdf produces consistent keys', () => {
  const ikm = Buffer.from('input key material');
  const salt = Buffer.from('salt value here');
  const info = Buffer.from('context info');

  const key1 = native.deriveKeyHkdf(ikm, salt, info);
  const key2 = native.deriveKeyHkdf(ikm, salt, info);

  if (key1.length !== 32) throw new Error(`Expected 32 bytes, got ${key1.length}`);
  if (key1.toString('hex') !== key2.toString('hex')) {
    throw new Error('HKDF should be deterministic');
  }
});

await test('deriveKeyPbkdf2 works', () => {
  const password = Buffer.from('password123');
  const salt = Buffer.from('random-salt-1234');

  const key = native.deriveKeyPbkdf2(password, salt, 100000);
  if (key.length !== 32) throw new Error(`Expected 32 bytes, got ${key.length}`);
});

await test('KDF resource and shared-secret bounds fail before allocation', () => {
  if (!assertThrows(() => native.deriveKeyHkdfRaw(
    Buffer.from('ikm'),
    null,
    Buffer.from('info'),
    0xffffffff,
  ))) throw new Error('Oversized HKDF output should fail');
  if (!assertThrows(() => native.deriveKeyPbkdf2(
    Buffer.from('password'),
    Buffer.alloc(16),
    0,
  ))) throw new Error('Zero PBKDF2 iterations should fail');
  if (!assertThrows(() => native.deriveKeyFromSharedSecret(
    Buffer.alloc(32),
    'salt',
    'info',
  ))) throw new Error('All-zero shared secret should fail');
});

// ============================================================================
// HASHING TESTS
// ============================================================================

console.log('\n=== Hashing Tests ===\n');

await test('hash SHA-256 matches known vector', () => {
  const data = Buffer.from('hello world');
  const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

  const hash = native.hash(data);
  if (hash !== expected) {
    throw new Error(`Hash mismatch: ${hash}`);
  }
});

await test('hash SHA-512 matches known vector', () => {
  const data = Buffer.from('hello world');
  const expected = '309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f';

  const hash = native.hash(data, 'sha512');
  if (hash !== expected) {
    throw new Error(`Hash mismatch: ${hash}`);
  }
});

await test('hashWithSalt produces different result', () => {
  const data = Buffer.from('password');
  const salt1 = Buffer.from('salt1');
  const salt2 = Buffer.from('salt2');

  const hash1 = native.hashWithSalt(data, salt1);
  const hash2 = native.hashWithSalt(data, salt2);

  if (hash1 === hash2) throw new Error('Different salts should produce different hashes');
  if (native.hashWithSalt(Buffer.from('a'), Buffer.from('bc')) ===
      native.hashWithSalt(Buffer.from('ab'), Buffer.from('c'))) {
    throw new Error('Salted hash fields must be length-delimited');
  }
});

await test('generateHmac and verifyHmac', () => {
  const data = Buffer.from('message');
  const key = Buffer.from('secret key');

  const hmac = native.generateHmac(data, key);
  const valid = native.verifyHmac(data, hmac, key);

  if (!valid) throw new Error('HMAC verification failed');
});

await test('compareHashes constant time', () => {
  const a = Buffer.from('same value');
  const b = Buffer.from('same value');
  const c = Buffer.from('different!');

  if (!native.compareHashes(a, b)) throw new Error('Same should match');
  if (native.compareHashes(a, c)) throw new Error('Different should not match');
});

await test('generateFingerprint', () => {
  const data = Buffer.from('public key data');
  const fp = native.generateFingerprint(data, 8);

  if (fp.length !== 16) throw new Error(`Expected 16 hex chars, got ${fp.length}`);
});

await test('generateSafetyNumbers', () => {
  const data = Buffer.from('key material');
  const numbers = native.generateSafetyNumbers(data, 5);

  if (!numbers.includes(' ')) throw new Error('Safety numbers should have spaces');
  if (!assertThrows(() => native.generateSafetyNumbers(data, 0))) {
    throw new Error('Zero group size should fail without aborting');
  }
});

await test('unknown algorithms fail closed', () => {
  const key = native.generateKey();
  if (!assertThrows(() => native.encrypt(Buffer.from('x'), key, 'aes-typo'))) {
    throw new Error('Unknown encryption algorithm should fail');
  }
  if (!assertThrows(() => native.hash(Buffer.from('x'), 'sha3-typo'))) {
    throw new Error('Unknown hash algorithm should fail');
  }
  if (!assertThrows(() => native.compress(Buffer.from('x'.repeat(200)), 'zip-typo'))) {
    throw new Error('Unknown compression algorithm should fail');
  }
});

// ============================================================================
// COMPRESSION TESTS
// ============================================================================

console.log('\n=== Compression Tests ===\n');

await test('compress/decompress gzip', () => {
  const data = Buffer.from('Hello, World! '.repeat(100));

  const result = native.compress(data, 'gzip');
  log(`  Original: ${result.originalSize}, Compressed: ${result.compressedSize}`);

  if (result.compressed.length === 0) throw new Error('No compressed data');

  const decompressed = native.decompress(result.compressed, result.algorithm);
  if (decompressed.toString() !== data.toString()) {
    throw new Error('Decompression mismatch');
  }
});

await test('compress/decompress brotli', () => {
  const data = Buffer.from('Brotli compression test '.repeat(50));

  const result = native.compress(data, 'brotli');
  log(`  Original: ${result.originalSize}, Compressed: ${result.compressedSize}`);

  const decompressed = native.decompress(result.compressed, result.algorithm);
  if (decompressed.toString() !== data.toString()) {
    throw new Error('Decompression mismatch');
  }
});

// ============================================================================
// FUSED SHELL TESTS
// ============================================================================

console.log('\n=== Fused Shell Tests ===\n');

await test('fuse/unfuse roundtrip', () => {
  const key = native.generateKey();
  const payload = Buffer.from('native fused roundtrip '.repeat(512));

  const shell = native.fuse(payload, key, 'balanced');
  const info = native.inspectFused(shell);
  const restored = native.unfuse(shell, key);

  if (info.preset !== 'balanced') throw new Error(`Wrong preset: ${info.preset}`);
  if (restored.toString() !== payload.toString()) {
    throw new Error('Fused roundtrip mismatch');
  }
});

await test('inspectFused rejects million-cell noncanonical geometry', () => {
  const originalLength = 2_000_000;
  const blockCount = Math.ceil(originalLength / 8);
  const payloadLength = originalLength + blockCount;
  const artifact = Buffer.alloc(22 + payloadLength + 16);
  artifact.write('VFS2', 0, 'ascii');
  artifact[4] = 2;
  artifact[5] = 2;
  artifact.writeUInt32BE(1, 6);

  if (!assertThrows(() => native.inspectFused(artifact))) {
    throw new Error('Million-cell noncanonical geometry should fail');
  }
});

await test('keyless inspect rejects header sizes above JavaScript safe integer', () => {
  const artifact = Buffer.alloc(44 + 1 + 16);
  artifact.write('VOF2', 0, 'ascii');
  artifact[4] = 1;
  artifact[5] = 2;
  artifact[6] = 0;
  artifact[7] = 2;
  artifact.writeUInt32BE(8, 8);
  artifact.writeBigUInt64BE(9_007_199_254_740_992n, 12);
  artifact.writeBigUInt64BE(1n, 20);

  let error;
  try {
    native.inspectRotationArtifact(artifact);
  } catch (caught) {
    error = caught;
  }
  if (!error || !error.message.includes('safe integer')) {
    throw new Error(`Expected safe-integer rejection, got: ${error?.message ?? 'no error'}`);
  }
});

await test('decompression bomb is rejected by expansion ratio', () => {
  const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024));
  if (!assertThrows(() => native.decompress(bomb, 'gzip'))) {
    throw new Error('Decompression bomb should fail');
  }
});

await test('protect/open roundtrip', () => {
  const key = native.generateKey();
  const payload = Buffer.from('native protected artifact '.repeat(2048));

  const result = native.protect(
    payload,
    key,
    'concealed',
    'brotli',
    undefined,
    'xchacha20-poly1305',
  );
  const info = native.inspectArtifact(result.artifact);
  const restored = native.open(result.artifact, key);

  if (info.preset !== 'concealed') throw new Error(`Wrong preset: ${info.preset}`);
  if (info.encryptionAlgorithm !== 'xchacha20-poly1305') {
    throw new Error(`Wrong encryption algorithm: ${info.encryptionAlgorithm}`);
  }
  if (restored.toString() !== payload.toString()) {
    throw new Error('Protected artifact roundtrip mismatch');
  }
});

await test('repackArtifact changes preset without changing plaintext', () => {
  const key = native.generateKey();
  const payload = Buffer.from('native repack artifact '.repeat(1024));

  const initial = native.protect(payload, key, 'balanced', 'brotli', undefined, 'xchacha20-poly1305');
  const repacked = native.repackArtifact(
    initial.artifact,
    key,
    'compact',
    'brotli',
    undefined,
    'xchacha20-poly1305',
  );
  const restored = native.open(repacked.artifact, key);

  if (repacked.preset !== 'compact') throw new Error(`Wrong repacked preset: ${repacked.preset}`);
  if (restored.toString() !== payload.toString()) {
    throw new Error('Repacked artifact roundtrip mismatch');
  }
});

// ============================================================================
// UTILITY TESTS
// ============================================================================

console.log('\n=== Utility Tests ===\n');

await test('randomBytes generates unique bytes', () => {
  const a = native.randomBytes(32);
  const b = native.randomBytes(32);

  if (a.length !== 32) throw new Error('Wrong length');
  if (a.toString('hex') === b.toString('hex')) throw new Error('Should be unique');
  if (!assertThrows(() => native.randomBytes(0))) throw new Error('Zero length should fail');
  if (!assertThrows(() => native.randomBytes(0xffffffff))) {
    throw new Error('Oversized random allocation should fail');
  }
});

await test('base64 encode/decode', () => {
  const data = Buffer.from('Hello, World!');
  const encoded = native.base64Encode(data);
  const decoded = native.base64Decode(encoded);

  if (encoded !== 'SGVsbG8sIFdvcmxkIQ==') throw new Error('Wrong encoding');
  if (decoded.toString() !== data.toString()) throw new Error('Wrong decoding');
});

await test('hex encode/decode', () => {
  const data = Buffer.from([0, 1, 255, 128]);
  const encoded = native.hexEncode(data);
  const decoded = native.hexDecode(encoded);

  if (encoded !== '0001ff80') throw new Error('Wrong encoding');
  if (decoded.toString('hex') !== data.toString('hex')) throw new Error('Wrong decoding');
});

await test('generateSalt produces random bytes', () => {
  const salt1 = native.generateSalt(16);
  const salt2 = native.generateSalt(16);

  if (salt1.length !== 16) throw new Error('Wrong length');
  if (salt1.toString('hex') === salt2.toString('hex')) throw new Error('Should be unique');
});

function assertThrows(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\nFailed tests:');
  errors.forEach(({ name, error }) => {
    console.log(`  - ${name}: ${error}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ All native binding tests passed!\n');
}

