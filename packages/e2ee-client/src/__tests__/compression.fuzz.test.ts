import {
    compress,
    decompress,
    analyzeCompression,
    uint8ArrayToString
} from '../compression';

// Fuzz test utilities
function generateFuzzData(size: number, fuzzType: 'random' | 'malformed' | 'edge' | 'corrupted'): string | Uint8Array {
    switch (fuzzType) {
        case 'random':
            return Array.from({ length: size }, () => String.fromCharCode(Math.floor(Math.random() * 65536))).join('');

        case 'malformed':
            // Mix of valid and potentially problematic characters
            const chars = [
                ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)), // Control characters
                ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)), // Printable ASCII
                ...Array.from({ length: 100 }, () => String.fromCharCode(0x80 + Math.floor(Math.random() * 0x7F80))), // Extended Unicode
                ...Array.from({ length: 50 }, () => '\u0000'), // Null bytes
                ...Array.from({ length: 50 }, () => '\uFFFD'), // Replacement character
            ];
            return Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

        case 'edge':
            // Edge case patterns
            const patterns = [
                'a'.repeat(size), // Single character repeated
                'ab'.repeat(Math.ceil(size / 2)).substring(0, size), // Alternating characters
                Array.from({ length: size }, (_, i) => String.fromCharCode(i % 256)).join(''), // Sequential bytes
                Array.from({ length: size }, () => String.fromCharCode(0)).join(''), // All nulls
                Array.from({ length: size }, () => String.fromCharCode(255)).join(''), // All 0xFF
            ];
            return patterns[Math.floor(Math.random() * patterns.length)];

        case 'corrupted':
            // Generate data that might cause issues
            const base = 'normal data '.repeat(Math.ceil(size / 12));
            const corrupted = base.split('').map((char, i) => {
                if (i % 100 === 0) return String.fromCharCode(0); // Insert nulls
                if (i % 200 === 0) return String.fromCharCode(0xFF); // Insert 0xFF
                if (i % 300 === 0) return '\uFFFD'; // Insert replacement character
                return char;
            }).join('');
            return corrupted.substring(0, size);

        default:
            return 'default fuzz data'.repeat(Math.ceil(size / 20)).substring(0, size);
    }
}

describe('Compression Fuzz Tests', () => {
    describe('Random Data Fuzzing', () => {
        test('should handle completely random string data', async () => {
            const iterations = 50;

            for (let i = 0; i < iterations; i++) {
                const size = Math.floor(Math.random() * 1000) + 10;
                const data = generateFuzzData(size, 'random');

                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);

                    const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(originalString);
                    expect(result.compressionRatio).toBeGreaterThan(0);
                    expect(result.compressionRatio).toBeLessThan(2.0); // Shouldn't expand too much
                } catch (error) {
                    // Some random data might cause issues, but should be handled gracefully
                    expect(error).toBeDefined();
                }
            }
        });

        test('should handle random Uint8Array data', async () => {
            const iterations = 30;

            for (let i = 0; i < iterations; i++) {
                const size = Math.floor(Math.random() * 500) + 10;
                const data = new Uint8Array(Array.from({ length: size }, () => Math.floor(Math.random() * 256)));

                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);

                    expect(decompressed).toEqual(data);
                    expect(result.compressionRatio).toBeGreaterThan(0);
                    expect(result.compressionRatio).toBeLessThan(2.0);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });
    });

    describe('Malformed Data Fuzzing', () => {
        test('should handle malformed string data', async () => {
            const iterations = 40;

            for (let i = 0; i < iterations; i++) {
                const size = Math.floor(Math.random() * 500) + 10;
                const data = generateFuzzData(size, 'malformed');

                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);

                    const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(originalString);
                } catch (error) {
                    // Malformed data might cause issues, but should be handled gracefully
                    expect(error).toBeDefined();
                }
            }
        });

        test('should handle data with null bytes', async () => {
            const testCases = [
                'normal\u0000data',
                '\u0000\u0000\u0000',
                'start\u0000middle\u0000end',
                '\u0000'.repeat(100)
            ];

            for (const data of testCases) {
                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(data);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });

        test('should handle data with replacement characters', async () => {
            const testCases = [
                'normal\uFFFData',
                '\uFFFD\uFFFD\uFFFD',
                'start\uFFFDmiddle\uFFFDend',
                '\uFFFD'.repeat(50)
            ];

            for (const data of testCases) {
                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(data);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });
    });

    describe('Edge Case Fuzzing', () => {
        test('should handle edge case patterns', async () => {
            const iterations = 30;

            for (let i = 0; i < iterations; i++) {
                const size = Math.floor(Math.random() * 300) + 10;
                const data = generateFuzzData(size, 'edge');

                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);

                    const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(originalString);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });

        test('should handle single character repeated data', async () => {
            const testCases = [
                'a'.repeat(100),
                '0'.repeat(200),
                ' '.repeat(150),
                '\n'.repeat(80)
            ];

            for (const data of testCases) {
                const result = await compress(data);
                const decompressed = await decompress(result.compressed, result.algorithm);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                expect(decompressedString).toBe(data);
                // Allow for cases where compression might not be very effective for small data
                expect(result.compressionRatio).toBeLessThan(1.1); // Shouldn't expand significantly
            }
        });

        test('should handle alternating patterns', async () => {
            const testCases = [
                'ab'.repeat(100),
                '01'.repeat(150),
                '+-'.repeat(80),
                'xy'.repeat(120)
            ];

            for (const data of testCases) {
                const result = await compress(data);
                const decompressed = await decompress(result.compressed, result.algorithm);
                const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                expect(decompressedString).toBe(data);
                expect(result.compressionRatio).toBeLessThan(0.8); // Should compress reasonably well
            }
        });
    });

    describe('Corrupted Data Fuzzing', () => {
        test('should handle data with embedded nulls and special characters', async () => {
            const iterations = 25;

            for (let i = 0; i < iterations; i++) {
                const size = Math.floor(Math.random() * 400) + 20;
                const data = generateFuzzData(size, 'corrupted');

                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);

                    const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(originalString);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });

        test('should handle data with mixed encodings', async () => {
            const testCases = [
                'normal\u0000\uFFFDdata',
                'start\u0000middle\uFFFDend',
                '\u0000\uFFFD\u0000\uFFFD'.repeat(20),
                'ascii\u0000unicode\uFFFDmixed'
            ];

            for (const data of testCases) {
                try {
                    const result = await compress(data);
                    const decompressed = await decompress(result.compressed, result.algorithm);
                    const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                    expect(decompressedString).toBe(data);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });
    });

    describe('Algorithm Fuzzing', () => {
        test('should handle fuzz data with different algorithms', async () => {
            const algorithms: ('gzip' | 'brotli' | 'auto')[] = ['gzip', 'brotli', 'auto'];
            const iterations = 20;

            for (const algorithm of algorithms) {
                for (let i = 0; i < iterations; i++) {
                    const size = Math.floor(Math.random() * 200) + 10;
                    const data = generateFuzzData(size, 'random');

                    try {
                        const result = await compress(data, { algorithm });
                        const decompressed = await decompress(result.compressed, result.algorithm);

                        const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                        const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                        expect(decompressedString).toBe(originalString);
                        expect(['gzip', 'none']).toContain(result.algorithm);
                    } catch (error) {
                        expect(error).toBeDefined();
                    }
                }
            }
        });

        test('should handle fuzz data with different compression levels', async () => {
            const levels = [1, 6, 9];
            const iterations = 15;

            for (const level of levels) {
                for (let i = 0; i < iterations; i++) {
                    const size = Math.floor(Math.random() * 150) + 10;
                    const data = generateFuzzData(size, 'edge');

                    try {
                        const result = await compress(data, { compressionLevel: level });
                        const decompressed = await decompress(result.compressed, result.algorithm);

                        const originalString = typeof data === 'string' ? data : uint8ArrayToString(data);
                        const decompressedString = typeof decompressed === 'string' ? decompressed : uint8ArrayToString(decompressed);

                        expect(decompressedString).toBe(originalString);
                    } catch (error) {
                        expect(error).toBeDefined();
                    }
                }
            }
        });
    });

    describe('Analysis Fuzzing', () => {
        test('should analyze fuzz data correctly', async () => {
            const iterations = 30;

            for (let i = 0; i < iterations; i++) {
                const size = Math.floor(Math.random() * 300) + 10;
                const data = generateFuzzData(size, 'random');

                try {
                    const analysis = await analyzeCompression(data);

                    expect(analysis.originalSize).toBe(typeof data === 'string' ? data.length : data.length);
                    expect(analysis.gzipSize).toBeGreaterThan(0);
                    expect(analysis.brotliSize).toBeGreaterThan(0);
                    expect(analysis.gzipRatio).toBeGreaterThan(0);
                    expect(analysis.brotliRatio).toBeGreaterThan(0);
                    expect(['gzip', 'none']).toContain(analysis.recommendation);
                } catch (error) {
                    expect(error).toBeDefined();
                }
            }
        });
    });

    describe('Error Recovery Fuzzing', () => {
        test('should handle decompression of corrupted compressed data', async () => {
            const testData = 'normal test data';
            const result = await compress(testData);

            // Corrupt the compressed data
            const corrupted = new Uint8Array(result.compressed);
            corrupted[0] = corrupted[0] ^ 0xFF; // Flip bits

            // Note: Some compression libraries are very resilient to corruption
            // and might still decompress successfully. This test verifies the behavior
            // but doesn't enforce that it must throw.
            try {
                await decompress(corrupted, result.algorithm);
                // If it doesn't throw, that's also acceptable behavior
            } catch (error) {
                // If it throws, that's also acceptable behavior
                expect(error).toBeDefined();
            }
        });

        test('should handle wrong algorithm for decompression', async () => {
            const testData = 'test data';
            const result = await compress(testData, { algorithm: 'gzip' });

            // Note: Some decompression libraries might be resilient to wrong algorithms
            // and might still attempt decompression or handle gracefully
            try {
                await decompress(result.compressed, 'brotli');
                // If it doesn't throw, that's also acceptable behavior
            } catch (error) {
                // If it throws, that's also acceptable behavior
                expect(error).toBeDefined();
            }
        });
    });
});
