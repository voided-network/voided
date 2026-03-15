import { VoidedE2EEClient } from '../index';
import { InMemoryStorage } from './test-utils';

describe('Advanced Security Features', () => {
    test('Password-based key derivation encrypts and decrypts correctly', async () => {
        const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
        await client.deriveKeyFromPassword({ password: 'test-password', iterations: 100000 });
        const data = 'password-derived secret';
        const encrypted = await client.encrypt(data);
        const decrypted = await client.decrypt(encrypted);
        expect(decrypted).toBe(data);
    });

    test('Digital signatures: encrypt includes signature, decrypt verifies', async () => {
        const client = new VoidedE2EEClient({ storage: new InMemoryStorage(), enableSignatures: true });
        await client.generateSigningKeys();
        const data = 'signed data';
        const encrypted = await client.encrypt(data);
        expect(encrypted.signature).toBeDefined();
        const decrypted = await client.decrypt(encrypted);
        expect(decrypted).toBe(data);
    });

    test('Key fingerprints and safety numbers are consistent', async () => {
        const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
        const fingerprint = await client.getKeyFingerprint();
        const safetyNumbers = await client.getSafetyNumbers();
        expect(typeof fingerprint).toBe('string');
        expect(typeof safetyNumbers).toBe('string');
        expect(fingerprint.length).toBeGreaterThan(10);
        expect(safetyNumbers.length).toBeGreaterThan(10);
    });

    test('Key agreement (ECDH) produces shared secret for encryption', async () => {
        const alice = new VoidedE2EEClient({ storage: new InMemoryStorage() });
        const bob = new VoidedE2EEClient({ storage: new InMemoryStorage() });
        const alicePub = await alice.generateAgreementKeys();
        const bobPub = await bob.generateAgreementKeys();
        await alice.performKeyAgreement(bobPub);
        await bob.performKeyAgreement(alicePub);
        const msg = 'ecdh shared secret';
        const encrypted = await alice.encrypt(msg);
        const decrypted = await bob.decrypt(encrypted);
        expect(decrypted).toBe(msg);
    });

    test('Forward secrecy: ephemeral keys are used and decrypts correctly', async () => {
        const client = new VoidedE2EEClient({ storage: new InMemoryStorage(), enableForwardSecrecy: true });
        await client.generateAgreementKeys();
        const data = 'forward secret message';
        const encrypted = await client.encrypt(data);
        expect(encrypted.ephemeralPublicKey).toBeDefined();
        const decrypted = await client.decrypt(encrypted);
        expect(decrypted).toBe(data);
    });
}); 