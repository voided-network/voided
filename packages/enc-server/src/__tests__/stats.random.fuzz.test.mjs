import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { encryptWithMap, decryptWithMapString, analyzeMap, StatsTracker, generateKey } = require('../../dist/index.cjs');

console.log('=== Random Pipeline Stress Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

const key = generateKey();
const RUNS = 100;

// Reset stats tracker
StatsTracker.instance.metrics = [];

test(`fuzz encryption pipeline (${RUNS} runs)`, () => {
    for (let i = 0; i < RUNS; i++) {
        const len = Math.floor(Math.random() * 5000);
        const temp = 0.1 + Math.random() * 0.8;
        const data = 'X'.repeat(len);
        
        const start = Date.now();
        const enc = encryptWithMap(data, { key, temperature: temp, seed: `test-fuzz-${i}`, compressionAlgorithm: 'brotli' });
        const decrypted = decryptWithMapString(enc.data, enc.map, key);
        const duration = Date.now() - start;
        
        assert.strictEqual(decrypted, data);
        
        const analysis = analyzeMap(enc.map);
        StatsTracker.instance.add({
            label: `rand-${len}-${temp.toFixed(2)}`,
            originalSize: len,
            compressedSize: enc.compressedSize,
            encryptedSize: enc.encryptedSize,
            storedSize: enc.data.length,
            compressionRatio: len > 0 ? enc.compressedSize / len : 1,
            obfuscatedSize: enc.data.length,
            expansionRatio: analysis.expansionRatio,
            computeUnits: analysis.computeScore,
            algorithm: enc.compressionUsed,
            temperature: temp,
            durationMs: duration
        });
    }
});

test('handles edge cases from fuzzing', () => {
    const enc1 = encryptWithMap('', { key, temperature: 0.5, seed: 'test-edge-1' });
    assert.strictEqual(decryptWithMapString(enc1.data, enc1.map, key), '');
    
    const enc2 = encryptWithMap('X', { key, temperature: 0.5, seed: 'test-edge-2' });
    assert.strictEqual(decryptWithMapString(enc2.data, enc2.map, key), 'X');
    
    const enc3 = encryptWithMap('test', { key, temperature: 0.01, seed: 'test-edge-3' });
    assert.strictEqual(decryptWithMapString(enc3.data, enc3.map, key), 'test');
    
    const enc4 = encryptWithMap('test', { key, temperature: 0.99, seed: 'test-edge-4' });
    assert.strictEqual(decryptWithMapString(enc4.data, enc4.map, key), 'test');
});

const summary = StatsTracker.instance.summary;
if (summary.count > 0) {
    console.log('\n--- Fuzz Test Summary ---');
    console.log(`Total runs: ${summary.count}`);
    console.log(`Avg duration: ${(summary.totalDurationMs / summary.count).toFixed(2)}ms`);
    console.log(`Total duration: ${summary.totalDurationMs}ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

