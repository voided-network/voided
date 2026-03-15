import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { VoidedService } = require('../../dist/index.cjs');

console.log('=== VoidedService E2E Stress Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('encrypt/decrypt many messages across sizes', () => {
    const svc = new VoidedService({ temperature: 0.5, seed: 'test-service-1' });
    const sizes = [0, 1, 7, 64, 512, 4096];
    for (const size of sizes) {
        const msg = 'X'.repeat(size);
        const enc = svc.encrypt(msg);
        const out = svc.decrypt(enc.data, enc.map);
        assert.strictEqual(out, msg);
    }
});

test('encrypt/decrypt with different temperatures', () => {
    const temps = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const temp of temps) {
        const svc = new VoidedService({ temperature: temp, seed: `test-service-temp-${temp}` });
        const msg = 'Test message for temperature ' + temp;
        const enc = svc.encrypt(msg);
        const out = svc.decrypt(enc.data, enc.map);
        assert.strictEqual(out, msg);
    }
});

test('obfuscateOnly/deobfuscateOnly roundtrip', () => {
    const svc = new VoidedService({ temperature: 0.6, seed: 'test-service-obf' });
    const messages = ['Simple text', 'Unicode: 日本語 🎌', 'Special chars: !@#$%^&*()', 'Long text '.repeat(50)];
    for (const msg of messages) {
        const { obfuscated, map } = svc.obfuscateOnly(msg);
        const restored = svc.deobfuscateOnly(obfuscated, map);
        assert.strictEqual(restored, msg);
    }
});

test('multiple services with different keys', () => {
    const svc1 = new VoidedService({ seed: 'test-service-1' });
    const svc2 = new VoidedService({ seed: 'test-service-2' });
    const msg = 'Shared message';
    const enc1 = svc1.encrypt(msg);
    const enc2 = svc2.encrypt(msg);
    assert.notStrictEqual(enc1.data, enc2.data);
    assert.strictEqual(svc1.decrypt(enc1.data, enc1.map), msg);
    assert.strictEqual(svc2.decrypt(enc2.data, enc2.map), msg);
});

test('service with custom key', () => {
    const customKey = Buffer.alloc(32, 0x42);
    const svc = new VoidedService({ encryptionKey: customKey, seed: 'test-service-custom' });
    assert(svc.getKey().equals(customKey));
    const msg = 'Custom key message';
    const enc = svc.encrypt(msg);
    const out = svc.decrypt(enc.data, enc.map);
    assert.strictEqual(out, msg);
});

test('stress: 100 encrypt/decrypt cycles', () => {
    const svc = new VoidedService({ temperature: 0.4, seed: 'test-service-stress' });
    const msg = 'Stress test payload 🚀';
    for (let i = 0; i < 10; i++) {
        const enc = svc.encrypt(msg);
        const out = svc.decrypt(enc.data, enc.map);
        assert.strictEqual(out, msg);
    }
});

test('handles edge case: empty string', () => {
    const svc = new VoidedService({ seed: 'test-service-empty' });
    const enc = svc.encrypt('');
    const out = svc.decrypt(enc.data, enc.map);
    assert.strictEqual(out, '');
});

test('handles edge case: single character', () => {
    const svc = new VoidedService({ seed: 'test-service-single' });
    const enc = svc.encrypt('X');
    const out = svc.decrypt(enc.data, enc.map);
    assert.strictEqual(out, 'X');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

