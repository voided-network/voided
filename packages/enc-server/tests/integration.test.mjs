/**
 * Integration Tests for @voideddev/enc-server
 * 
 * Tests the Rust-powered crypto operations.
 * 
 * Run with: node packages/enc-server/tests/integration.test.mjs
 */

// Test tracking
let passed = 0;
let failed = 0;
const errors = [];
const startTime = Date.now();

function log(msg) {
  console.log(`[TEST] ${msg}`);
}

function success(name, details = '') {
  passed++;
  console.log(`✓ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, error) {
  failed++;
  errors.push({ name, error: error.message || String(error) });
  console.log(`✗ ${name}: ${error.message || error}`);
}

async function test(name, fn) {
  try {
    await fn();
    success(name);
  } catch (e) {
    fail(name, e);
  }
}

// ============================================================================
// IMPORT THE PACKAGE
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('@voideddev/enc-server Integration Tests (Rust)');
console.log('='.repeat(60) + '\n');

log('Importing package...');

let pkg;
try {
  pkg = await import('../dist/index.js');
  log('Package imported successfully');
  log(`Exports: ${Object.keys(pkg).join(', ')}`);
} catch (e) {
  console.error('Failed to import package:', e.message);
  process.exit(1);
}

const {
  // Core crypto
  generateKey,
  encrypt,
  decrypt,
  deriveKeyHkdf,
  deriveKeyPbkdf2,
  hash,
  hashWithSalt,
  compareHashes,
  generateHmac,
  verifyHmac,
  fingerprint,
  safetyNumbers,
  compress,
  decompress,
  generateMap,
  obfuscate,
  deobfuscate,
  analyzeMap,
  randomBytes,
  generateSalt,
  base64Encode,
  base64Decode,
  hexEncode,
  hexDecode,
  // High-level API
  encryptWithMap,
  decryptWithMap,
  VoidedService,
} = pkg;

// ============================================================================
// ENCRYPTION TESTS
// ============================================================================

console.log('\n=== Encryption Tests ===\n');

await test('generateKey returns 32-byte Buffer', () => {
  const key = generateKey();
  if (!Buffer.isBuffer(key)) throw new Error('Key should be Buffer');
  if (key.length !== 32) throw new Error(`Key should be 32 bytes, got ${key.length}`);
});

await test('generateKey returns unique keys', () => {
  const key1 = generateKey();
  const key2 = generateKey();
  if (key1.equals(key2)) throw new Error('Keys should be unique');
});

await test('encrypt/decrypt roundtrip', () => {
  const key = generateKey();
  const plaintext = Buffer.from('Hello, Rust!');
  
  const encrypted = encrypt(plaintext, key);
  if (!encrypted.encrypted) throw new Error('No encrypted field');
  if (!encrypted.nonce) throw new Error('No nonce field');
  if (!encrypted.tag) throw new Error('No tag field');
  if (!encrypted.algorithm) throw new Error('No algorithm field');
  
  log(`  Algorithm: ${encrypted.algorithm}`);
  
  const decrypted = decrypt(encrypted, key);
  if (!decrypted.equals(plaintext)) {
    throw new Error('Decryption mismatch');
  }
});

await test('encrypt with AES-256-GCM', () => {
  const key = generateKey();
  const plaintext = Buffer.from('AES test');
  
  const encrypted = encrypt(plaintext, key, 'aes-256-gcm');
  if (encrypted.algorithm !== 'aes-256-gcm') {
    throw new Error(`Wrong algorithm: ${encrypted.algorithm}`);
  }
  
  const decrypted = decrypt(encrypted, key);
  if (!decrypted.equals(plaintext)) {
    throw new Error('AES decryption failed');
  }
});

await test('encrypt with XChaCha20-Poly1305', () => {
  const key = generateKey();
  const plaintext = Buffer.from('XChaCha test');
  
  const encrypted = encrypt(plaintext, key, 'xchacha20-poly1305');
  if (encrypted.algorithm !== 'xchacha20-poly1305') {
    throw new Error(`Wrong algorithm: ${encrypted.algorithm}`);
  }
  
  const decrypted = decrypt(encrypted, key);
  if (!decrypted.equals(plaintext)) {
    throw new Error('XChaCha decryption failed');
  }
});

await test('encrypt/decrypt with Unicode', () => {
  const key = generateKey();
  const plaintext = Buffer.from('你好世界 🌍🔐 αβγδ');
  
  const encrypted = encrypt(plaintext, key);
  const decrypted = decrypt(encrypted, key);
  
  if (!decrypted.equals(plaintext)) {
    throw new Error('Unicode roundtrip failed');
  }
});

await test('encrypt/decrypt with empty data', () => {
  const key = generateKey();
  const plaintext = Buffer.from('');
  
  const encrypted = encrypt(plaintext, key);
  const decrypted = decrypt(encrypted, key);
  
  if (decrypted.length !== 0) {
    throw new Error('Empty data should remain empty');
  }
});

await test('wrong key fails decryption', () => {
  const key1 = generateKey();
  const key2 = generateKey();
  const plaintext = Buffer.from('Secret');
  
  const encrypted = encrypt(plaintext, key1);
  
  let threw = false;
  try {
    decrypt(encrypted, key2);
  } catch (e) {
    threw = true;
  }
  
  if (!threw) {
    throw new Error('Should have thrown with wrong key');
  }
});

// ============================================================================
// KEY DERIVATION TESTS
// ============================================================================

console.log('\n=== Key Derivation Tests ===\n');

await test('deriveKeyHkdf works', () => {
  const ikm = Buffer.from('input key material');
  const salt = Buffer.from('salt');
  const info = Buffer.from('context');
  
  const key = deriveKeyHkdf(ikm, salt, info);
  if (key.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${key.length}`);
  }
});

await test('deriveKeyHkdf is deterministic', () => {
  const ikm = Buffer.from('input key material');
  const salt = Buffer.from('salt');
  const info = Buffer.from('context');
  
  const key1 = deriveKeyHkdf(ikm, salt, info);
  const key2 = deriveKeyHkdf(ikm, salt, info);
  
  if (!key1.equals(key2)) {
    throw new Error('HKDF should be deterministic');
  }
});

await test('deriveKeyPbkdf2 works', () => {
  const password = Buffer.from('password');
  const salt = Buffer.from('salt');
  
  const key = deriveKeyPbkdf2(password, salt, 10000);
  if (key.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${key.length}`);
  }
});

// ============================================================================
// HASHING TESTS
// ============================================================================

console.log('\n=== Hashing Tests ===\n');

await test('hash SHA-256 matches known vector', () => {
  const data = Buffer.from('hello world');
  const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
  
  const result = hash(data, 'sha256');
  if (result !== expected) {
    throw new Error(`Hash mismatch: ${result}`);
  }
});

await test('hashWithSalt differs with different salts', () => {
  const data = Buffer.from('password');
  const salt1 = Buffer.from('salt1');
  const salt2 = Buffer.from('salt2');
  
  const hash1 = hashWithSalt(data, salt1);
  const hash2 = hashWithSalt(data, salt2);
  
  if (hash1 === hash2) {
    throw new Error('Different salts should produce different hashes');
  }
});

await test('generateHmac/verifyHmac works', () => {
  const data = Buffer.from('message');
  const key = Buffer.from('secret');
  
  const hmac = generateHmac(data, key);
  const valid = verifyHmac(data, hmac, key);
  
  if (!valid) {
    throw new Error('HMAC verification failed');
  }
});

await test('compareHashes works', () => {
  const a = Buffer.from('same');
  const b = Buffer.from('same');
  const c = Buffer.from('diff');
  
  if (!compareHashes(a, b)) throw new Error('Same should match');
  if (compareHashes(a, c)) throw new Error('Different should not match');
});

await test('fingerprint returns correct length', () => {
  const data = Buffer.from('public key');
  const fp = fingerprint(data, 8);
  
  if (fp.length !== 16) {
    throw new Error(`Expected 16 chars, got ${fp.length}`);
  }
});

await test('safetyNumbers returns formatted string', () => {
  const data = Buffer.from('key data');
  const numbers = safetyNumbers(data, 5);
  
  if (!numbers.includes(' ')) {
    throw new Error('Safety numbers should be space-separated');
  }
  log(`  ${numbers.slice(0, 50)}...`);
});

// ============================================================================
// COMPRESSION TESTS
// ============================================================================

console.log('\n=== Compression Tests ===\n');

await test('compress/decompress gzip', () => {
  const data = Buffer.from('Hello '.repeat(1000));
  
  const compressed = compress(data, 'gzip');
  log(`  Original: ${data.length}, Compressed: ${compressed.compressedSize}`);
  
  const decompressed = decompress(compressed.compressed, 'gzip');
  if (!decompressed.equals(data)) {
    throw new Error('Gzip roundtrip failed');
  }
});

await test('compress/decompress brotli', () => {
  const data = Buffer.from('Brotli test '.repeat(500));
  
  const compressed = compress(data, 'brotli');
  log(`  Original: ${data.length}, Compressed: ${compressed.compressedSize}`);
  
  const decompressed = decompress(compressed.compressed, 'brotli');
  if (!decompressed.equals(data)) {
    throw new Error('Brotli roundtrip failed');
  }
});

// ============================================================================
// OBFUSCATION TESTS
// ============================================================================

console.log('\n=== Obfuscation Tests ===\n');

await test('generateMap creates valid map', () => {
  const map = generateMap(0.5, 'test-seed', 'abc');
  
  if (!map || typeof map !== 'object') {
    throw new Error('Map should be an object');
  }
  
  if (!map['a'] || !Array.isArray(map['a'])) {
    throw new Error('Map should have array mappings');
  }
});

await test('obfuscate/deobfuscate roundtrip', () => {
  const map = generateMap(0.5, 'roundtrip', 'Hello');
  const text = 'Hello';
  
  const result = obfuscate(text, map, 'seed');
  log(`  "${text}" -> "${result.obfuscated.slice(0, 40)}..."`);
  
  const recovered = deobfuscate(result.obfuscated, map);
  if (recovered !== text) {
    throw new Error(`Recovery failed: "${recovered}"`);
  }
});

await test('analyzeMap returns statistics', () => {
  const map = generateMap(0.5, 'analyze', 'test');
  const analysis = analyzeMap(map);
  
  if (typeof analysis.totalMappings !== 'number') {
    throw new Error('Missing totalMappings');
  }
  log(`  Mappings: ${analysis.totalMappings}`);
});

// ============================================================================
// UTILITY TESTS
// ============================================================================

console.log('\n=== Utility Tests ===\n');

await test('randomBytes generates unique values', () => {
  const a = randomBytes(32);
  const b = randomBytes(32);
  
  if (a.equals(b)) {
    throw new Error('Random bytes should be unique');
  }
});

await test('generateSalt returns unique values', () => {
  const a = generateSalt(16);
  const b = generateSalt(16);
  
  if (a.equals(b)) {
    throw new Error('Salts should be unique');
  }
});

await test('base64Encode/Decode roundtrip', () => {
  const data = Buffer.from('Hello, Base64!');
  const encoded = base64Encode(data);
  const decoded = base64Decode(encoded);
  
  if (!decoded.equals(data)) {
    throw new Error('Base64 roundtrip failed');
  }
});

await test('hexEncode/Decode roundtrip', () => {
  const data = Buffer.from([0, 127, 255, 128]);
  const encoded = hexEncode(data);
  const decoded = hexDecode(encoded);
  
  if (!decoded.equals(data)) {
    throw new Error('Hex roundtrip failed');
  }
});

// ============================================================================
// HIGH-LEVEL API TESTS
// ============================================================================

console.log('\n=== High-Level API Tests ===\n');

await test('encryptWithMap/decryptWithMap roundtrip', () => {
  const key = generateKey();
  const plaintext = 'This is a secret message!';
  
  const encrypted = encryptWithMap(plaintext, { key, temperature: 0.5 });
  log(`  Original: ${encrypted.originalSize}, Compressed: ${encrypted.compressedSize}`);
  
  const decrypted = decryptWithMap(encrypted.data, encrypted.map, key);
  if (decrypted.toString('utf8') !== plaintext) {
    throw new Error('High-level roundtrip failed');
  }
});

await test('VoidedService encrypt/decrypt', () => {
  const service = new VoidedService({ temperature: 0.5 });
  const plaintext = 'Service test message';
  
  const encrypted = service.encrypt(plaintext);
  const decrypted = service.decrypt(encrypted.data, encrypted.map);
  
  if (decrypted !== plaintext) {
    throw new Error('VoidedService roundtrip failed');
  }
});

await test('VoidedService obfuscateOnly/deobfuscateOnly', () => {
  const service = new VoidedService({ temperature: 0.5 });
  const text = 'Just obfuscate this';
  
  const { obfuscated, map } = service.obfuscateOnly(text);
  const recovered = service.deobfuscateOnly(obfuscated, map);
  
  if (recovered !== text) {
    throw new Error('Obfuscate-only roundtrip failed');
  }
});

// ============================================================================
// PERFORMANCE BENCHMARKS
// ============================================================================

console.log('\n=== Performance Benchmarks ===\n');

await test('benchmark: 100 encrypt/decrypt cycles', () => {
  const key = generateKey();
  const data = Buffer.from('Benchmark message content here');
  
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    const enc = encrypt(data, key);
    decrypt(enc, key);
  }
  const elapsed = Date.now() - start;
  
  log(`  100 cycles in ${elapsed}ms (${(elapsed / 100).toFixed(2)}ms/cycle)`);
});

await test('benchmark: 1000 hash operations', () => {
  const data = Buffer.from('Hash this data');
  
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    hash(data);
  }
  const elapsed = Date.now() - start;
  
  log(`  1000 hashes in ${elapsed}ms`);
});

// ============================================================================
// SUMMARY
// ============================================================================

const totalTime = Date.now() - startTime;

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed (${totalTime}ms)`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\nFailed tests:');
  errors.forEach(({ name, error }) => {
    console.log(`  ✗ ${name}: ${error}`);
  });
  process.exit(1);
} else {
  console.log('\n✓ All integration tests passed!\n');
}
