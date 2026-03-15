import { E2EEError } from './errors';

export const CLIENT_MAX_UPLOAD_BYTES = 34_359_738_368 as const; // 32 GiB
export const CLIENT_MAX_UPLOAD_HUMAN = '32 GiB' as const;
export const VOI_FILE_TOO_LARGE = 'VOI_FILE_TOO_LARGE' as const;

export function assertWithinClientUploadLimit(sizeBytes: number): void {
    if (sizeBytes > CLIENT_MAX_UPLOAD_BYTES) {
        throw new E2EEError('Client-side uploads support up to 32 GiB per file.', VOI_FILE_TOO_LARGE, false);
    }
}


