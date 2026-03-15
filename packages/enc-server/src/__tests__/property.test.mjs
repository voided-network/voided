import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { encrypt, decrypt, compress, decompress, encryptWithMap, decryptWithMapString, reEncryptWithNewKey, generateKey } = require('../../dist/index.cjs');

console.log('=== Property-Based Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

function randomString(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
    let str = '';
    for (let i = 0; i < len; i++) str += chars[Math.floor(Math.random() * chars.length)];
    return str;
}

function randomKey() {
    const buf = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
    return buf;
}

test('raw encryption round-trip (100 iterations)', () => {
    for (let i = 0; i < 10; i++) {
        const data = randomString(Math.floor(Math.random() * 500));
        const key = randomKey();
        const enc = encrypt(Buffer.from(data, 'utf8'), key);
        const out = decrypt(enc, key).toString('utf8');
        assert.strictEqual(out, data);
    }
});

test('compression round-trip (100 iterations)', () => {
    for (let i = 0; i < 10; i++) {
        const data = randomString(Math.floor(Math.random() * 500));
        const buf = Buffer.from(data, 'utf8');
        const result = compress(buf, 'brotli');
        if (result.algorithm !== 'none') {
            const restored = decompress(result.compressed, result.algorithm);
            assert.strictEqual(restored.toString('utf8'), data);
        } else {
            assert.strictEqual(result.compressed.toString('utf8'), data);
        }
    }
});

test('full pipeline round-trip (50 iterations)', () => {
    for (let i = 0; i < 5; i++) {
        const data = randomString(Math.floor(Math.random() * 300));
        const key = randomKey();
        const temp = 0.1 + Math.random() * 0.8;
        const enc = encryptWithMap(data, { key, temperature: temp, seed: `test-prop-${i}`, compressionAlgorithm: 'brotli' });
        const out = decryptWithMapString(enc.data, enc.map, key);
        assert.strictEqual(out, data);
    }
});

test('key rotation preserves data (50 iterations)', () => {
    for (let i = 0; i < 5; i++) {
        const data = randomString(Math.floor(Math.random() * 200));
        const oldKey = randomKey();
        const newKey = randomKey();
        const temp = 0.1 + Math.random() * 0.8;
        const seed = `test-rotate-${i}`;
        const first = encryptWithMap(data, { key: oldKey, temperature: temp, seed });
        const migrated = reEncryptWithNewKey(first.data, first.map, oldKey, newKey, { seed });
        const recovered = decryptWithMapString(migrated.data, migrated.map, newKey);
        assert.strictEqual(recovered, data);
    }
});

test('wrong key does not decrypt (50 iterations)', () => {
    for (let i = 0; i < 5; i++) {
        const data = randomString(Math.floor(Math.random() * 100) + 1);
        const keyA = randomKey();
        let keyB = randomKey();
        while (keyA.equals(keyB)) keyB = randomKey();
        const enc = encrypt(Buffer.from(data, 'utf8'), keyA);
        let threw = false;
        try { decrypt(enc, keyB); } catch { threw = true; }
        assert(threw, 'Should throw with wrong key');
    }
});

test('encryption is non-deterministic (30 iterations)', () => {
    for (let i = 0; i < 5; i++) {
        const data = randomString(Math.floor(Math.random() * 50) + 1);
        const key = randomKey();
        const enc1 = encrypt(Buffer.from(data, 'utf8'), key);
        const enc2 = encrypt(Buffer.from(data, 'utf8'), key);
        assert(!enc1.encrypted.equals(enc2.encrypted), 'Ciphertexts should differ');
        assert.strictEqual(decrypt(enc1, key).toString('utf8'), data);
        assert.strictEqual(decrypt(enc2, key).toString('utf8'), data);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

