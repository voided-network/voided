import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { generateMap, analyzeMap, getExpansionRatio } = require('../../dist/index.cjs');

console.log('=== Map Analysis Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

// Generate maps once upfront to avoid repeated slow generations
console.log('Generating test maps...');
const map05 = generateMap(0.5, 'test-map-05');
const map02 = generateMap(0.2, 'test-map-02');
const map08 = generateMap(0.8, 'test-map-08');
console.log('Maps generated.\n');

test('analyzeMap returns all expected fields', () => {
    const analysis = analyzeMap(map05);
    assert(analysis.temperature !== undefined);
    assert(analysis.totalMappings !== undefined);
    assert(analysis.averageMappingsPerChar !== undefined);
    assert(analysis.averageMappingLength !== undefined);
    assert(analysis.expansionRatio !== undefined);
    assert(analysis.computeScore !== undefined);
    assert(analysis.entropy !== undefined);
});

test('temperature is reflected in analysis', () => {
    const lowAnalysis = analyzeMap(map02);
    const highAnalysis = analyzeMap(map08);
    assert(lowAnalysis.temperature < highAnalysis.temperature);
});

test('higher temperature produces more mappings', () => {
    const lowAnalysis = analyzeMap(map02);
    const highAnalysis = analyzeMap(map08);
    assert(highAnalysis.averageMappingsPerChar >= lowAnalysis.averageMappingsPerChar);
});

test('getExpansionRatio returns positive number', () => {
    const ratio = getExpansionRatio(map05);
    assert(ratio > 0);
    assert(typeof ratio === 'number');
});

test('expansion ratio varies with temperature', () => {
    const lowRatio = getExpansionRatio(map02);
    const highRatio = getExpansionRatio(map08);
    assert(typeof lowRatio === 'number');
    assert(typeof highRatio === 'number');
});

test('map contains expected character keys', () => {
    assert(map05['a'] !== undefined);
    assert(map05['A'] !== undefined);
    assert(map05['0'] !== undefined);
    assert(Array.isArray(map05['a']));
    assert(map05['a'].length > 0);
});

test('all mappings are non-empty strings', () => {
    for (const [char, mappings] of Object.entries(map05)) {
        assert(Array.isArray(mappings));
        for (const mapping of mappings) {
            assert(typeof mapping === 'string');
            assert(mapping.length > 0);
        }
    }
});

test('computeScore is reasonable', () => {
    const analysis = analyzeMap(map05);
    assert(analysis.computeScore > 0);
    assert(analysis.computeScore < 1000000);
});

test('entropy is calculated', () => {
    const analysis = analyzeMap(map05);
    assert(analysis.entropy > 0);
});

test('different seeds produce different maps', () => {
    const mapA = generateMap(0.5, 'seed-a');
    const mapB = generateMap(0.5, 'seed-b');
    assert.notStrictEqual(JSON.stringify(mapA), JSON.stringify(mapB));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
