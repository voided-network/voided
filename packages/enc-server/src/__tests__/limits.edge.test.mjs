import assert from 'assert';
import { PassThrough } from 'stream';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { assertWithinServerUploadLimit, SERVER_MAX_UPLOAD_BYTES, shouldStream, STREAMING_THRESHOLD_BYTES, createByteLimitGuard } = require('../../dist/index.cjs');

console.log('=== Server Limits Tests ===\n');

let passed = 0, failed = 0;

async function test(name, fn) {
    try { await fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('throws when exceeding 1 TiB', () => {
    let threw = false;
    try { assertWithinServerUploadLimit(SERVER_MAX_UPLOAD_BYTES + 1); }
    catch { threw = true; }
    assert(threw);
});

test('allows exactly at limit', () => {
    assertWithinServerUploadLimit(SERVER_MAX_UPLOAD_BYTES);
});

test('allows below limit', () => {
    assertWithinServerUploadLimit(1000);
});

test('shouldStream returns true for large data', () => {
    assert.strictEqual(shouldStream(STREAMING_THRESHOLD_BYTES), true);
    assert.strictEqual(shouldStream(STREAMING_THRESHOLD_BYTES + 1), true);
});

test('shouldStream returns false for small data', () => {
    assert.strictEqual(shouldStream(1000), false);
    assert.strictEqual(shouldStream(STREAMING_THRESHOLD_BYTES - 1), false);
});

await test('createByteLimitGuard rejects oversized data', () => {
    return new Promise((resolve, reject) => {
        const guard = createByteLimitGuard(100);
        const src = new PassThrough();
        guard.on('error', (err) => {
            assert(err.message.includes('Exceeded'));
            resolve();
        });
        guard.on('end', () => reject(new Error('Should have errored')));
        src.pipe(guard);
        src.end(Buffer.alloc(150));
    });
});

await test('createByteLimitGuard allows under-limit data', () => {
    return new Promise((resolve) => {
        const guard = createByteLimitGuard(100);
        const src = new PassThrough();
        const chunks = [];
        guard.on('data', (chunk) => chunks.push(chunk));
        guard.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).length, 50);
            resolve();
        });
        src.pipe(guard);
        src.end(Buffer.alloc(50));
    });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

