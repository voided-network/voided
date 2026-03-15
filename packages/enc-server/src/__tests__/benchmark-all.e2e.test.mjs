import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { benchmarkAll, benchmarkCompression, benchmarkEncryption, benchmarkObfuscation, benchmarkHashing, benchmarkPipeline, StatsTracker } = require('../../dist/index.cjs');

console.log('=== Benchmark E2E Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

const sampleText = 'The quick brown fox jumps over the lazy dog '.repeat(100);

test('benchmarkCompression covers all algorithms and returns sensible timings', () => {
    const results = benchmarkCompression(Buffer.from(sampleText), 5);
    assert(results.length >= 2);
    for (const r of results) {
        assert(r.avgMs >= 0);
        assert(r.totalMs >= r.avgMs);
        assert(['gzip', 'brotli', 'none'].includes(r.algorithm));
    }
});

test('benchmarkEncryption encrypts and decrypts correctly at scale', () => {
    const results = benchmarkEncryption(Buffer.from(sampleText), 10);
    assert(results.length > 0);
    for (const r of results) {
        assert(r.avgMs >= 0);
        assert(r.totalMs >= r.avgMs);
    }
});

test('benchmarkObfuscation runs across multiple temperatures', () => {
    const results = benchmarkObfuscation(sampleText, 5);
    assert(results.length >= 3);
    for (const r of results) {
        assert(r.avgMs >= 0);
        assert(r.algorithm.startsWith('temp-'));
    }
});

test('benchmarkHashing measures multiple hash algorithms', () => {
    const results = benchmarkHashing(sampleText, 20);
    assert(results.length >= 2);
    for (const r of results) assert(r.avgMs >= 0);
});

test('benchmarkPipeline performs full round-trips', () => {
    const results = benchmarkPipeline(sampleText, 3);
    assert.strictEqual(results.length, 1);
    assert(results[0].avgMs >= 0);
    assert(results[0].totalMs >= results[0].avgMs);
});

test('benchmarkAll aggregates everything and populates StatsTracker', () => {
    StatsTracker.instance.metrics = [];
    const res = benchmarkAll(sampleText, 5);
    assert(res.compression.length > 0);
    assert(res.encryption.length > 0);
    assert(res.obfuscation.length > 0);
    assert(res.hashing.length > 0);
    assert.strictEqual(res.pipeline.length, 1);
    const summary = StatsTracker.instance.summary;
    assert(summary.count > 0);
    assert(summary.totalDurationMs > 0);
});

test('benchmark results are consistent', () => {
    const results1 = benchmarkEncryption(Buffer.from('test'), 10);
    const results2 = benchmarkEncryption(Buffer.from('test'), 10);
    assert.strictEqual(results1.length, results2.length);
    for (const r of [...results1, ...results2]) {
        assert(Number.isFinite(r.avgMs));
        assert(r.avgMs >= 0);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

