import { StorageService } from './storage-service';
import { CryptoService } from './crypto-service';
import { MigrationState } from './index';
import { inspectCanonicalBase64 } from './base64-validation';

const RAW_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const VERSIONED_KEY_PATTERN = /^([A-Za-z0-9+/]{43}=)\.v([1-9][0-9]*)$/;
const MAX_STORED_KEY_LENGTH = 44 + 2 + String(Number.MAX_SAFE_INTEGER).length;

type ParsedStoredKey = {
    rawKey: string;
    version: number;
    isVersioned: boolean;
};

export interface KeyReadLease {
    getCurrentKey(): Promise<CryptoKey>;
    getLegacyKey(): Promise<CryptoKey | null>;
    getMigrationStatus(): Promise<MigrationState | null>;
    getPersistedKeyVersion(): Promise<number | null>;
}

export interface KeyMutationSidecars {
    beforeCommit?: (targetVersion: number) => Promise<void>;
    afterCommit?: () => Promise<void>;
}

type LeaseWaiter = {
    mode: 'read' | 'write';
    resolve: (release: () => void) => void;
};

/**
 * KeyManager - Handles key lifecycle, versioning, and migration
 */
export class KeyManager {
    private keyId: string;
    private storage: StorageService;
    private crypto: CryptoService;
    private cachedKey?: CryptoKey;
    private cachedAuthorityValue?: string;
    private cachedLegacyKey?: CryptoKey;
    private cachedLegacyVersion?: number;
    private keyPromise?: Promise<CryptoKey>;
    private keyPromiseGeneration = 0;
    private activeReaders = 0;
    private writerActive = false;
    private readonly leaseQueue: LeaseWaiter[] = [];

    constructor(storage: StorageService, crypto: CryptoService, keyId: string) {
        this.keyId = keyId;
        this.storage = storage;
        this.crypto = crypto;
    }

    /**
     * Get current key, generating if necessary
     */
    async getCurrentKey(): Promise<CryptoKey> {
        return await this.withKeyReadLease(lease => lease.getCurrentKey());
    }

    private async getCurrentKeyUnlocked(): Promise<CryptoKey> {
        if (this.cachedKey) {
            return this.cachedKey;
        }

        if (this.keyPromise) {
            return this.keyPromise;
        }

        const loadPromise = this._loadOrGenerateKey();
        const generation = ++this.keyPromiseGeneration;
        this.keyPromise = loadPromise;

        try {
            return await loadPromise;
        } finally {
            // Failed storage reads must be retryable. Successful loads remain in
            // cachedKey, so retaining a settled promise is unnecessary.
            if (this.keyPromiseGeneration === generation) {
                this.keyPromise = undefined;
            }
        }
    }

    /**
     * Get key for decryption (current or legacy during migration)
     */
    async getKeyForDecryption(_blobKeyId: string): Promise<CryptoKey> {
        return this.withKeyReadLease(lease => lease.getCurrentKey());
    }

    /**
     * Set key with version
     */
    async setKey(
        key: CryptoKey,
        version: number,
        sidecars: KeyMutationSidecars = {}
    ): Promise<void> {
        const release = await this.acquireWriteLease();
        try {
            const activeMigration = await this.storage.getMigrationState(this.keyId);
            if (activeMigration?.isActive) {
                throw new Error('Cannot replace the primary key while a migration is active');
            }
            const current = await this.storage.getKey(this.keyId);
            const monotonicVersion = current
                ? Math.max(version, this.getVersionFromKey(current) + 1)
                : version;
            if (sidecars.beforeCommit) {
                await sidecars.beforeCommit(monotonicVersion);
            }
            await this.setKeyUnlocked(key, monotonicVersion);
            await this.runPostCommit(sidecars.afterCommit);
        } finally {
            release();
        }
    }

    private async setKeyUnlocked(key: CryptoKey, version: number): Promise<void> {
        if (!Number.isSafeInteger(version) || version < 1) {
            throw new Error('Key version must be a positive safe integer');
        }
        const keyString = await this.crypto.exportKey(key);
        const versionedKey = this.addVersionToKey(keyString, version);

        await this.persistAndVerify(this.keyId, versionedKey);
        this.cachedKey = key;
        this.cachedAuthorityValue = versionedKey;
        this.cachedLegacyKey = undefined;
        this.cachedLegacyVersion = undefined;
        this.keyPromise = undefined;
    }

    /**
     * Force rotate key (delete old, generate new)
     */
    async forceRotate(postCommit?: () => Promise<void>): Promise<string> {
        const release = await this.acquireWriteLease();

        try {
            const activeMigration = await this.storage.getMigrationState(this.keyId);
            if (activeMigration?.isActive) {
                await this.finalizeMigrationState(activeMigration);
            }

            // Get current version (0 if no key exists)
            const currentVersion = await this.getCurrentKeyVersionUnlocked();
            const newVersion = currentVersion + 1;
            this.assertValidKeyVersion(newVersion);

            // Generate new key
            const newKey = await this.crypto.generateKey();
            const keyString = await this.crypto.exportKey(newKey);
            const versionedKey = this.addVersionToKey(keyString, newVersion);

            // Stage and verify the replacement before overwriting the primary
            // slot. If either write fails, the old primary remains recoverable.
            const stagedKeyId = this.getVersionedStorageKey(newVersion);
            await this.persistAndVerify(stagedKeyId, versionedKey);
            try {
                await this.persistAndVerify(this.keyId, versionedKey);
            } catch (error) {
                // A storage adapter may commit the primary write and then throw,
                // or the verification read itself may fail transiently. Resolve
                // that ambiguity before deciding which key this instance owns.
                let persistedPrimary: string | null = null;
                try {
                    persistedPrimary = await this.storage.getKey(this.keyId);
                } catch {
                    this.cachedKey = undefined;
                    this.keyPromise = undefined;
                    throw error;
                }
                if (persistedPrimary !== versionedKey) {
                    throw error;
                }
            }

            // Cache the new key
            this.cachedKey = newKey;
            this.cachedAuthorityValue = versionedKey;
            this.keyPromise = undefined;
            this.cachedLegacyKey = undefined;
            this.cachedLegacyVersion = undefined;

            // Cleanup happens after the new primary is durable. A cleanup error
            // must not report that rotation failed after it irrevocably
            // succeeded; the next rotation attempts the previous slot again.
            await Promise.allSettled([
                this.storage.removeKey(stagedKeyId),
                this.storage.removeKey(this.getVersionedStorageKey(currentVersion))
            ]);

            await this.runPostCommit(postCommit);

            return await this.crypto.exportKey(newKey);
        } finally {
            release();
        }
    }

    /**
     * Start migration (keep old key, generate new)
     */
    async startMigration(cutoffTime: Date, postCommit?: () => Promise<void>): Promise<string> {
        const release = await this.acquireWriteLease();

        try {
            const existingMigration = await this.storage.getMigrationState(this.keyId);
            if (existingMigration?.isActive) {
                throw new Error('A key migration is already active');
            }

            // Migration is crash-recoverable only when the current key is
            // already durable. Session-only fallback keys can still be exported,
            // but must not enter an operation that promises durable migration.
            let currentKeyString = await this.storage.getKey(this.keyId);
            if (!currentKeyString) {
                await this.getCurrentKeyUnlocked();
                currentKeyString = await this.storage.getKey(this.keyId);
            }
            if (!currentKeyString) {
                throw new Error('Cannot migrate a key that is not durably stored');
            }
            const currentParsed = this.parseStoredKey(currentKeyString);
            const currentKey = this.cachedAuthorityValue === currentKeyString && this.cachedKey
                ? this.cachedKey
                : await this.crypto.importKey(currentParsed.rawKey);
            const currentVersion = currentParsed.version;

            // Generate new key
            const newVersion = currentVersion + 1;
            this.assertValidKeyVersion(newVersion);
            const newKey = await this.crypto.generateKey();
            const newKeyString = this.addVersionToKey(
                await this.crypto.exportKey(newKey),
                newVersion
            );
            const oldKeyString = this.addVersionToKey(
                currentParsed.rawKey,
                currentVersion
            );
            const oldStorageKey = this.getVersionedStorageKey(currentVersion);
            const newStorageKey = this.getVersionedStorageKey(newVersion);

            // Stage and read back both versions before the migration marker is
            // committed. A crash before the marker leaves the old primary live.
            try {
                await this.persistAndVerify(oldStorageKey, oldKeyString);
                await this.persistAndVerify(newStorageKey, newKeyString);
            } catch (error) {
                await Promise.allSettled([
                    this.storage.removeKey(oldStorageKey),
                    this.storage.removeKey(newStorageKey)
                ]);
                throw error;
            }

            // Create migration state
            const migrationState: MigrationState = {
                isActive: true,
                oldKeyVersion: currentVersion,
                newKeyVersion: newVersion,
                cutoffTime,
                lastProgress: 0,
                createdAt: new Date()
            };

            try {
                // The state record is the commit marker. Once it exists, reloads
                // select the staged new version and can lazily load the old one.
                await this.storage.setMigrationState(this.keyId, migrationState);
                const persistedState = await this.storage.getMigrationState(this.keyId);
                if (!this.matchesMigrationState(persistedState, migrationState)) {
                    throw new Error('Migration state storage verification failed');
                }
            } catch (error) {
                // A storage adapter may commit and then report an error. Confirm
                // the marker before deciding the migration failed, and never
                // delete staged keys while commit status is ambiguous.
                let persistedState: MigrationState | null = null;
                try {
                    persistedState = await this.storage.getMigrationState(this.keyId);
                } catch {
                    // Preserve both staged keys for recovery.
                    this.clearCache();
                    throw error;
                }
                if (!this.matchesMigrationState(persistedState, migrationState)) {
                    this.clearCache();
                    throw error;
                }
            }

            this.cachedKey = newKey;
            this.cachedAuthorityValue = newKeyString;
            this.cachedLegacyKey = currentKey;
            this.cachedLegacyVersion = currentVersion;
            this.keyPromise = undefined;

            // Keep the primary alias compatible with existing consumers. The
            // version slots and committed state are already sufficient for this
            // KeyManager to recover if the alias write is unavailable.
            try {
                await this.persistAndVerify(this.keyId, newKeyString);
            } catch {
                // Deliberately non-fatal: both migration keys and the commit
                // marker are durable, and reload reads the new version slot.
            }

            await this.runPostCommit(postCommit);

            return await this.crypto.exportKey(newKey);
        } finally {
            release();
        }
    }

    /**
     * Finalize migration (remove old key)
     */
    async finalizeMigration(): Promise<void> {
        const release = await this.acquireWriteLease();
        try {
            const migrationState = await this.storage.getMigrationState(this.keyId);
            if (!migrationState?.isActive) {
                throw new Error('No active migration to complete');
            }

            await this.finalizeMigrationState(migrationState);
        } finally {
            release();
        }
    }

    /**
     * Delete current key
     */
    async deleteKey(postCommit?: () => Promise<void>): Promise<void> {
        const release = await this.acquireWriteLease();
        try {
            const primaryKeyString = await this.storage.getKey(this.keyId);
            const migrationState = await this.storage.getMigrationState(this.keyId);
            if (migrationState?.isActive) {
                this.assertValidMigrationStateVersions(migrationState);
                await this.storage.removeKey(
                    this.getVersionedStorageKey(migrationState.oldKeyVersion)
                );
                await this.storage.removeKey(
                    this.getVersionedStorageKey(migrationState.newKeyVersion)
                );
            }
            if (primaryKeyString) {
                await this.storage.removeKey(
                    this.getVersionedStorageKey(this.getVersionFromKey(primaryKeyString))
                );
            }
            await this.storage.removeKey(this.keyId);
            await this.storage.removeMigrationState(this.keyId);
            this.clearCache();
            await this.runPostCommit(postCommit);
        } finally {
            release();
        }
    }

    /**
     * Check if key exists
     */
    async hasKey(): Promise<boolean> {
        return this.withKeyReadLease(async () => {
            const key = await this.storage.getKey(this.keyId);
            return key !== null;
        });
    }

    /**
     * Get current key version
     */
    async getCurrentKeyVersion(): Promise<number> {
        return this.withKeyReadLease(() => this.getCurrentKeyVersionUnlocked());
    }

    private async getCurrentKeyVersionUnlocked(): Promise<number> {
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (migrationState?.isActive) {
            this.assertValidMigrationStateVersions(migrationState);
            const migratedKeyString = await this.storage.getKey(
                this.getVersionedStorageKey(migrationState.newKeyVersion)
            );
            if (!migratedKeyString) {
                throw new Error('Active migration has no valid durable new key');
            }
            return this.parseStoredKey(
                migratedKeyString,
                migrationState.newKeyVersion,
                true
            ).version;
        }

        const keyString = await this.storage.getKey(this.keyId);
        if (keyString) {
            return this.getVersionFromKey(keyString);
        }

        // Only an explicit null means absence. Thrown reads propagate through the
        // storage boundary and can never trigger replacement-key generation.
        await this.getCurrentKeyUnlocked();
        const persisted = await this.storage.getKey(this.keyId);
        return persisted ? this.getVersionFromKey(persisted) : 1;
    }

    /**
     * Get migration status
     */
    async getMigrationStatus(): Promise<MigrationState | null> {
        return this.withKeyReadLease(() => this.storage.getMigrationState(this.keyId));
    }

    /**
     * Get legacy key (if available during migration)
     */
    async getLegacyKey(): Promise<CryptoKey | null> {
        return this.withKeyReadLease(lease => lease.getLegacyKey());
    }

    private async getLegacyKeyUnlocked(): Promise<CryptoKey | null> {
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (!migrationState?.isActive) {
            return null;
        }
        this.assertValidMigrationStateVersions(migrationState);

        const legacyKeyString = await this.storage.getKey(
            this.getVersionedStorageKey(migrationState.oldKeyVersion)
        );
        if (!legacyKeyString) {
            return null;
        }
        const parsedLegacyKey = this.parseStoredKey(
            legacyKeyString,
            migrationState.oldKeyVersion,
            true
        );

        if (
            this.cachedLegacyKey &&
            this.cachedLegacyVersion === parsedLegacyKey.version
        ) {
            return this.cachedLegacyKey;
        }

        const legacyKey = await this.crypto.importKey(parsedLegacyKey.rawKey);
        this.cachedLegacyKey = legacyKey;
        this.cachedLegacyVersion = migrationState.oldKeyVersion;
        return legacyKey;
    }

    /**
     * Clear cached keys
     */
    clearCache(): void {
        this.cachedKey = undefined;
        this.cachedAuthorityValue = undefined;
        this.cachedLegacyKey = undefined;
        this.cachedLegacyVersion = undefined;
        this.keyPromise = undefined;
    }

    /** Hold a stable-key read lease for the entire cryptographic operation. */
    async withKeyReadLease<T>(operation: (lease: KeyReadLease) => Promise<T>): Promise<T> {
        const release = await this.acquireReadLease();
        let active = true;
        const assertActive = () => {
            if (!active) throw new Error('Key read lease has already been released');
        };
        try {
            // Detect rotations performed sequentially by another client instance
            // sharing this storage. Concurrent cross-instance writers require an
            // application-owned storage lock and remain unsupported.
            await this.refreshCacheFromAuthority();
            const lease: KeyReadLease = {
                getCurrentKey: async () => {
                    assertActive();
                    return this.getCurrentKeyUnlocked();
                },
                getLegacyKey: async () => {
                    assertActive();
                    return this.getLegacyKeyUnlocked();
                },
                getMigrationStatus: async () => {
                    assertActive();
                    return this.storage.getMigrationState(this.keyId);
                },
                getPersistedKeyVersion: async () => {
                    assertActive();
                    return this.getPersistedKeyVersionUnlocked();
                },
            };
            return await operation(lease);
        } finally {
            active = false;
            release();
        }
    }

    private acquireReadLease(): Promise<() => void> {
        return this.enqueueLease('read');
    }

    private acquireWriteLease(): Promise<() => void> {
        return this.enqueueLease('write');
    }

    private enqueueLease(mode: 'read' | 'write'): Promise<() => void> {
        return new Promise(resolve => {
            this.leaseQueue.push({ mode, resolve });
            this.drainLeaseQueue();
        });
    }

    private drainLeaseQueue(): void {
        if (this.writerActive) return;
        if (this.activeReaders > 0) return;
        const first = this.leaseQueue[0];
        if (!first) return;

        if (first.mode === 'write') {
            this.leaseQueue.shift();
            this.writerActive = true;
            let released = false;
            first.resolve(() => {
                if (released) return;
                released = true;
                this.writerActive = false;
                this.drainLeaseQueue();
            });
            return;
        }

        while (this.leaseQueue[0]?.mode === 'read') {
            const reader = this.leaseQueue.shift()!;
            this.activeReaders++;
            let released = false;
            reader.resolve(() => {
                if (released) return;
                released = true;
                this.activeReaders--;
                if (this.activeReaders === 0) this.drainLeaseQueue();
            });
        }
    }

    /**
     * Load or generate key
     */
    private async _loadOrGenerateKey(): Promise<CryptoKey> {
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (migrationState?.isActive) {
            this.assertValidMigrationStateVersions(migrationState);
            const migratedKeyString = await this.storage.getKey(
                this.getVersionedStorageKey(migrationState.newKeyVersion)
            );
            if (!migratedKeyString) {
                throw new Error('Active migration is missing its durable new key');
            }

            const migratedKey = await this.crypto.importKey(
                this.parseStoredKey(
                    migratedKeyString,
                    migrationState.newKeyVersion,
                    true
                ).rawKey
            );
            this.cachedKey = migratedKey;
            this.cachedAuthorityValue = migratedKeyString;
            return migratedKey;
        }

        const keyString = await this.storage.getKey(this.keyId);
        if (keyString) {
            // A bare canonical key is the only accepted legacy representation.
            const parsedKey = this.parseStoredKey(keyString);
            const key = await this.crypto.importKey(parsedKey.rawKey);
            this.cachedKey = key;
            this.cachedAuthorityValue = keyString;
            return key;
        }

        // An explicit null is confirmed first use. If persistence is unavailable,
        // retain this same generated key for the current session rather than
        // generating a second, unrelated fallback key.
        const newKey = await this.crypto.generateKey();
        try {
            await this.setKeyUnlocked(newKey, 1);
            return newKey;
        } catch {
            this.cachedKey = newKey;
            this.cachedAuthorityValue = undefined;
            return newKey;
        }
    }

    private async refreshCacheFromAuthority(): Promise<void> {
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (migrationState?.isActive) {
            this.assertValidMigrationStateVersions(migrationState);
        }
        const authorityValue = migrationState?.isActive
            ? await this.storage.getKey(
                this.getVersionedStorageKey(migrationState.newKeyVersion)
            )
            : await this.storage.getKey(this.keyId);

        if (migrationState?.isActive && !authorityValue) {
            this.clearCache();
            throw new Error('Active migration is missing its durable new key');
        }
        const parsedAuthority = authorityValue
            ? this.parseStoredKey(
                authorityValue,
                migrationState?.isActive ? migrationState.newKeyVersion : undefined,
                Boolean(migrationState?.isActive)
            )
            : null;
        if (authorityValue === this.cachedAuthorityValue) return;
        if (!authorityValue || !parsedAuthority) {
            // Keep an explicitly session-only fallback, but discard a durable
            // cache after another instance deleted its authority record.
            if (this.cachedAuthorityValue !== undefined) this.clearCache();
            return;
        }

        const key = await this.crypto.importKey(parsedAuthority.rawKey);
        this.cachedKey = key;
        this.cachedAuthorityValue = authorityValue;
        this.keyPromise = undefined;
        if (!migrationState?.isActive) {
            this.cachedLegacyKey = undefined;
            this.cachedLegacyVersion = undefined;
        }
    }

    private async getPersistedKeyVersionUnlocked(): Promise<number | null> {
        const migrationState = await this.storage.getMigrationState(this.keyId);
        if (migrationState?.isActive) {
            this.assertValidMigrationStateVersions(migrationState);
            const migratedKey = await this.storage.getKey(
                this.getVersionedStorageKey(migrationState.newKeyVersion)
            );
            if (!migratedKey) {
                throw new Error('Active migration is missing its durable new key');
            }
            return this.parseStoredKey(
                migratedKey,
                migrationState.newKeyVersion,
                true
            ).version;
        }
        const keyString = await this.storage.getKey(this.keyId);
        return keyString ? this.getVersionFromKey(keyString) : null;
    }

    private getVersionedStorageKey(version: number): string {
        this.assertValidKeyVersion(version);
        return `${this.keyId}::voided:key:v${version}`;
    }

    private async persistAndVerify(storageKey: string, value: string): Promise<void> {
        try {
            await this.storage.setKey(storageKey, value);
        } catch (writeError) {
            try {
                if (await this.storage.getKey(storageKey) === value) return;
            } catch {
                this.clearCache();
            }
            throw writeError;
        }
        const persisted = await this.storage.getKey(storageKey);
        if (persisted !== value) {
            throw new Error(`Key storage verification failed for ${storageKey}`);
        }
    }

    private async runPostCommit(postCommit?: () => Promise<void>): Promise<void> {
        if (!postCommit) return;
        // The key mutation is already durable. Auxiliary metadata cleanup must
        // never make the caller believe the key operation itself failed.
        try {
            await postCommit();
        } catch {
            // Best effort by contract: the primary key is already committed.
        }
    }

    private async finalizeMigrationState(migrationState: MigrationState): Promise<void> {
        this.assertValidMigrationStateVersions(migrationState);
        const oldStorageKey = this.getVersionedStorageKey(migrationState.oldKeyVersion);
        const newStorageKey = this.getVersionedStorageKey(migrationState.newKeyVersion);
        const newKeyString = await this.storage.getKey(newStorageKey);
        if (!newKeyString) {
            throw new Error('Cannot finalize migration without its durable new key');
        }
        const parsedNewKey = this.parseStoredKey(
            newKeyString,
            migrationState.newKeyVersion,
            true
        );

        // Establish and verify the new primary before deleting any migration key.
        await this.persistAndVerify(this.keyId, newKeyString);
        const newKey = await this.crypto.importKey(parsedNewKey.rawKey);
        this.cachedKey = newKey;
        this.cachedAuthorityValue = newKeyString;
        this.keyPromise = undefined;

        // Clearing the commit marker is the irreversible finalization step. Do
        // it before deleting the old version so a failed/ambiguous marker write
        // can never leave an "active" migration whose legacy key is gone.
        try {
            await this.storage.removeMigrationState(this.keyId);
        } catch (error) {
            let persistedState: MigrationState | null;
            try {
                persistedState = await this.storage.getMigrationState(this.keyId);
            } catch {
                // Commit status is unknown. Preserve the old key and retry later.
                throw error;
            }
            if (persistedState?.isActive) {
                throw error;
            }
        }

        // Once the marker is durably absent, the primary new key is authoritative
        // and leftover version slots are safe cleanup rather than recovery state.
        await this.storage.removeKey(oldStorageKey);
        await Promise.allSettled([this.storage.removeKey(newStorageKey)]);
        this.cachedLegacyKey = undefined;
        this.cachedLegacyVersion = undefined;
    }

    private matchesMigrationState(
        actual: MigrationState | null,
        expected: MigrationState
    ): boolean {
        return Boolean(
            actual?.isActive &&
            actual.oldKeyVersion === expected.oldKeyVersion &&
            actual.newKeyVersion === expected.newKeyVersion
        );
    }

    private assertValidKeyVersion(version: number): void {
        if (!Number.isSafeInteger(version) || version < 1) {
            throw new Error('Key version must be a positive safe integer');
        }
    }

    private assertValidMigrationStateVersions(migrationState: MigrationState): void {
        this.assertValidKeyVersion(migrationState.oldKeyVersion);
        this.assertValidKeyVersion(migrationState.newKeyVersion);
        if (migrationState.newKeyVersion <= migrationState.oldKeyVersion) {
            throw new Error('Migration new key version must be greater than old key version');
        }
    }

    private isCanonicalRawKey(keyString: string): boolean {
        if (!RAW_KEY_PATTERN.test(keyString)) return false;
        const inspection = inspectCanonicalBase64(keyString, 32);
        return inspection.ok && inspection.decodedLength === 32;
    }

    private parseStoredKey(
        keyString: string,
        expectedVersion?: number,
        requireVersioned = false
    ): ParsedStoredKey {
        if (
            typeof keyString !== 'string' ||
            keyString.length < 44 ||
            keyString.length > MAX_STORED_KEY_LENGTH
        ) {
            throw new Error('Invalid stored encryption key format');
        }
        const versionedMatch = VERSIONED_KEY_PATTERN.exec(keyString);
        let parsed: ParsedStoredKey;

        if (versionedMatch) {
            const rawKey = versionedMatch[1];
            const version = Number(versionedMatch[2]);
            if (!this.isCanonicalRawKey(rawKey) || !Number.isSafeInteger(version)) {
                throw new Error('Invalid stored encryption key format');
            }
            parsed = { rawKey, version, isVersioned: true };
        } else if (this.isCanonicalRawKey(keyString)) {
            parsed = { rawKey: keyString, version: 1, isVersioned: false };
        } else {
            throw new Error('Invalid stored encryption key format');
        }

        if (expectedVersion !== undefined) {
            this.assertValidKeyVersion(expectedVersion);
            if (!parsed.isVersioned || parsed.version !== expectedVersion) {
                throw new Error(
                    `Stored encryption key version does not match expected slot v${expectedVersion}`
                );
            }
        } else if (requireVersioned && !parsed.isVersioned) {
            throw new Error('Expected a versioned stored encryption key');
        }

        return parsed;
    }

    /** Add a validated version suffix to a canonical 32-byte key. */
    private addVersionToKey(keyString: string, version: number): string {
        if (!this.isCanonicalRawKey(keyString)) {
            throw new Error('Invalid raw encryption key format');
        }
        this.assertValidKeyVersion(version);
        return `${keyString}.v${version}`;
    }

    /** Extract a validated version; an exact bare key is legacy version 1. */
    private getVersionFromKey(keyString: string): number {
        return this.parseStoredKey(keyString).version;
    }

    /** Compatibility barrier; full crypto operations must use withKeyReadLease. */
    async waitForRotationComplete(): Promise<void> {
        const release = await this.acquireReadLease();
        release();
    }
}
