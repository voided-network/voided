import assert from 'assert';
import { PassThrough } from 'stream';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
    createCompressionStream, createDecompressionStream,
    createEncryptionStream, createDecryptionStream,
    createObfuscateStream, createDeobfuscateStream,
    generateMap, generateKey
} = require('../../dist/index.cjs');

console.log('=== Streams Tests ===\n');

let passed = 0, failed = 0;

async function test(name, fn) {
    try { await fn(); passed++; console.log(`✓ ${name}`); }
    catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); }
}

function collect(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', c => chunks.push(c));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

await test('compression round-trip (gzip)', async () => {
    const input = Buffer.from('hello world'.repeat(50));
    const src = new PassThrough();
    const comp = createCompressionStream({ algorithm: 'gzip' });
    const decomp = createDecompressionStream('gzip');
    const outP = collect(src.pipe(comp).pipe(decomp));
    src.end(input);
    const out = await outP;
    assert.strictEqual(out.toString('hex'), input.toString('hex'));
});

await test('compression round-trip (brotli)', async () => {
    const input = Buffer.from('hello brotli world'.repeat(50));
    const src = new PassThrough();
    const comp = createCompressionStream({ algorithm: 'brotli' });
    const decomp = createDecompressionStream('brotli');
    const outP = collect(src.pipe(comp).pipe(decomp));
    src.end(input);
    const out = await outP;
    assert.strictEqual(out.toString('hex'), input.toString('hex'));
});

await test('encryption round-trip (AES-256-GCM)', async () => {
    const input = Buffer.from('secret data'.repeat(50));
    const key = generateKey();
    const src = new PassThrough();
    const enc = createEncryptionStream({ key });
    const encOut = src.pipe(enc.stream);
    src.end(input);
    const encrypted = await collect(encOut);
    const nonce = enc.nonce;
    const tag = enc.getAuthTag();
    const dec = createDecryptionStream({ key, nonce, tag });
    const out = await collect(PassThrough.from(encrypted).pipe(dec));
    assert.strictEqual(out.toString('hex'), input.toString('hex'));
});

await test('obfuscate/deobfuscate round-trip (stream)', async () => {
    const map = generateMap(0.5, 'test-stream');
    const input = 'The quick brown fox jumps over the lazy dog 🦊🐶';
    const src = new PassThrough();
    const obf = createObfuscateStream(map);
    const deobf = createDeobfuscateStream(map);
    const outP = collect(src.pipe(obf).pipe(deobf));
    src.end(Buffer.from(input, 'utf8'));
    const out = (await outP).toString('utf8');
    assert.strictEqual(out, input);
});

await test('stream handles empty input', async () => {
    const input = Buffer.from('');
    const src = new PassThrough();
    const comp = createCompressionStream({ algorithm: 'gzip' });
    const decomp = createDecompressionStream('gzip');
    const outP = collect(src.pipe(comp).pipe(decomp));
    src.end(input);
    const out = await outP;
    assert.strictEqual(out.length, 0);
});

await test('stream handles large data', async () => {
    const input = Buffer.alloc(1024 * 1024, 0x42);
    const key = generateKey();
    const src = new PassThrough();
    const enc = createEncryptionStream({ key });
    const encOut = src.pipe(enc.stream);
    src.end(input);
    const encrypted = await collect(encOut);
    const nonce = enc.nonce;
    const tag = enc.getAuthTag();
    const dec = createDecryptionStream({ key, nonce, tag });
    const out = await collect(PassThrough.from(encrypted).pipe(dec));
    assert.strictEqual(out.length, input.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

