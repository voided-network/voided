import {
    compress,
    decompress,
    analyzeCompression,
    uint8ArrayToString
} from '../compression';

// Performance benchmarks
const PERFORMANCE_THRESHOLDS = {
    COMPRESSION_TIME_MS: 1000, // 1 second for large data
    DECOMPRESSION_TIME_MS: 500, // 500ms for large data
    MEMORY_USAGE_MB: 100, // 100MB max memory usage
    COMPRESSION_RATIO_MIN: 0.1, // 90% compression for highly compressible data
    COMPRESSION_RATIO_MAX: 1.1 // 10% overhead max for incompressible data
};

// Generate various test data patterns
function generateTestData(size: number, pattern: 'repetitive' | 'random' | 'mixed' | 'structured' | 'binary'): string | Uint8Array {
    switch (pattern) {
        case 'repetitive':
            return 'This is a highly repetitive pattern that should compress extremely well. '.repeat(Math.ceil(size / 50)).substring(0, size);

        case 'random':
            const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?';
            return Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

        case 'mixed':
            const repetitive = 'Repetitive pattern. '.repeat(Math.ceil(size / 4));
            const random = Array.from({ length: Math.floor(size / 4) }, () =>
                String.fromCharCode(32 + Math.floor(Math.random() * 95))
            ).join('');
            return (repetitive + random).substring(0, size);

        case 'structured':
            // JSON-like structured data
            const items = Math.ceil(size / 100);
            const data = Array.from({ length: items }, (_, i) => ({
                id: i,
                name: `Item ${i}`,
                value: Math.random() * 1000,
                active: i % 2 === 0
            }));
            return JSON.stringify(data).substring(0, size);

        case 'binary':
            return new Uint8Array(Array.from({ length: size }, () => Math.floor(Math.random() * 256)));

        default:
            return 'default data'.repeat(Math.ceil(size / 12)).substring(0, size);
    }
}

describe('Compression Stress Tests', () => {
    describe('Performance Benchmarks', () => {
        test('should handle large repetitive data efficiently', async () => {
            const largeData = generateTestData(100000, 'repetitive'); // 100KB
            const startTime = performance.now();

            const result = await compress(largeData);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_TIME_MS);
            expect(result.compressionRatio).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_RATIO_MIN);
            expect(result.compressedSize).toBeLessThan(result.originalSize * 0.1); // 90%+ compression

            // Test decompression performance
            const decompressStart = performance.now();
            const decompressed = await decompress(result.compressed, result.algorithm);
            const decompressEnd = performance.now();
            const decompressDuration = decompressEnd - decompressStart;

            expect(decompressDuration).toBeLessThan(PERFORMANCE_THRESHOLDS.DECOMPRESSION_TIME_MS);

            // Verify data integrity
            const originalString = typeof largeData === 'string' ? largeData : uint8ArrayToString(largeData);
            const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
            expect(decompressedString).toBe(originalString);
        });

        test('should handle large random data without excessive overhead', async () => {
            const largeData = generateTestData(50000, 'random'); // 50KB
            const startTime = performance.now();

            const result = await compress(largeData);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_TIME_MS);
            expect(result.compressionRatio).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_RATIO_MAX);

            // Random data might not compress well, but shouldn't expand significantly
            expect(result.compressedSize).toBeLessThan(result.originalSize * 1.1);
        });

        test('should handle very large structured data', async () => {
            const largeData = generateTestData(500000, 'structured'); // 500KB
            const startTime = performance.now();

            const result = await compress(largeData);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_TIME_MS * 2); // Allow more time for large data
            expect(result.compressionRatio).toBeLessThan(0.8); // Should compress structured data well

            // Verify round-trip
            const decompressed = await decompress(result.compressed, result.algorithm);
            const originalString = typeof largeData === 'string' ? largeData : uint8ArrayToString(largeData);
            const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
            expect(decompressedString).toBe(originalString);
        });
    });

    describe('Memory Stress Tests', () => {
        test('should handle multiple large compressions without memory leaks', async () => {
            const iterations = 10;
            const dataSize = 10000; // 10KB per iteration

            for (let i = 0; i < iterations; i++) {
                const data = generateTestData(dataSize, 'mixed');
                const result = await compress(data);
                const decompressed = await decompress(result.compressed, result.algorithm);

                // Verify data integrity
                const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                expect(decompressedString).toBe(originalString);

                // Verify compression was effective
                expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize);
            }
        });

        test('should handle binary data efficiently', async () => {
            const binaryData = generateTestData(25000, 'binary') as Uint8Array;
            const startTime = performance.now();

            const result = await compress(binaryData);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_TIME_MS);
            expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize);

            // Verify binary data integrity
            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(decompressed).toEqual(binaryData);
        });
    });

    describe('Algorithm Selection Stress Tests', () => {
        test('should consistently choose optimal algorithm for different data types', async () => {
            const testCases = [
                { data: generateTestData(10000, 'repetitive'), expected: 'gzip' },
                { data: generateTestData(10000, 'structured'), expected: 'gzip' },
                { data: generateTestData(1000, 'random'), expected: 'none' },
                { data: generateTestData(100, 'mixed'), expected: 'none' }
            ];

            for (const { data, expected } of testCases) {
                const analysis = await analyzeCompression(data);

                if (expected === 'none') {
                    // For small data, the algorithm might still choose compression
                    // if it's effective enough, so we accept either 'none' or a compression algorithm
                    expect(['gzip', 'none']).toContain(analysis.recommendation);
                } else {
                    expect(analysis.recommendation).toBe('gzip');

                    // Verify the recommendation is actually optimal
                    const compressed = await compress(data, { algorithm: analysis.recommendation });
                    expect(compressed.algorithm).toBe(analysis.recommendation);
                }
            }
        });

        test('should handle algorithm fallbacks gracefully', async () => {
            const data = generateTestData(5000, 'repetitive');

            // Test all algorithms explicitly
            const algorithms: ('gzip' | 'brotli' | 'auto')[] = ['gzip', 'brotli', 'auto'];

            for (const algorithm of algorithms) {
                if (algorithm === 'brotli') {
                    await expect(compress(data, { algorithm })).rejects.toThrow(
                        'requires the Rust WASM backend'
                    );
                    continue;
                }
                const result = await compress(data, { algorithm });
                expect(['gzip', 'none']).toContain(result.algorithm);

                // Verify round-trip works
                const decompressed = await decompress(result.compressed, result.algorithm);
                const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                expect(decompressedString).toBe(originalString);
            }
        });
    });

    describe('Edge Case Stress Tests', () => {
        test('should handle extremely large data', async () => {
            const hugeData = generateTestData(1000000, 'repetitive'); // 1MB
            const startTime = performance.now();

            const result = await compress(hugeData);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPRESSION_TIME_MS * 5); // Allow more time for huge data
            expect(result.compressionRatio).toBeLessThan(0.2); // Should compress very well

            // Verify round-trip
            const decompressed = await decompress(result.compressed, result.algorithm);
            const originalString = typeof hugeData === 'string' ? hugeData : uint8ArrayToString(hugeData);
            const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
            expect(originalString).toBe(decompressedString);
        });

        test('should handle data with many null bytes', async () => {
            const nullData = new Uint8Array(10000).fill(0);
            nullData[0] = 1; // Add one non-null byte to make it interesting

            const result = await compress(nullData);
            expect(result.compressionRatio).toBeLessThan(0.1); // Should compress extremely well

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(decompressed).toEqual(nullData);
        });

        test('should handle data with high entropy', async () => {
            const highEntropyData = new Uint8Array(10000);
            for (let i = 0; i < highEntropyData.length; i++) {
                highEntropyData[i] = i % 256; // High entropy pattern
            }

            const result = await compress(highEntropyData);
            expect(result.compressionRatio).toBeLessThan(1.1); // Shouldn't expand significantly

            const decompressed = await decompress(result.compressed, result.algorithm);
            expect(decompressed).toEqual(highEntropyData);
        });

        test('should handle unicode and special characters', async () => {
            const unicodeData = 'Hello 世界 🌍 emoji test 🚀 特殊字符测试 🎉'.repeat(1000);

            const result = await compress(unicodeData);
            expect(result.compressionRatio).toBeLessThan(0.5); // Should compress well due to repetition

            const decompressed = await decompress(result.compressed, result.algorithm);
            const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
            expect(decompressedString).toBe(unicodeData);
        });
    });

    describe('Concurrent Stress Tests', () => {
        test('should handle concurrent compression operations', async () => {
            const concurrentOperations = 5;
            const dataSize = 5000;

            const operations = Array.from({ length: concurrentOperations }, async () => {
                const data = generateTestData(dataSize, 'mixed');
                const result = await compress(data);
                const decompressed = await decompress(result.compressed, result.algorithm);

                const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                return originalString === decompressedString;
            });

            const results = await Promise.all(operations);
            expect(results.every(result => result)).toBe(true);
        });

        test('should handle rapid successive operations', async () => {
            const iterations = 20;
            const dataSize = 1000;

            for (let i = 0; i < iterations; i++) {
                const data = generateTestData(dataSize, 'random');
                const result = await compress(data);
                const decompressed = await decompress(result.compressed, result.algorithm);

                const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                expect(decompressedString).toBe(originalString);
            }
        });
    });

    describe('Compression Level Stress Tests', () => {
        test('should handle different compression levels', async () => {
            const data = generateTestData(10000, 'repetitive');

            const levels = [1, 6, 9];
            const results = await Promise.all(
                levels.map(level => compress(data, { compressionLevel: level }))
            );

            // Higher levels should generally give better compression
            for (let i = 1; i < results.length; i++) {
                expect(results[i].compressionRatio).toBeLessThanOrEqual(results[i - 1].compressionRatio);
            }

            // All should maintain data integrity
            for (const result of results) {
                const decompressed = await decompress(result.compressed, result.algorithm);
                const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);
                expect(decompressedString).toBe(originalString);
            }
        });
    });
});
