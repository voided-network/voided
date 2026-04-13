/**
 * Fused-first integration tests for @voideddev/enc-server.
 *
 * Run with:
 *   node packages/enc-server/tests/integration.test.mjs
 */

let passed = 0;
let failed = 0;
const failures = [];

function success(name) {
  passed += 1;
  console.log(`✓ ${name}`);
}

function fail(name, error) {
  failed += 1;
  failures.push({ name, error: error.message || String(error) });
  console.log(`✗ ${name}: ${error.message || error}`);
}

async function test(name, fn) {
  try {
    await fn();
    success(name);
  } catch (error) {
    fail(name, error);
  }
}

console.log('\n' + '='.repeat(60));
console.log('@voideddev/enc-server Fused Integration Tests');
console.log('='.repeat(60) + '\n');

let pkg;
try {
  pkg = await import('../dist/index.js');
} catch (error) {
  console.error('Failed to import ../dist/index.js');
  console.error(error.message || error);
  process.exit(1);
}

const {
  generateKey,
  encrypt,
  decrypt,
  compress,
  decompress,
  fuse,
  unfuse,
  inspectFused,
  protect,
  open,
  inspectArtifact,
  repackArtifact,
} = pkg;

await test('encrypt/decrypt roundtrip still works', () => {
  const key = generateKey();
  const plaintext = Buffer.from('Voided v2 core encryption check');
  const encrypted = encrypt(plaintext, key, 'xchacha20-poly1305');
  const decrypted = decrypt(encrypted, key);

  if (!decrypted.equals(plaintext)) {
    throw new Error('decrypt(encrypt(x)) should restore the plaintext');
  }
});

await test('compress/decompress roundtrip still works', () => {
  const plaintext = Buffer.from('compress me '.repeat(512));
  const compressed = compress(plaintext, 'brotli');
  const restored = decompress(compressed.compressed, compressed.algorithm);

  if (!restored.equals(plaintext)) {
    throw new Error('decompress(compress(x)) should restore the plaintext');
  }
});

for (const preset of ['compact', 'balanced', 'concealed']) {
  await test(`fuse/unfuse roundtrip (${preset})`, () => {
    const key = generateKey();
    const payload = Buffer.from(`fused-shell-${preset}-`.repeat(1024));
    const shell = fuse(payload, key, preset);
    const info = inspectFused(shell);
    const restored = unfuse(shell, key);

    if (!restored.equals(payload)) {
      throw new Error('unfuse(fuse(x)) should restore the payload');
    }
    if (info.preset !== preset) {
      throw new Error(`expected preset ${preset}, got ${info.preset}`);
    }
  });

  await test(`protect/open roundtrip (${preset})`, () => {
    const key = generateKey();
    const plaintext = Buffer.from(`protect-${preset}-`.repeat(4096));
    const protectedArtifact = protect(plaintext, key, {
      preset,
      compressionAlgorithm: 'brotli',
      encryptionAlgorithm: 'xchacha20-poly1305',
    });
    const info = inspectArtifact(protectedArtifact.artifact);
    const restored = open(protectedArtifact.artifact, key);

    if (!restored.equals(plaintext)) {
      throw new Error('open(protect(x)) should restore the plaintext');
    }
    if (info.preset !== preset) {
      throw new Error(`expected preset ${preset}, got ${info.preset}`);
    }
    if (info.encryptionAlgorithm !== 'xchacha20-poly1305') {
      throw new Error(`expected xchacha20-poly1305, got ${info.encryptionAlgorithm}`);
    }
  });
}

await test('repackArtifact changes preset without changing plaintext', () => {
  const key = generateKey();
  const plaintext = Buffer.from('balanced default payload '.repeat(2048));
  const initial = protect(plaintext, key, { preset: 'balanced' });
  const repacked = repackArtifact(initial.artifact, key, { preset: 'concealed' });
  const restored = open(repacked.artifact, key);

  if (repacked.preset !== 'concealed') {
    throw new Error(`expected concealed preset, got ${repacked.preset}`);
  }
  if (!restored.equals(plaintext)) {
    throw new Error('repacked artifact should still open to the same plaintext');
  }
});

console.log('\n' + '-'.repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailures:');
  for (const failure of failures) {
    console.log(`  - ${failure.name}: ${failure.error}`);
  }
  process.exit(1);
}

console.log('\nAll fused-first integration tests passed.\n');
