import { Transform, TransformCallback } from 'stream';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { StringDecoder } from 'string_decoder';
import { type ObfuscationMap } from './crypto-backend.js';

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

// Obfuscation streams
type SelectionStrategy = 'random' | 'round-robin' | 'shortest' | 'longest';

// Use the same delimiter as the Rust implementation (Unit Separator)
const STREAM_DELIMITER = '\x1F';

export function createObfuscateStream(map: ObfuscationMap, options: { seed?: string; selectionStrategy?: SelectionStrategy } = {}) {
    const { seed, selectionStrategy = 'round-robin' } = options;
    // Use round-robin by default for deterministic behavior
    let rrIndex = 0;
    let isFirst = true;
    
    function pick(mappingList: string[]): string {
        if (selectionStrategy === 'shortest') return mappingList.reduce((a, b) => (a.length <= b.length ? a : b));
        if (selectionStrategy === 'longest') return mappingList.reduce((a, b) => (a.length >= b.length ? a : b));
        if (selectionStrategy === 'round-robin') {
            const v = mappingList[rrIndex % mappingList.length];
            rrIndex++;
            return v;
        }
        // random (seed not used here for simplicity)
        const idx = Math.floor(Math.random() * mappingList.length);
        return mappingList[idx];
    }

    const decoder = new StringDecoder('utf8');
    return new Transform({
        transform(chunk, _enc, cb) {
            const text = decoder.write(chunk);
            const tokens: string[] = [];
            for (const ch of text) {
                const list = map[ch];
                // Use delimiter to separate tokens for unambiguous deobfuscation
                tokens.push(list && list.length ? pick(list) : ch);
            }
            // Join with delimiter
            const out = (isFirst ? '' : STREAM_DELIMITER) + tokens.join(STREAM_DELIMITER);
            isFirst = false;
            cb(null, Buffer.from(out, 'utf8'));
        },
        final(cb) {
            const rem = decoder.end();
            if (rem) {
                const tokens: string[] = [];
                for (const ch of rem) {
                    const list = map[ch];
                    tokens.push(list && list.length ? list[0] : ch);
                }
                const out = (isFirst ? '' : STREAM_DELIMITER) + tokens.join(STREAM_DELIMITER);
                this.push(Buffer.from(out, 'utf8'));
            }
            cb();
        }
    });
}

export function createDeobfuscateStream(map: ObfuscationMap) {
    // Build reverse lookup
    const reverse = new Map<string, string>();
    for (const [orig, list] of Object.entries(map)) {
        for (const m of list) {
            reverse.set(m, orig);
        }
    }
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    
    return new Transform({
        transform(chunk, _enc, cb) {
            buffer += decoder.write(chunk);
            let emit = '';
            
            // Find complete tokens (delimited by STREAM_DELIMITER)
            let lastDelimIdx = buffer.lastIndexOf(STREAM_DELIMITER);
            if (lastDelimIdx === -1) {
                // No delimiter found, keep buffering
                cb(null, Buffer.from('', 'utf8'));
                return;
            }
            
            // Process all complete tokens
            const complete = buffer.slice(0, lastDelimIdx);
            buffer = buffer.slice(lastDelimIdx + 1);
            
            const tokens = complete.split(STREAM_DELIMITER);
            for (const token of tokens) {
                const orig = reverse.get(token);
                emit += orig ?? token;
            }
            
            cb(null, Buffer.from(emit, 'utf8'));
        },
        final(cb) {
            buffer += decoder.end();
            let emit = '';
            
            // Process remaining tokens
            if (buffer.length > 0) {
                const tokens = buffer.split(STREAM_DELIMITER);
                for (const token of tokens) {
                    const orig = reverse.get(token);
                    emit += orig ?? token;
                }
            }
            
            this.push(Buffer.from(emit, 'utf8'));
            cb();
        }
    });
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


