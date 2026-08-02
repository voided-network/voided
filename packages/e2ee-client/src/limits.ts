import { E2EEError } from './errors';

export const CLIENT_MAX_UPLOAD_BYTES = 4_294_967_295 as const; // u32::MAX
export const CLIENT_MAX_UPLOAD_HUMAN = '4 GiB - 1 byte' as const;
// Browser helpers materialize plaintext/ciphertext in memory. Keep that
// separate from the protocol's upload-size ceiling so hostile envelopes cannot
// force multi-gigabyte allocations in a tab.
export const CLIENT_MAX_IN_MEMORY_BYTES = 100 * 1024 * 1024;
export const CLIENT_MAX_ENCODED_BLOB_BYTES = 140 * 1024 * 1024;
export const CLIENT_MAX_CHUNKS = 128;
export const CLIENT_MIN_CHUNK_BYTES = 64 * 1024;
export const CLIENT_MAX_CHUNK_BYTES = 8 * 1024 * 1024;
export const CLIENT_CHUNK_CONCURRENCY = 4;
export const VOI_FILE_TOO_LARGE = 'VOI_FILE_TOO_LARGE' as const;

export function assertWithinClientUploadLimit(sizeBytes: number): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        throw new E2EEError(
            'Upload size must be a non-negative safe integer.',
            VOI_FILE_TOO_LARGE,
            false
        );
    }
    if (sizeBytes > CLIENT_MAX_UPLOAD_BYTES) {
        throw new E2EEError(
            `Client-side uploads support up to ${CLIENT_MAX_UPLOAD_HUMAN} per file.`,
            VOI_FILE_TOO_LARGE,
            false
        );
    }
}

export function assertWithinClientMemoryLimit(sizeBytes: number, label = 'Data'): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        throw new E2EEError(
            `${label} size must be a non-negative safe integer.`,
            VOI_FILE_TOO_LARGE,
            false
        );
    }
    if (sizeBytes > CLIENT_MAX_IN_MEMORY_BYTES) {
        throw new E2EEError(
            `${label} exceeds the ${CLIENT_MAX_IN_MEMORY_BYTES / 1024 / 1024} MiB browser in-memory limit.`,
            VOI_FILE_TOO_LARGE,
            false
        );
    }
}
