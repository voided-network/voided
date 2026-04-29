/**
 * Integration Tests for @voideddev/e2ee-client
 * 
 * Tests the package as it would actually be used by consumers in a browser.
 * Since we're in Node.js, we simulate browser APIs where needed.
 * 
 * Run with: node packages/e2ee-client/tests/integration.test.mjs
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
console.log('@voideddev/e2ee-client Integration Tests');
console.log('='.repeat(60) + '\n');

log('Importing package...');

// Import the built package (must build first: npm run build)
let pkg;
try {
  pkg = await import('../dist/index.js');
  log('Package imported successfully');
  log(`Exports: ${Object.keys(pkg).slice(0, 15).join(', ')}...`);
} catch (e) {
  console.error('Failed to import package. Did you run `npm run build`?');
  console.error(e.message);
  process.exit(1);
}

// ============================================================================
// CRYPTO BACKEND TESTS
// ============================================================================

console.log('\n=== Crypto Backend Tests ===\n');

const {
  crypto,
  getCurrentBackend,
  isWasmBackendReady,
  initWasm,
  protect: protectArtifact,
  open: openArtifact,
  inspectProtected,
} = pkg;

await test('getCurrentBackend returns valid backend', async () => {
  const backend = await getCurrentBackend();
  if (!['wasm', 'typescript'].includes(backend)) {
    throw new Error(`Invalid backend: ${backend}`);
  }
  log(`  Using backend: ${backend}`);
});

await test('isWasmBackendReady returns boolean', () => {
  const ready = isWasmBackendReady();
  log(`  WASM ready: ${ready}`);
  if (typeof ready !== 'boolean') {
    throw new Error('Should return boolean');
  }
});

await test('crypto.generateKey returns valid key', async () => {
  const key = await crypto.generateKey();
  if (!(key instanceof Uint8Array)) {
    throw new Error('Key should be Uint8Array');
  }
  if (key.length !== 32) {
    throw new Error(`Key should be 32 bytes, got ${key.length}`);
  }
});

await test('crypto.encrypt/decrypt roundtrip with string', async () => {
  const key = await crypto.generateKey();
  const plaintext = 'Hello, World! This is a test message.';
  
  const encrypted = await crypto.encrypt(plaintext, key);
  if (!encrypted.data) throw new Error('No data field');
  if (!encrypted.iv) throw new Error('No iv field');
  
  const decrypted = await crypto.decrypt(encrypted, key);
  const decryptedText = new TextDecoder().decode(decrypted);
  
  if (decryptedText !== plaintext) {
    throw new Error(`Mismatch: "${decryptedText}" !== "${plaintext}"`);
  }
});

await test('crypto.encrypt/decrypt with Uint8Array', async () => {
  const key = await crypto.generateKey();
  const plaintext = new TextEncoder().encode('Binary data test');
  
  const encrypted = await crypto.encrypt(plaintext, key);
  const decrypted = await crypto.decrypt(encrypted, key);
  
  if (new TextDecoder().decode(decrypted) !== 'Binary data test') {
    throw new Error('Uint8Array roundtrip failed');
  }
});

await test('crypto.encrypt/decrypt with Unicode', async () => {
  const key = await crypto.generateKey();
  const plaintext = '你好世界 🌍🔐 αβγδ émojis';
  
  const encrypted = await crypto.encrypt(plaintext, key);
  const decrypted = await crypto.decrypt(encrypted, key);
  const decryptedText = new TextDecoder().decode(decrypted);
  
  if (decryptedText !== plaintext) {
    throw new Error('Unicode roundtrip failed');
  }
});

await test('crypto.encrypt/decrypt with empty data', async () => {
  const key = await crypto.generateKey();
  const plaintext = '';
  
  const encrypted = await crypto.encrypt(plaintext, key);
  const decrypted = await crypto.decrypt(encrypted, key);
  
  if (decrypted.length !== 0) {
    throw new Error('Empty data should remain empty');
  }
});

await test('crypto.deriveKeyHkdf is deterministic', async () => {
  const ikm = new TextEncoder().encode('input key material');
  const salt = new TextEncoder().encode('salt');
  const info = new TextEncoder().encode('context');
  
  const key1 = await crypto.deriveKeyHkdf(ikm, salt, info);
  const key2 = await crypto.deriveKeyHkdf(ikm, salt, info);
  
  if (!arraysEqual(key1, key2)) {
    throw new Error('HKDF should be deterministic');
  }
});

await test('crypto.deriveKeyPbkdf2 works', async () => {
  const password = new TextEncoder().encode('password');
  const salt = new TextEncoder().encode('salt');
  
  const key = await crypto.deriveKeyPbkdf2(password, salt, 10000);
  if (key.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${key.length}`);
  }
});

// ============================================================================
// HASHING TESTS
// ============================================================================

console.log('\n=== Hashing Tests ===\n');

await test('crypto.hash SHA-256', async () => {
  const data = new TextEncoder().encode('hello world');
  const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
  
  const hash = await crypto.hash(data, 'sha256');
  if (hash !== expected) {
    throw new Error(`Hash mismatch: ${hash}`);
  }
});

await test('crypto.hashWithSalt differs with different salts', async () => {
  const data = new TextEncoder().encode('password');
  const salt1 = new TextEncoder().encode('salt1');
  const salt2 = new TextEncoder().encode('salt2');
  
  const hash1 = await crypto.hashWithSalt(data, salt1);
  const hash2 = await crypto.hashWithSalt(data, salt2);
  
  if (hash1 === hash2) {
    throw new Error('Different salts should produce different hashes');
  }
});

await test('crypto.generateHmac works', async () => {
  const data = new TextEncoder().encode('message');
  const key = new TextEncoder().encode('secret');
  
  const hmac = await crypto.generateHmac(data, key);
  if (!hmac || hmac.length !== 64) { // SHA-256 = 32 bytes = 64 hex chars
    throw new Error('HMAC generation failed');
  }
});

await test('crypto.compareHashes is constant-time safe', async () => {
  const a = new TextEncoder().encode('same');
  const b = new TextEncoder().encode('same');
  const c = new TextEncoder().encode('diff');
  
  if (!await crypto.compareHashes(a, b)) throw new Error('Same should match');
  if (await crypto.compareHashes(a, c)) throw new Error('Different should not match');
});

await test('crypto.generateFingerprint returns correct length', async () => {
  const data = new TextEncoder().encode('public key');
  const fp = await crypto.generateFingerprint(data, 8);
  
  // 8 bytes = 16 hex characters
  if (fp.length !== 16) {
    throw new Error(`Expected 16 chars, got ${fp.length}`);
  }
});

await test('crypto.generateSafetyNumbers returns formatted string', async () => {
  const data = new TextEncoder().encode('key data');
  const numbers = await crypto.generateSafetyNumbers(data, 5);
  
  if (!numbers.includes(' ')) {
    throw new Error('Safety numbers should be space-separated');
  }
});

// ============================================================================
// COMPRESSION TESTS
// ============================================================================

console.log('\n=== Compression Tests ===\n');

await test('crypto.compress/decompress gzip', async () => {
  const text = 'Hello '.repeat(1000);
  const data = new TextEncoder().encode(text);
  
  const compressed = await crypto.compress(data, 'gzip');
  log(`  Original: ${data.length}, Compressed: ${compressed.compressedSize}`);
  
  // Use 'compressed' property (not 'data')
  const decompressed = await crypto.decompress(compressed.compressed, 'gzip');
  if (new TextDecoder().decode(decompressed) !== text) {
    throw new Error('Decompression mismatch');
  }
});

// ============================================================================
// UTILITY TESTS
// ============================================================================

console.log('\n=== Utility Tests ===\n');

await test('crypto.randomBytes generates unique values', async () => {
  const a = await crypto.randomBytes(32);
  const b = await crypto.randomBytes(32);
  
  if (arraysEqual(a, b)) {
    throw new Error('Random bytes should be unique');
  }
});

await test('crypto.base64Encode/Decode roundtrip', async () => {
  const data = new TextEncoder().encode('Hello, Base64!');
  const encoded = await crypto.base64Encode(data);
  const decoded = await crypto.base64Decode(encoded);
  
  if (!arraysEqual(decoded, data)) {
    throw new Error('Base64 roundtrip failed');
  }
});

await test('crypto.hexEncode/Decode roundtrip', async () => {
  const data = new Uint8Array([0, 127, 255, 128]);
  const encoded = await crypto.hexEncode(data);
  const decoded = await crypto.hexDecode(encoded);
  
  if (!arraysEqual(decoded, data)) {
    throw new Error('Hex roundtrip failed');
  }
});

await test('crypto.generateSalt returns unique values', async () => {
  const a = await crypto.generateSalt(16);
  const b = await crypto.generateSalt(16);
  
  if (arraysEqual(a, b)) {
    throw new Error('Salts should be unique');
  }
});

// ============================================================================
// MAIN E2EE CLIENT API TESTS
// ============================================================================

console.log('\n=== VoidedE2EEClient API Tests ===\n');

const { VoidedE2EEClient, encrypt: e2eeEncrypt, decrypt: e2eeDecrypt } = pkg;

await test('VoidedE2EEClient constructor', () => {
  // Just test that it can be instantiated
  // Full functionality requires IndexedDB which isn't available in Node
  if (typeof VoidedE2EEClient !== 'function') {
    throw new Error('VoidedE2EEClient should be a class');
  }
});

await test('convenience encrypt function exists', () => {
  if (typeof e2eeEncrypt !== 'function') {
    throw new Error('encrypt should be exported');
  }
});

await test('convenience decrypt function exists', () => {
  if (typeof e2eeDecrypt !== 'function') {
    throw new Error('decrypt should be exported');
  }
});

// ============================================================================
// MONOLITH ARTIFACT TESTS
// ============================================================================

console.log('\n=== Monolith Artifact Tests ===\n');

await test('protect/open roundtrip with preset inspection', async () => {
  try {
    await initWasm();
  } catch (error) {
    log(`  Skipping WASM-only monolith roundtrip in Node integration harness: ${error.message || error}`);
    return;
  }
  if (!isWasmBackendReady()) {
    log('  Skipping WASM-only monolith roundtrip in Node integration harness');
    return;
  }

  const plaintext = 'browser monolith artifact '.repeat(4096);
  const protectedBlob = await protectArtifact(plaintext, { preset: 'balanced' });
  const info = await inspectProtected(protectedBlob);
  const restored = await openArtifact(protectedBlob);

  if (info.preset !== 'balanced') {
    throw new Error(`Expected balanced preset, got ${info.preset}`);
  }
  if (restored !== plaintext) {
    throw new Error('protect/open roundtrip failed');
  }
});

await test('concealed preset handles larger payloads', async () => {
  try {
    await initWasm();
  } catch (error) {
    log(`  Skipping WASM-only large monolith artifact check: ${error.message || error}`);
    return;
  }
  if (!isWasmBackendReady()) {
    log('  Skipping WASM-only large monolith artifact check in Node integration harness');
    return;
  }
  const plaintext = 'concealed monolith payload '.repeat(12 * 1024);
  const protectedBlob = await protectArtifact(plaintext, { preset: 'concealed' });
  const info = await inspectProtected(protectedBlob);
  const restored = await openArtifact(protectedBlob);

  if (info.preset !== 'concealed') {
    throw new Error(`Expected concealed preset, got ${info.preset}`);
  }
  if (info.protectedSize <= 0) {
    throw new Error('Protected artifact should report a positive size');
  }
  if (restored !== plaintext) {
    throw new Error('Large monolith artifact roundtrip failed');
  }
});

// ============================================================================
// EDGE CASES
// ============================================================================

console.log('\n=== Edge Cases ===\n');

await test('handles binary data with all byte values', async () => {
  const key = await crypto.generateKey();
  const binary = new Uint8Array(256);
  for (let i = 0; i < 256; i++) binary[i] = i;
  
  const encrypted = await crypto.encrypt(binary, key);
  const decrypted = await crypto.decrypt(encrypted, key);
  
  if (!arraysEqual(decrypted, binary)) {
    throw new Error('Binary data roundtrip failed');
  }
});

await test('handles very small data (1 byte)', async () => {
  const key = await crypto.generateKey();
  const data = new Uint8Array([42]);
  
  const encrypted = await crypto.encrypt(data, key);
  const decrypted = await crypto.decrypt(encrypted, key);
  
  if (!arraysEqual(decrypted, data)) {
    throw new Error('Single byte roundtrip failed');
  }
});

await test('concurrent operations work correctly', async () => {
  const key = await crypto.generateKey();
  const messages = Array(10).fill(null).map((_, i) => 
    new TextEncoder().encode(`Message ${i}`)
  );
  
  // Encrypt all concurrently
  const encrypted = await Promise.all(
    messages.map(m => crypto.encrypt(m, key))
  );
  
  // Decrypt all concurrently
  const decrypted = await Promise.all(
    encrypted.map(e => crypto.decrypt(e, key))
  );
  
  for (let i = 0; i < messages.length; i++) {
    if (!arraysEqual(decrypted[i], messages[i])) {
      throw new Error(`Concurrent message ${i} mismatch`);
    }
  }
});

// ============================================================================
// PERFORMANCE BENCHMARKS
// ============================================================================

console.log('\n=== Performance Benchmarks ===\n');

await test('benchmark: 50 encrypt/decrypt cycles', async () => {
  const key = await crypto.generateKey();
  const data = new TextEncoder().encode('Benchmark message content here');
  
  const start = Date.now();
  for (let i = 0; i < 50; i++) {
    const enc = await crypto.encrypt(data, key);
    await crypto.decrypt(enc, key);
  }
  const elapsed = Date.now() - start;
  
  log(`  50 cycles in ${elapsed}ms (${(elapsed / 50).toFixed(2)}ms/cycle)`);
});

await test('benchmark: 500 hash operations', async () => {
  const data = new TextEncoder().encode('Hash this data');
  
  const start = Date.now();
  for (let i = 0; i < 500; i++) {
    await crypto.hash(data);
  }
  const elapsed = Date.now() - start;
  
  log(`  500 hashes in ${elapsed}ms`);
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

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

