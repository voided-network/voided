import { E2EEStorage, MigrationState } from './index';

/**
 * StorageService - Abstracts storage operations
 */
export class StorageService {
    private storage: E2EEStorage;

    constructor(storage: E2EEStorage) {
        this.storage = storage;
    }

    /**
     * Get key from storage
     */
    async getKey(keyId: string): Promise<string | null> {
        return this.storage.getKey(keyId);
    }

    /**
     * Store key in storage
     */
    async setKey(keyId: string, key: string): Promise<void> {
        return this.storage.setKey(keyId, key);
    }

    /**
     * Remove key from storage
     */
    async removeKey(keyId: string): Promise<void> {
        return this.storage.removeKey(keyId);
    }

    /**
     * Get migration state from storage
     */
    async getMigrationState(keyId: string): Promise<MigrationState | null> {
        return this.storage.getMigrationState(keyId);
    }

    /**
     * Store migration state
     */
    async setMigrationState(keyId: string, state: MigrationState): Promise<void> {
        return this.storage.setMigrationState(keyId, state);
    }

    /**
     * Remove migration state
     */
    async removeMigrationState(keyId: string): Promise<void> {
        return this.storage.removeMigrationState(keyId);
    }

    /**
     * Get key pair from storage
     */
    async getKeyPair(keyId: string, type: 'signing' | 'agreement'): Promise<string | null> {
        return this.storage.getKeyPair(keyId, type);
    }

    /**
     * Store key pair in storage
     */
    async setKeyPair(keyId: string, type: 'signing' | 'agreement', keyPair: string): Promise<void> {
        return this.storage.setKeyPair(keyId, type, keyPair);
    }

    /**
     * Remove key pair from storage
     */
    async removeKeyPair(keyId: string, type: 'signing' | 'agreement'): Promise<void> {
        return this.storage.removeKeyPair(keyId, type);
    }
} 