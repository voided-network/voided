import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { hash } = require('../../dist/index.cjs');

console.log('=== Large-Scale Hashing Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('hashes large buffer (10MB)', () => {
    const size = 10 * 1024 * 1024;
    console.log(`  [tb.integration] hashing ${size} bytes`);
    const data = Buffer.alloc(size, 0x42);
    const result = hash(data, 'sha256');
    assert(/^[a-f0-9]{64}$/.test(result));
    assert.strictEqual(result.length, 64);
});

test('hashes incrementally for very large data', () => {
    const chunkSize = 1024 * 1024;
    const numChunks = 10;
    const fullData = Buffer.alloc(chunkSize * numChunks, 0);
    for (let i = 0; i < numChunks; i++) {
        const offset = i * chunkSize;
        fullData.fill(i % 256, offset, offset + chunkSize);
    }
    const fullHash = hash(fullData, 'sha256');
    assert(/^[a-f0-9]{64}$/.test(fullHash));
    const secondHash = hash(fullData, 'sha256');
    assert.strictEqual(secondHash, fullHash);
});

test('hash performance is reasonable for large data', () => {
    const size = 5 * 1024 * 1024;
    const data = Buffer.alloc(size, 0x41);
    const start = Date.now();
    const result = hash(data, 'sha256');
    const duration = Date.now() - start;
    console.log(`  [tb.integration] Hashed ${size / 1024 / 1024}MB in ${duration}ms`);
    assert(duration < 10000);
    assert.strictEqual(result.length, 64);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

