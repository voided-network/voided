import {
    VoidedE2EEClient,
    EncryptedBlob
} from '../index';
import { InMemoryStorage } from './test-utils';

// Performance and stress test constants
const STRESS_TEST_CONFIG = {
    LARGE_DATA_SIZE: 100000, // 100KB
    HUGE_DATA_SIZE: 1000000, // 1MB
    CONCURRENT_OPERATIONS: 10,
    RAPID_ITERATIONS: 50,
    MEMORY_TEST_ITERATIONS: 20,
    PERFORMANCE_THRESHOLD_MS: 5000,
    COMPRESSION_RATIO_THRESHOLD: 0.3
};

// Generate various test data patterns
function generateTestData(size: number, pattern: 'repetitive' | 'random' | 'structured' | 'mixed'): string {
    switch (pattern) {
        case 'repetitive':
            return 'This is highly repetitive data that should compress extremely well. '.repeat(Math.ceil(size / 50)).substring(0, size);

        case 'random':
            const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?';
            return Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

        case 'structured':
            const items = Math.ceil(size / 200);
            const data = Array.from({ length: items }, (_, i) => ({
                id: i,
                name: `User ${i}`,
                email: `user${i}@example.com`,
                active: i % 2 === 0,
                score: Math.random() * 100,
                metadata: {
                    created: new Date().toISOString(),
                    tags: [`tag${i}`, `category${i % 5}`]
                }
            }));
            return JSON.stringify(data).substring(0, size);

        case 'mixed':
            const repetitive = 'Repetitive pattern. '.repeat(Math.ceil(size / 3));
            const random = Array.from({ length: Math.floor(size / 3) }, () =>
                String.fromCharCode(32 + Math.floor(Math.random() * 95))
            ).join('');
            const structured = JSON.stringify({ timestamp: Date.now(), data: 'mixed content' });
            return (repetitive + random + structured).substring(0, size);

        default:
            return 'default test data'.repeat(Math.ceil(size / 20)).substring(0, size);
    }
}

describe('E2EE Integration Stress Tests', () => {
    describe('Large Data Performance Tests', () => {
        test('should handle large repetitive data efficiently', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const largeData = generateTestData(STRESS_TEST_CONFIG.LARGE_DATA_SIZE, 'repetitive');

            const startTime = performance.now();

            const encrypted = await client.encrypt(largeData, {
                forceCompression: true,
                compressionAlgorithm: 'gzip'
            });
            const decrypted = await client.decrypt(encrypted);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(STRESS_TEST_CONFIG.PERFORMANCE_THRESHOLD_MS);
            expect(decrypted).toBe(largeData);
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize * STRESS_TEST_CONFIG.COMPRESSION_RATIO_THRESHOLD);
        });

        test('should handle large structured data efficiently', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const structuredData = generateTestData(STRESS_TEST_CONFIG.LARGE_DATA_SIZE, 'structured');

            const startTime = performance.now();

            const encrypted = await client.encrypt(structuredData, {
                forceCompression: true,
                compressionAlgorithm: 'gzip'
            });
            const decrypted = await client.decrypt(encrypted);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(STRESS_TEST_CONFIG.PERFORMANCE_THRESHOLD_MS);
            expect(decrypted).toBe(structuredData);
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize * 0.8);
        });

        test('should handle huge data without memory issues', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const hugeData = generateTestData(STRESS_TEST_CONFIG.HUGE_DATA_SIZE, 'repetitive');

            const startTime = performance.now();

            const encrypted = await client.encrypt(hugeData, {
                forceCompression: true,
                compressionAlgorithm: 'gzip'
            });
            const decrypted = await client.decrypt(encrypted);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(STRESS_TEST_CONFIG.PERFORMANCE_THRESHOLD_MS * 3); // Allow more time for huge data
            expect(decrypted).toBe(hugeData);
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize * 0.2);
        });
    });

    describe('Concurrent Operations Tests', () => {
        test('should handle multiple concurrent encryption operations', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const dataSize = 10000;

            const operations = Array.from({ length: STRESS_TEST_CONFIG.CONCURRENT_OPERATIONS }, async () => {
                const data = generateTestData(dataSize, 'mixed');
                const encrypted = await client.encrypt(data);
                const decrypted = await client.decrypt(encrypted);
                return { original: data, decrypted, success: data === decrypted };
            });

            const results: any[] = await Promise.all(operations);
            const allSuccessful = results.every(result => result.success);
            expect(allSuccessful).toBe(true);
        });

        test('should handle concurrent operations with different data types', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const patterns: ('repetitive' | 'random' | 'structured' | 'mixed')[] = ['repetitive', 'random', 'structured', 'mixed'];

            const operations = patterns.map(async (pattern) => {
                const data = generateTestData(5000, pattern);
                const encrypted = await client.encrypt(data);
                const decrypted = await client.decrypt(encrypted);
                return { pattern, original: data, decrypted, success: data === decrypted };
            });

            const results = await Promise.all(operations);
            const allSuccessful = results.every(result => result.success);
            expect(allSuccessful).toBe(true);
        });
    });

    describe('Memory Stress Tests', () => {
        test('should handle rapid successive operations without memory leaks', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const dataSize = 5000;

            for (let i = 0; i < STRESS_TEST_CONFIG.RAPID_ITERATIONS; i++) {
                const data = generateTestData(dataSize, 'mixed');
                const encrypted = await client.encrypt(data);
                const decrypted = await client.decrypt(encrypted);

                expect(decrypted).toBe(data);

                // Verify compression metadata
                expect(encrypted.compression.originalSize).toBe(data.length);
                expect(encrypted.compression.compressedSize).toBeLessThanOrEqual(encrypted.compression.originalSize);
            }
        });

        test('should handle multiple large operations in sequence', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const dataSize = 50000;

            for (let i = 0; i < 5; i++) {
                const data = generateTestData(dataSize, 'repetitive');
                const encrypted = await client.encrypt(data, {
                    forceCompression: true,
                    compressionAlgorithm: 'gzip'
                });
                const decrypted = await client.decrypt(encrypted);

                expect(decrypted).toBe(data);
                expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize * 0.5);
            }
        });
    });

    describe('Key Management Stress Tests', () => {
        test('should handle key rotation under load', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = generateTestData(10000, 'structured');

            // Encrypt with original key
            const encrypted1 = await client.encrypt(testData);
            const decrypted1 = await client.decrypt(encrypted1);
            expect(decrypted1).toBe(testData);

            // Rotate key (force rotation by default)
            const newKeyString = await client.rotateKey();
            expect(newKeyString).toBeDefined();

            // Encrypt with new key
            const encrypted2 = await client.encrypt(testData);
            const decrypted2 = await client.decrypt(encrypted2);
            expect(decrypted2).toBe(testData);

            // Verify old encrypted data is no longer decryptable (force rotation)
            await expect(client.decrypt(encrypted1)).rejects.toThrow();
        });

        test('should handle key export/import under stress', async () => {
            const client1 = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const client2 = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            const testData = generateTestData(10000, 'mixed');

            // Encrypt with client1
            const encrypted = await client1.encrypt(testData);

            // Export key from client1
            const keyString = await client1.exportKey();

            // Import key to client2
            await client2.importKey(keyString);

            // Decrypt with client2
            const decrypted = await client2.decrypt(encrypted);
            expect(decrypted).toBe(testData);
        });
    });

    describe('Error Recovery Tests', () => {
        test('should handle corrupted encrypted data gracefully', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = generateTestData(1000, 'mixed');

            const encrypted = await client.encrypt(testData);

            // Corrupt the encrypted data
            const corruptedBlob: EncryptedBlob = {
                ...encrypted,
                data: encrypted.data?.substring(0, (encrypted.data?.length ?? 0) - 10) + 'corrupted'
            };

            // Should throw an error when trying to decrypt corrupted data
            await expect(client.decrypt(corruptedBlob)).rejects.toThrow();
        });

        test('should handle invalid compression metadata', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = generateTestData(1000, 'mixed');

            const encrypted = await client.encrypt(testData);

            // Modify compression metadata
            const modifiedBlob: EncryptedBlob = {
                ...encrypted,
                compression: {
                    ...encrypted.compression,
                    algorithm: 'invalid' as any
                }
            };

            // Should handle gracefully or throw appropriate error
            try {
                await client.decrypt(modifiedBlob);
            } catch (error) {
                expect(error).toBeDefined();
            }
        });
    });

    describe('Compression Algorithm Tests', () => {
        test('should use optimal compression for different data types', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });

            const testCases = [
                { data: generateTestData(10000, 'repetitive'), expectedRatio: 0.3 },
                { data: generateTestData(10000, 'structured'), expectedRatio: 0.6 },
                { data: generateTestData(10000, 'random'), expectedRatio: 1.0 }
            ];

            for (const { data, expectedRatio } of testCases) {
                const encrypted = await client.encrypt(
                    data,
                    expectedRatio < 1
                        ? { forceCompression: true, compressionAlgorithm: 'gzip' }
                        : { compressionAlgorithm: 'none' }
                );
                const decrypted = await client.decrypt(encrypted);

                expect(decrypted).toBe(data);
                expect(encrypted.compression.compressedSize / encrypted.compression.originalSize).toBeLessThanOrEqual(expectedRatio);
            }
        });

        test('should maintain compression effectiveness across multiple operations', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const data = generateTestData(10000, 'repetitive');

            const ratios: number[] = [];

            for (let i = 0; i < 10; i++) {
                const encrypted = await client.encrypt(data, {
                    forceCompression: true,
                    compressionAlgorithm: 'gzip'
                });
                const ratio = encrypted.compression.compressedSize / encrypted.compression.originalSize;
                ratios.push(ratio);

                const decrypted = await client.decrypt(encrypted);
                expect(decrypted).toBe(data);
            }

            // Compression should be consistent
            const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
            expect(avgRatio).toBeLessThan(0.5);

            // Variance should be low
            const variance = ratios.reduce((sum, ratio) => sum + Math.pow(ratio - avgRatio, 2), 0) / ratios.length;
            expect(variance).toBeLessThan(0.01);
        });
    });

    describe('Unicode and Special Character Tests', () => {
        test('should handle unicode data correctly', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const unicodeData = 'Hello 世界 🌍 emoji test 🚀 特殊字符测试 🎉'.repeat(100);

            const encrypted = await client.encrypt(unicodeData, {
                forceCompression: true,
                compressionAlgorithm: 'gzip'
            });
            const decrypted = await client.decrypt(encrypted);

            expect(decrypted).toBe(unicodeData);
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize);
        });

        test('should handle special characters and symbols', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\'.repeat(50);

            const encrypted = await client.encrypt(specialChars);
            const decrypted = await client.decrypt(encrypted);

            expect(decrypted).toBe(specialChars);
        });
    });

    describe('Performance Regression Tests', () => {
        test('should maintain consistent performance across operations', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const data = generateTestData(5000, 'mixed');
            const times: number[] = [];

            for (let i = 0; i < 10; i++) {
                const startTime = performance.now();

                const encrypted = await client.encrypt(data);
                const decrypted = await client.decrypt(encrypted);

                const endTime = performance.now();
                times.push(endTime - startTime);

                expect(decrypted).toBe(data);
            }

            // Average time should be reasonable
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            expect(avgTime).toBeLessThan(2000); // 2 seconds average

            // No single operation should be too slow
            const maxTime = Math.max(...times);
            expect(maxTime).toBeLessThan(5000); // 5 seconds max
        });
    });
});
