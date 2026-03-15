// Server-side limits utility

export const SERVER_MAX_UPLOAD_BYTES = 1_099_511_627_776 as const; // 1 TiB
export const SERVER_MAX_UPLOAD_HUMAN = '1 TiB' as const;
export const VOI_SERVER_FILE_TOO_LARGE = 'VOI_SERVER_FILE_TOO_LARGE' as const;
export const STREAMING_THRESHOLD_BYTES = 1_073_741_824 as const; // 1 GiB
export const VOI_STREAMING_REQUIRED = 'VOI_STREAMING_REQUIRED' as const;

export function assertWithinServerUploadLimit(sizeBytes: number): void {
    if (sizeBytes > SERVER_MAX_UPLOAD_BYTES) {
        const message = `Server-side operations support up to ${SERVER_MAX_UPLOAD_HUMAN} per item.`;
        // Keep generic Error to avoid importing error types across modules
        const err = new Error(message) as Error & { code?: string };
        err.code = VOI_SERVER_FILE_TOO_LARGE;
        throw err;
    }
}

export function shouldStream(sizeBytes: number): boolean {
    return sizeBytes >= STREAMING_THRESHOLD_BYTES;
}

// Optional: a Transform to enforce byte limit on streaming paths
// Consumers can pipe data through this to guard against oversized inputs
import { Transform } from 'stream';

export function createByteLimitGuard(maxBytes: number = SERVER_MAX_UPLOAD_BYTES): Transform {
    let seen = 0;
    return new Transform({
        transform(chunk, _enc, cb) {
            seen += chunk.length || 0;
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


