import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { hash, hashWithSalt, generateHmac, verifyHmac, compareHashes, fingerprint, safetyNumbers, hashPbkdf2, verifyPbkdf2, generateSalt } = require('../../dist/index.cjs');

console.log('=== Hash Service Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('SHA-256 produces correct hash', () => {
    const data = Buffer.from('hello world', 'utf8');
    const result = hash(data, 'sha256');
    assert.strictEqual(result, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});

test('SHA-512 produces correct hash', () => {
    const data = Buffer.from('hello world', 'utf8');
    const result = hash(data, 'sha512');
    assert.strictEqual(result.length, 128);
});

test('same input produces same hash', () => {
    const data = Buffer.from('test data', 'utf8');
    const hash1 = hash(data, 'sha256');
    const hash2 = hash(data, 'sha256');
    assert.strictEqual(hash1, hash2);
});

test('different inputs produce different hashes', () => {
    const data1 = Buffer.from('hello', 'utf8');
    const data2 = Buffer.from('world', 'utf8');
    assert.notStrictEqual(hash(data1), hash(data2));
});

test('hashWithSalt produces different hashes with different salts', () => {
    const data = Buffer.from('password', 'utf8');
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const hash1 = hashWithSalt(data, salt1);
    const hash2 = hashWithSalt(data, salt2);
    assert.notStrictEqual(hash1, hash2);
});

test('hashWithSalt is deterministic with same salt', () => {
    const data = Buffer.from('password', 'utf8');
    const salt = Buffer.from('fixed-salt-value', 'utf8');
    const hash1 = hashWithSalt(data, salt);
    const hash2 = hashWithSalt(data, salt);
    assert.strictEqual(hash1, hash2);
});

test('HMAC generation and verification', () => {
    const data = Buffer.from('message to authenticate', 'utf8');
    const key = Buffer.from('secret-key-1234567890123456', 'utf8');
    const hmac = generateHmac(data, key, 'sha256');
    assert.strictEqual(hmac.length, 64);
    const isValid = verifyHmac(data, hmac, key, 'sha256');
    assert.strictEqual(isValid, true);
});

test('HMAC verification fails with wrong key', () => {
    const data = Buffer.from('message', 'utf8');
    const key1 = Buffer.from('key-one-1234567890123456', 'utf8');
    const key2 = Buffer.from('key-two-1234567890123456', 'utf8');
    const hmac = generateHmac(data, key1, 'sha256');
    const isValid = verifyHmac(data, hmac, key2, 'sha256');
    assert.strictEqual(isValid, false);
});

test('HMAC verification fails with tampered message', () => {
    const data = Buffer.from('original message', 'utf8');
    const tamperedData = Buffer.from('tampered message', 'utf8');
    const key = Buffer.from('secret-key-1234567890123456', 'utf8');
    const hmac = generateHmac(data, key);
    const isValid = verifyHmac(tamperedData, hmac, key);
    assert.strictEqual(isValid, false);
});

test('compareHashes works for equal hashes', () => {
    const data1 = Buffer.from('same-value', 'utf8');
    const data2 = Buffer.from('same-value', 'utf8');
    assert.strictEqual(compareHashes(data1, data2), true);
});

test('compareHashes works for different hashes', () => {
    const data1 = Buffer.from('value-a', 'utf8');
    const data2 = Buffer.from('value-b', 'utf8');
    assert.strictEqual(compareHashes(data1, data2), false);
});

test('fingerprint generates correct length', () => {
    const data = Buffer.from('some data', 'utf8');
    const fp = fingerprint(data, 8);
    assert.strictEqual(fp.length, 16);
});

test('fingerprint is deterministic', () => {
    const data = Buffer.from('fingerprint test', 'utf8');
    const fp1 = fingerprint(data);
    const fp2 = fingerprint(data);
    assert.strictEqual(fp1, fp2);
});

test('safetyNumbers produces formatted string', () => {
    const data = Buffer.from('key data for safety numbers', 'utf8');
    const sn = safetyNumbers(data, 5);
    assert(sn.length > 0);
    assert(/\d{3}/.test(sn));
});

test('PBKDF2 hash and verify', () => {
    const data = Buffer.from('password123', 'utf8');
    const salt = generateSalt();
    const hashed = hashPbkdf2(data, salt, 100000);
    const isValid = verifyPbkdf2(data, hashed, salt, 100000);
    assert.strictEqual(isValid, true);
});

test('PBKDF2 verify fails with wrong password', () => {
    const password = Buffer.from('correct-password', 'utf8');
    const wrongPassword = Buffer.from('wrong-password', 'utf8');
    const salt = generateSalt();
    const hashed = hashPbkdf2(password, salt, 100000);
    const isValid = verifyPbkdf2(wrongPassword, hashed, salt, 100000);
    assert.strictEqual(isValid, false);
});

test('handles empty input', () => {
    const data = Buffer.from('', 'utf8');
    const result = hash(data, 'sha256');
    assert.strictEqual(result, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('handles unicode input', () => {
    const data = Buffer.from('日本語 🌍 مرحبا', 'utf8');
    const result = hash(data);
    assert.strictEqual(result.length, 64);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
