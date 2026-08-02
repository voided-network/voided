import assert from 'assert';
import crypto from 'crypto';
import zlib from 'zlib';
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'fs';
import { join } from 'path';
import { once } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    StatsTracker,
    createChunker,
    createCompressionStream,
    createDecompressionStream,
    createDecryptionStream,
    createLineSplitter,
    assertWithinServerUploadLimit,
    safetyNumbers,
} = require('../../dist/index.cjs');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✓ ${name}`);
    } catch (error) {
        failed++;
        console.log(`✗ ${name}: ${error.message}`);
    }
}

async function invokeRawTransform(stream, chunk) {
    return new Promise(resolve => {
        try {
            stream._transform(chunk, 'buffer', error => resolve(error ?? null));
        } catch (error) {
            resolve(error);
        }
    });
}

function forgedOversizedUint8ArrayLike() {
    return Object.setPrototypeOf(
        {
            byteLength: Number.MAX_SAFE_INTEGER,
            length: Number.MAX_SAFE_INTEGER,
        },
        Uint8Array.prototype,
    );
}

await test('rejects zero-sized chunks and fingerprint groups', () => {
    assert.throws(() => createChunker(0), /positive safe integer/);
    assert.throws(() => safetyNumbers(Buffer.from('x'), 0), /between 1 and 32/);
});

await test('line splitter preserves UTF-8 split across chunks', async () => {
    const splitter = createLineSplitter();
    const output = [];
    splitter.on('data', line => output.push(line));
    const text = Buffer.from('hello 🌍\nnext', 'utf8');
    splitter.write(text.subarray(0, 8));
    splitter.end(text.subarray(8));
    await once(splitter, 'end');
    assert.deepStrictEqual(output, ['hello 🌍', 'next']);
});

await test('line splitter preserves blank records', async () => {
    const splitter = createLineSplitter();
    const output = [];
    splitter.on('data', line => output.push(line));
    splitter.end(Buffer.from('\nalpha\n\n', 'utf8'));
    await once(splitter, 'end');
    assert.deepStrictEqual(output, ['', 'alpha', '']);
});

await test('line splitter rejects an unbounded line', async () => {
    const splitter = createLineSplitter({ maxLineBytes: 8 });
    const error = once(splitter, 'error');
    splitter.end(Buffer.alloc(9, 0x61));
    const [caught] = await error;
    assert.match(caught.message, /Line exceeds/);
});

await test('stream preflights reject forged chunks before copy or downstream work', async () => {
    const key = Buffer.alloc(32, 1);
    const nonce = Buffer.alloc(12, 2);
    const tag = Buffer.alloc(16, 3);
    const originalFrom = Buffer.from;
    const originalConcat = Buffer.concat;
    const originalGunzip = zlib.gunzipSync;
    const originalCreateDecipheriv = crypto.createDecipheriv;
    let copyCalls = 0;
    let concatCalls = 0;
    let decompressCalls = 0;
    let decryptUpdateCalls = 0;
    let decryptFinalCalls = 0;
    const fakeDecipher = {
        setAuthTag() {},
        update() {
            decryptUpdateCalls++;
            return Buffer.alloc(0);
        },
        final() {
            decryptFinalCalls++;
            return Buffer.alloc(0);
        },
    };

    zlib.gunzipSync = (...args) => {
        decompressCalls++;
        return originalGunzip(...args);
    };
    crypto.createDecipheriv = () => fakeDecipher;
    const decompressor = createDecompressionStream('gzip', { maxInputBytes: 8 });
    const decryptor = createDecryptionStream({
        key,
        nonce,
        tag,
        maxCiphertextBytes: 8,
    });
    const splitter = createLineSplitter({ maxLineBytes: 8 });
    Buffer.from = (...args) => {
        copyCalls++;
        return originalFrom(...args);
    };
    Buffer.concat = (...args) => {
        concatCalls++;
        return originalConcat(...args);
    };

    try {
        for (const stream of [decompressor, decryptor, splitter]) {
            const error = await invokeRawTransform(
                stream,
                forgedOversizedUint8ArrayLike(),
            );
            assert(error instanceof TypeError);
            assert.match(error.message, /real Buffer or Uint8Array/);
        }
        assert.strictEqual(copyCalls, 0);
        assert.strictEqual(concatCalls, 0);
        assert.strictEqual(decompressCalls, 0);
        assert.strictEqual(decryptUpdateCalls, 0);
        assert.strictEqual(decryptFinalCalls, 0);
    } finally {
        Buffer.from = originalFrom;
        Buffer.concat = originalConcat;
        zlib.gunzipSync = originalGunzip;
        crypto.createDecipheriv = originalCreateDecipheriv;
        decompressor.destroy();
        decryptor.destroy();
        splitter.destroy();
    }
});

await test('oversized real chunks fail before copy, concat, decompress, or decrypt', async () => {
    const key = Buffer.alloc(32, 1);
    const nonce = Buffer.alloc(12, 2);
    const tag = Buffer.alloc(16, 3);
    const oversizedCompressed = Buffer.alloc(9, 0x61);
    const oversizedCiphertext = Buffer.alloc(9, 0x62);
    const oversizedLine = Buffer.alloc(9, 0x63);
    const originalFrom = Buffer.from;
    const originalConcat = Buffer.concat;
    const originalGunzip = zlib.gunzipSync;
    const originalCreateDecipheriv = crypto.createDecipheriv;
    let copyCalls = 0;
    let concatCalls = 0;
    let decompressCalls = 0;
    let decryptUpdateCalls = 0;
    let decryptFinalCalls = 0;
    const fakeDecipher = {
        setAuthTag() {},
        update() {
            decryptUpdateCalls++;
            return Buffer.alloc(0);
        },
        final() {
            decryptFinalCalls++;
            return Buffer.alloc(0);
        },
    };

    zlib.gunzipSync = (...args) => {
        decompressCalls++;
        return originalGunzip(...args);
    };
    crypto.createDecipheriv = () => fakeDecipher;
    const decompressor = createDecompressionStream('gzip', { maxInputBytes: 8 });
    const decryptor = createDecryptionStream({
        key,
        nonce,
        tag,
        maxCiphertextBytes: 8,
    });
    const splitter = createLineSplitter({ maxLineBytes: 8 });
    Buffer.from = (...args) => {
        copyCalls++;
        return originalFrom(...args);
    };
    Buffer.concat = (...args) => {
        concatCalls++;
        return originalConcat(...args);
    };

    try {
        const decompressionError = await invokeRawTransform(
            decompressor,
            oversizedCompressed,
        );
        const decryptionError = await invokeRawTransform(
            decryptor,
            oversizedCiphertext,
        );
        const lineError = await invokeRawTransform(splitter, oversizedLine);
        assert.match(decompressionError?.message ?? '', /Compressed input exceeds 8 bytes/);
        assert.match(decryptionError?.message ?? '', /Ciphertext exceeds 8 bytes/);
        assert.match(lineError?.message ?? '', /Line exceeds 8 bytes/);
        assert.strictEqual(copyCalls, 0);
        assert.strictEqual(concatCalls, 0);
        assert.strictEqual(decompressCalls, 0);
        assert.strictEqual(decryptUpdateCalls, 0);
        assert.strictEqual(decryptFinalCalls, 0);
    } finally {
        Buffer.from = originalFrom;
        Buffer.concat = originalConcat;
        zlib.gunzipSync = originalGunzip;
        crypto.createDecipheriv = originalCreateDecipheriv;
        decompressor.destroy();
        decryptor.destroy();
        splitter.destroy();
    }
});

await test('line splitter rejects carry plus a no-newline tail before copying', async () => {
    const splitter = createLineSplitter({ maxLineBytes: 8 });
    const initial = Buffer.from('1234');
    const overflowingTail = Buffer.from('56789');
    const firstError = await invokeRawTransform(splitter, initial);
    assert.strictEqual(firstError, null);

    const originalFrom = Buffer.from;
    const originalConcat = Buffer.concat;
    let copyCalls = 0;
    let concatCalls = 0;
    Buffer.from = (...args) => {
        copyCalls++;
        return originalFrom(...args);
    };
    Buffer.concat = (...args) => {
        concatCalls++;
        return originalConcat(...args);
    };
    try {
        const error = await invokeRawTransform(splitter, overflowingTail);
        assert.match(error?.message ?? '', /Line exceeds 8 bytes/);
        assert.strictEqual(copyCalls, 0);
        assert.strictEqual(concatCalls, 0);
    } finally {
        Buffer.from = originalFrom;
        Buffer.concat = originalConcat;
        splitter.destroy();
    }
});

await test('tampered GCM emits no plaintext before authentication fails', async () => {
    const key = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update('TRANSFER=100'), cipher.final()]);
    const tag = cipher.getAuthTag();
    ciphertext[0] ^= 1;

    const decryptor = createDecryptionStream({ key, nonce, tag });
    const output = [];
    decryptor.on('data', chunk => output.push(Buffer.from(chunk)));
    const error = once(decryptor, 'error');
    decryptor.end(ciphertext);
    await error;
    assert.strictEqual(output.length, 0);
});

await test('decompression stream rejects excessive expansion', async () => {
    const bomb = require('zlib').gzipSync(Buffer.alloc(2 * 1024 * 1024));
    const decompressor = createDecompressionStream('gzip');
    const output = [];
    decompressor.on('data', chunk => output.push(chunk));
    const error = once(decompressor, 'error');
    decompressor.end(bomb);
    await error;
    assert.strictEqual(output.length, 0);
});

await test('none decompression passthrough obeys both input and output bounds', async () => {
    const decompressor = createDecompressionStream('none', {
        maxInputBytes: 4,
        maxOutputBytes: 8,
    });
    const output = [];
    decompressor.on('data', chunk => output.push(Buffer.from(chunk)));
    const error = once(decompressor, 'error');
    decompressor.end(Buffer.alloc(5));
    const [caught] = await error;
    assert.match(caught.message, /passthrough exceeds 4 bytes/);
    assert.strictEqual(output.length, 0);
});

await test('compression stream rejects unknown algorithms and invalid levels', () => {
    assert.throws(
        () => createCompressionStream({ algorithm: 'deflate' }),
        /Unsupported compression algorithm/,
    );
    assert.throws(
        () => createCompressionStream({ algorithm: 'gzip', level: 10 }),
        /between 0 and 9/,
    );
});

await test('limit helpers reject NaN and negative sizes', () => {
    assert.throws(() => assertWithinServerUploadLimit(Number.NaN), /safe integer/);
    assert.throws(() => assertWithinServerUploadLimit(-1), /safe integer/);
});

await test('stats dump replaces a symlink without overwriting its target', () => {
    const root = mkdtempSync(join(process.cwd(), '.voided-stats-security-'));
    try {
        const target = join(root, 'target.json');
        const link = join(root, 'stats.json');
        writeFileSync(target, 'do-not-overwrite');
        symlinkSync(target, link);
        StatsTracker.instance.dumpToJson(join(root.slice(process.cwd().length + 1), 'stats.json'));
        assert.strictEqual(readFileSync(target, 'utf8'), 'do-not-overwrite');
        assert.doesNotThrow(() => JSON.parse(readFileSync(link, 'utf8')));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
