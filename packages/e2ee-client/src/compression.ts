// Import compression libraries for browser environment
import { gzipSync, Gunzip, strToU8, strFromU8 } from 'fflate';
import {
    assertWithinClientMemoryLimit,
    assertWithinClientUploadLimit,
    CLIENT_MAX_IN_MEMORY_BYTES
} from './limits';

export interface CompressionResult {
    compressed: Uint8Array;
    algorithm: 'gzip' | 'brotli' | 'none';
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
}

export interface CompressionOptions {
    algorithm?: 'gzip' | 'brotli' | 'none' | 'auto';
    minSizeThreshold?: number; // Don't compress data smaller than this
    compressionLevel?: number; // 1-9 for gzip, 1-11 for brotli
}

/**
 * Check if gzip compression is available
 */
function hasGzipSupport(): boolean {
    return typeof gzipSync === 'function' && typeof Gunzip === 'function';
}

/**
 * Normalize requested algorithms for the TypeScript fallback. Algorithm labels
 * are protocol inputs: an explicit Brotli request must never silently become
 * gzip.
 */
function normalizeRequestedAlgorithm(
    algorithm: 'gzip' | 'brotli' | 'none' | 'auto'
): 'gzip' | 'none' | 'auto' {
    if (!['gzip', 'brotli', 'none', 'auto'].includes(algorithm)) {
        throw new Error('Unsupported compression algorithm');
    }
    if (algorithm === 'brotli') {
        throw new Error('Brotli compression requires the Rust WASM backend in e2ee-client');
    }
    return algorithm;
}

/**
 * Quick entropy analysis to determine if data is likely compressible
 * Returns true if data appears compressible, false if likely already compressed
 */
function isLikelyCompressible(data: Uint8Array): boolean {
    // Very small payloads: compression overhead usually not worth it, but safe to try
    if (data.length < 4096) return true;

    // Use a quick gzip probe on a small sample to decide
    const sampleSize = Math.min(data.length, 64 * 1024); // up to 64KB sample
    const sample = data.subarray(0, sampleSize);

    try {
        if (!hasGzipSupport()) {
            // If gzip isn't available for probing, err on the side of not compressing large random data
            return false;
        }

        // Low level for speed; we only need an estimate
        const compressedSample = gzipSync(sample, { level: 1 as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
        const ratio = compressedSample.length / sample.length;

        // If we cannot save at least ~10% on the sample, treat as non-compressible
        return ratio < 0.9;
    } catch {
        // On probe failure, avoid expensive full-data compression
        return false;
    }
}

/**
 * Choose optimal compression algorithm based on data characteristics
 */
function chooseOptimalAlgorithm(data: Uint8Array, options: CompressionOptions): 'gzip' | 'none' {
    const requestedAlgorithm = normalizeRequestedAlgorithm(options.algorithm ?? 'auto');
    const { minSizeThreshold = 100 } = options;

    if (requestedAlgorithm !== 'auto') return requestedAlgorithm;

    // Don't compress small data
    if (data.length < minSizeThreshold) return 'none';

    // For test environments, skip compression for very small repetitive data to avoid performance issues
    if (data.length < 2048 && isRepeatingPattern(data)) return 'none';

    // Check if data is likely already compressed
    if (!isLikelyCompressible(data)) return 'none';

    // For larger data, prefer gzip for maximum compatibility in all environments
    if (data.length > 1024) return 'gzip';

    // For smaller data, gzip is faster
    return 'gzip';
}

/**
 * Quick check for repeating patterns (like test data)
 */
function isRepeatingPattern(data: Uint8Array): boolean {
    if (data.length < 4) return false;

    const first = data[0];
    let repeatCount = 0;

    // Check if most bytes are the same (simple repeating pattern detection)
    for (let i = 0; i < Math.min(data.length, 100); i++) {
        if (data[i] === first) repeatCount++;
    }

    // If more than 90% of the sampled bytes are the same, it's likely a repeating pattern
    return (repeatCount / Math.min(data.length, 100)) > 0.9;
}

/**
 * Compress data using browser-compatible compression
 * Optimized for performance with intelligent algorithm selection
 */
export async function compress(
    data: string | Uint8Array,
    options: CompressionOptions = {}
): Promise<CompressionResult> {
    const {
        algorithm = 'auto',
        minSizeThreshold = 100,
        compressionLevel = 6
    } = options;
    const requestedAlgorithm = normalizeRequestedAlgorithm(algorithm);

    // Use TextEncoder for consistent UTF-8 encoding so TextDecoder on decrypt is a true inverse
    const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    // Guard: enforce 32 GiB limit on any input processed
    assertWithinClientUploadLimit(input.length);
    assertWithinClientMemoryLimit(input.length, 'Compression input');
    const originalSize = input.length;

    // Quick size check
    if (originalSize < minSizeThreshold) {
        return {
            compressed: input,
            algorithm: 'none',
            originalSize,
            compressedSize: originalSize,
            compressionRatio: 1.0
        };
    }

    // Choose optimal algorithm
    const optimalAlgorithm = chooseOptimalAlgorithm(input, { ...options, algorithm: requestedAlgorithm });

    // Decide an adaptive compression level for performance when using auto selection.
    // We favor speed for small/medium payloads in concurrent scenarios.
    let adaptiveLevel = compressionLevel;
    if (optimalAlgorithm === 'gzip' && (requestedAlgorithm === 'auto')) {
        if (originalSize <= 1 * 1024 * 1024) {
            // ≤ 1MB: prioritize speed
            adaptiveLevel = 1;
        } else if (originalSize <= 5 * 1024 * 1024) {
            // 1-5MB: moderately fast
            adaptiveLevel = Math.min(compressionLevel, 3);
        }
    }
    if (optimalAlgorithm === 'none') {
        return {
            compressed: input,
            algorithm: 'none',
            originalSize,
            compressedSize: originalSize,
            compressionRatio: 1.0
        };
    }

    try {
        let compressed: Uint8Array;
        const usedAlgorithm: 'gzip' = 'gzip';

        if (hasGzipSupport()) {
            compressed = gzipSync(input, { level: adaptiveLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
        } else {
            throw new Error('Gzip compression not available');
        }

        const compressedSize = compressed.length;
        const compressionRatio = compressedSize / originalSize;

        // Only use compression if it actually saves space (at least 10% reduction)
        if (compressionRatio < 0.9) {
            return {
                compressed,
                algorithm: usedAlgorithm,
                originalSize,
                compressedSize,
                compressionRatio
            };
        }
    } catch (error) {
        if (requestedAlgorithm !== 'auto') {
            throw new Error(
                `Explicit ${requestedAlgorithm} compression failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    // Auto selection may safely choose or fall back to uncompressed data.
    return {
        compressed: input,
        algorithm: 'none',
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1.0
    };
}

/**
 * Decompress data using browser-compatible decompression
 */
export async function decompress(
    compressedData: Uint8Array,
    algorithm: 'gzip' | 'brotli' | 'none',
    options: {
        expectedOutputBytes?: number;
        maxOutputBytes?: number;
        maxExpansionRatio?: number;
    } = {}
): Promise<Uint8Array> {
    // Guard: sanity check on compressed input size
    assertWithinClientUploadLimit(compressedData.length);
    assertWithinClientMemoryLimit(compressedData.length, 'Compressed input');
    const maxOutputBytes = Math.min(
        options.maxOutputBytes ?? CLIENT_MAX_IN_MEMORY_BYTES,
        CLIENT_MAX_IN_MEMORY_BYTES
    );
    const maxExpansionRatio = options.maxExpansionRatio ?? 4096;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
        throw new Error('Invalid decompression output limit');
    }
    if (!Number.isFinite(maxExpansionRatio) || maxExpansionRatio <= 0) {
        throw new Error('Invalid decompression expansion ratio');
    }
    if (algorithm === 'none') {
        if (
            compressedData.length > maxOutputBytes ||
            (
                options.expectedOutputBytes !== undefined &&
                compressedData.length !== options.expectedOutputBytes
            )
        ) {
            throw new Error('Uncompressed payload size does not match its authenticated metadata');
        }
        return compressedData;
    }

    try {
        if (compressedData.length === 0) {
            throw new Error('Compressed payload cannot be empty');
        }
        if (algorithm === 'brotli') {
            throw new Error('Brotli decompression requires the Rust WASM backend in e2ee-client');
        }

        if (!hasGzipSupport()) {
            throw new Error('Gzip decompression not available');
        }

        const chunks: Uint8Array[] = [];
        let total = 0;
        const ratioLimit = Math.max(
            1024,
            Math.ceil(compressedData.length * maxExpansionRatio)
        );
        const effectiveLimit = Math.min(maxOutputBytes, ratioLimit);
        const gunzip = new Gunzip((chunk) => {
            total += chunk.length;
            if (total > effectiveLimit) {
                throw new Error('Decompressed payload exceeds configured output limits');
            }
            chunks.push(chunk);
        });

        const inputChunkSize = 64 * 1024;
        for (
            let inputOffset = 0;
            inputOffset < compressedData.length;
            inputOffset += inputChunkSize
        ) {
            const end = Math.min(inputOffset + inputChunkSize, compressedData.length);
            gunzip.push(
                compressedData.subarray(inputOffset, end),
                end === compressedData.length
            );
        }

        if (
            options.expectedOutputBytes !== undefined &&
            total !== options.expectedOutputBytes
        ) {
            throw new Error('Decompressed payload size does not match its authenticated metadata');
        }

        const output = new Uint8Array(total);
        let outputOffset = 0;
        for (const chunk of chunks) {
            output.set(chunk, outputOffset);
            outputOffset += chunk.length;
        }
        return output;
    } catch (error) {
        throw new Error(`Decompression failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Convert string to Uint8Array (fflate utility)
 */
export function stringToUint8Array(str: string): Uint8Array {
    return strToU8(str);
}

/**
 * Convert Uint8Array to string (fflate utility)
 */
export function uint8ArrayToString(arr: Uint8Array): string {
    return strFromU8(arr);
}

/**
 * Utility function to test compression effectiveness
 */
export async function analyzeCompression(data: string | Uint8Array): Promise<{
    originalSize: number;
    gzipSize: number;
    brotliSize: number;
    gzipRatio: number;
    brotliRatio: number;
    recommendation: 'gzip' | 'brotli' | 'none';
}> {
    const input = typeof data === 'string' ? strToU8(data) : data;
    assertWithinClientUploadLimit(input.length);
    const originalSize = input.length;

    // Test gzip compression
    let gzipSize = originalSize;
    let gzipRatio = 1.0;
    if (hasGzipSupport()) {
        try {
            const gzipResult = gzipSync(input, { level: 6 });
            gzipSize = gzipResult.length;
            gzipRatio = gzipSize / originalSize;
        } catch (error) {
            //if (process.env.NODE_ENV !== 'test') console.warn('Gzip analysis failed:', error);
        }
    }

    // The TypeScript fallback does not benchmark brotli. Real brotli support
    // remains available through the Rust/WASM backend.
    let brotliSize = originalSize;
    let brotliRatio = 1.0;

    // Determine recommendation
    let recommendation: 'gzip' | 'brotli' | 'none';
    if (gzipRatio < 0.9) {
        recommendation = 'gzip';
    } else {
        recommendation = 'none';
    }

    return {
        originalSize,
        gzipSize,
        brotliSize,
        gzipRatio,
        brotliRatio,
        recommendation
    };
}
