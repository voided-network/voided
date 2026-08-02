import {
    VoidedE2EEClient,
    EncryptedBlob
} from '../index';
import { InMemoryStorage } from './test-utils';

// Production-scale test configuration
const PRODUCTION_CONFIG = {
    // Data sizes
    HUGE_DATA_SIZE: 10 * 1024 * 1024, // 10MB (practical limit for browser)
    MASSIVE_DATA_SIZE: 25 * 1024 * 1024, // 25MB (upper test limit)

    // Concurrency levels
    HIGH_CONCURRENCY: 100,
    EXTREME_CONCURRENCY: 1000,

    // Time limits
    EXTREME_TIMEOUT: 60000, // 60 seconds
    MARATHON_TIMEOUT: 300000, // 5 minutes

    // Memory limits
    MAX_MEMORY_USAGE_MB: 500,

    // Performance thresholds
    THROUGHPUT_MB_PER_SEC: 1, // Minimum 1 MB/sec
    LATENCY_MS_MAX: 10000, // 10 seconds max for large operations

    // Reliability
    ERROR_RATE_THRESHOLD: 0.01, // 1% error rate max

    // Load testing
    SUSTAINED_OPERATIONS: 10000,
    BURST_OPERATIONS: 1000,

    // Real-world patterns
    TYPICAL_MESSAGE_SIZE: 1000, // 1KB
    TYPICAL_FILE_SIZE: 100 * 1024, // 100KB
    LARGE_FILE_SIZE: 10 * 1024 * 1024, // 10MB
};

// Memory monitoring utilities
class MemoryMonitor {
    private samples: number[] = [];
    private interval?: NodeJS.Timeout;

    start() {
        this.samples = [];
        this.interval = setInterval(() => {
            if (typeof performance !== 'undefined' && (performance as any).memory) {
                this.samples.push((performance as any).memory.usedJSHeapSize);
            }
        }, 100);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }

    getStats() {
        if (this.samples.length === 0) return { avg: 0, max: 0, min: 0 };

        const avg = this.samples.reduce((a, b) => a + b) / this.samples.length;
        const max = Math.max(...this.samples);
        const min = Math.min(...this.samples);

        return {
            avg: avg / 1024 / 1024, // MB
            max: max / 1024 / 1024, // MB
            min: min / 1024 / 1024, // MB
        };
    }
}

// Data generators for production scenarios
class ProductionDataGenerator {
    static generateRealisticData(size: number, pattern: 'text' | 'json' | 'binary' | 'mixed'): string | Uint8Array {
        switch (pattern) {
            case 'text':
                // Realistic text with varying compression ratios - OPTIMIZED VERSION
                const sentences = [
                    'This is a typical user message that might be sent in a chat application.',
                    'Users often send similar messages with slight variations.',
                    'Some messages contain emojis 😀 and special characters.',
                    'Business documents contain structured information with repeated patterns.',
                    'Log files have timestamps and similar formatting patterns.',
                ];

                // Calculate how many full sentences we need
                const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
                const numSentences = Math.ceil(size / avgSentenceLength);

                // Build the text more efficiently
                const textParts: string[] = [];
                for (let i = 0; i < numSentences; i++) {
                    const sentence = sentences[i % sentences.length];
                    textParts.push(sentence + ' ');
                }

                const fullText = textParts.join('');
                return fullText.substring(0, size);

            case 'json':
                // Realistic JSON data structure
                const records: any[] = [];
                const recordSize = 200; // Approximate size per record
                const numRecords = Math.ceil(size / recordSize);

                for (let i = 0; i < numRecords; i++) {
                    records.push({
                        id: i,
                        userId: `user_${i}`,
                        timestamp: Date.now() + i * 1000,
                        message: `Message ${i} with some content`,
                        metadata: {
                            ip: `192.168.1.${i % 255}`,
                            userAgent: 'Mozilla/5.0 (compatible)',
                            sessionId: `session_${Math.floor(i / 10)}`,
                        },
                        tags: [`tag${i % 5}`, `category${i % 3}`],
                        active: i % 2 === 0,
                        score: Math.random() * 100,
                    });
                }

                return JSON.stringify(records).substring(0, size);

            case 'binary':
                // Realistic binary data with patterns
                const binary = new Uint8Array(size);
                const patterns = [
                    () => Math.floor(Math.random() * 256), // Random
                    (i: number) => i % 256, // Sequential
                    (i: number) => i % 2 === 0 ? 0 : 255, // Alternating
                    () => 0, // Null bytes
                ];

                for (let i = 0; i < size; i++) {
                    const patternIndex = Math.floor(i / 1000) % patterns.length;
                    binary[i] = patterns[patternIndex](i);
                }

                return binary;

            case 'mixed':
                // Mixed content simulating real-world data - OPTIMIZED VERSION
                const textPart = this.generateRealisticData(size * 0.4, 'text') as string;
                const jsonPart = this.generateRealisticData(size * 0.3, 'json') as string;
                const binaryPart = this.generateRealisticData(size * 0.3, 'binary') as Uint8Array;

                // Combine efficiently without creating massive arrays
                let result = textPart + jsonPart;
                for (let i = 0; i < binaryPart.length; i++) {
                    result += String.fromCharCode(binaryPart[i]);
                }
                return result;

            default:
                return 'default data'.repeat(Math.ceil(size / 12)).substring(0, size);
        }
    }

    static generateUserScenarios(count: number) {
        const scenarios: any[] = [];

        for (let i = 0; i < count; i++) {
            const scenario = {
                userId: `user_${i}`,
                messageCount: Math.floor(Math.random() * 100) + 10,
                averageMessageSize: Math.floor(Math.random() * 1000) + 100,
                fileCount: Math.floor(Math.random() * 10),
                averageFileSize: Math.floor(Math.random() * 1000000) + 10000,
                keyRotationFrequency: Math.floor(Math.random() * 7) + 1, // Days
            };

            scenarios.push(scenario);
        }

        return scenarios;
    }
}

describe('Production-Scale E2EE Tests', () => {
    let memoryMonitor: MemoryMonitor;

    beforeEach(() => {
        memoryMonitor = new MemoryMonitor();
    });

    afterEach(() => {
        memoryMonitor.stop();
    });

    describe('Massive Data Tests', () => {
        test('should handle 10MB data with acceptable performance', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const largeData = ProductionDataGenerator.generateRealisticData(
                PRODUCTION_CONFIG.HUGE_DATA_SIZE,
                'text'
            ) as string;

            memoryMonitor.start();
            const startTime = performance.now();

            const encrypted = await client.encrypt(largeData, {
                forceCompression: true,
                compressionAlgorithm: 'gzip'
            });
            const decrypted = await client.decrypt(encrypted);

            const endTime = performance.now();
            const duration = endTime - startTime;

            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Performance assertions
            expect(duration).toBeLessThan(PRODUCTION_CONFIG.LATENCY_MS_MAX);
            expect(decrypted).toBe(largeData);

            // Memory assertions
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB);

            // Throughput assertions
            const throughputMBPerSec = (PRODUCTION_CONFIG.HUGE_DATA_SIZE / 1024 / 1024) / (duration / 1000);
            expect(throughputMBPerSec).toBeGreaterThan(PRODUCTION_CONFIG.THROUGHPUT_MB_PER_SEC);

            // Compression effectiveness
            expect(encrypted.compression.compressedSize).toBeLessThan(encrypted.compression.originalSize);
        }, PRODUCTION_CONFIG.EXTREME_TIMEOUT);

        test('should handle 25MB data near upper test limit', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const massiveData = ProductionDataGenerator.generateRealisticData(
                PRODUCTION_CONFIG.MASSIVE_DATA_SIZE,
                'text'
            ) as string;

            memoryMonitor.start();
            const startTime = performance.now();

            const encrypted = await client.encrypt(massiveData);
            const decrypted = await client.decrypt(encrypted);

            const endTime = performance.now();
            const duration = endTime - startTime;

            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Performance assertions (more lenient for upper test size)
            expect(duration).toBeLessThan(PRODUCTION_CONFIG.MARATHON_TIMEOUT / 2);
            expect(decrypted).toBe(massiveData);

            // Memory should not exceed reasonable limits
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB);

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });

    describe('Extreme Concurrency Tests', () => {
        test('should handle 100 concurrent encryption operations', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operations: Promise<{ success: boolean; originalSize: number; compressedSize: number }>[] = [];

            memoryMonitor.start();
            const startTime = performance.now();

            for (let i = 0; i < PRODUCTION_CONFIG.HIGH_CONCURRENCY; i++) {
                const data = ProductionDataGenerator.generateRealisticData(
                    PRODUCTION_CONFIG.TYPICAL_MESSAGE_SIZE,
                    'text'
                ) as string;

                operations.push(
                    client.encrypt(data).then(encrypted =>
                        client.decrypt(encrypted).then(decrypted => ({
                            success: decrypted === data,
                            originalSize: data.length,
                            compressedSize: encrypted.compression.compressedSize,
                        }))
                    )
                );
            }

            const results = await Promise.all(operations);
            const endTime = performance.now();

            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // All operations should succeed
            const successRate = results.filter(r => r.success).length / results.length;
            expect(successRate).toBeGreaterThan(1 - PRODUCTION_CONFIG.ERROR_RATE_THRESHOLD);

            // Performance should be reasonable
            const avgTimePerOp = (endTime - startTime) / PRODUCTION_CONFIG.HIGH_CONCURRENCY;
            expect(avgTimePerOp).toBeLessThan(100); // 100ms per operation

            // Memory should be reasonable
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB);

            // log removed
        }, PRODUCTION_CONFIG.EXTREME_TIMEOUT);

        test('should handle 1000 concurrent operations with graceful degradation', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            let successCount = 0;
            let errorCount = 0;

            memoryMonitor.start();
            const startTime = performance.now();

            // Create operations in batches to avoid overwhelming the system
            const batchSize = 50;
            const numBatches = Math.ceil(PRODUCTION_CONFIG.EXTREME_CONCURRENCY / batchSize);

            for (let batch = 0; batch < numBatches; batch++) {
                const batchOperations: Promise<void>[] = [];

                for (let i = 0; i < batchSize && (batch * batchSize + i) < PRODUCTION_CONFIG.EXTREME_CONCURRENCY; i++) {
                    const data = ProductionDataGenerator.generateRealisticData(
                        PRODUCTION_CONFIG.TYPICAL_MESSAGE_SIZE,
                        'text'
                    ) as string;

                    batchOperations.push(
                        client.encrypt(data)
                            .then(encrypted => client.decrypt(encrypted))
                            .then(decrypted => {
                                if (decrypted === data) {
                                    successCount++;
                                } else {
                                    errorCount++;
                                }
                            })
                            .catch(() => {
                                errorCount++;
                            })
                    );
                }

                // Process batch
                await Promise.all(batchOperations);

                // Brief pause between batches to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            const endTime = performance.now();
            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Calculate success rate
            const successRate = successCount / (successCount + errorCount);

            // Should handle most operations successfully
            expect(successRate).toBeGreaterThan(0.9); // 90% success rate minimum

            // Memory should not explode
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB * 2);
            expect(endTime - startTime).toBeLessThan(PRODUCTION_CONFIG.MARATHON_TIMEOUT);

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });

    describe('Sustained Load Tests', () => {
        test('should handle sustained operations over time', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operationCount = 1000;
            const results: any[] = [];

            memoryMonitor.start();
            const startTime = performance.now();

            for (let i = 0; i < operationCount; i++) {
                const data = ProductionDataGenerator.generateRealisticData(
                    PRODUCTION_CONFIG.TYPICAL_MESSAGE_SIZE,
                    i % 2 === 0 ? 'text' : 'json'
                ) as string;

                const opStartTime = performance.now();

                try {
                    const encrypted = await client.encrypt(data);
                    const decrypted = await client.decrypt(encrypted);

                    const opEndTime = performance.now();
                    const opDuration = opEndTime - opStartTime;

                    results.push({
                        success: decrypted === data,
                        duration: opDuration,
                        compressionRatio: encrypted.compression.compressedSize / encrypted.compression.originalSize,
                    });
                } catch (error) {
                    results.push({
                        success: false,
                        duration: performance.now() - opStartTime,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }

                // Brief pause to simulate realistic usage
                if (i % 100 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1));
                }
            }

            const endTime = performance.now();
            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Analyze results
            const successRate = results.filter(r => r.success).length / results.length;
            const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
            const maxDuration = Math.max(...results.map(r => r.duration));

            // Performance should not degrade significantly
            expect(successRate).toBeGreaterThan(0.99); // 99% success rate
            expect(avgDuration).toBeLessThan(100); // 100ms average
            expect(maxDuration).toBeLessThan(1000); // 1s max

            // Memory should be stable
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB);
            expect(endTime - startTime).toBeLessThan(PRODUCTION_CONFIG.MARATHON_TIMEOUT);

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });

    describe('Real-World User Scenarios', () => {
        test('should handle realistic user workloads', async () => {
            const userScenarios = ProductionDataGenerator.generateUserScenarios(10);
            const clients = userScenarios.map(() => new VoidedE2EEClient({ storage: new InMemoryStorage() }));

            memoryMonitor.start();
            const startTime = performance.now();

            const userOperations = userScenarios.map(async (scenario, index) => {
                const client = clients[index];
                const results: any[] = [];

                // Simulate user's daily operations
                for (let i = 0; i < scenario.messageCount; i++) {
                    const messageData = ProductionDataGenerator.generateRealisticData(
                        scenario.averageMessageSize,
                        'text'
                    ) as string;

                    const encrypted = await client.encrypt(messageData);
                    const decrypted = await client.decrypt(encrypted);

                    results.push({
                        success: decrypted === messageData,
                        type: 'message',
                        size: messageData.length,
                    });
                }

                // Simulate file operations
                for (let i = 0; i < scenario.fileCount; i++) {
                    const fileData = ProductionDataGenerator.generateRealisticData(
                        scenario.averageFileSize,
                        'mixed'
                    ) as string;

                    const encrypted = await client.encrypt(fileData);
                    const decrypted = await client.decrypt(encrypted);

                    results.push({
                        success: decrypted === fileData,
                        type: 'file',
                        size: fileData.length,
                    });
                }

                return results;
            });

            const allResults = await Promise.all(userOperations);
            const endTime = performance.now();

            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Flatten and analyze results
            const flatResults = allResults.flat();
            const successRate = flatResults.filter(r => r.success).length / flatResults.length;
            const totalOperations = flatResults.length;

            // Should handle realistic workloads successfully
            expect(successRate).toBeGreaterThan(0.99);
            expect(totalOperations).toBeGreaterThan(100); // Should have processed significant operations

            // Memory should be reasonable
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB * 1.5);
            expect(endTime - startTime).toBeLessThan(PRODUCTION_CONFIG.MARATHON_TIMEOUT);

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });

    describe('Advanced Security Under Load', () => {
        test('should maintain security features under extreme load', async () => {
            const client = new VoidedE2EEClient({
                storage: new InMemoryStorage(),
                enableSignatures: true
            });

            // Generate keys for advanced features
            const signingPublicKey = await client.generateSigningKeys();
            await client.setTrustedSigningPublicKey(signingPublicKey);
            await client.generateAgreementKeys();

            memoryMonitor.start();
            const startTime = performance.now();

            const operations: any[] = [];
            const numOperations = 100;

            for (let i = 0; i < numOperations; i++) {
                const data = ProductionDataGenerator.generateRealisticData(
                    PRODUCTION_CONFIG.TYPICAL_FILE_SIZE,
                    'json'
                ) as string;

                operations.push(
                    client.encrypt(data).then(encrypted => {
                        // Verify advanced security features are present
                        const hasSignature = encrypted.signature !== undefined;

                        return client.decrypt(encrypted).then(decrypted => ({
                            success: decrypted === data,
                            hasSignature,
                            compressionRatio: encrypted.compression.compressedSize / encrypted.compression.originalSize,
                        }));
                    })
                );
            }

            const results = await Promise.all(operations);
            const endTime = performance.now();

            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // All operations should succeed
            const successRate = results.filter(r => r.success).length / results.length;
            expect(successRate).toBe(1.0); // 100% success rate expected

            // All should have advanced security features
            const signatureRate = results.filter(r => r.hasSignature).length / results.length;

            expect(signatureRate).toBe(1.0); // All should have signatures
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB * 2);

            // Performance should still be reasonable
            const avgTimePerOp = (endTime - startTime) / numOperations;
            expect(avgTimePerOp).toBeLessThan(1000); // 1s per operation max

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });

    describe('Resource Exhaustion Tests', () => {
        test('should handle memory pressure gracefully', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operations: Promise<{ encrypted: EncryptedBlob; originalSize: number }>[] = [];

            memoryMonitor.start();

            // Create memory pressure by keeping many large encrypted objects in memory
            // Reduced from 50 to 10 to prevent memory exhaustion
            for (let i = 0; i < 10; i++) {
                const largeData = ProductionDataGenerator.generateRealisticData(
                    PRODUCTION_CONFIG.LARGE_FILE_SIZE,
                    'mixed'
                ) as string;

                operations.push(
                    client.encrypt(largeData).then(encrypted => {
                        // Keep encrypted data in memory to create pressure
                        return { encrypted, originalSize: largeData.length };
                    })
                );
            }

            const results = await Promise.all(operations);

            // Now try to decrypt all of them while memory pressure is high
            // Ensure a uniform result shape to avoid TypeError from `'error' in r` on primitives
            type DecryptResult = { ok: true; value: string } | { ok: false; error: string };
            const decryptOperations: Promise<DecryptResult>[] = results.map(({ encrypted }) =>
                client
                    .decrypt(encrypted)
                    .then((value: unknown) => ({ ok: true, value: String(value) } as const)
                    )
                    .catch((error: unknown) => ({ ok: false, error: String(error) } as const)
                    )
            );

            const decryptResults = await Promise.all(decryptOperations);

            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Should handle most operations even under memory pressure
            const successfulDecrypts = decryptResults.filter(r => r.ok).length;
            const successRate = successfulDecrypts / decryptResults.length;

            expect(successRate).toBeGreaterThan(0.8); // 80% success rate minimum under pressure
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB * 2);

            // Clean up references to free memory
            results.length = 0;
            decryptResults.length = 0;

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });

    describe('Long-Running Stability Tests', () => {
        test('should maintain performance over extended periods', async () => {
            const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
            const operationIntervals = [10, 100, 1000]; // Different operation intervals
            const results: any[] = [];

            memoryMonitor.start();
            const startTime = performance.now();

            for (const interval of operationIntervals) {
                const intervalResults: any[] = [];

                for (let i = 0; i < interval; i++) {
                    const data = ProductionDataGenerator.generateRealisticData(
                        PRODUCTION_CONFIG.TYPICAL_MESSAGE_SIZE,
                        'text'
                    ) as string;

                    const opStartTime = performance.now();

                    try {
                        const encrypted = await client.encrypt(data);
                        const decrypted = await client.decrypt(encrypted);

                        intervalResults.push({
                            success: decrypted === data,
                            duration: performance.now() - opStartTime,
                            interval,
                        });
                    } catch (error) {
                        intervalResults.push({
                            success: false,
                            duration: performance.now() - opStartTime,
                            interval,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }

                results.push(...intervalResults);

                // Brief pause between intervals
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            const endTime = performance.now();
            memoryMonitor.stop();
            const memStats = memoryMonitor.getStats();

            // Analyze performance over time
            const successRate = results.filter(r => r.success).length / results.length;
            const avgDurations = operationIntervals.map(interval => {
                const intervalResults = results.filter(r => r.interval === interval);
                return intervalResults.reduce((sum, r) => sum + r.duration, 0) / intervalResults.length;
            });

            // Performance should not degrade significantly over time
            expect(successRate).toBeGreaterThan(0.99);
            expect(endTime - startTime).toBeLessThan(PRODUCTION_CONFIG.MARATHON_TIMEOUT);
            expect(memStats.max).toBeLessThan(PRODUCTION_CONFIG.MAX_MEMORY_USAGE_MB * 2);

            // Later intervals should not be significantly slower
            const performanceDegradation = avgDurations[avgDurations.length - 1] / avgDurations[0];
            expect(performanceDegradation).toBeLessThan(2.0); // Max 2x slowdown

            // log removed
        }, PRODUCTION_CONFIG.MARATHON_TIMEOUT);
    });
});
