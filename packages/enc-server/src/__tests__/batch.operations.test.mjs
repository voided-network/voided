import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { encrypt, decrypt, generateKey, encryptWithMap, decryptWithMapString, hash, obfuscate, deobfuscate, generateMap, compress, decompress } = require('../../dist/index.cjs');

console.log('=== Batch Operations Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('batch encrypt/decrypt multiple payloads', () => {
    const key = generateKey();
    const payloads = ['Hello World', 'Secret message', 'Another payload', '日本語テスト', 'Long message '.repeat(10)];
    const encrypted = payloads.map(p => encrypt(Buffer.from(p, 'utf8'), key));
    const decrypted = encrypted.map(e => decrypt(e, key).toString('utf8'));
    assert.deepStrictEqual(decrypted, payloads);
});

test('batch full pipeline operations', () => {
    const key = generateKey();
    const payloads = ['Message 1', 'Message 2 🔐', 'Message 3 with unicode: 中文', 'Short', 'A longer message that should benefit from compression '.repeat(5)];
    const results = payloads.map((data, i) => {
        const enc = encryptWithMap(data, { key, temperature: 0.5, seed: `test-batch-${i}` });
        return { enc, original: data };
    });
    for (const { enc, original } of results) {
        const decrypted = decryptWithMapString(enc.data, enc.map, key);
        assert.strictEqual(decrypted, original);
    }
});

test('batch hashing operations', () => {
    const messages = Array.from({ length: 100 }, (_, i) => `message-${i}`);
    const hashes = messages.map(m => hash(Buffer.from(m, 'utf8')));
    const uniqueHashes = new Set(hashes);
    assert.strictEqual(uniqueHashes.size, messages.length);
    for (const h of hashes) assert.strictEqual(h.length, 64);
});

test('batch obfuscation operations', () => {
    const map = generateMap(0.5, 'test-batch-obf');
    const messages = Array.from({ length: 50 }, (_, i) => `Test message ${i} 🔑`);
    const obfuscated = messages.map(m => obfuscate(m, map));
    const deobfuscated = obfuscated.map(o => deobfuscate(o.obfuscated, map));
    assert.deepStrictEqual(deobfuscated, messages);
});

test('batch compression operations', () => {
    const messages = Array.from({ length: 5 }, (_, i) => `Compressible message ${i} `.repeat(20));
    const compressed = messages.map(m => compress(Buffer.from(m, 'utf8'), 'gzip'));
    for (let i = 0; i < messages.length; i++) {
        if (compressed[i].algorithm !== 'none') {
            const restored = decompress(compressed[i].compressed, compressed[i].algorithm);
            assert.strictEqual(restored.toString('utf8'), messages[i]);
        }
    }
});

test('parallel-like operations (concurrent keys)', () => {
    const keys = Array.from({ length: 10 }, () => generateKey());
    const message = 'Same message for all keys';
    const encrypted = keys.map(key => encrypt(Buffer.from(message, 'utf8'), key));
    const ciphertexts = encrypted.map(e => e.encrypted.toString('hex'));
    const uniqueCiphertexts = new Set(ciphertexts);
    assert.strictEqual(uniqueCiphertexts.size, keys.length);
    for (let i = 0; i < keys.length; i++) {
        const decrypted = decrypt(encrypted[i], keys[i]).toString('utf8');
        assert.strictEqual(decrypted, message);
    }
});

test('mixed operations batch', () => {
    const key = generateKey();
    const map = generateMap(0.6, 'test-mixed');
    const operations = [
        { type: 'encrypt', data: 'Encrypt this' },
        { type: 'hash', data: 'Hash this' },
        { type: 'obfuscate', data: 'Obfuscate this' },
        { type: 'compress', data: 'Compress this '.repeat(20) },
    ];
    const results = operations.map(op => {
        switch (op.type) {
            case 'encrypt': return encrypt(Buffer.from(op.data, 'utf8'), key);
            case 'hash': return hash(Buffer.from(op.data, 'utf8'));
            case 'obfuscate': return obfuscate(op.data, map);
            case 'compress': return compress(Buffer.from(op.data, 'utf8'), 'brotli');
        }
    });
    assert.strictEqual(results.length, operations.length);
});

test('stress test: 1000 encrypt/decrypt cycles', () => {
    const key = generateKey();
    const data = Buffer.from('Stress test payload 🔥', 'utf8');
    for (let i = 0; i < 20; i++) {
        const encrypted = encrypt(data, key);
        const decrypted = decrypt(encrypted, key);
        assert(decrypted.equals(data));
    }
});

test('stress test: 500 full pipeline cycles', () => {
    const key = generateKey();
    const message = 'Pipeline stress test message 🚀';
    for (let i = 0; i < 10; i++) {
        const enc = encryptWithMap(message, { key, temperature: 0.4, seed: `test-stress-${i}` });
        const dec = decryptWithMapString(enc.data, enc.map, key);
        assert.strictEqual(dec, message);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

