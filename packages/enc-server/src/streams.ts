import { Transform, TransformCallback } from 'stream';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_EXPANSION_RATIO = 256;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

function boundedInteger(name: string, value: number, max = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
        throw new RangeError(`${name} must be a positive safe integer no greater than ${max}`);
    }
    return value;
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const intrinsicTypedArrayByteLength = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    'byteLength',
)!.get!;
const intrinsicTypedArrayLength = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    'length',
)!.get!;
const intrinsicTypedArrayByteOffset = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    'byteOffset',
)!.get!;
const intrinsicTypedArrayBuffer = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    'buffer',
)!.get!;
const intrinsicTypedArrayTag = Object.getOwnPropertyDescriptor(
    typedArrayPrototype,
    Symbol.toStringTag,
)!.get!;
const intrinsicUint8ArrayIndexOf = Uint8Array.prototype.indexOf;

function streamChunkByteLength(chunk: unknown): number {
    let tag: unknown;
    let byteLength: unknown;
    let length: unknown;
    try {
        tag = intrinsicTypedArrayTag.call(chunk);
        byteLength = intrinsicTypedArrayByteLength.call(chunk);
        length = intrinsicTypedArrayLength.call(chunk);
    } catch {
        throw new TypeError('Stream chunk must be a real Buffer or Uint8Array');
    }
    if (!Buffer.isBuffer(chunk) && tag !== 'Uint8Array') {
        throw new TypeError('Stream chunk must be a real Buffer or Uint8Array');
    }
    if (
        !Number.isSafeInteger(byteLength) ||
        !Number.isSafeInteger(length) ||
        byteLength !== length ||
        (byteLength as number) < 0
    ) {
        throw new RangeError('Stream chunk byte length is invalid');
    }
    return byteLength as number;
}

function streamChunkView(chunk: unknown, start: number, end: number): Uint8Array {
    const buffer = intrinsicTypedArrayBuffer.call(chunk) as ArrayBufferLike;
    const byteOffset = intrinsicTypedArrayByteOffset.call(chunk) as number;
    return new Uint8Array(buffer, byteOffset + start, end - start);
}

function wipeBuffers(buffers: Buffer[]): void {
    for (const buffer of buffers) buffer.fill(0);
    buffers.length = 0;
}

// Compression streams
export function createCompressionStream(options: { algorithm: 'brotli' | 'gzip'; level?: number }) {
    const { algorithm, level } = options;
    if (algorithm !== 'brotli' && algorithm !== 'gzip') {
        throw new TypeError(`Unsupported compression algorithm: ${String(algorithm)}`);
    }
    if (level != null) {
        const maximum = algorithm === 'brotli' ? 11 : 9;
        if (!Number.isInteger(level) || level < 0 || level > maximum) {
            throw new RangeError(`${algorithm} compression level must be an integer between 0 and ${maximum}`);
        }
    }
    if (algorithm === 'brotli') {
        return zlib.createBrotliCompress({ params: level != null ? { [zlib.constants.BROTLI_PARAM_QUALITY]: level } : undefined });
    }
    return zlib.createGzip({ level });
}

export function createDecompressionStream(
    algorithm: 'brotli' | 'gzip' | 'none',
    options: {
        maxInputBytes?: number;
        maxOutputBytes?: number;
        maxExpansionRatio?: number;
    } = {}
) {
    if (algorithm !== 'brotli' && algorithm !== 'gzip' && algorithm !== 'none') {
        throw new TypeError(`Unsupported compression algorithm: ${String(algorithm)}`);
    }
    const maxInputBytes = boundedInteger(
        'maxInputBytes',
        options.maxInputBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
    );
    const maxOutputBytes = boundedInteger(
        'maxOutputBytes',
        options.maxOutputBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES,
    );
    const maxExpansionRatio = boundedInteger(
        'maxExpansionRatio',
        options.maxExpansionRatio ?? DEFAULT_MAX_EXPANSION_RATIO,
    );

    if (algorithm === 'none') {
        const passthroughLimit = Math.min(maxInputBytes, maxOutputBytes);
        let seen = 0;
        return new Transform({
            transform(chunk: unknown, _enc, cb) {
                let chunkLength: number;
                try {
                    chunkLength = streamChunkByteLength(chunk);
                } catch (error) {
                    cb(error as Error);
                    return;
                }
                if (chunkLength > passthroughLimit - seen) {
                    cb(new RangeError(`Uncompressed passthrough exceeds ${passthroughLimit} bytes`));
                    return;
                }
                seen += chunkLength;
                cb(null, chunk);
            },
        });
    }

    const chunks: Buffer[] = [];
    let inputBytes = 0;
    return new Transform({
        transform(chunk: unknown, _enc, cb) {
            let chunkLength: number;
            try {
                chunkLength = streamChunkByteLength(chunk);
            } catch (error) {
                wipeBuffers(chunks);
                inputBytes = 0;
                cb(error as Error);
                return;
            }
            if (chunkLength > maxInputBytes - inputBytes) {
                wipeBuffers(chunks);
                inputBytes = 0;
                cb(new RangeError(`Compressed input exceeds ${maxInputBytes} bytes`));
                return;
            }
            try {
                const owned = Buffer.from(streamChunkView(chunk, 0, chunkLength));
                inputBytes += chunkLength;
                chunks.push(owned);
                cb();
            } catch (error) {
                wipeBuffers(chunks);
                inputBytes = 0;
                cb(error as Error);
            }
        },
        flush(cb) {
            try {
                const input = Buffer.concat(chunks, inputBytes);
                const ratioLimit = Math.min(
                    Number.MAX_SAFE_INTEGER,
                    inputBytes * maxExpansionRatio,
                );
                const outputLimit = Math.min(maxOutputBytes, ratioLimit);
                const output = algorithm === 'brotli'
                    ? zlib.brotliDecompressSync(input, { maxOutputLength: outputLimit })
                    : zlib.gunzipSync(input, { maxOutputLength: outputLimit });
                if (output.length > outputLimit) {
                    throw new RangeError(`Decompressed output exceeds ${outputLimit} bytes`);
                }
                this.push(output);
                cb();
            } catch (error) {
                cb(error as Error);
            } finally {
                wipeBuffers(chunks);
                inputBytes = 0;
            }
        },
    });
}

// Encryption streams (AES-256-GCM)
export function createEncryptionStream(options: { key: Buffer }) {
    const { key } = options;
    if (!Buffer.isBuffer(key) || key.length !== 32) {
        throw new TypeError('AES-256-GCM key must be exactly 32 bytes');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    let finalTag: Buffer | undefined;

    // Wait for the stream to be fully finished before getting the tag
    cipher.on('end', () => {
        try {
            finalTag = cipher.getAuthTag();
        } catch (err) {
            // Tag not ready yet, will try again when requested
        }
    });

    return {
        stream: cipher as Transform,
        nonce: iv,
        getAuthTag: () => {
            // If we don't have the tag yet, try to get it
            if (!finalTag) {
                try {
                    finalTag = cipher.getAuthTag();
                } catch (err) {
                    // Return undefined if tag is not ready
                    return undefined;
                }
            }
            return finalTag;
        }
    };
}

export function createDecryptionStream(options: {
    key: Buffer;
    nonce: Buffer;
    tag: Buffer;
    maxCiphertextBytes?: number;
}) {
    const { key, nonce, tag } = options;
    if (!Buffer.isBuffer(key) || key.length !== 32) {
        throw new TypeError('AES-256-GCM key must be exactly 32 bytes');
    }
    if (!Buffer.isBuffer(nonce) || nonce.length !== 12) {
        throw new TypeError('AES-256-GCM nonce must be exactly 12 bytes');
    }
    if (!Buffer.isBuffer(tag) || tag.length !== 16) {
        throw new TypeError('AES-256-GCM tag must be exactly 16 bytes');
    }
    const maxCiphertextBytes = boundedInteger(
        'maxCiphertextBytes',
        options.maxCiphertextBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
    );
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const ciphertext: Buffer[] = [];
    let ciphertextBytes = 0;

    // GCM plaintext is not released until decipher.final() authenticates the
    // complete record. Applications needing larger streams must use bounded,
    // independently authenticated records rather than one unbounded GCM stream.
    return new Transform({
        transform(chunk: unknown, _enc, cb) {
            let chunkLength: number;
            try {
                chunkLength = streamChunkByteLength(chunk);
            } catch (error) {
                wipeBuffers(ciphertext);
                ciphertextBytes = 0;
                cb(error as Error);
                return;
            }
            if (chunkLength > maxCiphertextBytes - ciphertextBytes) {
                wipeBuffers(ciphertext);
                ciphertextBytes = 0;
                cb(new RangeError(`Ciphertext exceeds ${maxCiphertextBytes} bytes`));
                return;
            }
            try {
                const owned = Buffer.from(streamChunkView(chunk, 0, chunkLength));
                ciphertextBytes += chunkLength;
                ciphertext.push(owned);
                cb();
            } catch (error) {
                wipeBuffers(ciphertext);
                ciphertextBytes = 0;
                cb(error as Error);
            }
        },
        flush(cb) {
            const plaintext: Buffer[] = [];
            try {
                for (const chunk of ciphertext) {
                    const output = decipher.update(chunk);
                    if (output.length) plaintext.push(output);
                }
                const final = decipher.final();
                if (final.length) plaintext.push(final);
                for (const chunk of plaintext) this.push(chunk);
                cb();
            } catch (error) {
                for (const chunk of plaintext) chunk.fill(0);
                cb(error as Error);
            } finally {
                wipeBuffers(ciphertext);
                ciphertextBytes = 0;
            }
        },
    });
}

// Chunking helpers
export function createChunker(chunkSize: number) {
    boundedInteger('chunkSize', chunkSize, DEFAULT_MAX_BUFFERED_BYTES);
    let carry: Buffer | null = null;
    return new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
            const data = carry ? Buffer.concat([carry, chunk]) : chunk;
            let offset = 0;
            while (offset + chunkSize <= data.length) {
                this.push(data.subarray(offset, offset + chunkSize));
                offset += chunkSize;
            }
            carry = offset < data.length ? data.subarray(offset) : null;
            cb();
        },
        flush(cb: TransformCallback) {
            if (carry && carry.length) this.push(carry);
            carry = null;
            cb();
        }
    });
}

export function createLineSplitter(options: { maxLineBytes?: number } = {}) {
    const maxLineBytes = boundedInteger(
        'maxLineBytes',
        options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
    );
    let carry = Buffer.alloc(0);

    function rejectOversizedLine(cb: TransformCallback): void {
        carry.fill(0);
        carry = Buffer.alloc(0);
        cb(new RangeError(`Line exceeds ${maxLineBytes} bytes`));
    }

    return new Transform({
        readableObjectMode: true,
        transform(chunk: unknown, _enc: BufferEncoding, cb: TransformCallback) {
            let chunkLength: number;
            try {
                chunkLength = streamChunkByteLength(chunk);
            } catch (error) {
                carry.fill(0);
                carry = Buffer.alloc(0);
                cb(error as Error);
                return;
            }

            let start = 0;
            try {
                let newline: number;
                while (
                    (newline = intrinsicUint8ArrayIndexOf.call(chunk, 0x0a, start)) >= 0
                ) {
                    const segmentLength = newline - start;
                    if (segmentLength > maxLineBytes - carry.length) {
                        rejectOversizedLine(cb);
                        return;
                    }

                    const segment = streamChunkView(chunk, start, newline);
                    const line = carry.length
                        ? Buffer.concat([carry, segment], carry.length + segmentLength)
                        : Buffer.from(segment);
                    carry.fill(0);
                    carry = Buffer.alloc(0);
                    const decoded = line.toString('utf8');
                    line.fill(0);
                    this.push(decoded);
                    start = newline + 1;
                }

                const remaining = chunkLength - start;
                if (remaining > maxLineBytes - carry.length) {
                    rejectOversizedLine(cb);
                    return;
                }
                if (remaining > 0) {
                    const tail = streamChunkView(chunk, start, chunkLength);
                    if (carry.length) {
                        const combined = Buffer.concat(
                            [carry, tail],
                            carry.length + remaining,
                        );
                        carry.fill(0);
                        carry = combined;
                    } else {
                        carry = Buffer.from(tail);
                    }
                }
                cb();
            } catch (error) {
                carry.fill(0);
                carry = Buffer.alloc(0);
                cb(error as Error);
            }
        },
        flush(cb) {
            if (carry.length) this.push(carry.toString('utf8'));
            carry.fill(0);
            carry = Buffer.alloc(0);
            cb();
        }
    });
}
