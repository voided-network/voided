import { StorageService } from './storage-service';
import { CryptoService } from './crypto-service';
import { MigrationState } from './index';

/**
 * KeyManager - Handles key lifecycle, versioning, and migration
 */
export class KeyManager {
    private keyId: string;
    private storage: StorageService;
    private crypto: CryptoService;
    private cachedKey?: CryptoKey;
    private cachedLegacyKey?: CryptoKey;
    private keyPromise?: Promise<CryptoKey>;
    private rotationLock?: Promise<void>;
    // Track whether we've successfully persisted a key at least once.
    // Used to avoid clobbering an existing key during transient storage read failures.
    private hasPersistedKey: boolean = false;
    // Flag to indicate we are inside a rotation operation; used to prevent deadlocks
    // if any internal code path ends up calling methods that would otherwise wait
    // for rotation to complete.
    private isRotating: boolean = false;

    constructor(storage: StorageService, crypto: CryptoService, keyId: string) {
        this.keyId = keyId;
        this.storage = storage;
        this.crypto = crypto;
    }

    /**
     * Get current key, generating if necessary
     */
    async getCurrentKey(): Promise<CryptoKey> {
        if (this.cachedKey) {
            return this.cachedKey;
        }

        if (this.keyPromise) {
            return this.keyPromise;
        }

        this.keyPromise = this._loadOrGenerateKey();
        return this.keyPromise;
    }

    /**
     * Get key for decryption (current or legacy during migration)
     */
    async getKeyForDecryption(blobKeyId: string): Promise<CryptoKey> {
        // Get current key
        const currentKey = await this.getCurrentKey();

        // Check if we're in migration and have a legacy key
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (migrationState?.isActive && this.cachedLegacyKey) {
            // Return both keys - the decrypt method will try current first, then legacy
            return currentKey;
        }

        return currentKey;
    }

    /**
     * Set key with version
     */
    async setKey(key: CryptoKey, version: number): Promise<void> {
        const keyString = await this.crypto.exportKey(key);
        const versionedKey = this.addVersionToKey(keyString, version);

        await this.storage.setKey(this.keyId, versionedKey);
        this.cachedKey = key;
        this.keyPromise = undefined;
        this.hasPersistedKey = true;
    }

    /**
     * Force rotate key (delete old, generate new)
     */
    async forceRotate(): Promise<string> {
        const release = await this.acquireRotationLock();

        try {
            this.isRotating = true;
            // Get current version (0 if no key exists)
            const currentVersion = await this.getCurrentKeyVersion();
            const newVersion = currentVersion + 1;

            // Generate new key
            const newKey = await this.crypto.generateKey();

            // Delete old key first to make old data unrecoverable
            await this.storage.removeKey(this.keyId);

            // Store new key with same key ID
            const keyString = await this.crypto.exportKey(newKey);
            const versionedKey = this.addVersionToKey(keyString, newVersion);
            await this.storage.setKey(this.keyId, versionedKey);

            // Cache the new key
            this.cachedKey = newKey;
            this.keyPromise = undefined;
            this.hasPersistedKey = true;

            // Clear migration state
            await this.storage.removeMigrationState(this.keyId);

            // Clear legacy cache
            this.cachedLegacyKey = undefined;

            return await this.crypto.exportKey(newKey);
        } finally {
            this.isRotating = false;
            release();
        }
    }

    /**
     * Start migration (keep old key, generate new)
     */
    async startMigration(cutoffTime: Date): Promise<string> {
        const release = await this.acquireRotationLock();

        try {
            this.isRotating = true;
            // Get current key as legacy BEFORE storing new key
            const currentKey = await this.getCurrentKey();
            this.cachedLegacyKey = currentKey;

            // Generate new key
            const newKey = await this.crypto.generateKey();
            const currentVersion = await this.getCurrentKeyVersion();
            const newVersion = currentVersion + 1;

            // Store new key (this will overwrite the current key in storage)
            await this.setKey(newKey, newVersion);
            this.hasPersistedKey = true;

            // Create migration state
            const migrationState: MigrationState = {
                isActive: true,
                oldKeyVersion: currentVersion,
                newKeyVersion: newVersion,
                cutoffTime,
                lastProgress: 0,
                createdAt: new Date()
            };

            await this.storage.setMigrationState(this.keyId, migrationState);

            return await this.crypto.exportKey(newKey);
        } finally {
            this.isRotating = false;
            release();
        }
    }

    /**
     * Finalize migration (remove old key)
     */
    async finalizeMigration(): Promise<void> {
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (!migrationState?.isActive) {
            throw new Error('No active migration to complete');
        }

        // Remove old key and migration state
        await this.storage.removeKey(this.keyId);
        await this.storage.removeMigrationState(this.keyId);

        // Clear legacy cache
        this.cachedLegacyKey = undefined;
    }

    /**
     * Delete current key
     */
    async deleteKey(): Promise<void> {
        await this.storage.removeKey(this.keyId);
        await this.storage.removeMigrationState(this.keyId);
        this.clearCache();
        this.hasPersistedKey = false;
    }

    /**
     * Check if key exists
     */
    async hasKey(): Promise<boolean> {
        const key = await this.storage.getKey(this.keyId);
        return key !== null;
    }

    /**
     * Get current key version
     */
    async getCurrentKeyVersion(): Promise<number> {
        const keyString = await this.storage.getKey(this.keyId);
        if (keyString) {
            this.hasPersistedKey = true;
            return this.getVersionFromKey(keyString);
        }
        // If storage returned null and we've never persisted a key in this session,
        // initialize one to ensure versioning starts at 1.
        if (!this.hasPersistedKey) {
            const newKey = await this.crypto.generateKey();
            await this.setKey(newKey, 1);
            return 1;
        }
        // If we've persisted a key before, treat this as a transient read failure;
        // do not generate/store a new key to avoid clobbering a valid existing key.
        return 0;
    }

    /**
     * Get migration status
     */
    async getMigrationStatus(): Promise<MigrationState | null> {
        return this.storage.getMigrationState(this.keyId);
    }

    /**
     * Get legacy key (if available during migration)
     */
    async getLegacyKey(): Promise<CryptoKey | null> {
        return this.cachedLegacyKey || null;
    }

    /**
     * Clear cached keys
     */
    clearCache(): void {
        this.cachedKey = undefined;
        this.cachedLegacyKey = undefined;
        this.keyPromise = undefined;
    }

    /**
     * Acquire rotation lock to prevent concurrent rotations
     */
    private async acquireRotationLock(): Promise<() => void> {
        // Wait for any existing rotation to complete
        while (this.rotationLock) {
            await this.rotationLock;
        }

        let resolveLock: () => void;
        this.rotationLock = new Promise(resolve => {
            resolveLock = resolve;
        });

        return () => {
            resolveLock!();
            this.rotationLock = undefined;
        };
    }

    /**
     * Load or generate key
     */
    private async _loadOrGenerateKey(): Promise<CryptoKey> {
        try {
            const keyString = await this.storage.getKey(this.keyId);

            if (keyString) {
                // Handle both versioned and legacy keys
                const cleanKeyString = this.removeVersionFromKey(keyString);
                const key = await this.crypto.importKey(cleanKeyString);
                this.cachedKey = key;
                this.hasPersistedKey = true;
                return key;
            }
        } catch (error) {
            //if (process.env.NODE_ENV !== 'test') console.warn('Failed to load key from storage:', error);
        }

        // Storage did not return a key. If we've never persisted before in this session,
        // this is likely first-run: generate and persist a new key. If we have persisted
        // before, treat as transient failure: DO NOT overwrite storage; generate an
        // in-memory key so operations can continue, but allow future reads to recover
        // the original persisted key when storage succeeds.
        if (!this.hasPersistedKey) {
            try {
                const newKey = await this.crypto.generateKey();
                await this.setKey(newKey, 1); // Start at version 1
                return newKey;
            } catch (error) {
                // Continue with in-memory key if persisting fails
                const newKey = await this.crypto.generateKey();
                this.cachedKey = newKey;
                return newKey;
            }
        } else {
            const newKey = await this.crypto.generateKey();
            this.cachedKey = newKey;
            return newKey;
        }
    }

    /**
     * Add version to key string
     */
    private addVersionToKey(keyString: string, version: number): string {
        return `${keyString}.v${version}`;
    }

    /**
     * Extract version from key string
     */
    private getVersionFromKey(keyString: string): number {
        const parts = keyString.split('.v');
        if (parts.length !== 2) return 1; // Default to version 1 for legacy keys

        const version = parseInt(parts[1], 10);
        return isNaN(version) ? 1 : version;
    }

    /**
     * Remove version from key string
     */
    private removeVersionFromKey(keyString: string): string {
        const parts = keyString.split('.v');
        return parts[0]; // Return the key without version
    }
}

// Public utility to allow the client to wait for any ongoing rotation
export interface RotationWaitable {
    waitForRotationComplete(): Promise<void>;
}

// Augment KeyManager with a wait method without exposing locks directly
export interface KeyManager extends RotationWaitable { }

KeyManager.prototype.waitForRotationComplete = async function (this: KeyManager): Promise<void> {
    const self = this as unknown as KeyManager & { rotationLock?: Promise<void> };
    // @ts-ignore accessing private field intentionally within same module scope
    const lock = (self as any).rotationLock as Promise<void> | undefined;
    if (lock) {
        await lock;
    }
};