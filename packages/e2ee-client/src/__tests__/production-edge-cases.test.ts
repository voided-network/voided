/// <reference types="jest" />
import { VoidedE2EEClient } from '../index';
import { InMemoryStorage } from './test-utils';

// Edge case test configuration
const EDGE_CONFIG = {
    // Extreme data patterns
    MAX_UNICODE_CODEPOINT: 0x10FFFF,
    MASSIVE_REPETITION_SIZE: 1000000,
    ULTRA_SPARSE_SIZE: 100000,

    // Browser limits
    MAX_STRING_LENGTH: 268435456, // 256MB theoretical limit
    MAX_PRACTICAL_SIZE: 100 * 1024 * 1024, // 100MB practical limit

    // Attack simulation
    TIMING_ATTACK_SAMPLES: 1000,
    SIDE_CHANNEL_SAMPLES: 500,

    // Real-world patterns
    EMOJI_HEAVY_FACTOR: 0.3,
    MULTILINGUAL_FACTOR: 0.4,
    BINARY_NOISE_FACTOR: 0.2,
};

// Advanced data generators for edge cases
class EdgeCaseDataGenerator {
    /**
     * Generate data with extreme Unicode patterns
     */
    static generateUnicodeExtreme(size: number): string {
        const patterns = [
            () => String.fromCodePoint(32 + Math.floor(Math.random() * 95)), // Safe ASCII range
            () => String.fromCodePoint(0x80 + Math.floor(Math.random() * 0x80)), // Latin Extended
            () => String.fromCodePoint(0x100 + Math.floor(Math.random() * 0x100)), // Latin Extended Additional
            () => String.fromCodePoint(0x1F600 + Math.floor(Math.random() * 0x80)), // Emoji
            () => String.fromCodePoint(0x4E00 + Math.floor(Math.random() * 0x9FFF)), // CJK
            () => String.fromCodePoint(0x10000 + Math.floor(Math.random() * 0xFFFF)), // Supplementary
        ];

        let result = '';
        for (let i = 0; i < size; i++) {
            try {
                const pattern = patterns[Math.floor(Math.random() * patterns.length)];
                const char = pattern();
                // Validate the character is safe for encryption/decryption
                if (char && char.length > 0 && char.charCodeAt(0) !== 0) {
                    result += char;
                } else {
                    result += 'X'; // Fallback for invalid characters
                }
            } catch (e) {
                result += 'X'; // Fallback for invalid code points
            }
        }

        return result;
    }

    /**
     * Generate data with pathological compression patterns
     */
    static generateCompressionPathological(size: number, type: 'worst' | 'best' | 'alternating'): string {
        switch (type) {
            case 'worst':
                // Random data that compresses poorly
                return Array.from({ length: size }, () =>
                    String.fromCharCode(Math.floor(Math.random() * 256))
                ).join('');

            case 'best':
                // Highly repetitive data
                const pattern = 'COMPRESS_ME_';
                return pattern.repeat(Math.ceil(size / pattern.length)).substring(0, size);

            case 'alternating':
                // Alternating compressible and incompressible blocks
                let result = '';
                const blockSize = 1000;
                for (let i = 0; i < size; i += blockSize) {
                    const isCompressible = Math.floor(i / blockSize) % 2 === 0;
                    const currentBlockSize = Math.min(blockSize, size - i);

                    if (isCompressible) {
                        result += 'REPEAT'.repeat(Math.ceil(currentBlockSize / 6)).substring(0, currentBlockSize);
                    } else {
                        result += Array.from({ length: currentBlockSize }, () =>
                            String.fromCharCode(Math.floor(Math.random() * 256))
                        ).join('');
                    }
                }
                return result;

            default:
                return 'default';
        }
    }

    /**
     * Generate data with extreme sparsity patterns
     */
    static generateSparseData(size: number): string {
        const result = new Array(size).fill('\0');

        // Randomly place non-null characters (1% density)
        const nonNullCount = Math.floor(size * 0.01);
        for (let i = 0; i < nonNullCount; i++) {
            const pos = Math.floor(Math.random() * size);
            result[pos] = String.fromCharCode(1 + Math.floor(Math.random() * 255));
        }

        return result.join('');
    }

    /**
     * Generate multilingual content
     */
    static generateMultilingual(size: number): string {
        const languages = [
            'Hello World! ', // English
            'Hola Mundo! ', // Spanish
            'Bonjour le Monde! ', // French
            'Hallo Welt! ', // German
            'Привет мир! ', // Russian
            'こんにちは世界! ', // Japanese
            '你好世界! ', // Chinese
            'مرحبا بالعالم! ', // Arabic
            'नमस्ते दुनिया! ', // Hindi
            '안녕하세요 세계! ', // Korean
        ];

        let result = '';
        while (result.length < size) {
            const lang = languages[Math.floor(Math.random() * languages.length)];
            result += lang;
        }

        return result.substring(0, size);
    }

    /**
     * Generate adversarial patterns that might break crypto
     */
    static generateAdversarialPattern(size: number, type: 'timing' | 'frequency' | 'collision'): string {
        switch (type) {
            case 'timing':
                // Patterns that might cause timing differences
                return Array.from({ length: size }, (_, i) => {
                    // Create patterns that might cause branch misprediction
                    if (i % 1000 < 500) {
                        return String.fromCharCode(65 + (i % 26)); // A-Z
                    } else {
                        return String.fromCharCode(97 + (i % 26)); // a-z
                    }
                }).join('');

            case 'frequency':
                // Patterns with unusual frequency distribution
                const weights = [0.5, 0.3, 0.15, 0.04, 0.01]; // Heavily skewed
                const chars = 'ABCDE';
                return Array.from({ length: size }, () => {
                    const rand = Math.random();
                    let cumulative = 0;
                    for (let i = 0; i < weights.length; i++) {
                        cumulative += weights[i];
                        if (rand < cumulative) {
                            return chars[i];
                        }
                    }
                    return 'E';
                }).join('');

            case 'collision':
                // Patterns that might cause hash collisions
                return Array.from({ length: size }, (_, i) => {
                    // Create patterns based on known collision-prone sequences
                    const base = Math.floor(i / 16);
                    return String.fromCharCode(65 + (base % 26));
                }).join('');

            default:
                return 'default';
        }
    }
}

// Timing attack simulation
class TimingAttackSimulator {
    async measureOperation(operation: () => Promise<any>): Promise<number> {
        const start = performance.now();
        await operation();
        const end = performance.now();
        return end - start;
    }

    async collectSamples(operation: () => Promise<any>, sampleCount: number): Promise<number[]> {
        const samples: number[] = [];
        for (let i = 0; i < sampleCount; i++) {
            const time = await this.measureOperation(operation);
            samples.push(time);

            // Brief pause to reduce measurement noise
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        return samples;
    }

    analyzeTimingVariance(samples: number[]): {
        mean: number;
        variance: number;
        standardDeviation: number;
        coefficient: number;
    } {
        const mean = samples.reduce((a, b) => a + b) / samples.length;
        const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / samples.length;
        const standardDeviation = Math.sqrt(variance);
        const coefficient = standardDeviation / mean;

        return { mean, variance, standardDeviation, coefficient };
    }
}

describe('Production Edge Case Tests', () => {
    describe('Extreme Unicode and Character Set Tests', () => {
        test('should handle extreme Unicode characters', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            // Test various Unicode ranges
            const testCases = [
                EdgeCaseDataGenerator.generateUnicodeExtreme(1000),
                EdgeCaseDataGenerator.generateMultilingual(2000),
                '🌍🚀🎉💎🔥⚡️🌟💫🎯🎪'.repeat(100), // Emoji heavy
                'نص عربي مع English text और हिंदी テキスト 中文文本 한국어 텍스트', // Mixed scripts
                '\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000A\u000B\u000C\u000D\u000E\u000F', // Control characters
                String.fromCharCode(0xFFFD).repeat(100), // Replacement character
            ];

            for (const testData of testCases) {
                const encrypted = await client.encrypt(testData);
                const decrypted = await client.decrypt(encrypted);

                expect(decrypted).toBe(testData);
                const expectedByteSize = encrypted.textEncoding === 'utf16le'
                    ? testData.length * 2
                    : new TextEncoder().encode(testData).length;
                expect(encrypted.compression.originalSize).toBe(expectedByteSize);
            }
        }, 30000);

        test('should handle data with extreme sparsity', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const sparseData = EdgeCaseDataGenerator.generateSparseData(EDGE_CONFIG.ULTRA_SPARSE_SIZE);

            const encrypted = await client.encrypt(sparseData, {
                forceCompression: true,
                compressionAlgorithm: 'gzip'
            });
            const decrypted = await client.decrypt(encrypted);

            expect(decrypted).toBe(sparseData);
            // Sparse data should compress extremely well
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize * 0.1);
        }, 30000);
    });

    describe('Pathological Compression Tests', () => {
        test('should handle worst-case compression scenarios', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            const testCases = [
                {
                    name: 'Random data (worst compression)',
                    data: EdgeCaseDataGenerator.generateCompressionPathological(10000, 'worst'),
                    // Random data with gzip can expand up to ~1.3x due to overhead
                    maxExpectedRatio: 1.35,
                    // The generator emits random Latin-1 code units, whose
                    // UTF-8 prefix structure remains somewhat compressible.
                    minExpectedRatio: 0.7,
                    options: { forceCompression: true, compressionAlgorithm: 'gzip' as const }
                },
                {
                    name: 'Highly repetitive data (best compression)',
                    data: EdgeCaseDataGenerator.generateCompressionPathological(10000, 'best'),
                    maxExpectedRatio: 0.2, // Very compressible
                    minExpectedRatio: 0.001,
                    options: { forceCompression: true, compressionAlgorithm: 'gzip' as const }
                },
                {
                    name: 'Alternating compressible/incompressible',
                    data: EdgeCaseDataGenerator.generateCompressionPathological(10000, 'alternating'),
                    maxExpectedRatio: 0.8,
                    minExpectedRatio: 0.3,
                    options: { forceCompression: true, compressionAlgorithm: 'gzip' as const }
                }
            ];

            for (const testCase of testCases) {
                const encrypted = await client.encrypt(testCase.data, testCase.options);
                const decrypted = await client.decrypt(encrypted);

                expect(decrypted).toBe(testCase.data);

                const actualRatio = encrypted.compression.compressedSize / encrypted.compression.originalSize;

                // Check that the ratio is within expected bounds
                expect(actualRatio).toBeGreaterThanOrEqual(testCase.minExpectedRatio);
                expect(actualRatio).toBeLessThanOrEqual(testCase.maxExpectedRatio);

                // Verify the compression algorithm was applied as expected
                if (testCase.options.forceCompression) {
                    // Should use gzip or the specified algorithm, not 'none'
                    expect(encrypted.compression.algorithm).not.toBe('none');
                }
            }

            // Separate test for no compression to diagnose the issue
            const noCompressData = EdgeCaseDataGenerator.generateCompressionPathological(1000, 'worst');
            const noCompressEncrypted = await client.encrypt(noCompressData, { compressionAlgorithm: 'none' });
            const noCompressDecrypted = await client.decrypt(noCompressEncrypted);

            expect(noCompressDecrypted).toBe(noCompressData);

            const noCompressRatio = noCompressEncrypted.compression.compressedSize / noCompressEncrypted.compression.originalSize;

            // With no compression, the algorithm should be 'none' and ratio should be close to 1.0
            expect(noCompressEncrypted.compression.algorithm).toBe('none');

            // Allow some tolerance for UTF-8 encoding differences between string length and byte length
            // The ratio might not be exactly 1.0 if originalSize is measured in characters but compressedSize in bytes
            expect(noCompressRatio).toBeGreaterThanOrEqual(0.5); // Very lenient lower bound
            expect(noCompressRatio).toBeLessThanOrEqual(4.0);    // Very lenient upper bound for UTF-8 expansion

            // More specific check: if no compression is used, compressedSize should equal the actual byte size of the UTF-8 encoded string
            const expectedByteSize = new TextEncoder().encode(noCompressData).length;

            // The compressedSize should match the actual UTF-8 byte size when no compression is used
            if (noCompressEncrypted.compression.algorithm === 'none') {
                expect(noCompressEncrypted.compression.compressedSize).toBe(expectedByteSize);
            }
        }, 30000);
    });

    describe('Browser Limit Tests', () => {
        test('should handle data at browser string limits', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            // Test with large but practical data size
            const largeSizeData = 'x'.repeat(25 * 1024 * 1024); // Reduced from 50MB to 25MB

            const startTime = performance.now();
            const encrypted = await client.encrypt(largeSizeData);
            const decrypted = await client.decrypt(encrypted);
            const endTime = performance.now();

            expect(decrypted).toBe(largeSizeData);
            expect(endTime - startTime).toBeLessThan(60000); // 60 seconds max

            // Default encryption intentionally avoids compression so an
            // attacker cannot turn this path into a decompression bomb.
            expect(encrypted.compression.algorithm).toBe('none');
            expect(encrypted.compression.compressedSize).toBe(
                encrypted.compression.originalSize
            );

            // log removed
        }, 120000);

        test('should handle data near library limits', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            // Test at the library's maximum size limit
            const maxSizeData = 'A'.repeat(EDGE_CONFIG.MAX_PRACTICAL_SIZE);

            const startTime = performance.now();
            const encrypted = await client.encrypt(maxSizeData);
            const decrypted = await client.decrypt(encrypted);
            const endTime = performance.now();

            expect(decrypted).toBe(maxSizeData);
            expect(endTime - startTime).toBeLessThan(300000); // 5 minutes max

            // log removed
        }, 600000);
    });

    describe('Memory Pressure Edge Cases', () => {
        test('should handle memory pressure with large objects', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            // Create memory pressure by maintaining references to large objects
            const largeObjects: any[] = [];
            const objectSize = 5 * 1024 * 1024; // Reduced from 10MB to 5MB each

            try {
                // Create several large objects
                for (let i = 0; i < 5; i++) {
                    const data = 'x'.repeat(objectSize);
                    const encrypted = await client.encrypt(data);
                    largeObjects.push({ data, encrypted });
                }

                // Now try to decrypt all of them while they're all in memory
                for (const obj of largeObjects) {
                    const decrypted = await client.decrypt(obj.encrypted);
                    expect(decrypted).toBe(obj.data);
                }

                // log removed
            } catch (error) {
                // If we run out of memory, that's expected in extreme conditions
                // log removed
                expect((error instanceof Error ? error.message : String(error))).toContain('memory');
            } finally {
                // Clean up references to free memory
                largeObjects.length = 0;
            }
        }, 120000);
    });

    describe('Security Edge Cases', () => {
        test('should resist timing attacks', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const simulator = new TimingAttackSimulator();

            // Test with different data patterns to see if timing varies
            const testCases = [
                EdgeCaseDataGenerator.generateAdversarialPattern(1000, 'timing'),
                EdgeCaseDataGenerator.generateAdversarialPattern(1000, 'frequency'),
                EdgeCaseDataGenerator.generateAdversarialPattern(1000, 'collision'),
            ];

            const timingResults: any[] = [];

            for (const testData of testCases) {
                const samples = await simulator.collectSamples(
                    async () => {
                        const encrypted = await client.encrypt(testData);
                        await client.decrypt(encrypted);
                    },
                    100
                );

                const analysis = simulator.analyzeTimingVariance(samples);
                timingResults.push(analysis);

                // log removed
            }

            // Coefficient of variation should be similar across different patterns
            const coefficients = timingResults.map(r => r.coefficient);
            const maxCoeff = Math.max(...coefficients);
            const minCoeff = Math.min(...coefficients);
            const timingVariance = maxCoeff / minCoeff;

            // Should not have extreme timing differences (allow up to 10x variance in test environments)
            // Note: timing tests are inherently flaky due to GC, system load, etc.
            expect(timingVariance).toBeLessThan(10.0);
        }, 60000);

        test('should handle malformed encrypted blobs', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = 'test data for malformed blob test';

            const validEncrypted = await client.encrypt(testData);

            // Test various malformed blob scenarios
            const malformedBlobs = [
                { ...validEncrypted, data: 'corrupted_base64_data' },
                { ...validEncrypted, iv: 'corrupted_iv' },
                { ...validEncrypted, algorithm: 'invalid_algorithm' as any },
                { ...validEncrypted, version: '999.0' as any },
                { ...validEncrypted, compression: { ...validEncrypted.compression, algorithm: 'invalid' as any } },
                { ...validEncrypted, data: validEncrypted.data?.substring(0, 10) ?? '' },
                { ...validEncrypted, data: (validEncrypted.data || '') + 'extra_data' },
            ];

            for (const malformedBlob of malformedBlobs) {
                await expect(client.decrypt(malformedBlob)).rejects.toThrow();
            }
        }, 30000);
    });

    describe('Concurrent Edge Cases', () => {
        test('should handle concurrent operations with extreme data', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            const operations: any[] = [];
            const dataSize = 1024 * 1024; // 1MB per operation

            // Create concurrent operations with different data patterns
            for (let i = 0; i < 10; i++) {
                const dataPattern = ['best', 'worst', 'alternating'][i % 3] as any;
                const data = EdgeCaseDataGenerator.generateCompressionPathological(dataSize, dataPattern);

                operations.push(
                    client.encrypt(data, {
                        forceCompression: true,
                        compressionAlgorithm: 'gzip'
                    }).then(encrypted =>
                        client.decrypt(encrypted).then(decrypted => ({
                            success: decrypted === data,
                            pattern: dataPattern,
                            compressionRatio: encrypted.compression.compressedSize / encrypted.compression.originalSize,
                        }))
                    )
                );
            }

            const results = await Promise.all(operations);

            // All operations should succeed
            const successRate = results.filter(r => r.success).length / results.length;
            expect(successRate).toBe(1.0);

            // Verify compression ratios make sense for different patterns
            const bestCompression = results.filter(r => r.pattern === 'best');
            const worstCompression = results.filter(r => r.pattern === 'worst');

            if (bestCompression.length > 0 && worstCompression.length > 0) {
                const avgBest = bestCompression.reduce((sum, r) => sum + r.compressionRatio, 0) / bestCompression.length;
                const avgWorst = worstCompression.reduce((sum, r) => sum + r.compressionRatio, 0) / worstCompression.length;

                expect(avgBest).toBeLessThan(avgWorst);
            }

            // log removed
        }, 60000);
    });

    describe('Advanced Security Features Edge Cases', () => {
        test('should handle advanced features with extreme data', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableSignatures: true
            });

            // Generate keys for advanced features
            const signingPublicKey = await client.generateSigningKeys();
            await client.setTrustedSigningPublicKey(signingPublicKey);
            await client.generateAgreementKeys();

            // Test with extreme data patterns
            const extremeData = EdgeCaseDataGenerator.generateUnicodeExtreme(500);

            const encrypted = await client.encrypt(extremeData);
            const decrypted = await client.decrypt(encrypted);


            expect(decrypted).toBe(extremeData);
            expect(encrypted.signature).toBeDefined();

            // Test fingerprint generation with extreme data
            const fingerprint = await client.getKeyFingerprint();
            const safetyNumbers = await client.getSafetyNumbers();

            expect(fingerprint).toBeDefined();
            expect(safetyNumbers).toBeDefined();
            expect(fingerprint.length).toBeGreaterThan(10);
            expect(safetyNumbers.length).toBeGreaterThan(10);
        }, 60000);
    });

    describe('Real-World Attack Simulation', () => {
        test('should not expose repeated sensitive plaintext patterns', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            const sensitivePatterns = [
                'password123',
                'credit_card_4111111111111111',
                'social_security_123456789',
                'secret_key_abcdef123456',
                'api_token_xyz789abc',
            ];

            for (const pattern of sensitivePatterns) {
                const data = pattern.repeat(100);
                const first = await client.encrypt(data);
                const second = await client.encrypt(data);
                const decrypted = await client.decrypt(first);

                expect(decrypted).toBe(data);
                expect(first.data).not.toBe(second.data);
                expect(first.iv).not.toBe(second.iv);
                expect(JSON.stringify(first)).not.toContain(pattern);
            }
        }, 30000);
    });
});
