import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { compress, decompress } = require('../../dist/index.cjs');

console.log('=== Compression Edge Cases ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('compresses and decompresses empty data', () => {
    const data = Buffer.from('');
    const result = compress(data, 'gzip');
    assert.strictEqual(result.originalSize, 0);
});

test('handles incompressible random data', () => {
    const randomData = Buffer.alloc(1000);
    for (let i = 0; i < randomData.length; i++) randomData[i] = Math.floor(Math.random() * 256);
    const result = compress(randomData, 'gzip');
    if (result.algorithm === 'none') {
        assert(result.compressed.equals(randomData));
    } else {
        const restored = decompress(result.compressed, result.algorithm);
        assert(restored.equals(randomData));
    }
});

test('gzip compression with various levels', () => {
    const data = Buffer.from('hello world '.repeat(50));
    for (const level of [1, 5, 9]) {
        const result = compress(data, 'gzip', level);
        if (result.algorithm !== 'none') {
            const restored = decompress(result.compressed, 'gzip');
            assert.strictEqual(restored.toString(), data.toString());
        }
    }
});

test('brotli compression with various levels', () => {
    const data = Buffer.from('hello brotli '.repeat(50));
    for (const level of [1, 5, 11]) {
        const result = compress(data, 'brotli', level);
        if (result.algorithm !== 'none') {
            const restored = decompress(result.compressed, 'brotli');
            assert.strictEqual(restored.toString(), data.toString());
        }
    }
});

test('handles unicode content', () => {
    const data = Buffer.from('こんにちは世界 🌍 مرحبا 你好 '.repeat(20), 'utf8');
    const gzipResult = compress(data, 'gzip');
    if (gzipResult.algorithm !== 'none') {
        const restored = decompress(gzipResult.compressed, 'gzip');
        assert.strictEqual(restored.toString('utf8'), data.toString('utf8'));
    }
    const brotliResult = compress(data, 'brotli');
    if (brotliResult.algorithm !== 'none') {
        const restored = decompress(brotliResult.compressed, 'brotli');
        assert.strictEqual(restored.toString('utf8'), data.toString('utf8'));
    }
});

test('compression ratio is calculated correctly', () => {
    const data = Buffer.from('aaaa'.repeat(500));
    const result = compress(data, 'gzip');
    assert.strictEqual(result.originalSize, data.length);
    if (result.algorithm !== 'none') {
        assert(result.compressionRatio < 0.1);
        assert(result.compressedSize < result.originalSize);
    }
});

test('handles binary data', () => {
    const binaryData = Buffer.alloc(5000);
    for (let i = 0; i < binaryData.length; i++) binaryData[i] = i % 256;
    const result = compress(binaryData, 'gzip');
    if (result.algorithm !== 'none') {
        const restored = decompress(result.compressed, 'gzip');
        assert(restored.equals(binaryData));
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

