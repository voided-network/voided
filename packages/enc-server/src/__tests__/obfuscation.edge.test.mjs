import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { generateMap, obfuscate, deobfuscate, analyzeMap, getExpansionRatio } = require('../../dist/index.cjs');

console.log('=== Obfuscation Edge Cases ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('handles empty string', () => {
    const map = generateMap(0.5, 'test-empty');
    const result = obfuscate('', map);
    assert.strictEqual(result.obfuscated, '');
    assert.strictEqual(result.originalLength, 0);
    const recovered = deobfuscate(result.obfuscated, map);
    assert.strictEqual(recovered, '');
});

test('handles single character', () => {
    const map = generateMap(0.5, 'test-single');
    const result = obfuscate('a', map);
    assert.strictEqual(result.originalLength, 1);
    const recovered = deobfuscate(result.obfuscated, map);
    assert.strictEqual(recovered, 'a');
});

test('handles unicode characters', () => {
    const map = generateMap(0.5, 'test-unicode');
    const text = '日本語 🎌 中文 🐉 한국어 🇰🇷';
    const result = obfuscate(text, map);
    const recovered = deobfuscate(result.obfuscated, map);
    assert.strictEqual(recovered, text);
});

test('handles special characters', () => {
    const map = generateMap(0.5, 'test-special');
    const text = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
    const result = obfuscate(text, map);
    const recovered = deobfuscate(result.obfuscated, map);
    assert.strictEqual(recovered, text);
});

test('different temperatures produce different expansion ratios', () => {
    const lowTempMap = generateMap(0.1, 'test-low');
    const highTempMap = generateMap(0.9, 'test-high');
    const lowRatio = getExpansionRatio(lowTempMap);
    const highRatio = getExpansionRatio(highTempMap);
    assert(highRatio > lowRatio, 'Higher temperature should produce higher expansion');
});

test('deterministic with same seed', () => {
    const map1 = generateMap(0.5, 'test-seed');
    const map2 = generateMap(0.5, 'test-seed');
    
    // Compare maps by content rather than JSON string order
    // JavaScript objects may have different key orders between calls
    const keys1 = Object.keys(map1).sort();
    const keys2 = Object.keys(map2).sort();
    assert.deepStrictEqual(keys1, keys2, 'Maps should have same keys');
    
    for (const key of keys1) {
        const vals1 = map1[key].slice().sort();
        const vals2 = map2[key].slice().sort();
        assert.deepStrictEqual(vals1, vals2, `Mappings for "${key}" should be identical`);
    }
});

test('different seeds produce different maps', () => {
    const map1 = generateMap(0.5, 'seed-a');
    const map2 = generateMap(0.5, 'seed-b');
    assert.notStrictEqual(JSON.stringify(map1), JSON.stringify(map2));
});

test('analyzeMap returns valid statistics', () => {
    const map = generateMap(0.6, 'test-analyze');
    const analysis = analyzeMap(map);
    assert(Math.abs(analysis.temperature - 0.6) < 0.2);
    assert(analysis.totalMappings > 0);
    assert(analysis.averageMappingsPerChar > 0);
    assert(analysis.averageMappingLength > 0);
    assert(analysis.expansionRatio > 0);
});

test('handles long text', () => {
    const map = generateMap(0.5, 'test-long');
    const longText = 'Hello World! '.repeat(100);
    const result = obfuscate(longText, map);
    assert(result.obfuscatedLength > result.originalLength);
    const recovered = deobfuscate(result.obfuscated, map);
    assert.strictEqual(recovered, longText);
});

test('handles newlines and whitespace', () => {
    const map = generateMap(0.5, 'test-newlines');
    const text = 'Line 1\nLine 2\r\nLine 3\tTabbed';
    const result = obfuscate(text, map);
    const recovered = deobfuscate(result.obfuscated, map);
    assert.strictEqual(recovered, text);
});

test('expansion ratio in result is accurate', () => {
    const map = generateMap(0.5, 'test-ratio');
    const text = 'Test message for ratio calculation';
    const result = obfuscate(text, map);
    const calculatedRatio = result.obfuscatedLength / result.originalLength;
    assert(Math.abs(result.expansionRatio - calculatedRatio) < 0.01);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

