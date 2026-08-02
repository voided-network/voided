// Server-side limits utility

export const SERVER_MAX_UPLOAD_BYTES = 1_099_511_627_776 as const; // 1 TiB
export const SERVER_MAX_UPLOAD_HUMAN = '1 TiB' as const;
export const VOI_SERVER_FILE_TOO_LARGE = 'VOI_SERVER_FILE_TOO_LARGE' as const;
export const STREAMING_THRESHOLD_BYTES = 1_073_741_824 as const; // 1 GiB
export const VOI_STREAMING_REQUIRED = 'VOI_STREAMING_REQUIRED' as const;

function assertValidByteCount(name: string, value: number, allowZero = true): void {
    const minimum = allowZero ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
    }
}

export function assertWithinServerUploadLimit(sizeBytes: number): void {
    assertValidByteCount('sizeBytes', sizeBytes);
    if (sizeBytes > SERVER_MAX_UPLOAD_BYTES) {
        const message = `Server-side operations support up to ${SERVER_MAX_UPLOAD_HUMAN} per item.`;
        // Keep generic Error to avoid importing error types across modules
        const err = new Error(message) as Error & { code?: string };
        err.code = VOI_SERVER_FILE_TOO_LARGE;
        throw err;
    }
}

export function shouldStream(sizeBytes: number): boolean {
    assertValidByteCount('sizeBytes', sizeBytes);
    return sizeBytes >= STREAMING_THRESHOLD_BYTES;
}

// Optional: a Transform to enforce byte limit on streaming paths
// Consumers can pipe data through this to guard against oversized inputs
import { Transform } from 'stream';

export function createByteLimitGuard(maxBytes: number = SERVER_MAX_UPLOAD_BYTES): Transform {
    assertValidByteCount('maxBytes', maxBytes, false);
    if (maxBytes > SERVER_MAX_UPLOAD_BYTES) {
        throw new RangeError(`maxBytes cannot exceed ${SERVER_MAX_UPLOAD_HUMAN}.`);
    }
    let seen = 0;
    return new Transform({
        transform(chunk, _enc, cb) {
            const chunkLength = Number(chunk?.length ?? 0);
            if (!Number.isSafeInteger(chunkLength) || chunkLength < 0) {
                cb(new RangeError('Stream chunk length is invalid.'));
                return;
            }
            seen += chunkLength;
            if (!Number.isSafeInteger(seen)) {
                cb(new RangeError('Stream byte count exceeded JavaScript safe integer range.'));
                return;
            }
            if (seen > maxBytes) {
                const err = new Error(`Exceeded server-side limit of ${SERVER_MAX_UPLOAD_HUMAN}`) as Error & { code?: string };
                err.code = VOI_SERVER_FILE_TOO_LARGE;
                cb(err);
                return;
            }
            cb(null, chunk);
        }
    });
}


