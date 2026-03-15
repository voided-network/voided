import { VoidedE2EEClient } from '../index';
import { CLIENT_MAX_UPLOAD_BYTES, VOI_FILE_TOO_LARGE } from '../limits';
import {
    compress,
    decompress,
    stringToUint8Array,
    uint8ArrayToString
} from '../compression';
import { InMemoryStorage } from './test-utils';

// Helper function to generate test data
function generateTestData(size: number, pattern: 'random' | 'repetitive' | 'mixed' = 'mixed'): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?';
    let result = '';

    if (pattern === 'repetitive') {
        const base = 'This is a repetitive pattern that should compress very well. '.repeat(Math.ceil(size / 50));
        result = base.substring(0, size);
    } else if (pattern === 'random') {
        for (let i = 0; i < size; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
    } else {
        const repetitive = 'This is a repetitive pattern. '.repeat(Math.ceil(size / 3));
        const random = Array.from({ length: Math.floor(size / 3) }, () =>
            chars[Math.floor(Math.random() * chars.length)]
        ).join('');
        result = (repetitive + random).substring(0, size);
    }

    return result;
}

describe('E2EE Integration Tests with Compression', () => {
    describe('Basic E2EE Client Pipeline', () => {
        test('should encrypt and decrypt data with compression', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = 'Secret message that will be encrypted and compressed!';

            // Encrypt with compression
            const encrypted = await client.encrypt(testData, { originalSizeBytes: testData.length });
            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();
            expect(encrypted.compression).toBeDefined();

            // Decrypt
            const decrypted = await client.decrypt(encrypted);
            expect(decrypted).toBe(testData);
        });

        test('should work with large repetitive data', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const largeData = generateTestData(5000, 'repetitive');

            // Encrypt
            const encrypted = await client.encrypt(largeData, { originalSizeBytes: largeData.length });
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize);

            // Decrypt
            const decrypted = await client.decrypt(encrypted);
            expect(decrypted).toBe(largeData);
        });

        test('should work with random data that doesn\'t compress well', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const randomData = generateTestData(1000, 'random');

            // Encrypt
            const encrypted = await client.encrypt(randomData, { originalSizeBytes: randomData.length });

            // Decrypt
            const decrypted = await client.decrypt(encrypted);
            expect(decrypted).toBe(randomData);
        });
    });

    describe('Compression Analysis Integration', () => {
        test('should enforce 32 GiB limit via options without allocating huge buffers', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const data = 'x'.repeat(1024);
            const over = CLIENT_MAX_UPLOAD_BYTES + 1;
            await expect(client.encrypt(data, { originalSizeBytes: over })).rejects.toMatchObject({ code: VOI_FILE_TOO_LARGE });
        });
        test('should analyze compression effectiveness', async () => {
            const testData = generateTestData(3000, 'repetitive');

            // Analyze compression before using it
            const analysis = await import('../compression').then(m => m.analyzeCompression(testData));

            expect(analysis.originalSize).toBe(testData.length);
            expect(['gzip', 'brotli', 'none']).toContain(analysis.recommendation);

            // Use the recommended algorithm
            const compressed = await compress(testData, { algorithm: analysis.recommendation });
            expect(compressed.algorithm).toBe(analysis.recommendation);

            // Verify the compression was effective
            if (analysis.recommendation !== 'none') {
                expect(compressed.compressionRatio).toBeLessThan(0.9);
            }
        });

        test('should handle compression analysis for different data types', async () => {
            const testCases = [
                { data: generateTestData(100, 'repetitive'), expected: 'brotli' },
                { data: generateTestData(100, 'random'), expected: 'none' },
                { data: 'tiny', expected: 'none' }
            ];

            for (const { data, expected } of testCases) {
                const analysis = await import('../compression').then(m => m.analyzeCompression(data));

                if (expected === 'none') {
                    expect(analysis.recommendation).toBe('none');
                } else {
                    expect(['gzip', 'brotli']).toContain(analysis.recommendation);
                }
            }
        });
    });

    describe('Compression Analysis Integration', () => {
        test('should analyze compression effectiveness in pipeline', async () => {
            const testData = generateTestData(3000, 'repetitive');

            // Analyze compression before using it
            const analysis = await import('../compression').then(m => m.analyzeCompression(testData));

            expect(analysis.originalSize).toBe(testData.length);
            expect(analysis.recommendation).toBe('brotli'); // Should recommend brotli for repetitive data

            // Use the recommended algorithm
            const compressed = await compress(testData, { algorithm: analysis.recommendation });
            expect(compressed.algorithm).toBe(analysis.recommendation);

            // Verify the compression was effective
            expect(compressed.compressionRatio).toBeLessThan(0.8);
        });

        test('should handle compression analysis for different data types', async () => {
            const testCases = [
                { data: generateTestData(100, 'repetitive'), expected: 'brotli' },
                { data: generateTestData(100, 'random'), expected: 'none' },
                { data: 'tiny', expected: 'none' }
            ];

            for (const { data, expected } of testCases) {
                const analysis = await import('../compression').then(m => m.analyzeCompression(data));

                if (expected === 'none') {
                    expect(analysis.recommendation).toBe('none');
                } else {
                    expect(['gzip', 'brotli']).toContain(analysis.recommendation);
                }
            }
        });
    });

    describe('Error Handling', () => {
        test('should handle compression failures gracefully', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = 'test data';

            // Should still work through the pipeline even with compression issues
            const encrypted = await client.encrypt(testData);
            const decrypted = await client.decrypt(encrypted);

            expect(decrypted).toBe(testData);
        });
    });

    describe('Performance Tests', () => {
        test('should handle large data efficiently', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const largeData = generateTestData(10000, 'repetitive');

            const startTime = performance.now();

            // Full pipeline
            const encrypted = await client.encrypt(largeData);
            const decrypted = await client.decrypt(encrypted);

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(decrypted).toBe(largeData);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize);
        });

        test('should maintain data integrity through multiple cycles', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const testData = generateTestData(1000, 'mixed');

            // Multiple encryption/decryption cycles
            let currentData = testData;
            for (let i = 0; i < 3; i++) {
                const encrypted = await client.encrypt(currentData);
                const decrypted = await client.decrypt(encrypted);
                currentData = decrypted;
            }

            expect(currentData).toBe(testData);
        });
    });
}); 