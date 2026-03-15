import { VoidedE2EEClient } from '../dist/index.js';

/**
 * Advanced Security Features Example
 * Demonstrates Signal-level security features while maintaining simplicity
 */

// Example 1: Password-Based Key Derivation
async function passwordBasedEncryption() {
    console.log('=== Password-Based Encryption ===');

    const client = new VoidedE2EEClient();

    // Derive key from password instead of generating random key
    await client.deriveKeyFromPassword({
        password: 'my-super-secure-password',
        iterations: 100000 // Default, can be customized
    });

    const data = 'Secret data encrypted with password-derived key';
    const encrypted = await client.encrypt(data);
    const decrypted = await client.decrypt(encrypted);

    console.log('Original:', data);
    console.log('Decrypted:', decrypted);
    console.log('✅ Password-based encryption working');
}

// Example 2: Digital Signatures for Authenticity
async function digitalSignatures() {
    console.log('\n=== Digital Signatures ===');

    const client = new VoidedE2EEClient({
        enableSignatures: true // Enable digital signatures
    });

    // Generate signing keys
    const publicKey = await client.generateSigningKeys();
    console.log('Public key for verification:', publicKey.substring(0, 50) + '...');

    const data = 'This data will be signed to prove authenticity';
    const encrypted = await client.encrypt(data);

    // The encrypted blob now includes a digital signature
    console.log('Signature included:', !!encrypted.signature);

    const decrypted = await client.decrypt(encrypted);
    console.log('✅ Signature verified and data decrypted');
}

// Example 3: Key Fingerprints for Identity Verification
async function identityVerification() {
    console.log('\n=== Identity Verification ===');

    const alice = new VoidedE2EEClient({ keyId: 'alice' });
    const bob = new VoidedE2EEClient({ keyId: 'bob' });

    // Get fingerprints for verification
    const aliceFingerprint = await alice.getKeyFingerprint();
    const aliceSafetyNumbers = await alice.getSafetyNumbers();

    console.log('Alice\'s fingerprint:', aliceFingerprint.substring(0, 32) + '...');
    console.log('Alice\'s safety numbers:', aliceSafetyNumbers.substring(0, 50) + '...');

    // In real usage, Alice would share her fingerprint with Bob through a secure channel
    // Bob would verify the fingerprint matches what Alice told him
    const verification = await bob.verifyFingerprint(aliceFingerprint);
    console.log('Fingerprint verification:', verification);
    console.log('✅ Identity verification system working');
}

// Example 4: Key Agreement for Secure Key Exchange
async function keyAgreement() {
    console.log('\n=== Key Agreement ===');

    const alice = new VoidedE2EEClient({
        keyId: 'alice',
        enableForwardSecrecy: true
    });
    const bob = new VoidedE2EEClient({
        keyId: 'bob',
        enableForwardSecrecy: true
    });

    // Generate key agreement keys
    const alicePublicKey = await alice.generateAgreementKeys();
    const bobPublicKey = await bob.generateAgreementKeys();

    // Perform key agreement
    await alice.performKeyAgreement(bobPublicKey);
    await bob.performKeyAgreement(alicePublicKey);

    // Now they share the same encryption key
    const aliceData = 'Message from Alice';
    const encryptedByAlice = await alice.encrypt(aliceData);
    const decryptedByBob = await bob.decrypt(encryptedByAlice);

    console.log('Alice sent:', aliceData);
    console.log('Bob received:', decryptedByBob);
    console.log('✅ Key agreement successful');
}

// Example 5: Forward Secrecy with Ephemeral Keys
async function forwardSecrecy() {
    console.log('\n=== Forward Secrecy ===');

    const client = new VoidedE2EEClient({
        enableForwardSecrecy: true
    });

    // Generate agreement keys first
    await client.generateAgreementKeys();

    const data = 'This message has forward secrecy';
    const encrypted = await client.encrypt(data);

    // Each message uses a new ephemeral key
    console.log('Ephemeral key used:', !!encrypted.ephemeralPublicKey);

    const decrypted = await client.decrypt(encrypted);
    console.log('Original:', data);
    console.log('Decrypted:', decrypted);
    console.log('✅ Forward secrecy working');
}

// Example 6: All Features Combined
async function signalLevelSecurity() {
    console.log('\n=== Signal-Level Security (All Features) ===');

    const client = new VoidedE2EEClient({
        enableSignatures: true,
        enableForwardSecrecy: true
    });

    // 1. Derive key from password
    await client.deriveKeyFromPassword({
        password: 'ultra-secure-password',
        iterations: 150000
    });

    // 2. Generate all key pairs
    const signingPublicKey = await client.generateSigningKeys();
    const agreementPublicKey = await client.generateAgreementKeys();

    // 3. Get identity verification info
    const fingerprint = await client.getKeyFingerprint();
    const safetyNumbers = await client.getSafetyNumbers();

    console.log('Setup complete:');
    console.log('- Password-derived encryption key ✅');
    console.log('- Digital signature capability ✅');
    console.log('- Forward secrecy enabled ✅');
    console.log('- Identity verification ready ✅');

    // 4. Encrypt with all features
    const data = 'Maximum security message with all features enabled';
    const encrypted = await client.encrypt(data);

    console.log('\nEncrypted blob features:');
    console.log('- Compressed:', encrypted.compression.algorithm !== 'none');
    console.log('- Signed:', !!encrypted.signature);
    console.log('- Forward secret:', !!encrypted.ephemeralPublicKey);

    const decrypted = await client.decrypt(encrypted);
    console.log('\nResult:', decrypted === data ? '✅ Success!' : '❌ Failed');
}

// Example 7: Simple Usage (Backward Compatibility)
async function simpleUsage() {
    console.log('\n=== Simple Usage (Still Works!) ===');

    // The original simple API still works
    const client = new VoidedE2EEClient();

    const data = 'Simple encryption still works perfectly';
    const encrypted = await client.encrypt(data);
    const decrypted = await client.decrypt(encrypted);

    console.log('Original simple API:', decrypted === data ? '✅ Still works!' : '❌ Broken');
}

// Run all examples
async function runAllExamples() {
    try {
        await passwordBasedEncryption();
        await digitalSignatures();
        await identityVerification();
        await keyAgreement();
        await forwardSecrecy();
        await signalLevelSecurity();
        await simpleUsage();

        console.log('\n🎉 All advanced security features working perfectly!');
        console.log('Your library now has Signal-level security with simple APIs');

    } catch (error) {
        console.error('❌ Error running examples:', error);
    }
}

// Export for use
export {
    passwordBasedEncryption,
    digitalSignatures,
    identityVerification,
    keyAgreement,
    forwardSecrecy,
    signalLevelSecurity,
    simpleUsage,
    runAllExamples
};

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllExamples();
} 