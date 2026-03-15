import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { StatsTracker } = require('../../dist/index.cjs');

console.log('=== Stats Tracker Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('collects and summarizes metrics', () => {
    StatsTracker.instance.metrics = [];
    StatsTracker.instance.add({
        label: 'a', originalSize: 100, compressedSize: 80, compressionRatio: 0.8,
        obfuscatedSize: 120, expansionRatio: 1.2, computeUnits: 10, algorithm: 'x', temperature: 0.5, durationMs: 5
    });
    StatsTracker.instance.add({
        label: 'b', originalSize: 200, compressedSize: 100, compressionRatio: 0.5,
        obfuscatedSize: 210, expansionRatio: 1.05, computeUnits: 20, algorithm: 'y', temperature: 0.7, durationMs: 7
    });
    const sum = StatsTracker.instance.summary;
    assert.strictEqual(sum.count, 2);
    assert.strictEqual(sum.totalBytesSaved, 120);
    assert.strictEqual(sum.totalComputeUnits, 30);
    assert.strictEqual(sum.totalDurationMs, 12);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

