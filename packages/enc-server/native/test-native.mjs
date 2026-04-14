/**
 * Native binding integration test for voided-node
 * 
 * Run with: node packages/enc-server/native/test-native.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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

// Load native module
let native;
try {
  const modulePath = join(__dirname, 'voided_node.node');
  log(`Loading native module from: ${modulePath}`);
  native = require(modulePath);
  log(`Native module loaded successfully`);
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
  const salt = Buffer.from('randomsalt');
  
  const key = native.deriveKeyPbkdf2(password, salt, 10000);
  if (key.length !== 32) throw new Error(`Expected 32 bytes, got ${key.length}`);
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

