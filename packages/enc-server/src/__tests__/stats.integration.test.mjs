import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { encryptWithMap, decryptWithMapString, StatsTracker, generateKey, analyzeMap } = require('../../dist/index.cjs');

console.log('=== Stats Integration Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

const sizes = [64, 256, 1024, 4096];
const temps = [0.2, 0.4, 0.6, 0.8];
const key = generateKey();

// Reset stats tracker
StatsTracker.instance.metrics = [];

for (const size of sizes) {
    for (const temp of temps) {
        test(`pipeline size ${size} temp ${temp}`, () => {
            const data = 'A'.repeat(size);
            const t0 = Date.now();
            const enc = encryptWithMap(data, { key, temperature: temp, seed: `test-stats-${size}-${temp}`, compressionAlgorithm: 'brotli' });
            decryptWithMapString(enc.data, enc.map, key);
            const duration = Date.now() - t0;
            const analysis = analyzeMap(enc.map);
            const memoryMb = process.memoryUsage().rss / 1024 / 1024;
            
            StatsTracker.instance.add({
                label: `${size}-${temp}`,
                originalSize: size,
                compressedSize: enc.compressedSize,
                encryptedSize: enc.encryptedSize,
                storedSize: enc.data.length,
                compressionRatio: enc.compressedSize / enc.originalSize,
                obfuscatedSize: enc.data.length,
                expansionRatio: analysis.expansionRatio,
                computeUnits: analysis.computeScore,
                algorithm: enc.compressionUsed,
                temperature: temp,
                durationMs: duration,
                memoryMb
            });
        });
    }
}

const summary = StatsTracker.instance.summary;
console.log('\n--- Stats Summary ---');
console.log(`Total test cases: ${summary.count}`);
console.log(`Avg compression ratio: ${(summary.avgCompressionRatio * 100).toFixed(1)}%`);
console.log(`Avg expansion ratio: ${(summary.avgExpansionRatio * 100).toFixed(1)}%`);
console.log(`Total duration: ${summary.totalDurationMs}ms`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

