import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { encrypt, decrypt, generateKey, deriveKeyHkdf, deriveKeyPbkdf2, base64Encode, base64Decode, hexEncode, hexDecode } = require('../../dist/index.cjs');

console.log('=== Encryption Serialization Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('encrypted result has all required fields', () => {
    const key = generateKey();
    const data = Buffer.from('test data', 'utf8');
    const result = encrypt(data, key);
    assert(result.encrypted !== undefined);
    assert(result.algorithm !== undefined);
    assert(result.nonce !== undefined);
    assert(result.tag !== undefined);
    assert(Buffer.isBuffer(result.encrypted));
    assert(Buffer.isBuffer(result.nonce));
    assert(Buffer.isBuffer(result.tag));
});

test('encrypted data can be serialized to JSON', () => {
    const key = generateKey();
    const data = Buffer.from('serialize me', 'utf8');
    const result = encrypt(data, key);
    const serialized = {
        encrypted: result.encrypted.toString('base64'),
        algorithm: result.algorithm,
        nonce: result.nonce.toString('base64'),
        tag: result.tag.toString('base64'),
    };
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    const reconstructed = {
        encrypted: Buffer.from(parsed.encrypted, 'base64'),
        algorithm: parsed.algorithm,
        nonce: Buffer.from(parsed.nonce, 'base64'),
        tag: Buffer.from(parsed.tag, 'base64'),
    };
    const decrypted = decrypt(reconstructed, key);
    assert.strictEqual(decrypted.toString('utf8'), 'serialize me');
});

test('AES-256-GCM produces expected nonce size', () => {
    const key = generateKey();
    const data = Buffer.from('test', 'utf8');
    const result = encrypt(data, key, 'aes-256-gcm');
    assert.strictEqual(result.algorithm, 'aes-256-gcm');
    assert.strictEqual(result.nonce.length, 12);
    assert.strictEqual(result.tag.length, 16);
});

test('XChaCha20-Poly1305 produces expected nonce size', () => {
    const key = generateKey();
    const data = Buffer.from('test', 'utf8');
    const result = encrypt(data, key, 'xchacha20-poly1305');
    assert.strictEqual(result.algorithm, 'xchacha20-poly1305');
    assert.strictEqual(result.nonce.length, 24);
    assert.strictEqual(result.tag.length, 16);
});

test('keys can be exported and imported via base64', () => {
    const originalKey = generateKey();
    const exported = base64Encode(originalKey);
    const imported = base64Decode(exported);
    assert(imported.equals(originalKey));
    const data = Buffer.from('test', 'utf8');
    const encrypted = encrypt(data, originalKey);
    const decrypted = decrypt(encrypted, imported);
    assert.strictEqual(decrypted.toString('utf8'), 'test');
});

test('keys can be exported and imported via hex', () => {
    const originalKey = generateKey();
    const exported = hexEncode(originalKey);
    const imported = hexDecode(exported);
    assert(imported.equals(originalKey));
    assert.strictEqual(exported.length, 64);
});

test('HKDF derived keys work for encryption', () => {
    const ikm = Buffer.from('initial key material', 'utf8');
    const salt = Buffer.from('salt-value', 'utf8');
    const info = Buffer.from('context info', 'utf8');
    const derivedKey = deriveKeyHkdf(ikm, salt, info);
    assert.strictEqual(derivedKey.length, 32);
    const data = Buffer.from('secret', 'utf8');
    const encrypted = encrypt(data, derivedKey);
    const decrypted = decrypt(encrypted, derivedKey);
    assert.strictEqual(decrypted.toString('utf8'), 'secret');
});

test('HKDF is deterministic', () => {
    const ikm = Buffer.from('initial key material', 'utf8');
    const salt = Buffer.from('salt-value', 'utf8');
    const info = Buffer.from('context info', 'utf8');
    const key1 = deriveKeyHkdf(ikm, salt, info);
    const key2 = deriveKeyHkdf(ikm, salt, info);
    assert(key1.equals(key2));
});

test('PBKDF2 derived keys work for encryption', () => {
    const password = Buffer.from('my-password', 'utf8');
    const salt = Buffer.from('salt-123456789012', 'utf8');
    const derivedKey = deriveKeyPbkdf2(password, salt, 10000);
    assert.strictEqual(derivedKey.length, 32);
    const data = Buffer.from('protected data', 'utf8');
    const encrypted = encrypt(data, derivedKey);
    const decrypted = decrypt(encrypted, derivedKey);
    assert.strictEqual(decrypted.toString('utf8'), 'protected data');
});

test('PBKDF2 is deterministic', () => {
    const password = Buffer.from('password', 'utf8');
    const salt = Buffer.from('salt-value-12345', 'utf8');
    const key1 = deriveKeyPbkdf2(password, salt, 5000);
    const key2 = deriveKeyPbkdf2(password, salt, 5000);
    assert(key1.equals(key2));
});

test('different PBKDF2 iterations produce different keys', () => {
    const password = Buffer.from('password', 'utf8');
    const salt = Buffer.from('salt-value-12345', 'utf8');
    const key1 = deriveKeyPbkdf2(password, salt, 1000);
    const key2 = deriveKeyPbkdf2(password, salt, 2000);
    assert(!key1.equals(key2));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

