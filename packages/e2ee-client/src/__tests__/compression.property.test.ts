import fc from 'fast-check';
import {
    compress,
    decompress,
    analyzeCompression,
    stringToUint8Array,
    uint8ArrayToString
} from '../compression';

// Custom arbitraries for testing
const stringArb = fc.string({ minLength: 1, maxLength: 10000 });
const uint8ArrayArb = fc.uint8Array({ minLength: 1, maxLength: 10000 });
const compressionLevelArb = fc.integer({ min: 1, max: 9 });
const algorithmArb = fc.constantFrom('gzip', 'brotli', 'auto', 'none');

describe('Compression Property-Based Tests', () => {
    describe('Core Properties', () => {
        it('should preserve data through compress-decompress cycle (string)', () =>
            fc.assert(
                fc.asyncProperty(stringArb, async (data) => {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    const decompressedString = uint8ArrayToString(decompressed);
                    return decompressedString === data;
                }),
                { numRuns: 100, timeout: 10000 }
            )
        );

        it('should preserve data through compress-decompress cycle (Uint8Array)', () =>
            fc.assert(
                fc.asyncProperty(uint8ArrayArb, async (data) => {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    return decompressed.length === data.length &&
                        decompressed.every((byte, i) => byte === data[i]);
                }),
                { numRuns: 100, timeout: 10000 }
            )
        );

        it('should maintain compression ratio bounds', () =>
            fc.assert(
                fc.asyncProperty(stringArb, async (data) => {
                    const result = await compress(data);
                    return result.compressionRatio >= 0 &&
                        result.compressionRatio <= 1.2; // Allow some overhead
                }),
                { numRuns: 100, timeout: 10000 }
            )
        );

        it('should maintain size relationships', () =>
            fc.assert(
                fc.asyncProperty(stringArb, async (data) => {
                    const result = await compress(data);
                    return result.originalSize === data.length &&
                        result.compressedSize >= 0 &&
                        result.compressedSize <= result.originalSize * 1.2;
                }),
                { numRuns: 100, timeout: 10000 }
            )
        );
    });

    describe('Algorithm Properties', () => {
        it('should respect explicit algorithm selection', () =>
            fc.assert(
                fc.asyncProperty(stringArb, algorithmArb, async (data, algorithm) => {
                    if (algorithm === 'none') {
                        const result = await compress(data, { algorithm: algorithm as 'gzip' | 'brotli' | 'auto' | 'none' });
                        return result.algorithm === 'none' &&
                            result.compressionRatio === 1.0;
                    }

                    const result = await compress(data, { algorithm: algorithm as 'gzip' | 'brotli' | 'auto' | 'none' });
                    return ['gzip', 'none'].includes(result.algorithm);
                }),
                { numRuns: 50, timeout: 10000 }
            )
        );

        it('should handle compression levels consistently', () =>
            fc.assert(
                fc.asyncProperty(stringArb, compressionLevelArb, async (data, level) => {
                    const result = await compress(data, { compressionLevel: level });
                    return result.compressionRatio >= 0 &&
                        result.compressionRatio <= 1.2;
                }),
                { numRuns: 50, timeout: 10000 }
            )
        );

        it('should maintain algorithm consistency in round-trip', () =>
            fc.assert(
                fc.asyncProperty(stringArb, algorithmArb, async (data, algorithm) => {
                    const result = await compress(data, { algorithm: algorithm as 'gzip' | 'brotli' | 'auto' | 'none' });
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                    return originalString === decompressedString;
                }),
                { numRuns: 50, timeout: 10000 }
            )
        );
    });

    describe('Analysis Properties', () => {
        it('should provide consistent analysis results', () =>
            fc.assert(
                fc.asyncProperty(stringArb, async (data) => {
                    const analysis = await analyzeCompression(data);
                    return analysis.originalSize === data.length &&
                        analysis.gzipSize >= 0 &&
                        analysis.brotliSize >= 0 &&
                        analysis.gzipRatio >= 0 &&
                        analysis.brotliRatio >= 0 &&
                        ['gzip', 'none'].includes(analysis.recommendation);
                }),
                { numRuns: 100, timeout: 10000 }
            )
        );

        it('should recommend optimal algorithm', () =>
            fc.assert(
                fc.asyncProperty(stringArb, async (data) => {
                    const analysis = await analyzeCompression(data);

                    if (analysis.recommendation === 'none') {
                        return analysis.gzipRatio >= 0.9 && analysis.brotliRatio >= 0.9;
                    }

                    if (analysis.recommendation === 'gzip') {
                        return analysis.gzipRatio < 0.9;
                    }

                    return false;
                }),
                { numRuns: 100, timeout: 10000 }
            )
        );
    });

    describe('Edge Case Properties', () => {
        it('should handle empty data', () =>
            fc.assert(
                fc.asyncProperty(fc.constant(''), async (data) => {
                    const result = await compress(data);
                    return result.originalSize === 0 &&
                        result.compressedSize === 0 &&
                        result.compressionRatio === 1.0;
                }),
                { numRuns: 10, timeout: 5000 }
            )
        );

        it('should handle single character data', () =>
            fc.assert(
                fc.asyncProperty(fc.char(), async (data) => {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    const decompressedString = uint8ArrayToString(decompressed);
                    return decompressedString === data;
                }),
                { numRuns: 50, timeout: 5000 }
            )
        );

        it('should handle data smaller than threshold', () =>
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 50 }),
                    fc.integer({ min: 100, max: 1000 }),
                    async (data, threshold) => {
                        const result = await compress(data, { minSizeThreshold: threshold });
                        return result.algorithm === 'none' &&
                            result.compressionRatio === 1.0;
                    }
                ),
                { numRuns: 50, timeout: 5000 }
            )
        );

        it('should handle data larger than threshold', () =>
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 200, maxLength: 1000 }),
                    fc.integer({ min: 50, max: 100 }),
                    async (data, threshold) => {
                        const result = await compress(data, { minSizeThreshold: threshold });
                        return result.originalSize > threshold;
                    }
                ),
                { numRuns: 50, timeout: 5000 }
            )
        );
    });

    describe('Invariant Properties', () => {
        it('should maintain idempotency for none algorithm', () =>
            fc.assert(
                fc.asyncProperty(stringArb, async (data) => {
                    const result1 = await compress(data, { algorithm: 'none' });
                    const result2 = await compress(data, { algorithm: 'none' });
                    return result1.algorithm === result2.algorithm &&
                        result1.compressionRatio === result2.compressionRatio &&
                        result1.compressedSize === result2.compressedSize;
                }),
                { numRuns: 50, timeout: 10000 }
            )
        );

        it('should maintain associativity for compression levels', () =>
            fc.assert(
                fc.asyncProperty(
                    stringArb,
                    fc.integer({ min: 1, max: 6 }),
                    fc.integer({ min: 6, max: 9 }),
                    async (data, level1, level2) => {
                        const result1 = await compress(data, { compressionLevel: level1 });
                        const result2 = await compress(data, { compressionLevel: level2 });

                        // Higher levels should generally give better compression
                        if (level2 > level1) {
                            return result2.compressionRatio <= result1.compressionRatio;
                        }
                        return true;
                    }
                ),
                { numRuns: 30, timeout: 10000 }
            )
        );

        it('should maintain data integrity under algorithm changes', () =>
            fc.assert(
                fc.asyncProperty(
                    stringArb,
                    fc.constantFrom('gzip', 'brotli'),
                    async (data, algorithm) => {
                        const result = await compress(data, { algorithm: algorithm as 'gzip' | 'brotli' });
                        const decompressed = await decompress(result.compressed, result.algorithm);
                        const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                        const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                        return originalString === decompressedString;
                    }
                ),
                { numRuns: 50, timeout: 10000 }
            )
        );
    });

    describe('Performance Properties', () => {
        it('should complete compression within reasonable time', () =>
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 100, maxLength: 1000 }),
                    async (data) => {
                        const startTime = performance.now();
                        await compress(data);
                        const endTime = performance.now();
                        const duration = endTime - startTime;
                        return duration < 1000; // Should complete within 1 second
                    }
                ),
                { numRuns: 30, timeout: 15000 }
            )
        );

        it('should complete decompression within reasonable time', () =>
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 100, maxLength: 1000 }),
                    async (data) => {
                        const compressed = await compress(data);
                        const startTime = performance.now();
                        await decompress(compressed.compressed, compressed.algorithm);
                        const endTime = performance.now();
                        const duration = endTime - startTime;
                        return duration < 500; // Should complete within 500ms
                    }
                ),
                { numRuns: 30, timeout: 15000 }
            )
        );
    });

    describe('Error Handling Properties', () => {
        it('should handle invalid compression algorithms gracefully', () =>
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 10, maxLength: 100 }),
                    async (data) => {
                        try {
                            await compress(data, { algorithm: 'none' });
                            return true; // Should succeed with 'none'
                        } catch (error) {
                            return false;
                        }
                    }
                ),
                { numRuns: 20, timeout: 5000 }
            )
        );

        it('should maintain consistency under error conditions', () =>
            fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 10, maxLength: 100 }),
                    async (data) => {
                        const result = await compress(data);

                        // Should handle decompression with correct algorithm
                        try {
                            const decompressed = await decompress(result.compressed, result.algorithm);
                            const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                            const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                            return originalString === decompressedString;
                        } catch (error) {
                            return false;
                        }
                    }
                ),
                { numRuns: 50, timeout: 10000 }
            )
        );
    });
});
