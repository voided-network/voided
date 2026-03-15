import { E2EEStorage, MigrationState } from '../index';

/**
 * In-memory storage implementation for testing
 */
export class InMemoryStorage implements E2EEStorage {
    private storage = new Map<string, string>();
    private migrationStorage = new Map<string, MigrationState>();
    private keyPairStorage = new Map<string, string>();

    async getKey(keyId: string): Promise<string | null> {
        return this.storage.get(keyId) || null;
    }

    async setKey(keyId: string, key: string): Promise<void> {
        this.storage.set(keyId, key);
    }

    async removeKey(keyId: string): Promise<void> {
        this.storage.delete(keyId);
    }

    async getMigrationState(keyId: string): Promise<MigrationState | null> {
        return this.migrationStorage.get(keyId) || null;
    }

    async setMigrationState(keyId: string, state: MigrationState): Promise<void> {
        this.migrationStorage.set(keyId, state);
    }

    async removeMigrationState(keyId: string): Promise<void> {
        this.migrationStorage.delete(keyId);
    }

    async getKeyPair(keyId: string, type: 'signing' | 'agreement'): Promise<string | null> {
        return this.keyPairStorage.get(`${keyId}_${type}`) || null;
    }

    async setKeyPair(keyId: string, type: 'signing' | 'agreement', keyPair: string): Promise<void> {
        this.keyPairStorage.set(`${keyId}_${type}`, keyPair);
    }

    async removeKeyPair(keyId: string, type: 'signing' | 'agreement'): Promise<void> {
        this.keyPairStorage.delete(`${keyId}_${type}`);
    }
} 