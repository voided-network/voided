/**
 * E2EE-specific error types
 */
import { inspectCanonicalBase64 } from './base64-validation';

export class E2EEError extends Error {
    constructor(
        message: string,
        public code: string,
        public recoverable: boolean = false
    ) {
        super(message);
        this.name = 'E2EEError';
    }
}

export class ValidationError extends E2EEError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR', true);
        this.name = 'ValidationError';
    }
}

export class CryptoError extends E2EEError {
    constructor(message: string) {
        super(message, 'CRYPTO_ERROR', false);
        this.name = 'CryptoError';
    }
}

export class StorageError extends E2EEError {
    constructor(message: string) {
        super(message, 'STORAGE_ERROR', true);
        this.name = 'StorageError';
    }
}

export class KeyError extends E2EEError {
    constructor(message: string) {
        super(message, 'KEY_ERROR', false);
        this.name = 'KeyError';
    }
}

/**
 * Input validation utilities
 */
export class Validator {
    private static readonly MAX_DATA_SIZE = 100 * 1024 * 1024; // 100 MiB
    private static readonly MAX_ENCODED_BLOB_SIZE = 140 * 1024 * 1024;
    private static readonly MAX_CHUNKS = 128;
    private static readonly MIN_CHUNK_SIZE = 64 * 1024;
    private static readonly MAX_CHUNK_SIZE = 8 * 1024 * 1024;
    private static readonly MIN_DATA_SIZE = 1;
    private static readonly MAX_KEY_ID_LENGTH = 256;

    private static validateBase64(
        value: unknown,
        label: string,
        maxDecodedBytes: number
    ): number {
        const inspection = inspectCanonicalBase64(value, maxDecodedBytes);
        if (!inspection.ok && inspection.reason === 'too-large') {
            throw new ValidationError(`Invalid encrypted blob: ${label} exceeds its size limit`);
        }
        if (!inspection.ok) {
            throw new ValidationError(`Invalid encrypted blob: ${label} is not canonical base64`);
        }
        return inspection.decodedLength;
    }

    /**
     * Validate data for encryption
     */
    static validateData(data: unknown): asserts data is string {
        if (typeof data !== 'string') {
            throw new ValidationError('Data must be a string');
        }

        if (data.length < this.MIN_DATA_SIZE) {
            throw new ValidationError('Data cannot be empty');
        }

        if (data.length > this.MAX_DATA_SIZE) {
            throw new ValidationError(`Data too large (max ${this.MAX_DATA_SIZE / 1024 / 1024}MB)`);
        }
    }

    /**
     * Validate encrypted blob (supports both chunked and non-chunked data)
     */
    static validateEncryptedBlob(blob: any): void {
        if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
            throw new ValidationError('Invalid encrypted blob: must be an object');
        }
        if (blob.algorithm !== 'AES-GCM') {
            throw new ValidationError('Invalid encrypted blob: unsupported algorithm');
        }
        if (blob.version !== '1.1') {
            throw new ValidationError(
                'Invalid encrypted blob: only the authenticated 1.1 envelope is supported'
            );
        }
        this.validateKeyId(blob.keyId);
        if (this.validateBase64(blob.messageId, 'messageId', 16) !== 16) {
            throw new ValidationError('Invalid encrypted blob: messageId must contain 16 bytes');
        }
        if (blob.ephemeralPublicKey !== undefined) {
            throw new ValidationError(
                'Invalid encrypted blob: legacy ephemeralPublicKey envelopes are unsupported'
            );
        }
        if (blob.textEncoding !== 'utf8' && blob.textEncoding !== 'utf16le') {
            throw new ValidationError('Invalid encrypted blob: unsupported text encoding');
        }
        if (!blob.compression || typeof blob.compression !== 'object') {
            throw new ValidationError('Invalid encrypted blob: compression info required');
        }
        if (!['gzip', 'brotli', 'none'].includes(blob.compression.algorithm)) {
            throw new ValidationError('Invalid encrypted blob: unsupported compression algorithm');
        }
        for (const field of ['originalSize', 'compressedSize'] as const) {
            const value = blob.compression[field];
            if (
                !Number.isSafeInteger(value) ||
                value < 1 ||
                value > this.MAX_DATA_SIZE
            ) {
                throw new ValidationError(`Invalid encrypted blob: invalid ${field}`);
            }
        }
        if (blob.signature !== undefined) {
            this.validateBase64(blob.signature, 'signature', 1024);
        }

        let aggregateEncodedSize = 0;
        if (blob.chunkInfo?.isChunked === true) {
            const chunkInfo = blob.chunkInfo;
            if (
                !Number.isSafeInteger(chunkInfo.totalChunks) ||
                chunkInfo.totalChunks < 1 ||
                chunkInfo.totalChunks > this.MAX_CHUNKS
            ) {
                throw new ValidationError('Invalid encrypted blob: invalid totalChunks');
            }
            if (
                !Number.isSafeInteger(chunkInfo.chunkSize) ||
                chunkInfo.chunkSize < this.MIN_CHUNK_SIZE ||
                chunkInfo.chunkSize > this.MAX_CHUNK_SIZE
            ) {
                throw new ValidationError('Invalid encrypted blob: invalid chunkSize');
            }
            if (
                !Array.isArray(blob.chunks) ||
                blob.chunks.length !== chunkInfo.totalChunks
            ) {
                throw new ValidationError(
                    'Invalid encrypted blob: chunk count does not match totalChunks'
                );
            }
            if (blob.data !== undefined || blob.iv !== undefined) {
                throw new ValidationError(
                    'Invalid encrypted blob: chunked envelopes cannot contain top-level data or iv'
                );
            }

            let totalPlaintextSize = 0;
            for (let index = 0; index < blob.chunks.length; index++) {
                const chunk = blob.chunks[index];
                if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
                    throw new ValidationError(
                        `Invalid encrypted blob: chunk ${index} must be an object`
                    );
                }
                if (chunk.index !== index) {
                    throw new ValidationError(
                        `Invalid encrypted blob: chunk ${index} has a non-canonical index`
                    );
                }
                if (
                    !Number.isSafeInteger(chunk.plaintextSize) ||
                    chunk.plaintextSize < 1 ||
                    chunk.plaintextSize > chunkInfo.chunkSize
                ) {
                    throw new ValidationError(
                        `Invalid encrypted blob: chunk ${index} has invalid plaintextSize`
                    );
                }
                const encryptedLength = this.validateBase64(
                    chunk.data,
                    `chunk ${index} data`,
                    this.MAX_CHUNK_SIZE + 12 + 16
                );
                if (encryptedLength !== chunk.plaintextSize + 12 + 16) {
                    throw new ValidationError(
                        `Invalid encrypted blob: chunk ${index} ciphertext size is inconsistent`
                    );
                }
                if (this.validateBase64(chunk.iv, `chunk ${index} iv`, 12) !== 12) {
                    throw new ValidationError(
                        `Invalid encrypted blob: chunk ${index} iv must contain 12 bytes`
                    );
                }
                if (chunk.signature !== undefined) {
                    this.validateBase64(
                        chunk.signature,
                        `chunk ${index} signature`,
                        1024
                    );
                }
                totalPlaintextSize += chunk.plaintextSize;
                aggregateEncodedSize +=
                    chunk.data.length +
                    chunk.iv.length +
                    (chunk.signature?.length ?? 0);
            }
            if (totalPlaintextSize !== blob.compression.compressedSize) {
                throw new ValidationError(
                    'Invalid encrypted blob: chunk sizes do not match compressedSize'
                );
            }
        } else {
            if (blob.chunkInfo !== undefined || blob.chunks !== undefined) {
                throw new ValidationError(
                    'Invalid encrypted blob: malformed chunk framing'
                );
            }
            const encryptedLength = this.validateBase64(
                blob.data,
                'data',
                this.MAX_DATA_SIZE + 12 + 16
            );
            if (encryptedLength !== blob.compression.compressedSize + 12 + 16) {
                throw new ValidationError(
                    'Invalid encrypted blob: ciphertext size is inconsistent'
                );
            }
            if (this.validateBase64(blob.iv, 'iv', 12) !== 12) {
                throw new ValidationError(
                    'Invalid encrypted blob: iv must contain 12 bytes'
                );
            }
            aggregateEncodedSize =
                blob.data.length +
                blob.iv.length +
                (blob.signature?.length ?? 0);
        }
        if (aggregateEncodedSize > this.MAX_ENCODED_BLOB_SIZE) {
            throw new ValidationError(
                'Invalid encrypted blob: aggregate encoded size exceeds browser limit'
            );
        }
    }

    /**
     * Validate a current VOF3 monolith protected blob
     */
    static validateProtectedBlob(blob: any): void {
        if (!blob || typeof blob !== 'object') {
            throw new ValidationError('Invalid protected blob: must be an object');
        }

        this.validateBase64(blob.artifact, 'artifact', this.MAX_ENCODED_BLOB_SIZE);

        this.validateKeyId(blob.keyId);

        if (blob.version !== '2.0') {
            throw new ValidationError('Invalid protected blob: unsupported version');
        }

        if (blob.pipeline !== 'compression->encryption->fused-shell') {
            throw new ValidationError('Invalid protected blob: unsupported pipeline');
        }

        const validPresets = ['compact', 'balanced', 'concealed'];
        if (!validPresets.includes(blob.preset)) {
            throw new ValidationError('Invalid protected blob: unsupported preset');
        }

        if (!blob.compression || typeof blob.compression !== 'object') {
            throw new ValidationError('Invalid protected blob: compression info required');
        }

        const validCompressionAlgorithms = ['gzip', 'brotli', 'none'];
        if (!validCompressionAlgorithms.includes(blob.compression.algorithm)) {
            throw new ValidationError('Invalid protected blob: unsupported compression algorithm');
        }

        if (
            !Number.isSafeInteger(blob.compression.originalSize) ||
            blob.compression.originalSize < 0 ||
            blob.compression.originalSize > this.MAX_DATA_SIZE
        ) {
            throw new ValidationError('Invalid protected blob: invalid originalSize');
        }

        if (
            !Number.isSafeInteger(blob.compression.compressedSize) ||
            blob.compression.compressedSize < 0 ||
            blob.compression.compressedSize > this.MAX_ENCODED_BLOB_SIZE
        ) {
            throw new ValidationError('Invalid protected blob: invalid compressedSize');
        }

        const validEncryptionAlgorithms = ['aes-256-gcm', 'xchacha20-poly1305'];
        if (!validEncryptionAlgorithms.includes(blob.encryptionAlgorithm)) {
            throw new ValidationError('Invalid protected blob: unsupported encryption algorithm');
        }

        if (!blob.shell || typeof blob.shell !== 'object') {
            throw new ValidationError('Invalid protected blob: shell info required');
        }

        if (
            !Number.isSafeInteger(blob.shell.chunkSize) ||
            blob.shell.chunkSize <= 0 ||
            blob.shell.chunkSize > this.MAX_CHUNK_SIZE
        ) {
            throw new ValidationError('Invalid protected blob: invalid shell chunk size');
        }

        if (
            !Number.isSafeInteger(blob.shell.chunkCount) ||
            blob.shell.chunkCount < 0 ||
            blob.shell.chunkCount > this.MAX_CHUNKS
        ) {
            throw new ValidationError('Invalid protected blob: invalid shell chunk count');
        }

        if (
            !Number.isSafeInteger(blob.protectedSize) ||
            blob.protectedSize <= 0 ||
            blob.protectedSize > this.MAX_ENCODED_BLOB_SIZE
        ) {
            throw new ValidationError('Invalid protected blob: invalid protected size');
        }

        if (blob.textEncoding !== undefined && blob.textEncoding !== 'utf8' && blob.textEncoding !== 'utf16le') {
            throw new ValidationError('Invalid protected blob: unsupported text encoding');
        }
    }

    /**
     * Validate key string
     */
    static validateKeyString(keyString: unknown): asserts keyString is string {
        if (typeof keyString !== 'string') {
            throw new ValidationError('Key must be a string');
        }

        const inspection = inspectCanonicalBase64(keyString, 32);
        if (!inspection.ok || inspection.decodedLength !== 32) {
            throw new ValidationError('Invalid key format (expected canonical 32-byte base64)');
        }
    }

    /**
     * Validate key ID
     */
    static validateKeyId(keyId: unknown): asserts keyId is string {
        if (typeof keyId !== 'string') {
            throw new ValidationError('Key ID must be a string');
        }

        if (keyId.length === 0) {
            throw new ValidationError('Key ID cannot be empty');
        }

        if (keyId.length > this.MAX_KEY_ID_LENGTH) {
            throw new ValidationError(`Key ID too long (max ${this.MAX_KEY_ID_LENGTH} characters)`);
        }

        if (keyId.includes('::voided:') || /[\u0000-\u001f\u007f]/.test(keyId)) {
            throw new ValidationError('Key ID contains a reserved namespace or control character');
        }
    }

    /**
     * Validate rotation options
     */
    static validateRotationOptions(options: unknown): asserts options is any {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new ValidationError('Rotation options must be an object');
        }
        if ('force' in options && typeof options.force !== 'boolean') {
            throw new ValidationError('force option must be a boolean');
        }

        if ('migrate' in options && typeof options.migrate !== 'boolean') {
            throw new ValidationError('migrate option must be a boolean');
        }

        if ('cutoffTime' in options) {
            if (
                !(options.cutoffTime instanceof Date) ||
                !Number.isFinite(options.cutoffTime.getTime())
            ) {
                throw new ValidationError('cutoffTime must be a Date object');
            }
        }
    }
}
