import {
    compress,
    decompress,
    analyzeCompression,
    stringToUint8Array,
    uint8ArrayToString,
    CompressionOptions
} from '../compression';

// Helper function to generate test data
function generateTestData(size: number, pattern: 'random' | 'repetitive' | 'mixed' = 'mixed'): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?';
    let result = '';

    if (pattern === 'repetitive') {
        // Create repetitive data that compresses well
        const base = 'This is a repetitive pattern that should compress very well. '.repeat(Math.ceil(size / 50));
        result = base.substring(0, size);
    } else if (pattern === 'random') {
        // Create random data that doesn't compress well
        for (let i = 0; i < size; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
    } else {
        // Mixed pattern
        const repetitive = 'This is a repetitive pattern. '.repeat(Math.ceil(size / 3));
        const random = Array.from({ length: Math.floor(size / 3) }, () =>
            chars[Math.floor(Math.random() * chars.length)]
        ).join('');
        result = (repetitive + random).substring(0, size);
    }

    return result;
}

describe('Frontend Compression Tests', () => {
    describe('Basic Functionality', () => {
        test('should compress and decompress string data', async () => {
            const testData = 'Hello, this is a test string that should compress well!';
            const result = await compress(testData);

            expect(result.originalSize).toBe(testData.length);
            expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize);
            expect(result.compressionRatio).toBeLessThanOrEqual(1.0);

            const decompressed = await decompress(result.compressed, result.algorithm);
            const decompressedString = uint8ArrayToString(decompressed);
            expect(decompressedString).toBe(testData);
        });

        test('should compress and decompress Uint8Array data', async () => {
            const testData = stringToUint8Array('Test data as Uint8Array');
            const result = await compress(testData);

            expect(result.originalSize).toBe(testData.length);
            expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize);

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(decompressed).toEqual(testData);
        });

        test('should handle small data without compression', async () => {
            const smallData = 'tiny';
            const result = await compress(smallData, { minSizeThreshold: 100 });

            expect(result.algorithm).toBe('none');
            expect(result.compressionRatio).toBe(1.0);
            expect(result.compressedSize).toBe(result.originalSize);
        });

        test('should respect minSizeThreshold option', async () => {
            const data = 'This is medium sized data that should be larger than the threshold';
            const result = await compress(data, { minSizeThreshold: 50 });

            // Should compress since data is larger than threshold
            expect(result.originalSize).toBeGreaterThan(50);
            expect(result.originalSize).toBe(data.length);
        });
    });

    describe('Algorithm Selection', () => {
        test('should use auto algorithm by default', async () => {
            const data = generateTestData(500, 'repetitive');
            const result = await compress(data);

            expect(['gzip', 'none']).toContain(result.algorithm);
        });

        test('should respect explicit gzip algorithm', async () => {
            const data = generateTestData(500, 'repetitive');
            const result = await compress(data, { algorithm: 'gzip' });

            expect(result.algorithm).toBe('gzip');
        });

        test('should fail closed for explicit brotli without the Rust WASM backend', async () => {
            const data = generateTestData(500, 'repetitive');
            await expect(compress(data, { algorithm: 'brotli' })).rejects.toThrow(
                'requires the Rust WASM backend'
            );
        });

        test('should respect none algorithm', async () => {
            const data = generateTestData(500, 'repetitive');
            const result = await compress(data, { algorithm: 'none' });

            expect(result.algorithm).toBe('none');
            expect(result.compressionRatio).toBe(1.0);
        });
    });

    describe('Compression Effectiveness', () => {
        test('should compress repetitive data effectively', async () => {
            const repetitiveData = generateTestData(1000, 'repetitive');
            const result = await compress(repetitiveData);

            // Repetitive data should compress well
            expect(result.compressionRatio).toBeLessThan(0.8);
            expect(result.compressedSize).toBeLessThan(result.originalSize);
        });

        test('should not compress random data significantly', async () => {
            const randomData = generateTestData(1000, 'random');
            const result = await compress(randomData);

            // Random data might not compress well, but should still work
            expect(result.compressionRatio).toBeLessThanOrEqual(1.0);
        });

        test('should only use compression when it saves space', async () => {
            const data = generateTestData(200, 'random');
            const result = await compress(data);

            // If compression doesn't help, should return 'none'
            if (result.compressionRatio >= 0.9) {
                expect(result.algorithm).toBe('none');
            }
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty string', async () => {
            const result = await compress('');
            expect(result.originalSize).toBe(0);
            expect(result.compressedSize).toBe(0);

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(decompressed.length).toBe(0);
        });

        test('should handle single character', async () => {
            const result = await compress('a');
            expect(result.originalSize).toBe(1);

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(uint8ArrayToString(decompressed)).toBe('a');
        });

        test('should handle unicode characters', async () => {
            const unicodeData = 'Hello 世界 🌍 emoji test';
            const result = await compress(unicodeData);

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(uint8ArrayToString(decompressed)).toBe(unicodeData);
        });

        test('should handle very large data', async () => {
            const largeData = generateTestData(10000, 'repetitive');
            const result = await compress(largeData);

            expect(result.originalSize).toBe(10000);
            expect(result.compressedSize).toBeLessThan(result.originalSize);

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(uint8ArrayToString(decompressed)).toBe(largeData);
        });
    });

    describe('Compression Levels', () => {
        test('should respect compression level for gzip', async () => {
            const data = generateTestData(1000, 'repetitive');
            const lowLevel = await compress(data, { algorithm: 'gzip', compressionLevel: 1 });
            const highLevel = await compress(data, { algorithm: 'gzip', compressionLevel: 9 });

            // Higher compression level should generally give better compression
            expect(highLevel.compressionRatio).toBeLessThanOrEqual(lowLevel.compressionRatio);
        });

        test('should reject brotli compression levels without the Rust WASM backend', async () => {
            const data = generateTestData(1000, 'repetitive');
            await expect(
                compress(data, { algorithm: 'brotli', compressionLevel: 1 })
            ).rejects.toThrow('requires the Rust WASM backend');
            await expect(
                compress(data, { algorithm: 'brotli', compressionLevel: 9 })
            ).rejects.toThrow('requires the Rust WASM backend');
        });
    });

    describe('Analyze Compression', () => {
        test('should analyze compression effectiveness', async () => {
            const data = generateTestData(500, 'repetitive');
            const analysis = await analyzeCompression(data);

            expect(analysis.originalSize).toBe(data.length);
            expect(analysis.gzipSize).toBeGreaterThan(0);
            expect(analysis.brotliSize).toBeGreaterThan(0);
            expect(analysis.gzipRatio).toBeGreaterThan(0);
            expect(analysis.brotliRatio).toBeGreaterThan(0);
            expect(['gzip', 'none']).toContain(analysis.recommendation);
        });

        test('should recommend none for small data', async () => {
            const smallData = 'tiny';
            const analysis = await analyzeCompression(smallData);

            expect(analysis.recommendation).toBe('none');
        });

        test('should recommend best algorithm for large data', async () => {
            const largeData = generateTestData(1000, 'repetitive');
            const analysis = await analyzeCompression(largeData);

            if (analysis.gzipRatio < 0.9) {
                expect(analysis.recommendation).toBe('gzip');
            } else {
                expect(analysis.recommendation).toBe('none');
            }
        });
    });

    describe('Error Handling', () => {
        test('should handle decompression with wrong algorithm', async () => {
            const data = 'test data';
            const compressed = await compress(data, { algorithm: 'gzip' });

            // Try to decompress with wrong algorithm
            await expect(decompress(compressed.compressed, 'brotli')).rejects.toThrow();
        });

        test('should handle corrupted compressed data', async () => {
            const corruptedData = new Uint8Array([1, 2, 3, 4, 5]); // Not valid compressed data

            await expect(decompress(corruptedData, 'gzip')).rejects.toThrow();
            await expect(decompress(corruptedData, 'brotli')).rejects.toThrow();
        });
    });

    describe('Round-trip Property Tests', () => {
        test('should preserve data through compress-decompress cycle', async () => {
            const testCases = [
                'Simple string',
                'String with spaces and punctuation!',
                'Unicode: 世界 🌍 emoji',
                generateTestData(100, 'repetitive'),
                generateTestData(100, 'random'),
                generateTestData(100, 'mixed')
            ];

            for (const testData of testCases) {
                const result = await compress(testData);
                const decompressed = await decompress(result.compressed, result.algorithm);
                const decompressedString = uint8ArrayToString(decompressed);

                expect(decompressedString).toBe(testData);
            }
        });

        test('should work with different compression options', async () => {
            const data = generateTestData(500, 'repetitive');
            const options: CompressionOptions[] = [
                { algorithm: 'auto' },
                { algorithm: 'gzip' },
                { algorithm: 'brotli' },
                { algorithm: 'none' },
                { minSizeThreshold: 50 },
                { compressionLevel: 1 },
                { compressionLevel: 9 }
            ];

            for (const option of options) {
                if (option.algorithm === 'brotli') {
                    await expect(compress(data, option)).rejects.toThrow(
                        'requires the Rust WASM backend'
                    );
                    continue;
                }
                const result = await compress(data, option);
                const decompressed = await decompress(result.compressed, result.algorithm);
                const decompressedString = uint8ArrayToString(decompressed);

                expect(decompressedString).toBe(data);
            }
        });
    });
});
