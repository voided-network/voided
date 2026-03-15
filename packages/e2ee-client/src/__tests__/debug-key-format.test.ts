import { CryptoService } from '../crypto-service';

describe('Debug Key Format', () => {
    test('should export and import public key correctly', async () => {
        const crypto = new CryptoService();

        // Generate a key pair
        const keyPair = await crypto.generateKeyAgreementKeyPair();

        // Export the public key
        const exported = await crypto.exportPublicKey(keyPair.publicKey);

        // Try to import it back
        try {
            const imported = await crypto.importPublicKey(exported, 'ECDH');
            expect(imported).toBeDefined();
        } catch (error) {
            throw error;
        }
    });
}); 