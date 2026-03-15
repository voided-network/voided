import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
    generateMap, obfuscate, deobfuscate,
    encryptWithMap, decryptWithMapString,
    KeyManager, reEncryptWithNewKey,
    compress, decompress, generateKey
} = require('../../dist/index.cjs');

console.log('=== Pipeline Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

function randomString(len) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
    let str = "";
    for (let i = 0; i < len; i++) str += chars[Math.floor(Math.random() * chars.length)];
    return str;
}

test('Mapping strings are globally unique', () => {
    const map = generateMap(0.6, 'uniqueness-test');
    const allMappings = new Set();
    for (const arr of Object.values(map)) {
        for (const m of arr) {
            assert(!allMappings.has(m), 'Duplicate mapping found');
            allMappings.add(m);
        }
    }
});

test('Obfuscation round-trip passes for multiple inputs & temps', () => {
    const temps = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const t of temps) {
        const map = generateMap(t, `rt-${t}`);
        for (let i = 0; i < 5; i++) {
            const text = randomString(50 + Math.floor(Math.random() * 100));
            const result = obfuscate(text, map);
            const recovered = deobfuscate(result.obfuscated, map);
            assert.strictEqual(recovered, text);
        }
    }
});

test('Encrypt→Obfuscate→Decrypt pipeline integrity', () => {
    const key = generateKey();
    const data = 'Super secret message 🤫';
    const enc = encryptWithMap(data, { key, temperature: 0.4, seed: 'test-pipeline', compressionAlgorithm: 'brotli' });
    const out = decryptWithMapString(enc.data, enc.map, key);
    assert.strictEqual(out, data);
});

test('Pipeline handles empty string', () => {
    const key = generateKey();
    const data = '';
    const enc = encryptWithMap(data, { key, temperature: 0.5, seed: 'test-empty' });
    const out = decryptWithMapString(enc.data, enc.map, key);
    assert.strictEqual(out, data);
});

test('Pipeline handles unicode', () => {
    const key = generateKey();
    const data = '日本語 🎌 中文 🐉 한국어 🇰🇷 Emoji: 🔐🔑💻';
    const enc = encryptWithMap(data, { key, temperature: 0.5, seed: 'test-unicode' });
    const out = decryptWithMapString(enc.data, enc.map, key);
    assert.strictEqual(out, data);
});

test('KeyManager rotates keys and preserves access', () => {
    const km = new KeyManager();
    km.generateAndActivateKey();
    const firstKey = km.activeKey;
    const msg = 'rotate me';
    const first = encryptWithMap(msg, { key: firstKey.key, temperature: 0.5, seed: 'test-rotate' });
    const rotated = km.rotateKey();
    const migrated = reEncryptWithNewKey(first.data, first.map, firstKey.key, rotated.key, { seed: 'test-rotate' });
    const recovered = decryptWithMapString(migrated.data, migrated.map, rotated.key);
    assert.strictEqual(recovered, msg);
});

test('Compression actually reduces size when possible', () => {
    const text = randomString(100).repeat(5);
    const buf = Buffer.from(text, 'utf8');
    const gzip = compress(buf, 'gzip');
    assert(gzip.compressionRatio < 0.5, 'Should compress well');
    if (gzip.algorithm !== 'none') {
        const restored = decompress(gzip.compressed, gzip.algorithm);
        assert.strictEqual(restored.toString('utf8'), text);
    }
});

test('Multiple encryptions produce different ciphertexts', () => {
    const key = generateKey();
    const data = 'Same message';
    const enc1 = encryptWithMap(data, { key, temperature: 0.5, seed: 'test-multi-1' });
    const enc2 = encryptWithMap(data, { key, temperature: 0.5, seed: 'test-multi-2' });
    assert.notStrictEqual(enc1.data, enc2.data);
    assert.strictEqual(decryptWithMapString(enc1.data, enc1.map, key), data);
    assert.strictEqual(decryptWithMapString(enc2.data, enc2.map, key), data);
});

test('Large payload encryption/decryption', () => {
    const key = generateKey();
    const data = randomString(1000);
    const enc = encryptWithMap(data, { key, temperature: 0.3, seed: 'test-large' });
    const out = decryptWithMapString(enc.data, enc.map, key);
    assert.strictEqual(out, data);
    assert(enc.compressedSize < enc.originalSize);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

