import { generateKey, randomBytes, hexEncode } from './crypto-backend.js';

export interface StoredKey {
    id: string;
    key: Buffer;
    createdAt: Date;
}

/**
 * Lightweight in-memory key manager.
 *
 * NOTE: In production you would back this by a database or KMS. The goal here
 * is to make key rotation workflows _easy to test_ while leaving persistence up
 * to the implementer.
 */
export class KeyManager {
    private keys = new Map<string, StoredKey>();
    private activeKeyId?: string;

    constructor(initialKey?: Buffer) {
        if (initialKey) {
            const id = this.generateKeyId();
            this.keys.set(id, { id, key: initialKey, createdAt: new Date() });
            this.activeKeyId = id;
        }
    }

    /**
     * Generates a cryptographically-random key and sets it active.
     */
    generateAndActivateKey(): StoredKey {
        const key = generateKey();
        return this.addKey(key, true);
    }

    /**
     * Add an externally-generated key. Optionally mark it active.
     */
    addKey(key: Buffer, makeActive = false, id: string = this.generateKeyId()): StoredKey {
        const entry: StoredKey = { id, key, createdAt: new Date() };
        this.keys.set(id, entry);
        if (makeActive) this.activeKeyId = id;
        return entry;
    }

    /**
     * Returns the active key record.
     */
    get activeKey(): StoredKey {
        if (!this.activeKeyId) throw new Error('No active key');
        const key = this.keys.get(this.activeKeyId);
        if (!key) throw new Error('Active key missing from store');
        return key;
    }

    getKey(id: string): StoredKey {
        const key = this.keys.get(id);
        if (!key) throw new Error(`Key with id ${id} not found`);
        return key;
    }

    /**
     * Rotate to a brand-new key. Returns the new StoredKey.
     */
    rotateKey(): StoredKey {
        return this.generateAndActivateKey();
    }

    /**
     * Helper that returns a summary suited for logging / API responses.
     */
    toJSON() {
        return {
            activeKeyId: this.activeKeyId,
            totalKeys: this.keys.size,
            createdAt: Array.from(this.keys.values()).map(k => ({ id: k.id, createdAt: k.createdAt }))
        };
    }

    private generateKeyId(): string {
        return hexEncode(randomBytes(8));
    }
} 