/**
 * WASM binding integration test for voided-wasm
 *
 * Run with: node --experimental-wasm-modules packages/e2ee-client/wasm/test-wasm.mjs
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// Load WASM module
let wasm;
try {
  log('Loading WASM module...');

  // Read the WASM file
  const wasmPath = join(__dirname, 'voided_wasm_bg.wasm');
  const jsPath = join(__dirname, 'voided_wasm.js');

  // Convert to file:// URL for Windows compatibility
  const jsUrl = new URL(`file://${jsPath.replace(/\\/g, '/')}`);

  // Import the JS wrapper
  const wasmModule = await import(jsUrl.href);

  // For Node.js, we need to read the WASM file and instantiate manually
  const wasmBytes = await readFile(wasmPath);
  await wasmModule.default({ module_or_path: wasmBytes });

  wasm = wasmModule;
  log('WASM module loaded successfully');
  log(`Version: ${wasm.version()}`);
} catch (e) {
  console.error(`Failed to load WASM module: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}

// ============================================================================
// ENCRYPTION TESTS
// ============================================================================

console.log('\n=== Encryption Tests ===\n');

await test('generateKey returns 32 bytes', () => {
  const key = wasm.generateKey();
  if (key.length !== 32) throw new Error(`Expected 32 bytes, got ${key.length}`);
});

await test('encrypt/decrypt roundtrip', () => {
  const key = wasm.generateKey();
  const plaintext = new TextEncoder().encode('Hello, WASM World!');

  const encrypted = wasm.encrypt(plaintext, key);
  if (!encrypted.ciphertext) throw new Error('No ciphertext in result');
  if (!encrypted.nonce) throw new Error('No nonce in result');

  const decrypted = wasm.decrypt(encrypted, key);
  const decryptedText = new TextDecoder().decode(new Uint8Array(decrypted));
  if (decryptedText !== 'Hello, WASM World!') {
    throw new Error(`Decryption mismatch: ${decryptedText}`);
  }
});

await test('encrypt with XChaCha20-Poly1305', () => {
  const key = wasm.generateKey();
  const plaintext = new TextEncoder().encode('XChaCha20 test');

  const encrypted = wasm.encrypt(plaintext, key, 'xchacha20-poly1305');
  if (encrypted.algorithm !== 'xchacha20-poly1305') {
    throw new Error(`Wrong algorithm: ${encrypted.algorithm}`);
  }

  const decrypted = wasm.decrypt(encrypted, key);
  if (new TextDecoder().decode(new Uint8Array(decrypted)) !== 'XChaCha20 test') {
    throw new Error('Decryption failed');
  }
});

// ============================================================================
// KEY DERIVATION TESTS
// ============================================================================

console.log('\n=== Key Derivation Tests ===\n');

await test('deriveKeyHkdf produces consistent keys', () => {
  const ikm = new TextEncoder().encode('input key material');
  const salt = new TextEncoder().encode('salt value');
  const info = new TextEncoder().encode('context');

  const key1 = wasm.deriveKeyHkdf(ikm, salt, info);
  const key2 = wasm.deriveKeyHkdf(ikm, salt, info);

  if (key1.length !== 32) throw new Error(`Expected 32 bytes, got ${key1.length}`);

  // Convert to hex for comparison
  const hex1 = Array.from(key1).map(b => b.toString(16).padStart(2, '0')).join('');
  const hex2 = Array.from(key2).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hex1 !== hex2) {
    throw new Error('HKDF should be deterministic');
  }
});

await test('deriveKeyPbkdf2 works', () => {
  const password = new TextEncoder().encode('password123');
  const salt = new TextEncoder().encode('voided-wasm-salt');

  const key = wasm.deriveKeyPbkdf2(password, salt, 100000);
  if (key.length !== 32) throw new Error(`Expected 32 bytes, got ${key.length}`);
});

// ============================================================================
// HASHING TESTS
// ============================================================================

console.log('\n=== Hashing Tests ===\n');

await test('hash SHA-256 matches known vector', () => {
  const data = new TextEncoder().encode('hello world');
  const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

  const hash = wasm.hash(data);
  if (hash !== expected) {
    throw new Error(`Hash mismatch: ${hash}`);
  }
});

await test('hash SHA-512 matches known vector', () => {
  const data = new TextEncoder().encode('hello world');
  const expected = '309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f';

  const hash = wasm.hash(data, 'sha512');
  if (hash !== expected) {
    throw new Error(`Hash mismatch: ${hash}`);
  }
});

await test('generateHmac and verifyHmac', () => {
  const data = new TextEncoder().encode('message');
  const key = new TextEncoder().encode('secret key');

  const hmac = wasm.generateHmac(data, key);
  const valid = wasm.verifyHmac(data, hmac, key);

  if (!valid) throw new Error('HMAC verification failed');
});

await test('generateFingerprint', () => {
  const data = new TextEncoder().encode('public key data');
  const fp = wasm.generateFingerprint(data, 8);

  if (fp.length !== 16) throw new Error(`Expected 16 hex chars, got ${fp.length}`);
});

await test('generateSafetyNumbers', () => {
  const data = new TextEncoder().encode('key material');
  const numbers = wasm.generateSafetyNumbers(data, 5);

  if (!numbers.includes(' ')) throw new Error('Safety numbers should have spaces');
});

// ============================================================================
// COMPRESSION TESTS
// ============================================================================

console.log('\n=== Compression Tests ===\n');

await test('compress/decompress gzip', () => {
  const text = 'Hello, World! '.repeat(100);
  const data = new TextEncoder().encode(text);

  const result = wasm.compress(data, 'gzip');
  log(`  Original: ${result.original_size || result.originalSize}, Compressed: ${result.compressed_size || result.compressedSize}`);

  const algo = result.algorithm;
  const compressed = new Uint8Array(result.compressed);

  const decompressed = wasm.decompress(compressed, algo);
  const decompressedText = new TextDecoder().decode(new Uint8Array(decompressed));
  if (decompressedText !== text) {
    throw new Error('Decompression mismatch');
  }
});

await test('compress/decompress brotli', () => {
  const text = 'Brotli compression test '.repeat(50);
  const data = new TextEncoder().encode(text);

  const result = wasm.compress(data, 'brotli');
  log(`  Original: ${result.original_size || result.originalSize}, Compressed: ${result.compressed_size || result.compressedSize}`);

  const algo = result.algorithm;
  const compressed = new Uint8Array(result.compressed);

  const decompressed = wasm.decompress(compressed, algo);
  const decompressedText = new TextDecoder().decode(new Uint8Array(decompressed));
  if (decompressedText !== text) {
    throw new Error('Decompression mismatch');
  }
});

// ============================================================================
// FUSED SHELL TESTS
// ============================================================================

console.log('\n=== Fused Shell Tests ===\n');

await test('fuse/unfuse roundtrip', () => {
  const key = wasm.generateKey();
  const payload = new TextEncoder().encode('WASM fused roundtrip '.repeat(1024));

  const shell = wasm.fuse(payload, key, 'balanced');
  const info = wasm.inspectFused(shell);
  const restored = wasm.unfuse(shell, key);

  if ((info.preset || info.preset_label) !== 'balanced') {
    throw new Error(`Wrong preset: ${info.preset || info.preset_label}`);
  }

  const restoredBytes = new Uint8Array(restored);
  if (new TextDecoder().decode(restoredBytes) !== new TextDecoder().decode(payload)) {
    throw new Error('Fused roundtrip failed');
  }
});

await test('protect/open roundtrip', () => {
  const key = wasm.generateKey();
  const payload = new TextEncoder().encode('WASM protected artifact '.repeat(2048));

  const result = wasm.protect(
    payload,
    key,
    'concealed',
    'brotli',
    undefined,
    'xchacha20-poly1305',
  );
  const info = wasm.inspectArtifact(result.artifact);
  const restored = wasm.open(result.artifact, key);
  const restoredBytes = new Uint8Array(restored);

  if ((info.preset || info.preset_label) !== 'concealed') {
    throw new Error(`Wrong preset: ${info.preset || info.preset_label}`);
  }
  if ((info.encryption_algorithm || info.encryptionAlgorithm) !== 'xchacha20-poly1305') {
    throw new Error(`Wrong encryption algorithm: ${info.encryption_algorithm || info.encryptionAlgorithm}`);
  }
  if (new TextDecoder().decode(restoredBytes) !== new TextDecoder().decode(payload)) {
    throw new Error('Protected artifact roundtrip failed');
  }
});

await test('repackArtifact changes preset without changing plaintext', () => {
  const key = wasm.generateKey();
  const payload = new TextEncoder().encode('WASM repack artifact '.repeat(2048));

  const initial = wasm.protect(
    payload,
    key,
    'balanced',
    'brotli',
    undefined,
    'xchacha20-poly1305',
  );
  const repacked = wasm.repackArtifact(
    initial.artifact,
    key,
    'compact',
    'brotli',
    undefined,
    'xchacha20-poly1305',
  );
  const restored = wasm.open(repacked.artifact, key);
  const restoredBytes = new Uint8Array(restored);

  if ((repacked.preset || repacked.preset_label) !== 'compact') {
    throw new Error(`Wrong repacked preset: ${repacked.preset || repacked.preset_label}`);
  }
  if (new TextDecoder().decode(restoredBytes) !== new TextDecoder().decode(payload)) {
    throw new Error('Repacked artifact roundtrip failed');
  }
});

// ============================================================================
// UTILITY TESTS
// ============================================================================

console.log('\n=== Utility Tests ===\n');

await test('randomBytes generates unique bytes', () => {
  const a = wasm.randomBytes(32);
  const b = wasm.randomBytes(32);

  if (a.length !== 32) throw new Error('Wrong length');

  const hexA = Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  const hexB = Array.from(b).map(b => b.toString(16).padStart(2, '0')).join('');
  if (hexA === hexB) throw new Error('Should be unique');
});

await test('base64 encode/decode', () => {
  const data = new TextEncoder().encode('Hello, World!');
  const encoded = wasm.base64Encode(data);
  const decoded = wasm.base64Decode(encoded);

  if (encoded !== 'SGVsbG8sIFdvcmxkIQ==') throw new Error(`Wrong encoding: ${encoded}`);
  if (new TextDecoder().decode(new Uint8Array(decoded)) !== 'Hello, World!') {
    throw new Error('Wrong decoding');
  }
});

await test('hex encode/decode', () => {
  const data = new Uint8Array([0, 1, 255, 128]);
  const encoded = wasm.hexEncode(data);
  const decoded = wasm.hexDecode(encoded);

  if (encoded !== '0001ff80') throw new Error(`Wrong encoding: ${encoded}`);

  const decodedArray = new Uint8Array(decoded);
  if (decodedArray[0] !== 0 || decodedArray[1] !== 1 || decodedArray[2] !== 255 || decodedArray[3] !== 128) {
    throw new Error('Wrong decoding');
  }
});

await test('generateSalt produces random bytes', () => {
  const salt1 = wasm.generateSalt(16);
  const salt2 = wasm.generateSalt(16);

  if (salt1.length !== 16) throw new Error('Wrong length');

  const hex1 = Array.from(salt1).map(b => b.toString(16).padStart(2, '0')).join('');
  const hex2 = Array.from(salt2).map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex1 === hex2) throw new Error('Should be unique');
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
  console.log('\n✓ All WASM binding tests passed!\n');
}
