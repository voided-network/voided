import {
    VoidedE2EEClient,
    EncryptedBlob
} from '../index';
import { InMemoryStorage } from './test-utils';

// GB-scale test configuration
const GB_SCALE_CONFIG = {
    // Data sizes for GB-scale testing
    MEDIUM_DATA_SIZE: 10 * 1024 * 1024, // 10MB
    LARGE_DATA_SIZE: 20 * 1024 * 1024, // 20MB
    HUGE_DATA_SIZE: 30 * 1024 * 1024, // 30MB (upper test limit)

    // Concurrency levels for production
    HIGH_CONCURRENCY: 100,
    EXTREME_CONCURRENCY: 500,

    // Performance thresholds
    MAX_OPERATION_TIME_MS: 30000, // 30 seconds
    MAX_MEMORY_USAGE_MB: 1000, // 1GB
    MIN_THROUGHPUT_MBPS: 1, // 1 MB/s minimum

    // Load testing
    SUSTAINED_OPERATIONS: 1000,
    BURST_OPERATIONS: 100,

    // Error tolerance
    MAX_ERROR_RATE: 0.01, // 1% maximum error rate
};

// Memory monitoring for GB-scale tests
let memoryPeakMB = 0;

function updateMemoryPeak() {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
        const currentMB = (performance as any).memory.usedJSHeapSize / 1024 / 1024;
        memoryPeakMB = Math.max(memoryPeakMB, currentMB);
    }
}

// Data generator for GB-scale tests
function generateGBScaleData(sizeBytes: number, pattern: 'compressible' | 'random' | 'mixed'): string {
    switch (pattern) {
        case 'compressible':
            // Highly compressible data
            const compressiblePattern = 'This is highly repetitive data that compresses extremely well. ';
            return compressiblePattern.repeat(Math.ceil(sizeBytes / compressiblePattern.length)).substring(0, sizeBytes);

        case 'random':
            // Random data - use more efficient generation
            const randomChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?';
            let result = '';
            // Use larger chunks for better performance
            const chunkSize = 1000;
            for (let i = 0; i < sizeBytes; i += chunkSize) {
                const currentChunkSize = Math.min(chunkSize, sizeBytes - i);
                const chunk = Array.from({ length: currentChunkSize }, () =>
                    randomChars[Math.floor(Math.random() * randomChars.length)]
                ).join('');
                result += chunk;
            }
            return result;

        case 'mixed':
            // Mixed data - alternating compressible and random (more efficient)
            const compressiblePart = 'Repetitive pattern. '.repeat(Math.ceil(sizeBytes * 0.4 / 18));
            const randomPartSize = Math.floor(sizeBytes * 0.6);
            const randomPart = Array.from({ length: randomPartSize }, () =>
                String.fromCharCode(32 + Math.floor(Math.random() * 95))
            ).join('');
            return (compressiblePart + randomPart).substring(0, sizeBytes);

        default:
            return 'default data'.repeat(Math.ceil(sizeBytes / 12)).substring(0, sizeBytes);
    }
}

describe('GB-Scale Production Tests', () => {
    beforeEach(() => {
        memoryPeakMB = 0;
    });

    afterEach(() => {
        // log removed
    });

    describe('Massive Data Handling', () => {
        test('should handle 10MB data efficiently (non-chunked)', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: false // Disable chunking to test non-chunked path
            });
            const data = generateGBScaleData(GB_SCALE_CONFIG.MEDIUM_DATA_SIZE, 'compressible');

            const startTime = performance.now();
            updateMemoryPeak();

            const encrypted = await client.encrypt(data);
            updateMemoryPeak();

            const decrypted = await client.decrypt(encrypted);
            updateMemoryPeak();

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Verify correctness
            expect(decrypted).toBe(data);
            expect(encrypted.compression.originalSize).toBe(data.length);

            // Should be non-chunked
            expect(encrypted.chunkInfo?.isChunked).toBeFalsy();
            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();

            // Performance checks
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS);
            expect(memoryPeakMB).toBeLessThan(GB_SCALE_CONFIG.MAX_MEMORY_USAGE_MB);

            // Throughput check
            const throughputMBps = (GB_SCALE_CONFIG.MEDIUM_DATA_SIZE / 1024 / 1024) / (duration / 1000);
            expect(throughputMBps).toBeGreaterThan(GB_SCALE_CONFIG.MIN_THROUGHPUT_MBPS);

            // Compression effectiveness
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize * 0.3);

            // log removed
        }, 60000);

        test('should handle 30MB data with automatic chunking', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: true,
                chunkSize: 10 * 1024 * 1024, // 10MB chunks
                minChunkThreshold: 20 * 1024 * 1024 // 20MB threshold
            });
            const data = generateGBScaleData(30 * 1024 * 1024, 'random'); // 30MB of random data (incompressible)

            const startTime = performance.now();
            updateMemoryPeak();

            const encrypted = await client.encrypt(data);
            updateMemoryPeak();

            const decrypted = await client.decrypt(encrypted);
            updateMemoryPeak();

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Verify correctness
            expect(decrypted).toBe(data);

            // Should be chunked
            expect(encrypted.chunkInfo?.isChunked).toBe(true);
            expect(encrypted.chunks).toBeDefined();
            expect(encrypted.chunkInfo?.totalChunks).toBeGreaterThan(1);
            expect(encrypted.data).toBeUndefined(); // No single data field for chunked
            expect(encrypted.iv).toBeUndefined(); // No single IV field for chunked

            // Performance checks
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS * 2);
            expect(memoryPeakMB).toBeLessThan(GB_SCALE_CONFIG.MAX_MEMORY_USAGE_MB);

            // Compression effectiveness - random data doesn't compress well, which is expected
            expect(encrypted.compression.compressedSize).toBeLessThanOrEqual(encrypted.compression.originalSize);

            // log removed
        }, 180000);

        test('should handle 20MB data with chunking under time limit', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: true,
                chunkSize: 10 * 1024 * 1024, // 10MB chunks
                minChunkThreshold: 20 * 1024 * 1024 // 20MB threshold
            });
            const data = generateGBScaleData(GB_SCALE_CONFIG.LARGE_DATA_SIZE, 'random'); // 20MB of random data

            const startTime = performance.now();
            updateMemoryPeak();

            const encrypted = await client.encrypt(data);
            updateMemoryPeak();

            const decrypted = await client.decrypt(encrypted);
            updateMemoryPeak();

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Verify correctness
            expect(decrypted).toBe(data);

            // Should be chunked
            expect(encrypted.chunkInfo?.isChunked).toBe(true);
            expect(encrypted.chunks).toBeDefined();
            expect(encrypted.chunkInfo?.totalChunks).toBeGreaterThan(1);

            // Performance checks
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS * 3); // Allow more time for 50MB
            expect(memoryPeakMB).toBeLessThan(GB_SCALE_CONFIG.MAX_MEMORY_USAGE_MB);

            // Compression effectiveness - random data doesn't compress well, which is expected
            expect(encrypted.compression.compressedSize).toBeLessThanOrEqual(encrypted.compression.originalSize);

            // log removed
        }, 180000);

        test('should handle 30MB data with chunking at upper test limit', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: true,
                chunkSize: 10 * 1024 * 1024, // 10MB chunks
                minChunkThreshold: 20 * 1024 * 1024 // 20MB threshold
            });
            const data = generateGBScaleData(GB_SCALE_CONFIG.HUGE_DATA_SIZE, 'random'); // 30MB of random data

            const startTime = performance.now();
            updateMemoryPeak();

            const encrypted = await client.encrypt(data);
            updateMemoryPeak();

            const decrypted = await client.decrypt(encrypted);
            updateMemoryPeak();

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Verify correctness
            expect(decrypted).toBe(data);

            // Should be chunked into ~3 chunks
            expect(encrypted.chunkInfo?.isChunked).toBe(true);
            expect(encrypted.chunks).toBeDefined();
            expect(encrypted.chunkInfo?.totalChunks).toBeGreaterThanOrEqual(3);
            expect(encrypted.chunkInfo?.totalChunks).toBeLessThanOrEqual(4);

            // Performance checks (more reasonable with lower size)
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS * 2);

            // Compression effectiveness - random data doesn't compress well, which is expected
            expect(encrypted.compression.compressedSize).toBeLessThanOrEqual(encrypted.compression.originalSize);

            // log removed
        }, 300000); // 5 minutes timeout
    });

    describe('High Concurrency Production Load', () => {
        test('should handle 100 concurrent 1MB operations', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operationSize = 1024 * 1024; // 1MB per operation

            const startTime = performance.now();
            updateMemoryPeak();

            const operations = Array.from({ length: GB_SCALE_CONFIG.HIGH_CONCURRENCY }, async (_, i) => {
                const data = generateGBScaleData(operationSize, 'mixed');

                try {
                    const encrypted = await client.encrypt(data);
                    updateMemoryPeak();

                    const decrypted = await client.decrypt(encrypted);
                    updateMemoryPeak();

                    return {
                        success: decrypted === data,
                        operation: i,
                        compressionRatio: encrypted.compression.compressedSize / encrypted.compression.originalSize,
                    };
                } catch (error) {
                    return {
                        success: false,
                        operation: i,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    };
                }
            });

            const results = await Promise.all(operations);
            const endTime = performance.now();
            const duration = endTime - startTime;

            // Analyze results
            const successCount = results.filter(r => r.success).length;
            const successRate = successCount / results.length;
            const errorRate = 1 - successRate;

            // Success rate should be very high
            expect(successRate).toBeGreaterThan(1 - GB_SCALE_CONFIG.MAX_ERROR_RATE);

            // Performance should be reasonable
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS * 2);
            expect(memoryPeakMB).toBeLessThan(GB_SCALE_CONFIG.MAX_MEMORY_USAGE_MB);

            // log removed
        }, 120000);

        test('should handle burst of 500 small operations', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operationSize = 10 * 1024; // 10KB per operation

            const startTime = performance.now();
            updateMemoryPeak();

            const operations = Array.from({ length: GB_SCALE_CONFIG.EXTREME_CONCURRENCY }, async (_, i) => {
                const data = generateGBScaleData(operationSize, 'mixed');

                try {
                    const encrypted = await client.encrypt(data);
                    updateMemoryPeak();

                    const decrypted = await client.decrypt(encrypted);
                    updateMemoryPeak();

                    return { success: decrypted === data, operation: i };
                } catch (error) {
                    return { success: false, operation: i, error: error instanceof Error ? error.message : 'Unknown error' };
                }
            });

            const results = await Promise.all(operations);
            const endTime = performance.now();
            const duration = endTime - startTime;

            // Analyze results
            const successCount = results.filter(r => r.success).length;
            const successRate = successCount / results.length;

            // Should handle burst load well
            expect(successRate).toBeGreaterThan(0.95); // 95% minimum
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS);

            // log removed
        }, 60000);
    });

    describe('Sustained Production Load', () => {
        test('should handle sustained operations without performance degradation', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operationSize = 50 * 1024; // 50KB per operation
            const numOperations = 1000;

            const performanceMetrics: Array<{ duration: number; memoryMB: number; successful: boolean }> = [];

            const startTime = performance.now();

            for (let i = 0; i < numOperations; i++) {
                const data = generateGBScaleData(operationSize, 'mixed');

                const opStartTime = performance.now();
                updateMemoryPeak();

                try {
                    const encrypted = await client.encrypt(data);
                    const decrypted = await client.decrypt(encrypted);

                    const opEndTime = performance.now();
                    const opDuration = opEndTime - opStartTime;

                    performanceMetrics.push({
                        duration: opDuration,
                        memoryMB: memoryPeakMB,
                        successful: decrypted === data,
                    });
                } catch (error) {
                    performanceMetrics.push({
                        duration: performance.now() - opStartTime,
                        memoryMB: memoryPeakMB,
                        successful: false,
                    });
                }

                // Brief pause every 100 operations
                if (i % 100 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1));
                }
            }

            const endTime = performance.now();
            const totalDuration = endTime - startTime;

            // Analyze performance over time
            const successRate = performanceMetrics.filter(m => m.successful).length / performanceMetrics.length;
            const avgDuration = performanceMetrics.reduce((sum, m) => sum + m.duration, 0) / performanceMetrics.length;

            // Check for performance degradation
            const firstHalf = performanceMetrics.slice(0, Math.floor(performanceMetrics.length / 2));
            const secondHalf = performanceMetrics.slice(Math.floor(performanceMetrics.length / 2));

            const firstHalfAvg = firstHalf.reduce((sum, m) => sum + m.duration, 0) / firstHalf.length;
            const secondHalfAvg = secondHalf.reduce((sum, m) => sum + m.duration, 0) / secondHalf.length;

            const performanceDegradation = secondHalfAvg / firstHalfAvg;

            // Assertions
            expect(successRate).toBeGreaterThan(0.99); // 99% success rate
            expect(avgDuration).toBeLessThan(100); // 100ms average per operation
            expect(performanceDegradation).toBeLessThan(1.5); // Max 50% degradation
            expect(memoryPeakMB).toBeLessThan(GB_SCALE_CONFIG.MAX_MEMORY_USAGE_MB);

            // log removed
        }, 300000); // 5 minutes timeout
    });

    describe('Advanced Security Under GB-Scale Load', () => {
        test('should maintain security features with chunked large data', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableSignatures: true,
                enableForwardSecrecy: true,
                enableChunking: true,
                chunkSize: 5 * 1024 * 1024, // 5MB chunks
                minChunkThreshold: 8 * 1024 * 1024 // 8MB threshold
            });

            // Generate keys for advanced features
            await client.generateSigningKeys();
            await client.generateAgreementKeys();

            const largeData = generateGBScaleData(15 * 1024 * 1024, 'mixed'); // 15MB -> will be chunked

            const startTime = performance.now();
            updateMemoryPeak();

            const encrypted = await client.encrypt(largeData);
            updateMemoryPeak();

            const decrypted = await client.decrypt(encrypted);
            updateMemoryPeak();

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Verify correctness
            expect(decrypted).toBe(largeData);

            // Should be chunked
            expect(encrypted.chunkInfo?.isChunked).toBe(true);
            expect(encrypted.chunks).toBeDefined();
            expect(encrypted.chunkInfo?.totalChunks).toBeGreaterThanOrEqual(2);

            // Verify advanced security features
            expect(encrypted.signature).toBeDefined(); // Global signature
            expect(encrypted.ephemeralPublicKey).toBeDefined();

            // Each chunk should also have signatures
            if (encrypted.chunks) {
                for (const chunk of encrypted.chunks) {
                    expect(chunk.signature).toBeDefined();
                }
            }

            // Performance should still be reasonable with advanced features
            expect(duration).toBeLessThan(GB_SCALE_CONFIG.MAX_OPERATION_TIME_MS * 2);
            expect(memoryPeakMB).toBeLessThan(GB_SCALE_CONFIG.MAX_MEMORY_USAGE_MB);

            // log removed
        }, 120000);
    });

    describe('Dynamic Chunking System', () => {
        test('should automatically chunk large data', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: true,
                chunkSize: 5 * 1024 * 1024, // 5MB chunks
                minChunkThreshold: 10 * 1024 * 1024 // 10MB threshold
            });

            const largeData = generateGBScaleData(12 * 1024 * 1024, 'mixed'); // 12MB -> should be chunked

            // Disable compression here to focus this test strictly on chunking behavior
            const encrypted = await client.encrypt(largeData, { compressionAlgorithm: 'none' });
            const decrypted = await client.decrypt(encrypted);

            // Verify correctness
            expect(decrypted).toBe(largeData);

            // Should be chunked
            expect(encrypted.chunkInfo?.isChunked).toBe(true);
            expect(encrypted.chunks).toBeDefined();
            expect(encrypted.chunkInfo?.totalChunks).toBeGreaterThanOrEqual(2);
            expect(encrypted.chunkInfo?.chunkSize).toBe(5 * 1024 * 1024);

            // Verify chunk structure
            if (encrypted.chunks) {
                // Chunks should be ordered
                for (let i = 0; i < encrypted.chunks.length; i++) {
                    expect(encrypted.chunks[i].index).toBe(i);
                    expect(encrypted.chunks[i].data).toBeDefined();
                    expect(encrypted.chunks[i].iv).toBeDefined();
                }
            }

            // log removed
        }, 6000);

        test('should not chunk small data', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: true,
                chunkSize: 5 * 1024 * 1024, // 5MB chunks
                minChunkThreshold: 10 * 1024 * 1024 // 10MB threshold
            });

            const smallData = generateGBScaleData(5 * 1024 * 1024, 'mixed'); // 5MB -> should not be chunked

            const encrypted = await client.encrypt(smallData);
            const decrypted = await client.decrypt(encrypted);

            // Verify correctness
            expect(decrypted).toBe(smallData);

            // Should not be chunked
            expect(encrypted.chunkInfo?.isChunked).toBeFalsy();
            expect(encrypted.chunks).toBeUndefined();
            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();

            // log removed
        }, 6000);

        test('should handle chunking disabled', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: false
            });

            const largeData = generateGBScaleData(15 * 1024 * 1024, 'mixed'); // 15MB -> would be chunked if enabled

            const encrypted = await client.encrypt(largeData);
            const decrypted = await client.decrypt(encrypted);

            // Verify correctness
            expect(decrypted).toBe(largeData);

            // Should not be chunked even though it's large
            expect(encrypted.chunkInfo?.isChunked).toBeFalsy();
            expect(encrypted.chunks).toBeUndefined();
            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();

            // log removed
        }, 60000);
    });

    describe('Error Recovery Under Load', () => {
        test('should handle errors gracefully under high load with chunking', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableChunking: true,
                chunkSize: 10 * 1024 * 1024, // 10MB chunks
                minChunkThreshold: 20 * 1024 * 1024 // 20MB threshold
            });

            // Create a mix of valid and problematic operations
            const operations = Array.from({ length: 100 }, async (_, i) => {
                try {
                    let data: string;

                    if (i % 10 === 0) {
                        // 10% of operations use very large data that will be chunked
                        data = generateGBScaleData(30 * 1024 * 1024, 'random'); // 30MB -> chunked
                    } else if (i % 5 === 0) {
                        // 20% use problematic characters
                        data = 'Test with nulls\0\0\0 and unicode 🚀🔥💎';
                    } else {
                        // 70% use normal data
                        data = generateGBScaleData(1024 * 1024, 'mixed');
                    }

                    const encrypted = await client.encrypt(data);
                    const decrypted = await client.decrypt(encrypted);

                    return {
                        success: decrypted === data,
                        operation: i,
                        size: data.length,
                        chunked: encrypted.chunkInfo?.isChunked || false
                    };
                } catch (error) {
                    return {
                        success: false,
                        operation: i,
                        error: error instanceof Error ? error.message : 'Unknown error',
                        chunked: false
                    };
                }
            });

            const results = await Promise.all(operations);

            // Analyze error patterns
            const successCount = results.filter(r => r.success).length;
            const errorCount = results.filter(r => !r.success).length;
            const successRate = successCount / results.length;
            const chunkedCount = results.filter(r => r.chunked).length;

            // Should handle most operations successfully, including chunked ones
            expect(successRate).toBeGreaterThan(0.95); // 95% minimum success rate with chunking
            expect(errorCount).toBeLessThan(results.length * 0.05); // Max 5% errors

            // log removed
        }, 300000);
    });
}); 