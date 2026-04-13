import { Transform, TransformCallback } from 'stream';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { StringDecoder } from 'string_decoder';

// Compression streams
export function createCompressionStream(options: { algorithm: 'brotli' | 'gzip'; level?: number }) {
    const { algorithm, level } = options;
    if (algorithm === 'brotli') {
        return zlib.createBrotliCompress({ params: level != null ? { [zlib.constants.BROTLI_PARAM_QUALITY]: level } : undefined });
    }
    return zlib.createGzip({ level });
}

export function createDecompressionStream(algorithm: 'brotli' | 'gzip' | 'none') {
    if (algorithm === 'none') {
        // passthrough
        return new Transform({ transform(chunk, _enc, cb) { cb(null, chunk); } });
    }
    if (algorithm === 'brotli') {
        return zlib.createBrotliDecompress();
    }
    return zlib.createGunzip();
}

// Encryption streams (AES-256-GCM)
export function createEncryptionStream(options: { key: Buffer }) {
    const { key } = options;
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

export function createDecryptionStream(options: { key: Buffer; nonce: Buffer; tag: Buffer }) {
    const { key, nonce, tag } = options;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return decipher as Transform;
}

// Chunking helpers
export function createChunker(chunkSize: number) {
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

export function createLineSplitter() {
    let buf = '';
    return new Transform({
        readableObjectMode: true,
        transform(chunk, _enc, cb) {
            buf += chunk.toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                if (line.length) this.push(line);
            }
            cb();
        },
        flush(cb) {
            if (buf.length) this.push(buf);
            buf = '';
            cb();
        }
    });
}

