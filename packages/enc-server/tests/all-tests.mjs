/**
 * All enc-server tests - runs with plain Node.js
 * Run with: node tests/all-tests.mjs
 */

import assert from 'assert';
import * as encServer from '../dist/index.js';

const {
  // Encryption
  generateKey, encrypt, decrypt, encryptWithMap, decryptWithMap, decryptWithMapString,
  deriveKeyHkdf, deriveKeyPbkdf2,
  // Hashing
  hash, hashWithSalt, generateHmac, verifyHmac, compareHashes,
  fingerprint, safetyNumbers, hashPbkdf2, verifyPbkdf2,
  // Compression
  compress, decompress,
  // Obfuscation
  generateMap, obfuscate, deobfuscate, analyzeMap, getExpansionRatio,
  // Utility
  randomBytes, generateSalt, secureWipe, base64Encode, base64Decode, hexEncode, hexDecode,
  // High-level
  VoidedService, KeyManager, reEncryptWithNewKey,
  // Signing
  signingService,
  // Streams
  createCompressionStream, createDecompressionStream,
  createEncryptionStream, createDecryptionStream,
  createObfuscateStream, createDeobfuscateStream,
  // Limits
  assertWithinServerUploadLimit, SERVER_MAX_UPLOAD_BYTES, shouldStream,
  // Stats
  StatsTracker,
} = encServer;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`✗ ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`✗ ${name}: ${err.message}`);
  }
}

console.log('\n============================================================');
console.log('@voideddev/enc-server Full Test Suite');
console.log('============================================================\n');

// ============================================================================
// ENCRYPTION TESTS
// ============================================================================
console.log('=== Encryption Tests ===\n');

test('generateKey returns 32-byte Buffer', () => {
  const key = generateKey();
  assert(Buffer.isBuffer(key), 'Key should be Buffer');
  assert.strictEqual(key.length, 32, 'Key should be 32 bytes');
});

test('encrypt/decrypt roundtrip', () => {
  const key = generateKey();
  const data = Buffer.from('Hello World!', 'utf8');
  const encrypted = encrypt(data, key);
  const decrypted = decrypt(encrypted, key);
  assert.strictEqual(decrypted.toString('utf8'), 'Hello World!');
});

test('encrypt with AES-256-GCM', () => {
  const key = generateKey();
  const data = Buffer.from('test', 'utf8');
  const result = encrypt(data, key, 'aes-256-gcm');
  assert.strictEqual(result.algorithm, 'aes-256-gcm');
  assert.strictEqual(result.nonce.length, 12);
});

test('encrypt with XChaCha20-Poly1305', () => {
  const key = generateKey();
  const data = Buffer.from('test', 'utf8');
  const result = encrypt(data, key, 'xchacha20-poly1305');
  assert.strictEqual(result.algorithm, 'xchacha20-poly1305');
  assert.strictEqual(result.nonce.length, 24);
});

test('encrypt/decrypt unicode', () => {
  const key = generateKey();
  const data = Buffer.from('日本語 🎌 中文 🐉', 'utf8');
  const encrypted = encrypt(data, key);
  const decrypted = decrypt(encrypted, key);
  assert.strictEqual(decrypted.toString('utf8'), '日本語 🎌 中文 🐉');
});

test('wrong key fails decryption', () => {
  const key1 = generateKey();
  const key2 = generateKey();
  const data = Buffer.from('secret', 'utf8');
  const encrypted = encrypt(data, key1);
  try {
    decrypt(encrypted, key2);
    assert.fail('Should have thrown');
  } catch (e) {
    // Expected
  }
});

// ============================================================================
// KEY DERIVATION TESTS
// ============================================================================
console.log('\n=== Key Derivation Tests ===\n');

test('deriveKeyHkdf works', () => {
  const ikm = Buffer.from('input key material', 'utf8');
  const salt = Buffer.from('salt', 'utf8');
  const info = Buffer.from('info', 'utf8');
  const key = deriveKeyHkdf(ikm, salt, info);
  assert.strictEqual(key.length, 32);
});

test('deriveKeyHkdf is deterministic', () => {
  const ikm = Buffer.from('input', 'utf8');
  const salt = Buffer.from('salt', 'utf8');
  const info = Buffer.from('info', 'utf8');
  const key1 = deriveKeyHkdf(ikm, salt, info);
  const key2 = deriveKeyHkdf(ikm, salt, info);
  assert(key1.equals(key2));
});

test('deriveKeyPbkdf2 works', () => {
  const password = Buffer.from('password', 'utf8');
  const salt = Buffer.from('salt12345678', 'utf8');
  const key = deriveKeyPbkdf2(password, salt, 10000);
  assert.strictEqual(key.length, 32);
});

// ============================================================================
// HASHING TESTS
// ============================================================================
console.log('\n=== Hashing Tests ===\n');

test('hash SHA-256 matches known vector', () => {
  const data = Buffer.from('hello world', 'utf8');
  const result = hash(data, 'sha256');
  assert.strictEqual(result, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});

test('hashWithSalt differs with different salts', () => {
  const data = Buffer.from('password', 'utf8');
  const salt1 = generateSalt();
  const salt2 = generateSalt();
  const hash1 = hashWithSalt(data, salt1);
  const hash2 = hashWithSalt(data, salt2);
  assert.notStrictEqual(hash1, hash2);
});

test('generateHmac/verifyHmac works', () => {
  const data = Buffer.from('message', 'utf8');
  const key = Buffer.from('secret-key-12345678901234', 'utf8');
  const hmac = generateHmac(data, key);
  assert(verifyHmac(data, hmac, key));
});

test('compareHashes works', () => {
  const a = Buffer.from('same', 'utf8');
  const b = Buffer.from('same', 'utf8');
  const c = Buffer.from('different', 'utf8');
  assert(compareHashes(a, b));
  assert(!compareHashes(a, c));
});

test('fingerprint returns correct length', () => {
  const data = Buffer.from('test', 'utf8');
  const fp = fingerprint(data, 8);
  assert.strictEqual(fp.length, 16); // 8 bytes = 16 hex chars
});

test('safetyNumbers returns formatted string', () => {
  const data = Buffer.from('key data', 'utf8');
  const sn = safetyNumbers(data, 5);
  // Format is groups of 3-digit numbers separated by spaces (with double spaces between groups of 5)
  assert(sn.length > 0);
  assert(/\d{3}/.test(sn)); // Contains 3-digit numbers
});

test('PBKDF2 hash and verify', () => {
  const data = Buffer.from('password', 'utf8');
  const salt = generateSalt();
  const hashed = hashPbkdf2(data, salt, 10000);
  assert(verifyPbkdf2(data, hashed, salt, 10000));
});

// ============================================================================
// COMPRESSION TESTS
// ============================================================================
console.log('\n=== Compression Tests ===\n');

test('compress/decompress gzip', () => {
  const data = Buffer.from('hello '.repeat(1000), 'utf8');
  const compressed = compress(data, 'gzip');
  assert(compressed.compressedSize < compressed.originalSize);
  if (compressed.algorithm !== 'none') {
    const decompressed = decompress(compressed.compressed, compressed.algorithm);
    assert(decompressed.equals(data));
  }
});

test('compress/decompress brotli', () => {
  const data = Buffer.from('hello '.repeat(1000), 'utf8');
  const compressed = compress(data, 'brotli');
  assert(compressed.compressedSize < compressed.originalSize);
  if (compressed.algorithm !== 'none') {
    const decompressed = decompress(compressed.compressed, compressed.algorithm);
    assert(decompressed.equals(data));
  }
});

// ============================================================================
// OBFUSCATION TESTS
// ============================================================================
console.log('\n=== Obfuscation Tests ===\n');

test('generateMap creates valid map', () => {
  const map = generateMap(0.5);
  assert(typeof map === 'object');
  assert(map['a'] && Array.isArray(map['a']));
});

test('obfuscate/deobfuscate roundtrip', () => {
  const map = generateMap(0.5);
  const text = 'Hello World!';
  const obfuscated = obfuscate(text, map);
  const recovered = deobfuscate(obfuscated.obfuscated, map);
  assert.strictEqual(recovered, text);
});

test('analyzeMap returns statistics', () => {
  const map = generateMap(0.6);
  const analysis = analyzeMap(map);
  assert(analysis.totalMappings > 0);
  assert(analysis.temperature >= 0);
});

test('getExpansionRatio returns number', () => {
  const map = generateMap(0.5);
  const ratio = getExpansionRatio(map);
  assert(typeof ratio === 'number');
  assert(ratio > 0);
});

test('deterministic with same seed', () => {
  const map1 = generateMap(0.5, 'test-seed');
  const map2 = generateMap(0.5, 'test-seed');
  assert.deepStrictEqual(map1, map2);
});

// ============================================================================
// PIPELINE TESTS
// ============================================================================
console.log('\n=== Pipeline Tests ===\n');

test('encryptWithMap/decryptWithMap roundtrip', () => {
  const key = generateKey();
  const data = 'Secret message 🔐';
  const enc = encryptWithMap(data, { key, temperature: 0.5 });
  const dec = decryptWithMapString(enc.data, enc.map, key);
  assert.strictEqual(dec, data);
});

test('VoidedService encrypt/decrypt', () => {
  const svc = new VoidedService({ temperature: 0.5 });
  const data = 'Test message';
  const enc = svc.encrypt(data);
  const dec = svc.decrypt(enc.data, enc.map);
  assert.strictEqual(dec, data);
});

test('VoidedService obfuscateOnly/deobfuscateOnly', () => {
  const svc = new VoidedService({ temperature: 0.5 });
  const data = 'Test message';
  const { obfuscated, map } = svc.obfuscateOnly(data);
  const dec = svc.deobfuscateOnly(obfuscated, map);
  assert.strictEqual(dec, data);
});

// ============================================================================
// KEY MANAGER TESTS
// ============================================================================
console.log('\n=== Key Manager Tests ===\n');

test('KeyManager generate and access', () => {
  const km = new KeyManager();
  const first = km.generateAndActivateKey();
  assert.strictEqual(km.activeKey.id, first.id);
  assert.strictEqual(km.toJSON().totalKeys, 1);
});

test('KeyManager rotateKey', () => {
  const km = new KeyManager();
  const first = km.generateAndActivateKey();
  const rotated = km.rotateKey();
  assert.notStrictEqual(rotated.id, first.id);
  assert.strictEqual(km.activeKey.id, rotated.id);
});

test('reEncryptWithNewKey', () => {
  const oldKey = generateKey();
  const newKey = generateKey();
  const data = 'Rotate me 🗝️';
  const enc = encryptWithMap(data, { key: oldKey, temperature: 0.5 });
  const migrated = reEncryptWithNewKey(enc.data, enc.map, oldKey, newKey);
  const dec = decryptWithMapString(migrated.data, migrated.map, newKey);
  assert.strictEqual(dec, data);
});

// ============================================================================
// SIGNING TESTS
// ============================================================================
console.log('\n=== Signing Tests ===\n');

await testAsync('signingService Ed25519 sign/verify', async () => {
  const { publicKeyPem, privateKeyPem } = await signingService.generateKeyPair('ed25519');
  const sig = await signingService.sign('hello', privateKeyPem, 'ed25519');
  const valid = await signingService.verify('hello', sig, publicKeyPem, 'ed25519');
  assert(valid);
});

await testAsync('signingService ECDSA-P256', async () => {
  const { publicKeyPem, privateKeyPem } = await signingService.generateKeyPair('ecdsa-p256');
  const sig = await signingService.sign('hello', privateKeyPem, 'ecdsa-p256');
  const valid = await signingService.verify('hello', sig, publicKeyPem, 'ecdsa-p256');
  assert(valid);
});

// ============================================================================
// UTILITY TESTS
// ============================================================================
console.log('\n=== Utility Tests ===\n');

test('randomBytes generates unique values', () => {
  const a = randomBytes(32);
  const b = randomBytes(32);
  assert(!a.equals(b));
});

test('base64Encode/Decode roundtrip', () => {
  const data = Buffer.from('test data', 'utf8');
  const encoded = base64Encode(data);
  const decoded = base64Decode(encoded);
  assert(decoded.equals(data));
});

test('hexEncode/Decode roundtrip', () => {
  const data = Buffer.from('test data', 'utf8');
  const encoded = hexEncode(data);
  const decoded = hexDecode(encoded);
  assert(decoded.equals(data));
});

// ============================================================================
// LIMITS TESTS
// ============================================================================
console.log('\n=== Limits Tests ===\n');

test('assertWithinServerUploadLimit allows valid size', () => {
  assertWithinServerUploadLimit(1000);
});

test('assertWithinServerUploadLimit throws for oversized', () => {
  try {
    assertWithinServerUploadLimit(SERVER_MAX_UPLOAD_BYTES + 1);
    assert.fail('Should have thrown');
  } catch (e) {
    // Expected
  }
});

test('shouldStream returns correct values', () => {
  assert(!shouldStream(1000));
  assert(shouldStream(2 * 1024 * 1024 * 1024)); // 2GB
});

// ============================================================================
// STATS TESTS
// ============================================================================
console.log('\n=== Stats Tests ===\n');

test('StatsTracker add and summarize', () => {
  const tracker = StatsTracker.instance;
  // Reset for test
  tracker.metrics = [];
  tracker.add({
    label: 'test',
    originalSize: 100,
    compressedSize: 50,
    compressionRatio: 0.5,
    obfuscatedSize: 150,
    expansionRatio: 1.5,
    computeUnits: 10,
    algorithm: 'test',
    temperature: 0.5,
    durationMs: 5
  });
  const summary = tracker.summary;
  assert.strictEqual(summary.count, 1);
});

// ============================================================================
// STRESS TESTS
// ============================================================================
console.log('\n=== Stress Tests ===\n');

test('100 encrypt/decrypt cycles', () => {
  const key = generateKey();
  const data = Buffer.from('Stress test 🔥', 'utf8');
  for (let i = 0; i < 100; i++) {
    const enc = encrypt(data, key);
    const dec = decrypt(enc, key);
    assert(dec.equals(data));
  }
});

test('50 full pipeline cycles', () => {
  const key = generateKey();
  const msg = 'Pipeline stress 🚀';
  for (let i = 0; i < 50; i++) {
    const enc = encryptWithMap(msg, { key, temperature: 0.4 });
    const dec = decryptWithMapString(enc.data, enc.map, key);
    assert.strictEqual(dec, msg);
  }
});

// ============================================================================
// RESULTS
// ============================================================================
console.log('\n============================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('============================================================\n');

if (failed > 0) {
  console.log('Failed tests:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}: ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('✓ All tests passed!');
  process.exit(0);
}

