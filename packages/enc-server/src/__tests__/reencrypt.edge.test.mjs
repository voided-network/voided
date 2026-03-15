import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { reEncryptWithNewKey, encryptWithMap, decryptWithMapString, generateKey } = require('../../dist/index.cjs');

console.log('=== Re-Encrypt Edge Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('re-encrypts data with new key and preserves plaintext', () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const data = 'Rotate me please 🗝️';
    const { data: blob, map } = encryptWithMap(data, { key: oldKey, temperature: 0.4, seed: 'test-reencrypt-1', compressionAlgorithm: 'brotli' });
    const migrated = reEncryptWithNewKey(blob, map, oldKey, newKey);
    const plain = decryptWithMapString(migrated.data, migrated.map, newKey);
    assert.strictEqual(plain, data);
});

test('re-encrypt with regenerated map', () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const data = 'Test message for rotation';
    const { data: blob, map } = encryptWithMap(data, { key: oldKey, temperature: 0.5, seed: 'test-reencrypt-2' });
    const migrated = reEncryptWithNewKey(blob, map, oldKey, newKey, { regenerateMap: true, temperature: 0.7, seed: 'test-reencrypt-new' });
    const plain = decryptWithMapString(migrated.data, migrated.map, newKey);
    assert.strictEqual(plain, data);
});

test('re-encrypt preserves unicode content', () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const data = '日本語テスト 🎌 中文测试 🐉 한국어 테스트 🇰🇷';
    const { data: blob, map } = encryptWithMap(data, { key: oldKey, seed: 'test-reencrypt-3' });
    const migrated = reEncryptWithNewKey(blob, map, oldKey, newKey);
    const plain = decryptWithMapString(migrated.data, migrated.map, newKey);
    assert.strictEqual(plain, data);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

