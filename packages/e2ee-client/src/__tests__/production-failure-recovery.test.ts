import {
    VoidedE2EEClient,
    E2EEStorage,
    MigrationState
} from '../index';
import { InMemoryStorage } from './test-utils';

// Mock storage that can simulate failures
class FailureSimulationStorage implements E2EEStorage {
    private baseStorage: E2EEStorage;
    private failureRate: number;
    private partialFailureRate: number;
    private corruptionRate: number;
    private networkDelay: number;
    private isDown: boolean = false;
    private failureCalls: number = 0;
    private failureHits: number = 0;
    // Deterministic corruption controller to reduce test flakiness
    private corruptionCalls: number = 0;
    private corruptionHits: number = 0;
    // Track key-specific corruption separately so getKey is corrupted at the intended rate
    private corruptionKeyCalls: number = 0;
    private corruptionKeyHits: number = 0;

    constructor(baseStorage: E2EEStorage = new InMemoryStorage()) {
        this.baseStorage = baseStorage;
        this.failureRate = 0;
        this.partialFailureRate = 0;
        this.corruptionRate = 0;
        this.networkDelay = 0;
    }

    setFailureRate(rate: number) {
        this.failureRate = rate;
        this.failureCalls = 0;
        this.failureHits = 0;
    }

    setPartialFailureRate(rate: number) {
        this.partialFailureRate = rate;
    }

    setCorruptionRate(rate: number) {
        this.corruptionRate = rate;
        // Reset deterministic controller whenever the rate changes
        this.corruptionCalls = 0;
        this.corruptionHits = 0;
        this.corruptionKeyCalls = 0;
        this.corruptionKeyHits = 0;
    }

    setNetworkDelay(delay: number) {
        this.networkDelay = delay;
    }

    setDown(down: boolean) {
        this.isDown = down;
    }

    private async simulateDelay() {
        if (this.networkDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.networkDelay));
        }
    }

    private shouldFail(): boolean {
        if (this.isDown) return true;
        this.failureCalls++;
        const desiredHits = Math.floor(this.failureRate * this.failureCalls);
        if (this.failureHits < desiredHits) {
            this.failureHits++;
            return true;
        }
        return false;
    }

    private shouldPartiallyFail(): boolean {
        return Math.random() < this.partialFailureRate;
    }

    private shouldCorrupt(): boolean {
        // Ensure approximately corruptionRate proportion of calls are corrupted deterministically
        this.corruptionCalls++;
        const desiredHits = Math.floor(this.corruptionRate * this.corruptionCalls);
        if (this.corruptionHits < desiredHits) {
            this.corruptionHits++;
            return true;
        }
        return false;
    }

    private shouldCorruptKey(): boolean {
        // Apply the corruption rate specifically to key retrievals (independent of other ops)
        this.corruptionKeyCalls++;
        const desiredHits = Math.floor(this.corruptionRate * this.corruptionKeyCalls);
        if (this.corruptionKeyHits < desiredHits) {
            this.corruptionKeyHits++;
            return true;
        }
        return false;
    }

    private corruptData(data: string): string {
        if (!this.shouldCorrupt()) return data;

        // Introduce corruption
        const corruption = Math.random();
        if (corruption < 0.33) {
            // Truncate data
            return data.substring(0, Math.floor(data.length * 0.8));
        } else if (corruption < 0.66) {
            // Modify random characters
            const chars = data.split('');
            for (let i = 0; i < Math.min(10, chars.length); i++) {
                const pos = Math.floor(Math.random() * chars.length);
                chars[pos] = String.fromCharCode(Math.floor(Math.random() * 256));
            }
            return chars.join('');
        } else {
            // Append garbage
            return data + 'CORRUPTED_DATA_' + Math.random().toString(36);
        }
    }

    async getKey(keyId: string): Promise<string | null> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to retrieve key');
        }

        if (this.shouldPartiallyFail()) {
            // A transient backend read failure must not masquerade as an
            // authoritative "key does not exist" result: that could trigger
            // unsafe key replacement. Hardened lifecycle reads fail closed.
            throw new Error('Storage partial failure: Key read was incomplete');
        }

        const result = await this.baseStorage.getKey(keyId);
        if (result && this.shouldCorruptKey()) {
            // Corrupt only the base64 portion before the version suffix to ensure
            // the corruption survives version stripping
            const [base, ...rest] = result.split('.v');
            const versionSuffix = rest.length > 0 ? '.v' + rest.join('.v') : '';
            const corruptedBase = this.corruptData(base);
            return corruptedBase + versionSuffix;
        }

        return result;
    }

    async setKey(keyId: string, key: string): Promise<void> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to store key');
        }

        if (this.shouldPartiallyFail()) {
            // Simulate partial write
            const partialKey = key.substring(0, Math.floor(key.length * 0.5));
            return this.baseStorage.setKey(keyId, partialKey);
        }

        return this.baseStorage.setKey(keyId, key);
    }

    async removeKey(keyId: string): Promise<void> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to remove key');
        }

        return this.baseStorage.removeKey(keyId);
    }

    async getMigrationState(keyId: string): Promise<MigrationState | null> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to retrieve migration state');
        }

        const result = await this.baseStorage.getMigrationState(keyId);
        if (result && this.shouldCorrupt()) {
            // Corrupt migration state
            return {
                ...result,
                oldKeyVersion: -1, // Invalid version
                cutoffTime: new Date('invalid'), // Invalid date
            };
        }

        return result;
    }

    async setMigrationState(keyId: string, state: MigrationState): Promise<void> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to store migration state');
        }

        return this.baseStorage.setMigrationState(keyId, state);
    }

    async removeMigrationState(keyId: string): Promise<void> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to remove migration state');
        }

        return this.baseStorage.removeMigrationState(keyId);
    }

    async getKeyPair(keyId: string, type: 'signing' | 'agreement'): Promise<string | null> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to retrieve key pair');
        }

        const result = await this.baseStorage.getKeyPair(keyId, type);
        if (result && this.shouldCorrupt()) {
            return this.corruptData(result);
        }

        return result;
    }

    async setKeyPair(keyId: string, type: 'signing' | 'agreement', keyPair: string): Promise<void> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to store key pair');
        }

        return this.baseStorage.setKeyPair(keyId, type, keyPair);
    }

    async removeKeyPair(keyId: string, type: 'signing' | 'agreement'): Promise<void> {
        await this.simulateDelay();

        if (this.shouldFail()) {
            throw new Error('Storage failure: Unable to remove key pair');
        }

        return this.baseStorage.removeKeyPair(keyId, type);
    }
}

// Circuit breaker for resilience testing
class CircuitBreaker {
    private failureCount = 0;
    private lastFailureTime = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';

    constructor(
        private failureThreshold: number = 5,
        private resetTimeout: number = 60000
    ) { }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'half-open';
            } else {
                throw new Error('Circuit breaker is open');
            }
        }

        try {
            const result = await operation();

            if (this.state === 'half-open') {
                this.state = 'closed';
                this.failureCount = 0;
            }

            return result;
        } catch (error) {
            this.failureCount++;
            this.lastFailureTime = Date.now();

            if (this.failureCount >= this.failureThreshold) {
                this.state = 'open';
            }

            throw error;
        }
    }

    getState() {
        return this.state;
    }

    reset() {
        this.state = 'closed';
        this.failureCount = 0;
        this.lastFailureTime = 0;
    }
}

describe('Production Failure Recovery Tests', () => {
    describe('Storage Failure Recovery', () => {
        test('should recover from transient storage failures', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            // Exercise fail-closed reads while leaving enough successful
            // attempts to prove recovery in a bounded randomized test.
            failureStorage.setFailureRate(0.1);

            const testData = 'test data for failure recovery';
            let successCount = 0;
            let failureCount = 0;

            // Attempt multiple operations
            for (let i = 0; i < 50; i++) {
                try {
                    const encrypted = await client.encrypt(testData);
                    const decrypted = await client.decrypt(encrypted);

                    if (decrypted === testData) {
                        successCount++;
                    } else {
                        failureCount++;
                    }
                } catch (error) {
                    failureCount++;
                }

                // Brief pause between operations
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            expect(successCount).toBeGreaterThan(0);
            expect(failureCount).toBeGreaterThan(0);

            // Reset failure rate and verify recovery
            failureStorage.setFailureRate(0);

            const encrypted = await client.encrypt(testData);
            const decrypted = await client.decrypt(encrypted);
            expect(decrypted).toBe(testData);

            // log removed
        }, 30000);

        test('should handle storage corruption gracefully', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            // First, store some data successfully
            const testData = 'test data for corruption recovery';
            const encrypted = await client.encrypt(testData);

            // Now enable corruption
            failureStorage.setCorruptionRate(0.8);

            // Clear cached key to force storage access
            client.clearCachedKey();

            // Try to decrypt - should fail due to corruption
            let corruptionErrors = 0;
            for (let i = 0; i < 10; i++) {
                try {
                    // Clear cache before each attempt to force storage access
                    client.clearCachedKey();
                    await client.decrypt(encrypted);
                } catch (error) {
                    corruptionErrors++;
                }
            }

            expect(corruptionErrors).toBeGreaterThan(5); // Should detect corruption

            // Reset corruption and verify recovery
            failureStorage.setCorruptionRate(0);

            // Force key regeneration to recover
            await client.rotateKey();

            const newEncrypted = await client.encrypt(testData);
            const decrypted = await client.decrypt(newEncrypted);
            expect(decrypted).toBe(testData);

            // log removed
        }, 30000);
    });

    describe('Network Failure Simulation', () => {
        test('should handle slow network conditions', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            // Simulate slow network
            failureStorage.setNetworkDelay(100);

            const testData = 'test data for slow network';
            const operations: Promise<{ success: boolean; operation: number }>[] = [];

            const startTime = performance.now();

            // Perform multiple operations
            for (let i = 0; i < 10; i++) {
                operations.push(
                    client.encrypt(testData).then(encrypted =>
                        client.decrypt(encrypted).then(decrypted => ({
                            success: decrypted === testData,
                            operation: i
                        }))
                    )
                );
            }

            const results = await Promise.all(operations);
            const endTime = performance.now();

            // All operations should succeed despite slow network
            const successRate = results.filter(r => r.success).length / results.length;
            expect(successRate).toBe(1.0);

            // Should take reasonable time even with delays
            const totalTime = endTime - startTime;
            expect(totalTime).toBeLessThan(5000); // 5 seconds max

            // log removed
        }, 30000);

        test('should handle intermittent connectivity', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            const testData = 'test data for intermittent connectivity';
            let successCount = 0;
            let retryCount = 0;
            let unavailableCount = 0;

            // Simulate intermittent connectivity deterministically. The
            // network state remains fixed for each operation, so retrying a
            // down operation must fail closed until connectivity is restored.
            for (let i = 0; i < 30; i++) {
                const isNetworkDown = i % 3 === 0;
                if (isNetworkDown) {
                    unavailableCount++;
                }
                failureStorage.setDown(isNetworkDown);

                let operationSucceeded = false;
                let attempts = 0;

                while (!operationSucceeded && attempts < 3) {
                    try {
                        const encrypted = await client.encrypt(testData);
                        const decrypted = await client.decrypt(encrypted);

                        if (decrypted === testData) {
                            operationSucceeded = true;
                            successCount++;
                        }
                    } catch (error) {
                        attempts++;
                        retryCount++;

                        // Brief pause before retry
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }

                // Brief pause between operations
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            expect(successCount).toBe(30 - unavailableCount);
            expect(retryCount).toBe(unavailableCount * 3);

            // log removed
        }, 30000);
    });

    describe('Partial State Recovery', () => {
        test('should recover from partial key corruption', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            // Store data successfully first
            const testData = 'test data for partial recovery';
            const encrypted = await client.encrypt(testData);

            // Enable partial failures (key not found)
            failureStorage.setPartialFailureRate(0.2);

            // Try multiple encrypt operations - should handle partial failures during key loading
            let keyNotFoundCount = 0;
            let successCount = 0;

            for (let i = 0; i < 20; i++) {
                try {
                    // Clear cache before each attempt to force storage access
                    client.clearCachedKey();

                    // Try to encrypt new data - this will trigger key loading
                    const newEncrypted = await client.encrypt(`test data ${i}`);
                    const newDecrypted = await client.decrypt(newEncrypted);

                    if (newDecrypted === `test data ${i}`) {
                        successCount++;
                    }
                } catch (error) {
                    // Hardened authority reads fail closed instead of replacing
                    // a durable key after an ambiguous/transient read failure.
                    keyNotFoundCount++;
                }
            }

            expect(successCount).toBeGreaterThan(0);
            expect(keyNotFoundCount).toBeGreaterThan(0);

            // Now test that we can still decrypt original data with resilience
            failureStorage.setPartialFailureRate(0.1); // Lower rate for decrypt test
            let decryptAttempts = 0;
            let decryptSuccesses = 0;

            for (let i = 0; i < 10; i++) {
                try {
                    client.clearCachedKey();
                    const decrypted = await client.decrypt(encrypted);
                    decryptAttempts++;
                    if (decrypted === testData) {
                        decryptSuccesses++;
                    }
                } catch (error) {
                    decryptAttempts++;
                    // Some failures are expected because ambiguous reads fail closed.
                }
            }

            expect(decryptAttempts).toBe(10);
            // At least some attempts should have the right key loaded
            expect(decryptSuccesses).toBeGreaterThan(0);

            // Reset and verify full recovery
            failureStorage.setPartialFailureRate(0);
            client.clearCachedKey();

            const finalDecrypted = await client.decrypt(encrypted);
            expect(finalDecrypted).toBe(testData);

            // log removed
        }, 30000);
    });

    describe('Circuit Breaker Pattern', () => {
        test('should implement circuit breaker for resilience', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });
            const circuitBreaker = new CircuitBreaker(3, 1000);

            // High failure rate to trigger circuit breaker
            failureStorage.setFailureRate(0.8);

            const testData = 'test data for circuit breaker';
            let circuitBreakerTrips = 0;
            let operationFailures = 0;
            let successCount = 0;

            // Perform operations through circuit breaker
            for (let i = 0; i < 20; i++) {
                try {
                    await circuitBreaker.execute(async () => {
                        // Clear cache to force storage access and trigger failures
                        client.clearCachedKey();
                        const encrypted = await client.encrypt(testData);

                        // Clear cache again for decrypt to also hit storage
                        client.clearCachedKey();
                        return client.decrypt(encrypted);
                    });
                    successCount++;
                } catch (error) {
                    if ((error instanceof Error ? error.message : String(error)).includes('Circuit breaker')) {
                        circuitBreakerTrips++;
                    } else {
                        operationFailures++;
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Circuit breaker should have tripped
            expect(circuitBreakerTrips).toBeGreaterThan(0);
            expect(circuitBreaker.getState()).toBe('open');

            // Restore storage before the single half-open recovery probe.
            failureStorage.setFailureRate(0);
            await new Promise(resolve => setTimeout(resolve, 1100));

            // Should be able to operate again
            const recovered = await circuitBreaker.execute(async () => {
                const encrypted = await client.encrypt(testData);
                return client.decrypt(encrypted);
            });

            expect(recovered).toBe(testData);

            // log removed
        }, 30000);
    });

    describe('Key Rotation Under Failure', () => {
        test('should handle key rotation failures gracefully', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            // Store initial data
            const testData = 'test data for rotation failure';
            await client.encrypt(testData);

            // Enable failures during rotation
            failureStorage.setFailureRate(0.6);

            let rotationFailures = 0;

            // Attempt multiple rotations
            for (let i = 0; i < 10; i++) {
                try {
                    await client.rotateKey();
                } catch (error) {
                    rotationFailures++;
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Should have some failures
            expect(rotationFailures).toBeGreaterThan(3);

            // Reset and verify system is still functional
            failureStorage.setFailureRate(0);

            const newEncrypted = await client.encrypt(testData);
            const decrypted = await client.decrypt(newEncrypted);
            expect(decrypted).toBe(testData);

            // log removed
        }, 30000);
    });

    describe('Migration Failure Recovery', () => {
        test('should handle migration failures and rollback', async () => {
            const failureStorage = new FailureSimulationStorage();
            const client = new VoidedE2EEClient({ storage: failureStorage });

            // Store data with original key
            const testData = 'test data for migration failure';
            const encrypted = await client.encrypt(testData);

            // Enable failures during migration
            failureStorage.setFailureRate(0.7);

            let migrationFailures = 0;
            let migrationSuccesses = 0;

            // Attempt migration with failures
            for (let i = 0; i < 5; i++) {
                try {
                    await client.rotateKey({ force: false, migrate: true });
                    migrationSuccesses++;
                } catch (error) {
                    migrationFailures++;
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Should have some failures
            expect(migrationFailures).toBeGreaterThan(2);

            // Reset failures and verify system state
            failureStorage.setFailureRate(0);

            // Should still be able to decrypt old data or work with new key
            try {
                const decrypted = await client.decrypt(encrypted);
                expect(decrypted).toBe(testData);
            } catch (error) {
                // If old key is not accessible, new operations should work
                const newEncrypted = await client.encrypt(testData);
                const newDecrypted = await client.decrypt(newEncrypted);
                expect(newDecrypted).toBe(testData);
            }

            // log removed
        }, 30000);
    });

    describe('Concurrent Operations Under Failure', () => {
        test('should handle concurrent operations with failures', async () => {
            const backingStorage = new InMemoryStorage();
            const initializer = new VoidedE2EEClient({ storage: backingStorage });
            await initializer.encrypt('initialize shared key');
            const failureStorage = new FailureSimulationStorage(backingStorage);

            // Concurrent lifecycle reads fail closed independently.
            failureStorage.setFailureRate(0.1);
            failureStorage.setNetworkDelay(50);

            const testData = 'concurrent test data';
            const operations: Promise<{ success: boolean; operation: number } | { success: boolean; operation: number; error: string }>[] = [];

            // Create many concurrent operations
            for (let i = 0; i < 50; i++) {
                const client = new VoidedE2EEClient({ storage: failureStorage });
                operations.push(
                    client.encrypt(testData + i)
                        .then(encrypted => client.decrypt(encrypted))
                        .then(decrypted => ({
                            success: decrypted === testData + i,
                            operation: i
                        }))
                        .catch(error => ({
                            success: false,
                            operation: i,
                            error: error instanceof Error ? error.message : String(error)
                        }))
                );
            }

            const results: any[] = await Promise.all(operations);

            // Analyze results
            const successRate = results.filter(r => r.success).length / results.length;
            expect(successRate).toBeGreaterThan(0);
            expect(successRate).toBeLessThan(1);

            failureStorage.setFailureRate(0);
            const recoveryClient = new VoidedE2EEClient({ storage: failureStorage });
            const recovered = await recoveryClient.encrypt('recovered');
            await expect(recoveryClient.decrypt(recovered)).resolves.toBe('recovered');

            // log removed
            // log removed
        }, 30000);
    });
});
