import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { signingService, RECOMMENDED_ALGORITHMS } = require('../../dist/index.cjs');

console.log('=== Signing Service Tests ===\n');

let passed = 0, failed = 0;

async function test(name, fn) {
    try { await fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

const algos = ['ed25519', 'ecdsa-p256', 'rsa-pss-2048'];

for (const algo of algos) {
    await test(`generateKeyPair + sign/verify round-trip for ${algo}`, async () => {
        const { publicKeyPem, privateKeyPem } = await signingService.generateKeyPair(algo);
        assert(publicKeyPem.includes('BEGIN PUBLIC KEY'));
        assert(privateKeyPem.includes('BEGIN PRIVATE KEY'));
        const message = 'hello world ' + algo;
        const sig = await signingService.sign(message, privateKeyPem, algo);
        const ok = await signingService.verify(message, sig, publicKeyPem, algo);
        assert.strictEqual(ok, true);
    });
}

await test('signMultiple/verifyMultiple at scale', async () => {
    const { publicKeyPem, privateKeyPem } = await signingService.generateKeyPair(RECOMMENDED_ALGORITHMS.modern);
    const items = Array.from({ length: 50 }, (_, i) => ({ data: `msg-${i}` }));
    const signatures = await signingService.signMultiple(items, privateKeyPem, RECOMMENDED_ALGORITHMS.modern);
    assert.strictEqual(signatures.length, items.length);
    const ver = await signingService.verifyMultiple(
        signatures.map((s, i) => ({ data: items[i].data, signature: s.signature })),
        publicKeyPem,
        RECOMMENDED_ALGORITHMS.modern
    );
    assert(ver.every(v => v.valid));
});

await test('getPublicKeyFromPrivate produces a key that verifies signatures', async () => {
    const { privateKeyPem } = await signingService.generateKeyPair('ed25519');
    const pub = signingService.getPublicKeyFromPrivate(privateKeyPem);
    const sig = await signingService.sign('data', privateKeyPem, 'ed25519');
    const ok = await signingService.verify('data', sig, pub, 'ed25519');
    assert.strictEqual(ok, true);
});

await test('fingerprint and safety numbers are generated', async () => {
    const { publicKeyPem } = await signingService.generateKeyPair('ed25519');
    const fp = signingService.getPublicKeyFingerprint(publicKeyPem);
    assert(/^[a-f0-9]{64}$/.test(fp));
    const sn = signingService.getSafetyNumbers(publicKeyPem, 6);
    assert(/\d{3}/.test(sn));
});

await test('validateKeyStrength returns warnings for RSA', () => {
    const res = signingService.validateKeyStrength('rsa-pss-2048');
    assert.strictEqual(res.secure, true);
    assert(res.warnings.length > 0);
});

await test('secureWipe scrubs buffer contents', () => {
    const buf = Buffer.from('super-secret');
    const before = buf.toString('hex');
    signingService.secureWipe(buf);
    const after = buf.toString('hex');
    assert.notStrictEqual(after, before);
});

await test('cross-algorithm verify fails', async () => {
    const { privateKeyPem, publicKeyPem } = await signingService.generateKeyPair('ed25519');
    const sig = await signingService.sign('hello', privateKeyPem, 'ed25519');
    let ok = false;
    try { ok = await signingService.verify('hello', sig, publicKeyPem, 'ecdsa-p256'); }
    catch (e) { ok = false; }
    assert.strictEqual(ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

