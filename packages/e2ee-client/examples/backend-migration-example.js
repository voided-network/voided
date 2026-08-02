// Example: Backend Integration for Key Rotation and Data Migration
// This shows how the frontend library works with a backend to handle data migration

import { VoidedE2EEClient } from '../dist/index.js';

// Simulated backend API
class BackendAPI {
    async notifyKeyRotation(userId, migrationInfo) {
        console.log(`Backend notified of key rotation for user ${userId}:`, migrationInfo);
        // Backend would:
        // 1. Fetch all user's encrypted data
        // 2. Decrypt with old key (using the old key version)
        // 3. Re-encrypt with new key (using the new key version)
        // 4. Update database with re-encrypted data
        // 5. Return success when complete

        // Simulate async backend work
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Backend completed data re-encryption');
        return { success: true };
    }
}

// Example usage
async function exampleKeyRotationWithBackend() {
    const client = new VoidedE2EEClient({ keyId: 'user123' });
    const backend = new BackendAPI();

    console.log('=== Key Rotation with Backend Migration Example ===\n');

    // 1. Encrypt some data with original key
    console.log('1. Encrypting data with original key...');
    const originalData = 'sensitive user data';
    const encrypted = await client.encrypt(originalData);
    console.log('   Data encrypted successfully:', encrypted.messageId, '\n');

    // 2. Start key rotation with migration
    console.log('2. Starting key rotation with migration...');
    await client.rotateKey({ migrate: true });
    console.log('   Key rotation started\n');

    // 3. Get migration info for backend
    console.log('3. Getting migration info for backend...');
    const migrationInfo = await client.getMigrationInfo();
    console.log('   Migration info:', migrationInfo);
    console.log('   Backend should re-encrypt all data from version', migrationInfo.oldKeyVersion, 'to', migrationInfo.newKeyVersion, '\n');

    // 4. Notify backend to re-encrypt all user data
    console.log('4. Notifying backend to re-encrypt user data...');
    await backend.notifyKeyRotation('user123', migrationInfo);
    console.log('   Backend migration completed\n');

    // 5. Finalize migration (clean up old keys)
    console.log('5. Finalizing migration...');
    await client.finalizeMigration();
    console.log('   Migration finalized - old keys cleaned up\n');

    // 6. Verify everything still works
    console.log('6. Verifying new encryption/decryption...');
    const newData = 'new data encrypted with new key';
    const newEncrypted = await client.encrypt(newData);
    const newDecrypted = await client.decrypt(newEncrypted);
    console.log('   New data encryption/decryption works:', newDecrypted === newData);

    // 7. Verify old data is still accessible (if backend re-encrypted it)
    console.log('\n7. Verifying old data accessibility...');
    console.log('   Note: Old data would now be encrypted with the new key by the backend');
    console.log('   The original encrypted blob is no longer valid');

    console.log('\n=== Example Complete ===');
}

// Example of force rotation (no backend needed)
async function exampleForceRotation() {
    const client = new VoidedE2EEClient({ keyId: 'user456' });

    console.log('=== Force Rotation Example ===\n');

    // 1. Encrypt data
    console.log('1. Encrypting data...');
    const data = 'data that will become unrecoverable';
    const encrypted = await client.encrypt(data);
    console.log('   Data encrypted\n');

    // 2. Force rotate (immediately delete old key)
    console.log('2. Force rotating key...');
    await client.rotateKey({ force: true });
    console.log('   Force rotation complete - old key deleted\n');

    // 3. Verify old data is unrecoverable
    console.log('3. Attempting to decrypt old data...');
    try {
        await client.decrypt(encrypted);
        console.log('   ERROR: Old data should be unrecoverable!');
    } catch (error) {
        console.log('   ✓ Old data is correctly unrecoverable');
    }

    // 4. Verify new data works
    console.log('\n4. Verifying new data encryption...');
    const newData = 'new data';
    const newEncrypted = await client.encrypt(newData);
    const newDecrypted = await client.decrypt(newEncrypted);
    console.log('   New data works:', newDecrypted === newData);

    console.log('\n=== Force Rotation Complete ===');
}

// Run examples
if (typeof window !== 'undefined') {
    // Browser environment
    window.exampleKeyRotationWithBackend = exampleKeyRotationWithBackend;
    window.exampleForceRotation = exampleForceRotation;
    console.log('Examples loaded. Run:');
    console.log('  exampleKeyRotationWithBackend()');
    console.log('  exampleForceRotation()');
} else {
    // Node.js environment
    exampleKeyRotationWithBackend().catch(console.error);
    exampleForceRotation().catch(console.error);
}
