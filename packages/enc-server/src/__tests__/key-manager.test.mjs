import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { KeyManager } = require('../../dist/index.cjs');

console.log('=== KeyManager Tests ===\n');

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

test('generate and access active key', () => {
    const km = new KeyManager();
    const first = km.generateAndActivateKey();
    assert.strictEqual(km.activeKey.id, first.id);
    assert.strictEqual(km.toJSON().totalKeys, 1);
});

test('add external key and make active', () => {
    const km = new KeyManager();
    const buf = Buffer.alloc(32, 7);
    const added = km.addKey(buf, true, 'fixed');
    assert.strictEqual(km.activeKey.id, 'fixed');
    assert(km.getKey('fixed').key.equals(buf));
});

test('rotateKey switches active id', () => {
    const km = new KeyManager();
    const first = km.generateAndActivateKey();
    const rotated = km.rotateKey();
    assert.notStrictEqual(rotated.id, first.id);
    assert.strictEqual(km.activeKey.id, rotated.id);
    assert.strictEqual(km.toJSON().totalKeys, 2);
});

test('generated keys are 32 bytes', () => {
    const km = new KeyManager();
    const key = km.generateAndActivateKey();
    assert.strictEqual(key.key.length, 32);
});

test('multiple rotations maintain history', () => {
    const km = new KeyManager();
    km.generateAndActivateKey();
    km.rotateKey();
    km.rotateKey();
    km.rotateKey();
    assert.strictEqual(km.toJSON().totalKeys, 4);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

