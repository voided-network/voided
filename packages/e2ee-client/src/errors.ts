/**
 * E2EE-specific error types
 */
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
    private static readonly MAX_DATA_SIZE = 100 * 1024 * 1024; // 100MB
    private static readonly MIN_DATA_SIZE = 1;
    private static readonly MAX_KEY_ID_LENGTH = 256;

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
        if (!blob || typeof blob !== 'object') {
            throw new ValidationError('Invalid encrypted blob: must be an object');
        }

        // Validate required fields for non-chunked data
        if (!blob.chunkInfo?.isChunked) {
            if (typeof blob.data !== 'string' || blob.data.length === 0) {
                throw new ValidationError('Invalid encrypted blob: data must be a non-empty string');
            }
            if (typeof blob.iv !== 'string' || blob.iv.length === 0) {
                throw new ValidationError('Invalid encrypted blob: iv must be a non-empty string');
            }

            // Validate base64 format
            try {
                atob(blob.data);
            } catch {
                throw new ValidationError('Invalid encrypted blob: data is not valid base64');
            }
            try {
                atob(blob.iv);
            } catch {
                throw new ValidationError('Invalid encrypted blob: iv is not valid base64');
            }
        }

        // Validate algorithm
        if (blob.algorithm !== 'AES-GCM') {
            throw new ValidationError('Invalid encrypted blob: unsupported algorithm');
        }

        // Validate version
        if (blob.version !== '1.0') {
            throw new ValidationError('Invalid encrypted blob: unsupported version');
        }

        // Validate compression object
        if (!blob.compression || typeof blob.compression !== 'object') {
            throw new ValidationError('Invalid encrypted blob: compression info required');
        }

        const validAlgorithms = ['gzip', 'brotli', 'none'];
        if (!validAlgorithms.includes(blob.compression.algorithm)) {
            throw new ValidationError('Invalid encrypted blob: unsupported compression algorithm');
        }

        if (typeof blob.compression.originalSize !== 'number' || blob.compression.originalSize < 0) {
            throw new ValidationError('Invalid encrypted blob: invalid originalSize');
        }

        if (typeof blob.compression.compressedSize !== 'number' || blob.compression.compressedSize < 0) {
            throw new ValidationError('Invalid encrypted blob: invalid compressedSize');
        }

        // Validate keyId
        if (typeof blob.keyId !== 'string' || blob.keyId.length === 0) {
            throw new ValidationError('Invalid encrypted blob: keyId must be a non-empty string');
        }

        // Validate signature if present
        if (blob.signature !== undefined) {
            if (typeof blob.signature !== 'string' || blob.signature.length === 0) {
                throw new ValidationError('Invalid encrypted blob: signature must be a non-empty string');
            }
            try {
                atob(blob.signature);
            } catch {
                throw new ValidationError('Invalid encrypted blob: signature is not valid base64');
            }
        }

        // Validate ephemeralPublicKey if present
        if (blob.ephemeralPublicKey !== undefined) {
            if (typeof blob.ephemeralPublicKey !== 'string' || blob.ephemeralPublicKey.length === 0) {
                throw new ValidationError('Invalid encrypted blob: ephemeralPublicKey must be a non-empty string');
            }
            try {
                atob(blob.ephemeralPublicKey);
            } catch {
                throw new ValidationError('Invalid encrypted blob: ephemeralPublicKey is not valid base64');
            }
        }

        // Validate chunked data if present
        if (blob.chunkInfo?.isChunked) {
            if (!Array.isArray(blob.chunks) || blob.chunks.length === 0) {
                throw new ValidationError('Invalid encrypted blob: chunks array required for chunked data');
            }

            for (let i = 0; i < blob.chunks.length; i++) {
                const chunk = blob.chunks[i];
                if (!chunk || typeof chunk !== 'object') {
                    throw new ValidationError(`Invalid encrypted blob: chunk ${i} must be an object`);
                }
                if (typeof chunk.data !== 'string' || chunk.data.length === 0) {
                    throw new ValidationError(`Invalid encrypted blob: chunk ${i} data must be a non-empty string`);
                }
                if (typeof chunk.iv !== 'string' || chunk.iv.length === 0) {
                    throw new ValidationError(`Invalid encrypted blob: chunk ${i} iv must be a non-empty string`);
                }
                if (typeof chunk.index !== 'number' || chunk.index !== i) {
                    throw new ValidationError(`Invalid encrypted blob: chunk ${i} has invalid index`);
                }
            }
        }
    }

    /**
     * Validate v3 monolith protected blob
     */
    static validateProtectedBlob(blob: any): void {
        if (!blob || typeof blob !== 'object') {
            throw new ValidationError('Invalid protected blob: must be an object');
        }

        if (typeof blob.artifact !== 'string' || blob.artifact.length === 0) {
            throw new ValidationError('Invalid protected blob: artifact must be a non-empty string');
        }

        try {
            atob(blob.artifact);
        } catch {
            throw new ValidationError('Invalid protected blob: artifact is not valid base64');
        }

        if (typeof blob.keyId !== 'string' || blob.keyId.length === 0) {
            throw new ValidationError('Invalid protected blob: keyId must be a non-empty string');
        }

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

        const validCompressionAlgorithms = ['gzip', 'brotli', 'none', 'iliad.foundation.v2'];
        if (!validCompressionAlgorithms.includes(blob.compression.algorithm)) {
            throw new ValidationError('Invalid protected blob: unsupported compression algorithm');
        }

        if (typeof blob.compression.originalSize !== 'number' || blob.compression.originalSize < 0) {
            throw new ValidationError('Invalid protected blob: invalid originalSize');
        }

        if (typeof blob.compression.compressedSize !== 'number' || blob.compression.compressedSize < 0) {
            throw new ValidationError('Invalid protected blob: invalid compressedSize');
        }

        const validEncryptionAlgorithms = ['aes-256-gcm', 'xchacha20-poly1305'];
        if (!validEncryptionAlgorithms.includes(blob.encryptionAlgorithm)) {
            throw new ValidationError('Invalid protected blob: unsupported encryption algorithm');
        }

        if (!blob.shell || typeof blob.shell !== 'object') {
            throw new ValidationError('Invalid protected blob: shell info required');
        }

        if (typeof blob.shell.chunkSize !== 'number' || blob.shell.chunkSize <= 0) {
            throw new ValidationError('Invalid protected blob: invalid shell chunk size');
        }

        if (typeof blob.shell.chunkCount !== 'number' || blob.shell.chunkCount < 0) {
            throw new ValidationError('Invalid protected blob: invalid shell chunk count');
        }

        if (typeof blob.protectedSize !== 'number' || blob.protectedSize <= 0) {
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

        if (keyString.length === 0) {
            throw new ValidationError('Key cannot be empty');
        }

        // Basic base64 validation
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(keyString)) {
            throw new ValidationError('Invalid key format (expected base64)');
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
    }

    /**
     * Validate rotation options
     */
    static validateRotationOptions(options: unknown): asserts options is any {
        if (options && typeof options === 'object') {
            if ('force' in options && typeof options.force !== 'boolean') {
                throw new ValidationError('force option must be a boolean');
            }

            if ('migrate' in options && typeof options.migrate !== 'boolean') {
                throw new ValidationError('migrate option must be a boolean');
            }

            if ('cutoffTime' in options && !(options.cutoffTime instanceof Date)) {
                throw new ValidationError('cutoffTime must be a Date object');
            }
        }
    }
}
